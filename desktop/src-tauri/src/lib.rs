use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::{Update, UpdaterExt};

/* A downloaded update parks here until the human says "restart" — the shell
   never installs out from under a running week. */
struct PendingUpdate(Mutex<Option<(Update, Vec<u8>)>>);

#[tauri::command]
async fn apply_update(state: tauri::State<'_, PendingUpdate>) -> Result<(), String> {
    let staged = state.0.lock().expect("update lock").take();
    match staged {
        // install() hands off to the platform installer and exits the app
        Some((update, bytes)) => update.install(bytes).map_err(|e| e.to_string()),
        None => Err("no update staged".into()),
    }
}

/* Clicking a native nudge toast must bring the week back: show (hidden),
   unminimize (taskbar), focus (raise). One app command keeps window ops in
   the shell — the webview's notification click route (#216) invokes it
   without any extra core:window capability grants. Best-effort on purpose:
   a window op the platform refuses must never surface as an error. */
#[tauri::command]
fn focus_main_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/* ── gbrain sidecar: the brain that ships invisibly ─────────────────────
   The installer bundles a bun-compiled `gbrain` binary; the shell owns its
   whole lifecycle against an app-managed PGLite brain under
   app_data_dir()/brain. The webview never spawns anything — it receives
   {url, token} over one handshake (event + pull command) and talks plain
   HTTP from there. A dead brain never blocks the week (MEW's keyless floor
   carries it) but is never invisible either: mew://brain-status reports each
   lifecycle beat so Settings can show it. A user who already runs their own
   gbrain opts in via Settings, which outranks the sidecar in the webview. */

const SIDECAR: &str = "gbrain";
/// after this many unexpected exits the shell gives up — floor takes over,
/// and the webview hears "unavailable" rather than silence
const MAX_RESTARTS: u32 = 3;
/// PGLite's first boot loads WASM and writes a fresh datadir — generous on purpose
const PORT_WAIT: Duration = Duration::from_secs(90);

#[derive(Clone, serde::Serialize)]
struct BrainEndpoint {
    url: String,
    token: String,
}

#[derive(Default)]
struct BrainState {
    endpoint: Mutex<Option<BrainEndpoint>>,
    /// last lifecycle beat ("starting" / "connected" / "retrying" /
    /// "unavailable"; "" before the first) — the pull side of
    /// mew://brain-status, for a webview that mounts or reloads after
    /// beats fired (the manager thread never re-emits)
    status: Mutex<String>,
    child: Mutex<Option<CommandChild>>,
    shutting_down: AtomicBool,
}

#[tauri::command]
fn brain_endpoint(state: tauri::State<'_, BrainState>) -> Option<BrainEndpoint> {
    state.endpoint.lock().expect("brain lock").clone()
}

#[tauri::command]
fn brain_status(state: tauri::State<'_, BrainState>) -> String {
    state.status.lock().expect("brain status lock").clone()
}

/// Ask the OS for a free loopback port. `gbrain serve --port 0` falls back
/// to its default (3131), so the shell must choose; the tiny window between
/// drop and reuse is acceptable on a single user machine.
fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port())
}

