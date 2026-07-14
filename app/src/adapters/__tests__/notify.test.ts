/* Notifier port — the two channels and the factory that picks between them.
   The app's vitest runs headless (no jsdom), so the browser primitives
   (Notification, document) and the shell seam (window.__TAURI__) are stubbed
   exactly as the runtime provides them, the same way desktop.test.ts fakes the
   shell. isTauri() is mocked at the ./desktop seam so each test owns which
   vehicle createNotifier() believes it is on. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserNotifier, createNotifier, createTauriNotifier } from '../notify'

const isTauriMock = vi.fn<() => boolean>()
const focusMainWindowMock = vi.fn(() => Promise.resolve())
vi.mock('../desktop', () => ({
  isTauri: () => isTauriMock(),
  focusMainWindow: () => focusMainWindowMock(),
}))

const NUDGE = { title: 'pixie · MEW', body: 'still on it?\nsecond line', tag: 'n1' }

afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  isTauriMock.mockReset()
  focusMainWindowMock.mockClear()
})

/* ── browser channel (Alternative A) ──────────────────────────────────── */

type FakeNotificationCtor = {
  new (title: string, opts: NotificationOptions): { onclick: (() => void) | null; close(): void }
  permission: NotificationPermission
  requestPermission(): Promise<NotificationPermission>
}

/* a Notification stand-in that records every constructed instance */
function fakeNotification(permission: NotificationPermission, grantOnRequest = true) {
  const made: Array<{
    title: string
    opts: NotificationOptions
    closed: boolean
    instance: { onclick: (() => void) | null; close(): void }
  }> = []
  const requested = { count: 0 }
  const ctor = function (this: unknown, title: string, opts: NotificationOptions) {
    const rec = {
      title,
      opts,
      closed: false,
      instance: { onclick: null as (() => void) | null, close: () => {} },
    }
    rec.instance.close = () => {
      rec.closed = true
    }
    made.push(rec)
    return rec.instance
  } as unknown as FakeNotificationCtor
  ctor.permission = permission
  ctor.requestPermission = async () => {
    requested.count++
    return grantOnRequest ? 'granted' : 'denied'
  }
  return { ctor, made, requested }
}

describe('browser notifier', () => {
  it('does nothing when the tab is focused — it only mirrors what would be missed', () => {
    const fake = fakeNotification('granted')
    vi.stubGlobal('Notification', fake.ctor)
    vi.stubGlobal('document', { visibilityState: 'visible' })
    createBrowserNotifier().mirror({ ...NUDGE, onClick: () => {} })
    expect(fake.made).toHaveLength(0)
  })

  it('posts when hidden and permission is already granted', () => {
    const fake = fakeNotification('granted')
    vi.stubGlobal('Notification', fake.ctor)
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    createBrowserNotifier().mirror({ ...NUDGE, onClick: () => {} })
    expect(fake.made).toHaveLength(1)
    expect(fake.made[0].title).toBe(NUDGE.title)
    expect(fake.made[0].opts).toMatchObject({
      body: NUDGE.body,
      tag: NUDGE.tag,
      icon: '/pixie-poly-face.svg',
      silent: true,
    })
  })

  it('asks permission in context, then posts on grant', async () => {
    const fake = fakeNotification('default', true)
    vi.stubGlobal('Notification', fake.ctor)
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    createBrowserNotifier().mirror({ ...NUDGE, onClick: () => {} })
    expect(fake.requested.count).toBe(1)
    await Promise.resolve() // requestPermission resolves on the microtask
    expect(fake.made).toHaveLength(1)
  })

  it('stays silent when permission is denied on ask', async () => {
    const fake = fakeNotification('default', false)
    vi.stubGlobal('Notification', fake.ctor)
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    createBrowserNotifier().mirror({ ...NUDGE, onClick: () => {} })
    await Promise.resolve()
    expect(fake.made).toHaveLength(0)
  })

  it('click focuses the window, runs onClick, and closes the toast', () => {
    const fake = fakeNotification('granted')
    const focus = vi.fn()
    const onClick = vi.fn()
    vi.stubGlobal('Notification', fake.ctor)
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    vi.stubGlobal('window', { focus })
    createBrowserNotifier().mirror({ ...NUDGE, onClick })
    fake.made[0].instance.onclick?.()
    expect(focus).toHaveBeenCalledOnce()
    expect(onClick).toHaveBeenCalledOnce()
    expect(fake.made[0].closed).toBe(true)
  })

  it('is inert when the Notification API is absent', () => {
    vi.stubGlobal('Notification', undefined)
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    expect(() => createBrowserNotifier().mirror({ ...NUDGE, onClick: () => {} })).not.toThrow()
  })
})

