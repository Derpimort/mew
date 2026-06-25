/* Notification mirror (PRD §7, ARCHITECTURE §2 NotifierPort). Chat is the
   single source; this only mirrors the newest nudge. Two implementations of
   one port:

   • Browser (Alternative A) — the Notification API, and only when the tab is
     unfocused: it mirrors what would otherwise be missed. Permission is asked
     in context, never on first load.
   • Tauri (Alternative B) — native OS notifications via the shell's
     notification plugin, surfaced over `window.__TAURI__` (withGlobalTauri),
     so the web bundle carries zero @tauri-apps packages in its module graph.
     Native alerts land in the OS notification center even when MEW is
     minimized or in another workspace, so — unlike the browser mirror — the
     desktop path does NOT gate on tab visibility (ARCHITECTURE §3B: the
     strongest product argument for B). End-of-day and drift nudges reach the
     user regardless of window state.

   `createNotifier()` picks the strongest channel available: native on the
   desktop shell, the browser API on the web, a no-op anywhere neither exists.
   Quiet hours are gated upstream in the nudge engine, before mirror() is ever
   called — no change here. Keys are untouched: notifications are local-only,
   no network, no endpoint. */

import { isTauri } from './desktop'

export interface NotifierPort {
  mirror(opts: { title: string; body: string; tag: string; onClick: () => void }): void
}

export function createBrowserNotifier(): NotifierPort {
  return {
    mirror({ title, body, tag, onClick }) {
      if (typeof Notification === 'undefined') return
      if (document.visibilityState === 'visible') return // mirrors only what would be missed

      const show = () => {
        const n = new Notification(title, {
          body,
          tag,
          icon: '/pixie-poly-face.svg',
          silent: true,
        })
        n.onclick = () => {
          window.focus()
          onClick()
          n.close()
        }
      }

      if (Notification.permission === 'granted') show()
      else if (Notification.permission === 'default') {
        Notification.requestPermission().then((p) => {
          if (p === 'granted') show()
        })
      }
    },
  }
}

/* The slice of the Tauri notification plugin we use (withGlobalTauri shape).
   Permission calls are async; sendNotification is fire-and-forget. */
interface TauriNotification {
  isPermissionGranted(): Promise<boolean>
  requestPermission(): Promise<'granted' | 'denied' | 'default'>
  sendNotification(opts: { title: string; body?: string; icon?: string }): void
}

const tauriNotification = (): TauriNotification | null => {
  if (typeof window === 'undefined') return null
  const n = (window as unknown as { __TAURI__?: { notification?: TauriNotification } }).__TAURI__
    ?.notification
  return n ?? null
}

export function createTauriNotifier(): NotifierPort {
  return {
    mirror({ title, body }) {
      const notif = tauriNotification()
      if (!notif) return
      /* fire-and-forget: a nudge must never block the week, and a failed
         notification is never an error the user sees. Native alerts surface
         even when the window is focused-but-minimized, so no visibility gate
         (that gate is a browser-only nicety). Click-to-focus is handled by the
         OS shell; the in-app nudge already lives in chat for when MEW reopens. */
      void (async () => {
        try {
          let granted = await notif.isPermissionGranted()
          if (!granted) granted = (await notif.requestPermission()) === 'granted'
          if (granted) notif.sendNotification({ title, body, icon: '/pixie-poly-face.svg' })
        } catch (err) {
          console.warn('mew: native notification unavailable (the week is unaffected)', err)
        }
      })()
    },
  }
}

/** The strongest channel for the running shell: native on Tauri (when the
    plugin is present), the browser API on the web, a no-op where neither
    exists (e.g. SSR/tests without a Notification global). */
export function createNotifier(): NotifierPort {
  if (isTauri() && tauriNotification()) return createTauriNotifier()
  if (typeof Notification !== 'undefined') return createBrowserNotifier()
  return { mirror() {} }
}
