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
loopback; phase 4 the release CI + updater.

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
