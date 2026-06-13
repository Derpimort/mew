/* Desktop adapter — the rotation/prune/offer logic is ours, so it gets the
   tests; the Tauri runtime is faked at the window.__TAURI__ seam exactly as
   the shell (withGlobalTauri) provides it. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OAUTH_PORTS,
  applyUpdate,
  backupPath,
  brainEndpoint,
  isTauri,
  latestBackupDate,
  oauthLoopback,
  onBrainEndpoint,
  onUpdateReady,
  readBackup,
  registerCloseFlush,
  writeBackup,
} from '../desktop'

/* in-memory $DOCUMENT: path → contents */
function fakeShell() {
  const files = new Map<string, string>()
  const removed: string[] = []
  const closeHandlers: Array<(e: { preventDefault(): void }) => void | Promise<void>> = []
  const openedUrls: string[] = []
  const invokes: { cmd: string; args?: Record<string, unknown> }[] = []
  const listeners = new Map<string, (e: { payload: unknown }) => void>()
  let destroyed = false
  const t = {
    fs: {
      mkdir: async () => {},
      writeTextFile: async (path: string, contents: string) => {
        files.set(path, contents)
      },
      readTextFile: async (path: string) => {
        const c = files.get(path)
        if (c == null) throw new Error(`ENOENT: ${path}`)
        return c
      },
      readDir: async (dir: string) =>
        [...files.keys()]
          .filter((p) => p.startsWith(`${dir}/`))
          .map((p) => ({ name: p.slice(dir.length + 1) })),
      remove: async (path: string) => {
        files.delete(path)
        removed.push(path)
      },
    },
    path: {
      BaseDirectory: { Document: 6 },
      documentDir: async () => '/home/user/Documents',
      join: async (...parts: string[]) => parts.join('/'),
    },
    opener: {
      openPath: async () => {},
      openUrl: async (url: string) => {
        openedUrls.push(url)
      },
    },
    window: {
      getCurrentWindow: () => ({
        onCloseRequested: async (cb: (typeof closeHandlers)[number]) => {
          closeHandlers.push(cb)
        },
        destroy: async () => {
          destroyed = true
        },
      }),
    },
    core: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        invokes.push({ cmd, args })
        if (cmd === 'plugin:oauth|start') return OAUTH_PORTS[0]
        return undefined
      },
    },
    event: {
      listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
        listeners.set(name, cb)
        return () => listeners.delete(name)
      },
    },
  }
  return {
    files,
    removed,
    closeHandlers,
    openedUrls,
    invokes,
    listeners,
    isDestroyed: () => destroyed,
    win: { __TAURI_INTERNALS__: {}, __TAURI__: t },
  }
}

const day = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

afterEach(() => vi.unstubAllGlobals())

describe('desktop adapter', () => {
  it('is inert outside the shell: detection false, io resolves to nothing', async () => {
    vi.stubGlobal('window', {})
    expect(isTauri()).toBe(false)
    await expect(writeBackup('{}')).resolves.toBeUndefined()
    expect(await readBackup()).toBeNull()
    expect(await latestBackupDate()).toBeNull()
    expect(backupPath()).toContain('Documents/MEW')
  })

  it('detects the shell via __TAURI_INTERNALS__', () => {
    vi.stubGlobal('window', fakeShell().win)
    expect(isTauri()).toBe(true)
  })

  it('writes the latest snapshot plus a dated rotation', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    await writeBackup('{"week":1}')
    expect(shell.files.get('MEW/mew-backup.json')).toBe('{"week":1}')
    expect(shell.files.get(`MEW/mew-backup-${day()}.json`)).toBe('{"week":1}')
  })

  it('prunes dated rotations to the newest 14, never the latest snapshot', async () => {
    const shell = fakeShell()
    for (let i = 1; i <= 16; i++) {
      shell.files.set(`MEW/mew-backup-2026-01-${String(i).padStart(2, '0')}.json`, 'old')
    }
    vi.stubGlobal('window', shell.win)
    await writeBackup('{}')
    const dated = [...shell.files.keys()].filter((p) => /mew-backup-\d{4}/.test(p))
    expect(dated).toHaveLength(14)
    expect(shell.removed).toEqual([
      'MEW/mew-backup-2026-01-01.json',
      'MEW/mew-backup-2026-01-02.json',
      'MEW/mew-backup-2026-01-03.json',
    ])
    expect(shell.files.has('MEW/mew-backup.json')).toBe(true)
  })

  it('readBackup returns the snapshot, or null when the file is gone', async () => {
    const shell = fakeShell()
    shell.files.set('MEW/mew-backup.json', '{"x":1}')
    vi.stubGlobal('window', shell.win)
    expect(await readBackup()).toBe('{"x":1}')
    shell.files.delete('MEW/mew-backup.json')
    expect(await readBackup()).toBeNull()
  })

  it('latestBackupDate reads the newest rotation name', async () => {
    const shell = fakeShell()
    shell.files.set('MEW/mew-backup-2026-05-30.json', '{}')
    shell.files.set('MEW/mew-backup-2026-06-02.json', '{}')
    shell.files.set('MEW/mew-backup.json', '{}')
    vi.stubGlobal('window', shell.win)
    expect(await latestBackupDate()).toBe('2026-06-02')
  })

  it('close flush: dirty close is intercepted, flushed once, then released', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    let dirty = true
    const flush = vi.fn(async () => {
      dirty = false
    })
    registerCloseFlush(() => dirty, flush)
    await Promise.resolve() // onCloseRequested registration is async
    expect(shell.closeHandlers).toHaveLength(1)
    let prevented = false
    await shell.closeHandlers[0]({ preventDefault: () => (prevented = true) })
    expect(prevented).toBe(true)
    expect(flush).toHaveBeenCalledOnce()
    expect(shell.isDestroyed()).toBe(true)
    /* clean close sails through */
    prevented = false
    await shell.closeHandlers[0]({ preventDefault: () => (prevented = true) })
    expect(prevented).toBe(false)
    expect(flush).toHaveBeenCalledOnce()
  })
})

