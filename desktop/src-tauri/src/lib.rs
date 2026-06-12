use std::sync::Mutex;
use tauri::{Emitter, Manager};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![apply_update])
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while launching MEW")
}
