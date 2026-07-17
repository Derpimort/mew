/* Tray presence (#283) — what the shell's tray icon says at a glance, as a
   pure function of liveNow. The Rust side is thin plumbing (swap icon, set
   tooltip); every judgment about WHAT to show lives here, where the test
   suite is. The store diffs the result and invokes the shell only on change. */

import type { LiveNow } from './liveNow'
import { fmtTime } from './time'

export type TrayDot = 'focus' | 'rest' | 'idle'

export interface TrayShape {
  state: TrayDot
  tooltip: string
}

/* ~40 chars keeps the tooltip one calm line on every platform's tray. */
const TITLE_MAX = 40

/** The block's short name (the pre-annotation half, same cut liveNow and the
    nudges use), clipped so a long title never turns the tooltip into a
    paragraph. */
function clip(title: string): string {
  const short = title.split('—')[0].trim()
  return short.length > TITLE_MAX ? `${short.slice(0, TITLE_MAX - 1).trimEnd()}…` : short
}

/** The dot is presence, not taxonomy: any live block that holds the user
    shows focus; a live rest block shows rest; everything else — between
    blocks, background-only, a clear day — is idle. Idle copy is positive by
    law: a free stretch is yours, never a gap. */
export function trayShape(live: LiveNow): TrayShape {
  if (live.current) {
    return {
      state: live.current.tag === 'rest' ? 'rest' : 'focus',
      tooltip: `${clip(live.current.title)} — ${live.minutesLeft ?? 0} min left`,
    }
  }
  if (live.next) {
    return {
      state: 'idle',
      tooltip: `next: ${clip(live.next.title)} at ${fmtTime(live.next.startMin)}`,
    }
  }
  return { state: 'idle', tooltip: 'nothing scheduled — all yours' }
}
