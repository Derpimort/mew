/* Shared polar/time geometry. The Focus view is a FIXED 12-hour clock face
   (orbitGeometry.ts): 12 at the top and never moving, a time mapped to its
   standard clock angle, now a hand that sweeps it. The old rolling next-12h
   mapping (now pinned at top) is retired. */

import { snapMin, type DragState } from './dragGeometry'

export const rPolar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

export const rArc = (cx: number, cy: number, r: number, d0: number, d1: number): string => {
  if (d1 < d0) d1 += 360
  const [x0, y0] = rPolar(cx, cy, r, d0)
  const [x1, y1] = rPolar(cx, cy, r, d1)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/** Filled sector clockwise d0→d1. rIn=0 → a pie slice (inner disk fill); rIn>0
    → an annular wedge (the band between two rings). Used for the day-progress
    wash, so it clamps a full turn just shy of 360 to keep the path non-empty. */
export const sector = (
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  d0: number,
  d1: number
): string => {
  if (d1 < d0) d1 += 360
  if (d1 - d0 >= 360) d1 = d0 + 359.999
  const big = d1 - d0 > 180 ? 1 : 0
  const [ox0, oy0] = rPolar(cx, cy, rOut, d0)
  const [ox1, oy1] = rPolar(cx, cy, rOut, d1)
  if (rIn <= 0) {
    return `M ${cx.toFixed(2)} ${cy.toFixed(2)} L ${ox0.toFixed(2)} ${oy0.toFixed(2)} A ${rOut} ${rOut} 0 ${big} 1 ${ox1.toFixed(2)} ${oy1.toFixed(2)} Z`
  }
  const [ix1, iy1] = rPolar(cx, cy, rIn, d1)
  const [ix0, iy0] = rPolar(cx, cy, rIn, d0)
  return `M ${ox0.toFixed(2)} ${oy0.toFixed(2)} A ${rOut} ${rOut} 0 ${big} 1 ${ox1.toFixed(2)} ${oy1.toFixed(2)} L ${ix1.toFixed(2)} ${iy1.toFixed(2)} A ${rIn} ${rIn} 0 ${big} 0 ${ix0.toFixed(2)} ${iy0.toFixed(2)} Z`
}

/** Fixed clock face: a time's standard clock angle, 12 at top (0°), clockwise,
    12 hours per turn — so 3:00→90°, 6:00→180°, 9:00→270°, and 15:00 lands on
    the same 90° as 3:00 (AM/PM is disambiguated by the inner/outer day fill). */
export const clockDeg = (h: number): number => ((((h % 12) + 12) % 12) / 12) * 360

/* ── The inverse: pointer → angle → time (#24) ───────────────────────────────
   What a dial drag stands on. clockDeg is lossy — 09:00 and 21:00 both ride
   270° — so an angle names a time only within a HALF of the day, and the caller
   supplies which: a drag keeps its block's half for the whole gesture (the
   tangential drag #24 recommends), so crossing 12 o'clock wraps within the half
   instead of jumping twelve hours. Everything answers in whole minutes of the
   day, and a drop snaps through Week's own snapMin — one grid for both views. */

/** A half of the day: the face's first turn (00:00–11:59) or its second. */
export type DayHalf = 'am' | 'pm'

/** The half a minute of the day falls in. */
export const halfOf = (min: number): DayHalf => (((min % 1440) + 1440) % 1440 < 720 ? 'am' : 'pm')

/** Degrees onto [0, 360). */
export const normDeg = (deg: number): number => ((deg % 360) + 360) % 360

/** Minutes of the day an angle names within a half: 0° is 12 o'clock (00:00 in
    the morning half, 12:00 in the afternoon), clockwise, 720 minutes a turn,
    rounded to the nearest minute. A full turn is the top of the SAME half, so
    the morning answers 0–719 and the afternoon 720–1439 — never the other. */
export function minFromDeg(deg: number, half: DayHalf): number {
  const m = Math.round((normDeg(deg) / 360) * 720) % 720
  return (half === 'pm' ? 720 : 0) + m
}

/** A point's clock angle about the dial's centre, on [0, 360): 0° at 12
    o'clock, clockwise (screen y grows downward). The exact inverse of rPolar's
    −90° offset, in whatever space the centre and the point share. The centre
    itself has no angle: null. */
export function degFromPoint(cx: number, cy: number, x: number, y: number): number | null {
  const dx = x - cx
  const dy = y - cy
  if (dx === 0 && dy === 0) return null
  return normDeg((Math.atan2(dy, dx) * 180) / Math.PI + 90)
}

/** Where a press grabbed a block along its arc: the block's half, and the
    minutes from its start to the pressed angle — read forward within that half,
    so a press past 12 o'clock on a block that crosses the top still measures
    from the start. Held for the whole drag, so the arc slides under the pointer
    instead of jumping its start to it (Week's grabOffsetPx, in minutes). */
export interface DialGrab {
  half: DayHalf
  offsetMin: number
}

export function dialGrab(startMin: number, pressDeg: number): DialGrab {
  const half = halfOf(startMin)
  const offsetMin = (((minFromDeg(pressDeg, half) - startMin) % 720) + 720) % 720
  return { half, offsetMin }
}

/** The candidate drop for a pointer on the dial — the dial's dropTarget. The
    pointer's angle names a minute in the grabbed half; the block's START follows
    it less the grab offset, wrapping within the half; then snapMin, Week's rule
    verbatim (the 5-minute grid, the day's bounds with the block's length kept
    before midnight). The day never changes: the dial shows one. A pointer on the
    centre has no angle, so the block stays home. Pure — the store's dragMove
    decides whether the drop is allowed. */
export function dialDropTarget(
  drag: Pick<DragState, 'fromDayKey' | 'fromStartMin' | 'durationMin'>,
  grab: DialGrab,
  cx: number,
  cy: number,
  x: number,
  y: number
): { dayKey: string; startMin: number } {
  const deg = degFromPoint(cx, cy, x, y)
  if (deg == null) return { dayKey: drag.fromDayKey, startMin: drag.fromStartMin }
  const base = grab.half === 'pm' ? 720 : 0
  const inHalf = (((minFromDeg(deg, grab.half) - grab.offsetMin - base) % 720) + 720) % 720
  return { dayKey: drag.fromDayKey, startMin: snapMin(base + inHalf, drag.durationMin) }
}

/** Time-true week columns: hour → y over the full 00:00–24:00 day, so early
    and late blocks (imported calendars cross timezones) sit where they belong. */
export const nxwY = (h: number, H: number): number => (h / 24) * H

/* ── Dial keyboard model (WCAG 2.2 §2.1.1 · APG Application pattern) ─────────
   The dial is a 2-D surface: one axis is TIME (the clock angle a block rides),
   the other is LANE (the importance band its radius encodes). Arrow keys move
   focus across those two axes; Enter promotes the focused item; Space opens its
   card; Escape lets the focus item run in the background. Tab is deliberately
   NOT claimed: with a roving tabindex (one arc in the tab order at a time), Tab
   keeps its native job of moving to the next/previous focusable — the roving arc,
   then the demote chip, then out — so the dial is never a keyboard trap (§2.1.2)
   while arrows still reach every arc. Keeping the key→intent mapping pure (no
   DOM, no React) lets us unit-test the contract like the rest of the geometry. */

/** What a keypress on the dial means, independent of which item is focused. */
export type DialAction =
  | { kind: 'step'; axis: 'time' | 'lane'; dir: 1 | -1 } // arrow: move focus along an axis
  | { kind: 'promote' } // Enter — promote the focused item to the centre
  | { kind: 'open' } // Space — activate like a click: open the detail card
  | { kind: 'demote' } // Escape — let the focus item run in background
  | null // a key the dial doesn't claim (let it bubble — Tab, characters, …)

/** Map a keyboard event's key to a dial action. Arrow keys read as the two clock
    axes: ←/→ step by TIME (earlier/later), ↑/↓ step by LANE (outward bands are
    "up" toward the rim, inward toward the centre is "down"). Following the APG
    button pattern, Enter and Space both activate — here Enter PROMOTES the arc to
    the centre (the dial's primary verb, the inverse of the demote chip) and Space
    OPENS its detail card (the same surface a mouse click opens, so every action
    is reachable by keyboard alone). Escape demotes the current focus item. Tab and
    everything else return null so the event keeps bubbling (native Tab traversal
    over the roving tab stop — no keyboard trap). */
export function dialKeyAction(key: string): DialAction {
  switch (key) {
    case 'ArrowRight':
      return { kind: 'step', axis: 'time', dir: 1 }
    case 'ArrowLeft':
      return { kind: 'step', axis: 'time', dir: -1 }
    case 'ArrowUp':
      return { kind: 'step', axis: 'lane', dir: -1 }
    case 'ArrowDown':
      return { kind: 'step', axis: 'lane', dir: 1 }
    case 'Enter':
      return { kind: 'promote' }
    case ' ':
    case 'Spacebar': // legacy key name some engines still emit
      return { kind: 'open' }
    case 'Escape':
    case 'Esc': // legacy key name
      return { kind: 'demote' }
    default:
      return null
  }
}
