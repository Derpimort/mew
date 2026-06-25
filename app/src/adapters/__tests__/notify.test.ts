/* Notifier port — the two channels and the factory that picks between them.
   The app's vitest runs headless (no jsdom), so the browser primitives
   (Notification, document) and the shell seam (window.__TAURI__) are stubbed
   exactly as the runtime provides them, the same way desktop.test.ts fakes the
   shell. isTauri() is mocked at the ./desktop seam so each test owns which
   vehicle createNotifier() believes it is on. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserNotifier, createNotifier, createTauriNotifier } from '../notify'

const isTauriMock = vi.fn<() => boolean>()
vi.mock('../desktop', () => ({ isTauri: () => isTauriMock() }))

const NUDGE = { title: 'pixie · MEW', body: 'still on it?\nsecond line', tag: 'n1' }

afterEach(() => vi.unstubAllGlobals())
beforeEach(() => isTauriMock.mockReset())

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

function fakeShellNotification(opts?: {
  granted?: boolean
  grantOnRequest?: boolean
  throwOnSend?: boolean
}) {
  const sent: Array<{ title: string; body?: string; icon?: string }> = []
  const requested = { count: 0 }
  const notification = {
    isPermissionGranted: async () => opts?.granted ?? false,
    requestPermission: async () => {
      requested.count++
      return (opts?.grantOnRequest ?? true) ? 'granted' : 'denied'
    },
    sendNotification: (o: { title: string; body?: string; icon?: string }) => {
      if (opts?.throwOnSend) throw new Error('plugin missing')
      sent.push(o)
    },
  }
  return { sent, requested, win: { __TAURI_INTERNALS__: {}, __TAURI__: { notification } } }
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
      { title: NUDGE.title, body: NUDGE.body, icon: '/pixie-poly-face.svg' },
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