describe('oauthLoopback', () => {
  const settle = () => new Promise<void>((r) => setTimeout(r, 0))

  it('refuses to run outside the shell', async () => {
    vi.stubGlobal('window', {})
    await expect(oauthLoopback(() => 'https://x')).rejects.toThrow(/desktop shell/)
  })

  it('opens the auth URL for the bound port and resolves on the token-bearing hit only', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    const p = oauthLoopback((port) => `https://accounts.google.com/o/oauth2/v2/auth?p=${port}`)
    await settle()
    expect(shell.openedUrls).toEqual([`https://accounts.google.com/o/oauth2/v2/auth?p=${OAUTH_PORTS[0]}`])
    const emit = shell.listeners.get('oauth://url')!
    /* the bare redirect (fragment stayed in the browser) must NOT settle it */
    emit({ payload: `http://localhost:${OAUTH_PORTS[0]}/` })
    /* the response page re-posts the fragment as a query — this settles it */
    emit({ payload: `http://localhost:${OAUTH_PORTS[0]}/?access_token=tok123&expires_in=3599` })
    await expect(p).resolves.toContain('access_token=tok123')
    await settle()
    expect(shell.invokes.map((i) => i.cmd)).toEqual(['plugin:oauth|start', 'plugin:oauth|cancel'])
    expect(shell.listeners.size).toBe(0) // unlistened after settling
  })

  it('starts the listener on the fixed candidate ports (exact-match redirect URIs)', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    const p = oauthLoopback(() => 'https://accounts.google.com/x')
    await settle()
    const start = shell.invokes.find((i) => i.cmd === 'plugin:oauth|start')!
    expect((start.args!.config as { ports: number[] }).ports).toEqual(OAUTH_PORTS)
    shell.listeners.get('oauth://url')!({ payload: 'http://localhost/?error=access_denied' })
    await expect(p).resolves.toContain('error=access_denied')
  })

  it('times out instead of hanging, and still cancels the listener', async () => {
    vi.useFakeTimers()
    try {
      const shell = fakeShell()
      vi.stubGlobal('window', shell.win)
      const p = oauthLoopback(() => 'https://accounts.google.com/x', 120_000)
      const rejection = expect(p).rejects.toThrow(/timed out after 120s/)
      await vi.advanceTimersByTimeAsync(121_000)
      await rejection
      expect(shell.invokes.map((i) => i.cmd)).toContain('plugin:oauth|cancel')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('brain sidecar bridge', () => {
  it('is inert outside the shell: endpoint null, listener a no-op', async () => {
    vi.stubGlobal('window', {})
    expect(await brainEndpoint()).toBeNull()
    expect(() => onBrainEndpoint(() => {})).not.toThrow()
  })

  it('brainEndpoint asks the shell and forwards its answer', async () => {
    const shell = fakeShell()
    shell.win.__TAURI__.core.invoke = async (cmd: string) =>
      cmd === 'brain_endpoint'
        ? ({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh' } as never)
        : (undefined as never)
    vi.stubGlobal('window', shell.win)
    expect(await brainEndpoint()).toEqual({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh' })
  })

  it('a shell without a brain up answers null, not an error', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    expect(await brainEndpoint()).toBeNull()
  })

  it('onBrainEndpoint forwards every (re)spawn handshake', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    const seen: { url: string }[] = []
    onBrainEndpoint((e) => seen.push(e))
    await new Promise<void>((r) => setTimeout(r, 0))
    const emit = shell.listeners.get('mew://brain-endpoint')!
    emit({ payload: { url: 'http://127.0.0.1:1000', token: 'a' } })
    emit({ payload: { url: 'http://127.0.0.1:2000', token: 'b' } })
    expect(seen.map((e) => e.url)).toEqual(['http://127.0.0.1:1000', 'http://127.0.0.1:2000'])
  })
})

describe('self-update bridge', () => {
  it('is inert outside the shell; applyUpdate refuses honestly', async () => {
    vi.stubGlobal('window', {})
    expect(() => onUpdateReady(() => {})).not.toThrow()
    await expect(applyUpdate()).rejects.toThrow(/desktop shell/)
  })

  it('onUpdateReady forwards the staged version from the shell event', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    const seen: string[] = []
    onUpdateReady((v) => seen.push(v))
    await new Promise<void>((r) => setTimeout(r, 0))
    shell.listeners.get('mew://update-ready')!({ payload: '0.2.0' })
    expect(seen).toEqual(['0.2.0'])
  })

  it('applyUpdate hands off to the shell command', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    await applyUpdate()
    expect(shell.invokes.map((i) => i.cmd)).toContain('apply_update')
  })
})