/* ── native channel (Alternative B) ───────────────────────────────────── */

type SentNative = { id?: number; title: string; body?: string; icon?: string }

function fakeShellNotification(opts?: {
  granted?: boolean
  grantOnRequest?: boolean
  throwOnSend?: boolean
  /** how the plugin treats onAction: capture the callback ('deliver'),
      reject registration (the pinned desktop plugin), or lack the API */
  clicks?: 'deliver' | 'reject' | 'absent'
}) {
  const sent: SentNative[] = []
  const requested = { count: 0 }
  const clicks = {
    registrations: 0,
    fire: undefined as ((n?: { id?: number }) => void) | undefined,
  }
  const notification: {
    isPermissionGranted(): Promise<boolean>
    requestPermission(): Promise<string>
    sendNotification(o: SentNative): void
    onAction?(cb: (n?: { id?: number }) => void): Promise<unknown>
  } = {
    isPermissionGranted: async () => opts?.granted ?? false,
    requestPermission: async () => {
      requested.count++
      return (opts?.grantOnRequest ?? true) ? 'granted' : 'denied'
    },
    sendNotification: (o) => {
      if (opts?.throwOnSend) throw new Error('plugin missing')
      sent.push(o)
    },
  }
  if (opts?.clicks !== 'absent') {
    notification.onAction = (cb) => {
      clicks.registrations++
      if (opts?.clicks === 'reject') return Promise.reject(new Error('no desktop listener command'))
      clicks.fire = cb
      return Promise.resolve({})
    }
  }
  return { sent, requested, clicks, win: { __TAURI_INTERNALS__: {}, __TAURI__: { notification } } }
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0))

