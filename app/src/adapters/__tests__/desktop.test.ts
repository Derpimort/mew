/* Desktop adapter — the rotation/prune/offer logic is ours, so it gets the
   tests; the Tauri runtime is faked at the window.__TAURI__ seam exactly as
   the shell (withGlobalTauri) provides it. */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  OAUTH_PORTS,
  applyUpdate,
  backupPath,
  brainEndpoint,
  brainStatus,
  focusMainWindow,
  isTauri,
  latestBackupDate,
  oauthLoopback,
  onBrainEndpoint,
  onShellTick,
  onTrayAction,
  onUpdateReady,
  readBackup,
  registerCloseFlush,
  setCaptureHotkey,
  updateTray,
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

  it('close flush under hide-to-tray (#283): every close is claimed, a dirty backup flushes, nothing is destroyed', async () => {
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
    await Promise.resolve() // the flush is fire-and-forget — let it land
    expect(prevented).toBe(true)
    expect(flush).toHaveBeenCalledOnce()
    /* the shell hid the window; destroying it here would undo hide-to-tray */
    expect(shell.isDestroyed()).toBe(false)
    /* a clean close is STILL claimed — an unclaimed close makes the guest
       wrapper destroy the window the shell just hid — but flushes nothing */
    prevented = false
    await shell.closeHandlers[0]({ preventDefault: () => (prevented = true) })
    expect(prevented).toBe(true)
    expect(flush).toHaveBeenCalledOnce()
    expect(shell.isDestroyed()).toBe(false)
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
    expect(shell.openedUrls).toEqual([
      `https://accounts.google.com/o/oauth2/v2/auth?p=${OAUTH_PORTS[0]}`,
    ])
    const emit = shell.listeners.get('oauth://url')!
    /* the bare redirect (fragment stayed in the browser) must NOT settle it */
    emit({ payload: `http://localhost:${OAUTH_PORTS[0]}/` })
    /* the response page re-posts the fragment as a query — this settles it */
    emit({ payload: `http://localhost:${OAUTH_PORTS[0]}/?access_token=tok123&expires_in=3599` })
    await expect(p).resolves.toContain('access_token=tok123')
    await settle()
    expect(shell.invokes.map((i) => i.cmd)).toEqual([
      'plugin:oauth|start',
      'focus_main_window',
      'plugin:oauth|cancel',
    ])
    expect(shell.listeners.size).toBe(0) // unlistened after settling
  })

  it('raises MEW exactly once when the redirect lands, even on duplicate hits', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    const p = oauthLoopback(() => 'https://accounts.google.com/x')
    await settle()
    const emit = shell.listeners.get('oauth://url')!
    emit({ payload: `http://localhost:${OAUTH_PORTS[0]}/?access_token=tok` })
    emit({ payload: `http://localhost:${OAUTH_PORTS[0]}/?access_token=tok` })
    await p
    await settle()
    expect(shell.invokes.filter((i) => i.cmd === 'focus_main_window')).toHaveLength(1)
  })

  it('raises MEW on an error-carrying redirect too — the human is done either way', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    const p = oauthLoopback(() => 'https://accounts.google.com/x')
    await settle()
    shell.listeners.get('oauth://url')!({ payload: 'http://localhost/?error=access_denied' })
    await expect(p).resolves.toContain('error=access_denied')
    await settle()
    expect(shell.invokes.filter((i) => i.cmd === 'focus_main_window')).toHaveLength(1)
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
      /* nobody came back — a timeout must not yank the window forward */
      expect(shell.invokes.map((i) => i.cmd)).not.toContain('focus_main_window')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('oauth landing page', () => {
  const settle = () => new Promise<void>((r) => setTimeout(r, 0))

  /* the page ships only as the response string inside plugin:oauth|start —
     capture it through that seam instead of exporting the constant */
  let html = ''
  beforeAll(async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    const p = oauthLoopback(() => 'https://accounts.google.com/x')
    await settle()
    const start = shell.invokes.find((i) => i.cmd === 'plugin:oauth|start')!
    shell.listeners.get('oauth://url')!({ payload: 'http://localhost/?access_token=t' })
    await p
    html = (start.args!.config as { response: string }).response
  })

  /* drive the page's inline script with hand fakes (no jsdom in this suite);
     the forward fetch settles only when the test says so */
  function runPage(loc: { hash?: string; search?: string }) {
    const els: Record<string, { textContent: string; style: Record<string, string> }> = {
      m: { textContent: /id="m">([^<]*)</.exec(html)![1], style: {} },
      p: { textContent: '', style: { display: 'none' } },
    }
    const fetched: string[] = []
    let settleForward: (() => void) | undefined
    const timers: { fn: () => void; ms: number }[] = []
    let closes = 0
    const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]
    new Function('location', 'document', 'fetch', 'setTimeout', 'window', script)(
      { hash: loc.hash ?? '', search: loc.search ?? '' },
      { getElementById: (id: string) => els[id] },
      (url: string) => {
        fetched.push(url)
        return { finally: (cb: () => void) => (settleForward = cb) }
      },
      (fn: () => void, ms: number) => timers.push({ fn, ms }),
      { close: () => closes++ }
    )
    return { els, fetched, timers, forward: () => settleForward!(), closes: () => closes }
  }

  it('is MEW-voiced, fully inline: prompt grammar, both outcome lines, zero external URLs', () => {
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).toMatch(/>mew<\/span> <span[^>]*>❯</)
    expect(html).toContain('#060708')
    expect(html).toContain('JetBrains Mono')
    expect(html).toContain('finishing sign-in…')
    expect(html).toContain('✓ connected — you can close this tab')
    expect(html).toContain('the key went straight to MEW on this device — this tab holds nothing')
    expect(html).toContain("that didn't go through — head back to MEW and try again")
    expect(html).toContain('window.close()')
  })

  it('token fragment: forwards it, then shows ✓ + privacy line and schedules the close', () => {
    const page = runPage({ hash: '#access_token=tok123&expires_in=3599' })
    expect(page.fetched).toEqual(['/?access_token=tok123&expires_in=3599'])
    expect(page.els.m.textContent).toBe('finishing sign-in…') // pending until the forward settles
    page.forward()
    expect(page.els.m.textContent).toBe('✓ connected — you can close this tab')
    expect(page.els.p.style.display).toBe('block')
    expect(page.timers.map((t) => t.ms)).toEqual([400])
    expect(page.closes()).toBe(0)
    page.timers[0].fn()
    expect(page.closes()).toBe(1)
  })

  it('error fragment: still forwards (the app-side flow must settle) but never claims success', () => {
    const page = runPage({ hash: '#error=access_denied' })
    expect(page.fetched).toEqual(['/?error=access_denied'])
    page.forward()
    expect(page.els.m.textContent).toBe("that didn't go through — head back to MEW and try again")
    expect(page.els.m.textContent).not.toContain('connected')
    expect(page.els.p.style.display).toBe('none') // privacy line stays gated behind success
    expect(page.timers).toHaveLength(0) // no auto-close on a failed run
  })

  it('error in the query (no fragment): error copy with nothing left to forward', () => {
    const page = runPage({ search: '?error=access_denied' })
    expect(page.fetched).toHaveLength(0)
    expect(page.els.m.textContent).toBe("that didn't go through — head back to MEW and try again")
    expect(page.timers).toHaveLength(0)
  })

  it('a bare hit claims nothing: no response arrived, so no success line', () => {
    const page = runPage({})
    expect(page.fetched).toHaveLength(0)
    expect(page.els.m.textContent).toBe('finishing sign-in…')
    expect(page.timers).toHaveLength(0)
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

  it('brainStatus pulls the last kept beat — the recovery for a late mount or reload', async () => {
    const shell = fakeShell()
    shell.win.__TAURI__.core.invoke = async (cmd: string) =>
      cmd === 'brain_status' ? ('unavailable' as never) : (undefined as never)
    vi.stubGlobal('window', shell.win)
    expect(await brainStatus()).toBe('unavailable')
  })

  it('brainStatus is honestly empty: null in a browser, and before the first beat', async () => {
    vi.stubGlobal('window', {})
    expect(await brainStatus()).toBeNull()
    const shell = fakeShell()
    shell.win.__TAURI__.core.invoke = async () => '' as never // shell up, no beat yet
    vi.stubGlobal('window', shell.win)
    expect(await brainStatus()).toBeNull()
  })
})