/// One short-lived gbrain run (init / auth) against the app's brain home.
/// stdin is a pipe, never a TTY — gbrain's interactive prompts (including
/// its self-upgrade offer) cannot fire, and `serve` below inherits the same
/// guarantee; MEW's updater is the only thing that ships new sidecars.
async fn gbrain_once(app: &AppHandle, home: &str, args: &[&str]) -> Result<String, String> {
    let out = app
        .shell()
        .sidecar(SIDECAR)
        .map_err(|e| e.to_string())?
        .args(args)
        .env("GBRAIN_HOME", home)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "gbrain {} exited {:?}: {}",
            args.first().unwrap_or(&""),
            out.status.code(),
            String::from_utf8_lossy(&out.stderr).chars().take(400).collect::<String>(),
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// First run init → fresh per-launch token → serve on a shell-chosen port.
/// Returns once the port accepts TCP (the webview's BrainPort does real
/// /health probes from there on).
async fn spawn_brain(
    app: &AppHandle,
    home: &str,
) -> Result<(BrainEndpoint, CommandChild, tauri::async_runtime::Receiver<CommandEvent>), String> {
    /* first run: a brain home without a config gets a keyless PGLite brain —
       embeddings stay off (no key to embed with); gbrain's keyword search
       still serves recall, exactly the adapter's fallback path */
    if !Path::new(home).join(".gbrain").join("config.json").exists() {
        gbrain_once(app, home, &["init", "--pglite", "--non-interactive", "--no-embedding"]).await?;
    }

    /* fresh token every launch, revoke-then-create: self-healing against a
       restored/wiped brain DB, and no plaintext secret ever touches disk.
       Both runs open PGLite, so they must finish before serve takes the lock.
       --takes-holders is the default value, passed explicitly because the
       pinned CLI mis-parses a bare `auth create <name>` (flag index -1 makes
       its positional scan exclude the name itself). */
    let _ = gbrain_once(app, home, &["auth", "revoke", "mew-desktop"]).await;
    let minted =
        gbrain_once(app, home, &["auth", "create", "mew-desktop", "--takes-holders", "world"]).await?;
    let token = minted
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with("gbrain_"))
        .ok_or("gbrain auth create printed no token")?
        .to_string();

    let port = free_port().map_err(|e| e.to_string())?;
    let (mut rx, child) = app
        .shell()
        .sidecar(SIDECAR)
        .map_err(|e| e.to_string())?
        .args(["serve", "--http", "--port", &port.to_string(), "--suppress-bootstrap-token"])
        .env("GBRAIN_HOME", home)
        .spawn()
        .map_err(|e| e.to_string())?;

    /* handshake = the chosen port accepting; drain the event channel while
       waiting so the child's stdio pipes can never fill and stall it */
    let deadline = Instant::now() + PORT_WAIT;
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    loop {
        while let Ok(ev) = rx.try_recv() {
            if let CommandEvent::Terminated(p) = ev {
                return Err(format!("gbrain serve exited during startup: {:?}", p.code));
            }
        }
        if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
            break;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            return Err("gbrain serve never opened its port".into());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    Ok((
        BrainEndpoint { url: format!("http://127.0.0.1:{port}"), token },
        child,
        rx,
    ))
}

/// Whole-lifecycle manager: spawn, hand the endpoint to the webview, park on
/// the event stream, respawn on unexpected death (fresh port + token each
/// time), give up after MAX_RESTARTS — still no error theater, but never
/// silent: every lifecycle beat is emitted as mew://brain-status ("starting" /
/// "retrying" / "unavailable"; connected is the mew://brain-endpoint handshake
/// itself) and kept in BrainState for the brain_status pull, so any webview —
/// even one that mounts late or reloads — can answer "is my brain on?" (#249).
fn manage_brain(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Ok(data_dir) = app.path().app_data_dir() else { return };
        let home_path = data_dir.join("brain");
        if std::fs::create_dir_all(&home_path).is_err() {
            return;
        }
        let home = home_path.to_string_lossy().into_owned();
        /* each beat is stored AND emitted: the event serves a live webview,
           the stored copy serves the brain_status pull — a webview that
           mounts after "starting" (React boots slower than this thread) or
           reloads after the give-up must not miss the lifecycle. Plain
           strings keep the webview decoupled from Rust types. */
        let beat = |status: &str| {
            *app.state::<BrainState>().status.lock().expect("brain status lock") =
                status.to_string();
            let _ = app.emit("mew://brain-status", status);
        };
        /* deliberately never reset on healthy uptime: the budget is 3 deaths
           per app session, so a slow-flapping brain still converges to the
           floor instead of restarting forever; relaunching MEW renews it */
        let mut restarts: u32 = 0;
        loop {
            let state = app.state::<BrainState>();
            if state.shutting_down.load(Ordering::SeqCst) {
                return;
            }
            beat("starting");
            match spawn_brain(&app, &home).await {
                Err(e) => eprintln!("mew: brain sidecar unavailable: {e}"),
                Ok((endpoint, child, mut rx)) => {
                    *state.child.lock().expect("child lock") = Some(child);
                    *state.endpoint.lock().expect("brain lock") = Some(endpoint.clone());
                    /* stored only, never a beat event: the endpoint handshake
                       below is the one connected signal (it carries the keys) */
                    *state.status.lock().expect("brain status lock") = "connected".to_string();
                    let _ = app.emit("mew://brain-endpoint", endpoint);
                    /* park here for the life of the process, draining stdio */
                    while let Some(ev) = rx.recv().await {
                        if matches!(ev, CommandEvent::Terminated(_)) {
                            break;
                        }
                    }
                    *state.endpoint.lock().expect("brain lock") = None;
                    *state.child.lock().expect("child lock") = None;
                }
            }
            if state.shutting_down.load(Ordering::SeqCst) {
                return;
            }
            restarts += 1;
            if restarts > MAX_RESTARTS {
                eprintln!("mew: brain sidecar gave up after {MAX_RESTARTS} restarts — running on the floor");
                beat("unavailable");
                return;
            }
            beat("retrying");
            tokio::time::sleep(Duration::from_secs(1 << restarts.min(4))).await;
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate(Mutex::new(None)))
        .manage(BrainState::default())
        .invoke_handler(tauri::generate_handler![
            apply_update,
            brain_endpoint,
            brain_status,
            focus_main_window
        ])
        .setup(|app| {
            /* check-on-launch: download quietly in the background, then let
               the webview ask in MEW's voice (mew://update-ready). Install
               happens only when the human accepts (apply_update above). */
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let Ok(updater) = handle.updater() else { return };
                let Ok(Some(update)) = updater.check().await else { return };
                let version = update.version.clone();
                let Ok(bytes) = update.download(|_, _| {}, || {}).await else { return };
                handle
                    .state::<PendingUpdate>()
                    .0
                    .lock()
                    .expect("update lock")
                    .replace((update, bytes));
                let _ = handle.emit("mew://update-ready", version);
            });
            manage_brain(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while launching MEW");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            /* kill on exit — serve must not outlive the window. (gbrain's own
               parent-process watchdog is the backstop for hard kills.) The
               taken child is bound first so the MutexGuard temporary drops at
               the end of its own statement, before `state` (E0597 otherwise:
               a tail-position `if let` extends the temporary past the guard). */
            let state = handle.state::<BrainState>();
            state.shutting_down.store(true, Ordering::SeqCst);
            let child = state.child.lock().expect("child lock").take();
            if let Some(child) = child {
                let _ = child.kill();
            }
        }
    });
}