describe('tauri notifier', () => {
  it('posts a native notification (with icon), regardless of tab visibility', async () => {
    const shell = fakeShellNotification({ granted: true })
    vi.stubGlobal('window', shell.win)
    // a *focused* tab would suppress the browser mirror — the native path must not care
    vi.stubGlobal('document', { visibilityState: 'visible' })
    createTauriNotifier().mirror({ ...NUDGE, onClick: () => {} })
    await settle()
    expect(shell.sent).toEqual([
      { id: 1, title: NUDGE.title, body: NUDGE.body, icon: '/pixie-poly-face.svg' },
    ])
  })

  it('asks the OS for permission once when not yet granted, then posts', async () => {
    const shell = fakeShellNotification({ granted: false, grantOnRequest: true })
    vi.stubGlobal('window', shell.win)
    createTauriNotifier().mirror({ ...NUDGE, onClick: () => {} })
    await settle()
    expect(shell.requested.count).toBe(1)
    expect(shell.sent).toHaveLength(1)
  })

  it('stays silent when the OS denies permission', async () => {
    const shell = fakeShellNotification({ granted: false, grantOnRequest: false })
    vi.stubGlobal('window', shell.win)
    createTauriNotifier().mirror({ ...NUDGE, onClick: () => {} })
    await settle()
    expect(shell.sent).toHaveLength(0)
  })

  it('swallows a plugin failure — a nudge never blocks the week', async () => {
    const shell = fakeShellNotification({ granted: true, throwOnSend: true })
    vi.stubGlobal('window', shell.win)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => createTauriNotifier().mirror({ ...NUDGE, onClick: () => {} })).not.toThrow()
    await settle()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('is inert when the plugin is not on window.__TAURI__', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, __TAURI__: {} })
    expect(() => createTauriNotifier().mirror({ ...NUDGE, onClick: () => {} })).not.toThrow()
    await settle()
  })

  /* ── click-to-focus (#216) ─────────────────────────────────────────── */

  it('registers the click listener once and stamps each toast with its own id', async () => {
    const shell = fakeShellNotification({ granted: true })
    vi.stubGlobal('window', shell.win)
    const notifier = createTauriNotifier()
    notifier.mirror({ ...NUDGE, onClick: () => {} })
    notifier.mirror({ ...NUDGE, tag: 'n2', onClick: () => {} })
    await settle()
    expect(shell.clicks.registrations).toBe(1)
    expect(shell.sent.map((s) => s.id)).toEqual([1, 2])
  })

  it('a toast click focuses the window and routes to that nudge, not the newest', async () => {
    const shell = fakeShellNotification({ granted: true })
    vi.stubGlobal('window', shell.win)
    const first = vi.fn()
    const second = vi.fn()
    const notifier = createTauriNotifier()
    notifier.mirror({ ...NUDGE, onClick: first })
    notifier.mirror({ ...NUDGE, tag: 'n2', onClick: second })
    await settle()
    shell.clicks.fire?.({ id: 1 })
    expect(focusMainWindowMock).toHaveBeenCalledOnce()
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
  })

  it('a click without a recognizable id still lands on the newest nudge', async () => {
    const shell = fakeShellNotification({ granted: true })
    vi.stubGlobal('window', shell.win)
    const first = vi.fn()
    const second = vi.fn()
    const notifier = createTauriNotifier()
    notifier.mirror({ ...NUDGE, onClick: first })
    notifier.mirror({ ...NUDGE, tag: 'n2', onClick: second })
    await settle()
    shell.clicks.fire?.() // a future desktop payload shape we don't know yet
    expect(focusMainWindowMock).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
  })

  it('keeps a bounded click registry — a pruned stale toast falls to the newest nudge', async () => {
    const shell = fakeShellNotification({ granted: true })
    vi.stubGlobal('window', shell.win)
    const first = vi.fn()
    const newest = vi.fn()
    const notifier = createTauriNotifier()
    notifier.mirror({ ...NUDGE, onClick: first })
    for (let i = 0; i < 7; i++) notifier.mirror({ ...NUDGE, tag: `n${i + 2}`, onClick: () => {} })
    notifier.mirror({ ...NUDGE, tag: 'n9', onClick: newest }) // 9th — id 1 pruned
    await settle()
    shell.clicks.fire?.({ id: 1 })
    expect(first).not.toHaveBeenCalled()
    expect(newest).toHaveBeenCalledOnce()
  })

  it('still posts when the plugin rejects listener registration (pinned desktop today)', async () => {
    const shell = fakeShellNotification({ granted: true, clicks: 'reject' })
    vi.stubGlobal('window', shell.win)
    expect(() => createTauriNotifier().mirror({ ...NUDGE, onClick: () => {} })).not.toThrow()
    await settle()
    expect(shell.clicks.registrations).toBe(1)
    expect(shell.sent).toHaveLength(1)
    expect(focusMainWindowMock).not.toHaveBeenCalled()
  })

  it('still posts when the plugin has no onAction API at all', async () => {
    const shell = fakeShellNotification({ granted: true, clicks: 'absent' })
    vi.stubGlobal('window', shell.win)
    expect(() => createTauriNotifier().mirror({ ...NUDGE, onClick: () => {} })).not.toThrow()
    await settle()
    expect(shell.sent).toHaveLength(1)
  })
})

/* ── the factory ──────────────────────────────────────────────────────── */

describe('createNotifier', () => {
  it('chooses the native channel on the desktop shell with the plugin present', async () => {
    const shell = fakeShellNotification({ granted: true })
    isTauriMock.mockReturnValue(true)
    vi.stubGlobal('window', shell.win)
    vi.stubGlobal('document', { visibilityState: 'visible' }) // native ignores this
    createNotifier().mirror({ ...NUDGE, onClick: () => {} })
    await settle()
    expect(shell.sent).toHaveLength(1)
  })

  it('falls back to the browser channel on the web (no Tauri)', () => {
    const fake = fakeNotification('granted')
    isTauriMock.mockReturnValue(false)
    vi.stubGlobal('window', { focus: () => {} })
    vi.stubGlobal('Notification', fake.ctor)
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    createNotifier().mirror({ ...NUDGE, onClick: () => {} })
    expect(fake.made).toHaveLength(1)
  })

  it('falls back to the browser channel when Tauri is detected but the plugin is missing', async () => {
    const fake = fakeNotification('granted')
    isTauriMock.mockReturnValue(true)
    // shell present, but no .notification slice → must not pick the native path
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, __TAURI__: {}, focus: () => {} })
    vi.stubGlobal('Notification', fake.ctor)
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    createNotifier().mirror({ ...NUDGE, onClick: () => {} })
    expect(fake.made).toHaveLength(1)
  })

  it('is a safe no-op where neither channel exists', () => {
    isTauriMock.mockReturnValue(false)
    vi.stubGlobal('Notification', undefined)
    vi.stubGlobal('window', {})
    expect(() => createNotifier().mirror({ ...NUDGE, onClick: () => {} })).not.toThrow()
  })
})