describe('window focus bridge', () => {
  it('is inert outside the shell', async () => {
    vi.stubGlobal('window', {})
    await expect(focusMainWindow()).resolves.toBeUndefined()
  })

  it('hands off to the shell command', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    await focusMainWindow()
    expect(shell.invokes.map((i) => i.cmd)).toContain('focus_main_window')
  })

  it('a refusing shell is swallowed, never thrown — the nudge still lives in chat', async () => {
    const shell = fakeShell()
    shell.win.__TAURI__.core.invoke = async () => {
      throw new Error('window gone')
    }
    vi.stubGlobal('window', shell.win)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(focusMainWindow()).resolves.toBeUndefined()
    warn.mockRestore()
  })
})

describe('tray bridge (#283)', () => {
  const settle = () => new Promise<void>((r) => setTimeout(r, 0))

  it('is inert outside the shell: listeners no-op, updateTray resolves to nothing', async () => {
    vi.stubGlobal('window', {})
    expect(() => onShellTick(() => {})).not.toThrow()
    expect(() => onTrayAction(() => {})).not.toThrow()
    await expect(updateTray('focus', 'anything')).resolves.toBeUndefined()
  })

  it('onShellTick fires the callback once per metronome beat', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    let beats = 0
    onShellTick(() => beats++)
    await settle()
    const emit = shell.listeners.get('mew://tick')!
    emit({ payload: null })
    emit({ payload: null })
    expect(beats).toBe(2)
  })

  it('onTrayAction forwards the shell payload verbatim', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    const seen: string[] = []
    onTrayAction((a) => seen.push(a))
    await settle()
    const emit = shell.listeners.get('mew://tray')!
    emit({ payload: 'start-next' })
    emit({ payload: 'done' })
    emit({ payload: 'quick-capture' })
    emit({ payload: 'open' })
    expect(seen).toEqual(['start-next', 'done', 'quick-capture', 'open'])
  })

  it('updateTray hands the dot + tooltip to the shell command', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    await updateTray('rest', 'Rest — 12 min left')
    expect(shell.invokes).toContainEqual({
      cmd: 'update_tray',
      args: { state: 'rest', tooltip: 'Rest — 12 min left' },
    })
  })

  it('a refusing shell is swallowed — tray chrome must never break the week', async () => {
    const shell = fakeShell()
    shell.win.__TAURI__.core.invoke = async () => {
      throw new Error('no tray on this session')
    }
    vi.stubGlobal('window', shell.win)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(updateTray('idle', 'nothing scheduled — all yours')).resolves.toBeUndefined()
    warn.mockRestore()
  })
})

