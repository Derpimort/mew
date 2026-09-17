/* A complete stand-in for the desktop shell's `window.__TAURI__` (withGlobalTauri)
   so the Tauri-only surfaces render in a plain headless browser. It covers the
   whole surface app/src/adapters/desktop.ts reads: fs, path, opener,
   window.getCurrentWindow, core.invoke, event.listen. A partial stub used to
   crash hydrate at `t.event.listen` (#31).
   Pass it to page.addInitScript(installTauriStub, options) BEFORE the first goto.
   Everything the app does through the shell is recorded on `window.__tauri`:
     invokes     [{ cmd, args }]   every core.invoke call
     openedUrls  [url]             opener.openUrl (the system browser)
     writes      number            fs.writeTextFile calls
     files       Map<path, text>   the fake Documents tree
     emit(name, payload)           fire a shell event at the app's listeners
     requestClose()                fire the window's close request (the app's
                                   close-time backup flush listens for it)
   options: { files?: Record<string,string>, oauthPort?: number } */

export function installTauriStub(options = {}) {
  const files = new Map(Object.entries(options.files ?? {}))
  const listeners = new Map() // name -> Set<cb>
  const closeHandlers = []
  const rec = { invokes: [], openedUrls: [], writes: 0, files }
  rec.emit = (name, payload) => {
    for (const cb of listeners.get(name) ?? []) cb({ payload })
  }
  rec.requestClose = async () => {
    for (const cb of closeHandlers) await cb({ preventDefault() {} })
  }
  window.__tauri = rec
  window.__TAURI_INTERNALS__ = {}
  window.__TAURI__ = {
    fs: {
      mkdir: async () => {},
      writeTextFile: async (p, text) => {
        files.set(p, text)
        rec.writes++
      },
      readTextFile: async (p) => {
        if (!files.has(p)) throw new Error(`ENOENT: ${p}`)
        return files.get(p)
      },
      readDir: async (dir) =>
        [...files.keys()]
          .filter((p) => p.startsWith(dir + '/'))
          .map((p) => ({ name: p.slice(dir.length + 1), isFile: true, isDirectory: false })),
      remove: async (p) => {
        files.delete(p)
      },
    },
    path: {
      BaseDirectory: { Document: 6 },
      documentDir: async () => '/home/user/Documents',
      join: async (...parts) => parts.join('/'),
    },
    opener: {
      openPath: async () => {},
      openUrl: async (url) => {
        rec.openedUrls.push(url)
      },
    },
    window: {
      getCurrentWindow: () => ({
        onCloseRequested: async (cb) => {
          closeHandlers.push(cb)
          return () => closeHandlers.splice(closeHandlers.indexOf(cb), 1)
        },
        destroy: async () => {},
      }),
    },
    core: {
      invoke: async (cmd, args) => {
        rec.invokes.push({ cmd, args })
        switch (cmd) {
          case 'plugin:oauth|start':
            return options.oauthPort ?? 17893
          case 'brain_endpoint':
            return null
          case 'brain_status':
            return ''
          default:
            return undefined
        }
      },
    },
    event: {
      listen: async (name, cb) => {
        if (!listeners.has(name)) listeners.set(name, new Set())
        listeners.get(name).add(cb)
        return () => listeners.get(name)?.delete(cb)
      },
    },
  }
}
