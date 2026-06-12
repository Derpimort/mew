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
