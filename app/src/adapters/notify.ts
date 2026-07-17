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

/* The two universal quick-actions a block reminder can grow (#305, v0.5 item
   10). The pair is fixed — never a per-nudge action set — so the native toast
   and the in-app nudge card always show the SAME two, and parity holds even
   where the platform can't render native buttons. `done` completes the block;
   `snooze15` pushes it +15. */
export type NotifyActionId = 'done' | 'snooze15'
export interface NotifyAction {
  id: NotifyActionId
  label: string
}

export interface NotifierPort {
  mirror(opts: {
    title: string
    body: string
    tag: string
    onClick: () => void
    /* Block quick-actions (#305): rendered as native buttons where the
       platform delivers them, ignored where it can't. Either way the click
       still lands on the nudge whose card carries the same two actions, so the
       feature degrades to click-to-land parity, never an error. */
    actions?: NotifyAction[]
    onAction?: (id: NotifyActionId) => void
  }): void
}

export function createBrowserNotifier(): NotifierPort {
  return {
    /* `actions`/`onAction` are accepted but not rendered here: action buttons
       need ServiceWorkerRegistration.showNotification, and a plain
       `new Notification()` (MEW ships no service worker) can't carry them.
       The click still lands on the nudge card, which grows the same two
       actions — parity without native buttons (#305). */
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
   up with no code change here.

   registerActionTypes + the action buttons on sendNotification are the #305
   quick-action path. Both are MOBILE-ONLY in the pinned plugin — Tauri's own
   docs state "The Actions API is only available on mobile platforms," and the
   notification changelog through 2.3.3 (the latest release) never adds desktop
   delivery. So they stay dormant on desktop exactly like onAction above; a
   future desktop-capable release lights the buttons up with no change here.
   Both are optional so a plugin lacking them still type-checks, and onAction's
   callback carries an optional actionId: a plain toast click has none (the
   #216 focus route), a button tap names the action. */
interface TauriNotification {
  isPermissionGranted(): Promise<boolean>
  requestPermission(): Promise<'granted' | 'denied' | 'default'>
  sendNotification(opts: {
    id?: number
    title: string
    body?: string
    icon?: string
    actionTypeId?: string
  }): void
  registerActionTypes?(
    types: { id: string; actions: { id: string; title: string }[] }[]
  ): Promise<unknown>
  onAction?(cb: (n?: { id?: number; actionId?: string }) => void): Promise<unknown>
}

/* one action-type id groups MEW's block quick-actions on the plugin side */
const BLOCK_ACTIONS = 'mew-block'

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
     an id and its handlers parked here; the plugin's actionPerformed listener
     maps a tap back to that nudge — focus/raise the window (shell command),
     then either run the store's navigate-to-nudge handler (a plain click) or
     the named quick-action (#305). */
  let seq = 0
  let routed = false
  const routes = new Map<number, { click: () => void; act?: (id: NotifyActionId) => void }>()

  const routeClicks = (notif: TauriNotification) => {
    if (routed || typeof notif.onAction !== 'function') return
    routed = true
    notif
      .onAction((n) => {
        void focusMainWindow()
        /* seq is the newest mirrored nudge — never pruned, so an unmatched
           tap (stale toast, unknown payload shape) still lands on the week */
        const route = (typeof n?.id === 'number' ? routes.get(n.id) : undefined) ?? routes.get(seq)
        if (n?.actionId === 'done' || n?.actionId === 'snooze15') route?.act?.(n.actionId)
        else route?.click()
      })
      .catch((err) => {
        /* pinned desktop plugin has no listener command — taps keep the OS
           default until the plugin grows desktop delivery. Logged at debug (not
           silent) so a future plugin-delivery regression is diagnosable — the
           reject is expected per-launch today, not an error. */
        log.debug('onAction/unavailable — click-to-focus route dormant', {}, err)
      })
  }

  return {
    mirror({ title, body, onClick, actions, onAction }) {
      const notif = tauriNotification()
      if (!notif) return
      const id = ++seq
      routes.set(id, { click: onClick, act: onAction })
      if (routes.size > CLICK_ROUTES) {
        const oldest = routes.keys().next().value
        if (oldest !== undefined) routes.delete(oldest)
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
          if (!granted) return
          /* declare the button set before posting (dormant on desktop per the
             interface note; a reject leaves the toast button-less, click intact) */
          if (actions?.length && typeof notif.registerActionTypes === 'function') {
            await notif
              .registerActionTypes([
                { id: BLOCK_ACTIONS, actions: actions.map((a) => ({ id: a.id, title: a.label })) },
              ])
              .catch((err) =>
                log.debug('registerActionTypes/unavailable — buttons dormant', {}, err)
              )
          }
          notif.sendNotification({
            id,
            title,
            body,
            icon: '/pixie-poly-face.svg',
            ...(actions?.length ? { actionTypeId: BLOCK_ACTIONS } : {}),
          })
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
