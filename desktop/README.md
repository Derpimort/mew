# MEW desktop (Tauri 2 shell)

The shell carries zero product logic — it wraps `app/dist` (see issue #2).

```sh
cd desktop
pnpm install
pnpm dev      # tauri dev against the vite server (starts it via beforeDevCommand)
pnpm build    # production installers (CI builds the real artifacts per-OS)
```

Storage: IndexedDB lives in the app-scoped webview profile. Phase 2 adds
auto-backup to ~/Documents/MEW via the FS plugin; phase 3 the Google OAuth
loopback; phase 4 the release CI + updater; phase 5 the built-in brain.

## Built-in brain (gbrain sidecar)

The installer ships a bun-compiled `gbrain` binary as a Tauri sidecar — a
user who has never heard of bun gets the full brain from one installer, no
keys, no setup. The shell owns the whole lifecycle:

- **First run**: `gbrain init --pglite --non-interactive --no-embedding`
  against an app-managed brain at `app_data_dir()/brain` (PGLite, keyless —
  recall rides keyword search, the adapter's existing fallback).
- **Every launch**: mint a fresh API token (`auth revoke` + `auth create` —
  self-healing, no plaintext secret ever touches disk), pick a free loopback
  port, `gbrain serve --http --port <p> --suppress-bootstrap-token`, then hand
  the webview `{url, token}` (the `mew://brain-endpoint` event + the
  `brain_endpoint` command). Explicit Settings config outranks the sidecar —
  point MEW at your own `gbrain serve --http` and the shell's stays untouched.
- **Lifecycle**: unexpected exit → respawn with fresh port+token (max 3,
  then give up quietly — the keyless floor carries the week); app exit →
  the child is killed (gbrain's parent-watchdog backstops hard kills).
- **Self-upgrade is inert by construction**: the sidecar's stdin is a pipe,
  never a TTY, and the upgrade prompt only triggers on remote-brain banners —
  MEW's own updater is the only thing that ships new sidecars.

Build the sidecar locally before `pnpm dev`/`pnpm build` (CI does the same
before `tauri build`):

```sh
node scripts/build-sidecar.mjs        # host target, from desktop/
```

The pin lives in `gbrain.version` (`owner/repo#ref`) — bumping the brain is a
one-line PR that CI proves by compiling. Binaries land in
`src-tauri/binaries/gbrain-<target-triple>` (gitignored).

The webview's CSP allows `connect-src http://127.0.0.1:*` for this: the
sidecar port is chosen fresh each launch, so the loopback origin can't be
pinned tighter than the host. Nothing binds beyond 127.0.0.1.

## Self-update + release signing (one-time setup)

Releases self-update from GitHub Releases: tagging `v*` builds installers and
`latest.json`; the installed app checks on launch, downloads quietly, and asks
in chat — *"v… is downloaded and ready — restart when you like"*. It never
restarts on its own; install runs only when you accept.

Updater artifacts must be signed. One-time, on a trusted machine:

```sh
cd desktop && pnpm install
pnpm tauri signer generate -w ~/.tauri/mew.key   # prompts for a password
```

1. Paste the contents of `~/.tauri/mew.key.pub` into `plugins.updater.pubkey`
   in `src-tauri/tauri.conf.json` (replacing the committed placeholder) — the
   public half is meant to be committed.
2. Add two repo **Actions secrets** (the names the workflow passes through):
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/mew.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you chose
3. Keep the private key somewhere safe: lose it and shipped apps can never
   accept another update (Tauri's own warning).

Dry-run without releasing: Actions → desktop → *Run workflow* — the full
matrix builds installers + updater artifacts, publishes nothing.

The updater signature validation (the `tauri.conf.json` `plugins.updater.pubkey`)
is part of our security model: the installed app accepts an update only if its
artifacts verify against that committed public key, so a tampered or unsigned
`latest.json`/installer is rejected. That public key, the signing-key handling
above, and CSP/key-handling scope are covered by the repo
[security policy](../.github/SECURITY.md).

## Google Calendar sign-in (one-time OAuth client config)

Google refuses OAuth inside embedded webviews (`disallowed_useragent`), so the
desktop shell signs in through your **system browser** and catches the redirect
on a localhost loopback. This needs one human step on your existing OAuth
client (the same Web-application client ID the web app uses):

1. [Google Cloud Console](https://console.cloud.google.com) → APIs & Services
   → Credentials → your **Web application** client.
2. Under **Authorized redirect URIs**, add all three loopback candidates
   (Web clients require exact matches, so the shell binds one of these
   fixed ports rather than a random one):
   - `http://localhost:17893`
   - `http://localhost:17894`
   - `http://localhost:17895`
3. Keep your dev/app origins under *Authorized JavaScript origins* as before —
   the web build's popup flow is untouched.

Why not a "Desktop app" client? Google's installed-app flow only issues tokens
through a code exchange (which wants a client secret MEW refuses to carry);
the Web client's implicit grant keeps every token on-device with no secret
anywhere — the same trust model as the browser build.

Notes:
- The token lives in memory for ~1h. When it expires mid-session, the next
  sync opens a quick browser tab that closes itself ("you can close this tab —
  MEW has it"). Sign-in prompts appear only on the first connect.
- If the sign-in tab is abandoned, MEW gives up after 120s and shows the
  error in Settings → Calendars.

## Brain endpoints and the CSP

The desktop CSP already allows `http://localhost:3131` (a BYO local
`gbrain serve` on its default port) and `http://127.0.0.1:*` (the managed
sidecar's fresh-per-launch port — see above). Pointing MEW at a REMOTE
serve (e.g. one backed by your Supabase — recipe: repo README → "One brain
across devices") needs that origin appended to `connect-src` in
`src-tauri/tauri.conf.json`. The Supabase origin itself is never needed —
the app talks to your serve, your serve talks to Supabase. Runtime-
configurable CSP origins are deliberately not a feature; edit the conf.
