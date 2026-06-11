/* Browser-notification mirror (PRD §7). Chat is the single source; this only
   mirrors the newest nudge, only when the tab is unfocused. Permission is
   requested in context — when the first nudge would otherwise be missed —
   never on first load. Clicking focuses the tab and scrolls chat to the nudge. */

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