describe('global capture hotkey (#284)', () => {
  it('is a cheerful no-op off the shell — the in-app hotkey carries capture there', async () => {
    vi.stubGlobal('window', {})
    await expect(setCaptureHotkey('CmdOrCtrl+Shift+C')).resolves.toBe(true)
    await expect(setCaptureHotkey(null)).resolves.toBe(true)
  })

  it('hands the accelerator to the shell command and resolves true', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    await expect(setCaptureHotkey('CmdOrCtrl+Shift+C')).resolves.toBe(true)
    expect(shell.invokes).toContainEqual({
      cmd: 'set_capture_hotkey',
      args: { accel: 'CmdOrCtrl+Shift+C' },
    })
  })

  it('null rides the same command — disable is an explicit release, not an omission', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    await expect(setCaptureHotkey(null)).resolves.toBe(true)
    expect(shell.invokes).toContainEqual({ cmd: 'set_capture_hotkey', args: { accel: null } })
  })

  it('a refusing shell resolves false, never throws — collision is a state, not an error', async () => {
    const shell = fakeShell()
    shell.win.__TAURI__.core.invoke = async () => {
      throw new Error('HotKey already registered')
    }
    vi.stubGlobal('window', shell.win)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(setCaptureHotkey('CmdOrCtrl+Shift+C')).resolves.toBe(false)
    warn.mockRestore()
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
