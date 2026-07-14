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
     user regardless of window state, and a toast click routes back: focus +
     raise the window (one shell command), then scroll to that nudge (#216).

   `createNotifier()` picks the strongest channel available: native on the
   desktop shell, the browser API on the web, a no-op anywhere neither exists.
   Quiet hours are gated upstream in the nudge engine, before mirror() is ever
   called — no change here. Keys are untouched: notifications are local-only,
   no network, no endpoint. */

import { focusMainWindow, isTauri } from './desktop'
import { logger } from './logger'

const log = logger.withContext('notify')

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
   Permission calls are async; sendNotification is fire-and-forget. onAction
   is the plugin's click/action listener — optional and rejection-tolerant
   because the pinned plugin (2.3.3) ships the guest API without a desktop
   listener command behind it: registration rejects on desktop today (mobile
   delivers), and a future plugin that adds desktop delivery lights the route
   up with no code change here. */
interface TauriNotification {
  isPermissionGranted(): Promise<boolean>
  requestPermission(): Promise<'granted' | 'denied' | 'default'>
  sendNotification(opts: { id?: number; title: string; body?: string; icon?: string }): void
  onAction?(cb: (n?: { id?: number }) => void): Promise<unknown>
}

const tauriNotification = (): TauriNotification | null => {
  if (typeof window === 'undefined') return null
  const n = (window as unknown as { __TAURI__?: { notification?: TauriNotification } }).__TAURI__
    ?.notification
  return n ?? null
}

/* OS notification centers keep a short history of toasts, so several MEW
   nudges can be alive at once — routing needs the clicked one, not just the
   loudest. Enough ids for a day of nudges; older clicks fall to the newest. */
const CLICK_ROUTES = 8

export function createTauriNotifier(): NotifierPort {
  /* Click-to-focus (#216, acceptance #3 of #168): each toast is stamped with
     an id and its onClick parked here; the plugin's actionPerformed listener
     maps a click back to that nudge — focus/raise the window (shell command),
     then run the store's navigate-to-nudge handler. */
  let seq = 0
  let routed = false
  const onClicks = new Map<number, () => void>()

  const routeClicks = (notif: TauriNotification) => {
    if (routed || typeof notif.onAction !== 'function') return
    routed = true
    notif
      .onAction((n) => {
        void focusMainWindow()
        const clicked = typeof n?.id === 'number' ? onClicks.get(n.id) : undefined
        /* seq is the newest mirrored nudge — never pruned, so an unmatched
           click (stale toast, unknown payload shape) still lands on the week */
        ;(clicked ?? onClicks.get(seq))?.()
      })
      .catch((err) => {
        /* pinned desktop plugin has no listener command — clicks keep the OS
           default until the plugin grows desktop delivery. Logged at debug (not
           silent) so a future plugin-delivery regression is diagnosable — the
           reject is expected per-launch today, not an error. */
        log.debug('onAction/unavailable — click-to-focus route dormant', {}, err)
      })
  }

  return {
    mirror({ title, body, onClick }) {
      const notif = tauriNotification()
      if (!notif) return
      const id = ++seq
      onClicks.set(id, onClick)
      if (onClicks.size > CLICK_ROUTES) {
        const oldest = onClicks.keys().next().value
        if (oldest !== undefined) onClicks.delete(oldest)
      }
      routeClicks(notif)
      /* fire-and-forget: a nudge must never block the week, and a failed
         notification is never an error the user sees. Native alerts surface
         even when the window is focused-but-minimized, so no visibility gate
         (that gate is a browser-only nicety). */
      void (async () => {
        try {
          let granted = await notif.isPermissionGranted()
          if (!granted) granted = (await notif.requestPermission()) === 'granted'
          if (granted) notif.sendNotification({ id, title, body, icon: '/pixie-poly-face.svg' })
        } catch (err) {
          log.warn('native notification unavailable (the week is unaffected)', {}, err)
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
