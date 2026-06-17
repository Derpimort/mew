/* Fixed 12-hour clock-face geometry. 12 sits at the top and never moves; a
   block rides an arc at its real start→end clock angle; now is a hand that
   sweeps the face. The whole day fits on a 12-h face because RADIUS carries the
   half: AM blocks (00:00–12:00) ride the band BETWEEN the inner and outer ring;
   PM blocks (12:00–24:00) ride OUTSIDE the outer ring. So a 9 AM and a 9 PM
   event share an angle but never a band. Within a band, time-overlapping blocks
   step one lane (greedy). Done blocks stay on the face as completed markers.
   Labels are callouts outside the bezel with per-side greedy de-collision.
   All pure — tested like the week model is. */

import type { Block } from '../../domain/types'
import { isBackground } from '../../domain/week'
import { clockDeg, rPolar } from './dialGeometry'

/* Radii, centre → out (SVG units around cx,cy):
   countdown (inside ri) · inner ring (ri) · AM band (ri→ro) · outer ring (ro) ·
   PM band (ro→pm) · hour ticks + now-hand (tick) · numerals (num). */
export const OG = {
  cx: 300,
  cy: 354,
  w: 760,
  h: 664,
  // ox centres the dial axis (cx) in the stage: cx + ox = w/2, so the
  // countdown can anchor at left:50% and margins stay symmetric.
  ox: 80,
  ri: 104,
  ro: 168,
  pm: 234,
  tick: 242,
  num: 254,
} as const
export const LANE_STEP = 8
export const LABEL_R = OG.num + 14 // callouts just outside the numerals
export const LABEL_GAP = 16

/** AM = the first half of the day; it rides the inner band. */
export const isAM = (b: Block): boolean => b.startMin < 720

export const DAY_MIN = 1440

/** How a block sits relative to today's [0,1440] window once it spans midnight.
    A 12-h face has no angle for "tomorrow", so a multi-day block is drawn only
    for its today-segment and the carry-over is marked, not swept — the analog
    Google/Outlook use when they clip a multi-day event per day. */
export interface CrossDaySpan {
  /** today-segment start in minutes (the arc's d0 maps from this) */
  drawStart: number
  /** today-segment end in minutes (the arc's d1 maps from this) */
  drawEnd: number
  /** runs past today's midnight → mark the day-end edge "continues" */
  continuesAfter: boolean
  /** began before today's midnight → mark the day-start edge "from yesterday" */
  continuesFrom: boolean
  /** real end clock-minute for a "→ 6:00" cue (endMin folded into [0,1440)) */
  endLabelMin: number
}

/** Clip a block to today's [0,1440] window so a cross-midnight block draws as a
    today-only wedge, never a giant wrap-around arc.

    Two stored shapes both mean "spills into tomorrow": an unfolded `endMin >
    1440` (start + a long duration, e.g. 22:00 + 8h = 1800) and a folded `endMin
    <= startMin` (a wrapped wall-clock end, e.g. start 1320, end 360). Either way
    we render `[startMin, 1440]` and flag `continuesAfter`. A block whose start is
    itself before midnight (`startMin < 0`, the "started yesterday" tail) renders
    `[0, endMin]` with `continuesFrom`. Same-day blocks (including one ending
    exactly at 24:00) pass through unclipped with no cue. Pure: minutes in,
    today-segment + carry flags out. */
export function crossDaySpan(startMin: number, endMin: number): CrossDaySpan {
  const endLabelMin = ((endMin % DAY_MIN) + DAY_MIN) % DAY_MIN
  // tail of a block that began yesterday: draw its today head [0, endMin]
  if (startMin < 0) {
    return { drawStart: 0, drawEnd: Math.min(endMin, DAY_MIN), continuesAfter: false, continuesFrom: true, endLabelMin }
  }
  // spills past midnight, either stored shape — clip the drawn arc to day-end
  const spills = endMin > DAY_MIN || endMin <= startMin
  if (spills) {
    return { drawStart: startMin, drawEnd: DAY_MIN, continuesAfter: true, continuesFrom: false, endLabelMin }
  }
  // same-day (24:00 end included): unclipped, no carry
  return { drawStart: startMin, drawEnd: endMin, continuesAfter: false, continuesFrom: false, endLabelMin }
}

/** Visible set: everything on today's face — open AND done, the whole day (no
    forward clip; the AM/PM bands keep 12-hours-apart events off one radius).
    Done blocks stay as completed markers. */
export function visibleOrbit(blocks: Block[], todayKey: string, _nowH: number): Block[] {
  return blocks
    .filter((b) => b.dayKey === todayKey && (b.status === 'open' || b.status === 'done'))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
}

export function isRunning(b: Block, nowH: number): boolean {
  return b.startMin / 60 <= nowH && nowH < b.endMin / 60
}

/** Lane radii. AM blocks sit just inside the outer ring and step INWARD toward
    the inner ring; PM blocks sit just outside it and step OUTWARD — so each
    half owns its band. Within a band a block only leaves the base ring if it
    time-overlaps something already placed (greedy interval colouring). Focus is
    placed first in its half, so it keeps the base ring. */
export function radiiFor(vis: Block[], focusId: string | null, _nowH: number): Map<string, number> {
  const out = new Map<string, number>()
  const place = (group: Block[], base: number, dir: 1 | -1) => {
    const order = [...group].sort((a, b) => {
      if (a.id === focusId) return -1
      if (b.id === focusId) return 1
      return a.startMin - b.startMin || a.endMin - b.endMin
    })
    const lanes: Block[][] = []
    for (const b of order) {
      let k = 0
      while (lanes[k]?.some((o) => b.startMin < o.endMin && o.startMin < b.endMin)) k++
      ;(lanes[k] ??= []).push(b)
      out.set(b.id, base + dir * k * LANE_STEP)
    }
  }
  place(vis.filter(isAM), OG.ro - 12, -1) // AM: inward through the inner band
  place(vis.filter((b) => !isAM(b)), OG.ro + 12, 1) // PM: outward through the outer band
  return out
}

export interface OrbitLabel {
  id: string
  x: number
  y: number
  right: boolean
  /** the arc's end-dot the label belongs to (leader line anchor) */
  ex: number
  ey: number
  /** true when de-collision displaced the label enough to need a leader */
  moved: boolean
}

/** Callout labels at LABEL_R along each item's END clock angle, then a per-side
    greedy sweep (top→bottom, LABEL_GAP minimum) so same-side labels never
    stack — the de-collision discipline the old dial proved, shaped for a fixed
    face. */
export function resolveLabels(vis: Block[], radii: Map<string, number>): Map<string, OrbitLabel> {
  const raw = vis.map((b) => {
    // anchor at the DRAWN end: a cross-midnight block's arc stops at day-end, so
    // its callout/leader belong there too, not at the phantom next-day angle
    const deg = clockDeg(crossDaySpan(b.startMin, b.endMin).drawEnd / 60)
    const [ex, ey] = rPolar(OG.cx, OG.cy, radii.get(b.id) ?? OG.ro, deg)
    const [lx, ly] = rPolar(OG.cx, OG.cy, LABEL_R, deg)
    const right = lx >= OG.cx
    return { id: b.id, x: lx + (right ? 9 : -9), y: ly, right, ex, ey, baseY: ly }
  })
  for (const side of [true, false]) {
    const grp = raw.filter((l) => l.right === side).sort((a, b) => a.y - b.y)
    for (let i = 1; i < grp.length; i++) {
      if (grp[i].y - grp[i - 1].y < LABEL_GAP) grp[i].y = grp[i - 1].y + LABEL_GAP
    }
  }
  const out = new Map<string, OrbitLabel>()
  for (const l of raw) {
    const moved = Math.abs(l.y - l.ey) > 7 || Math.abs(l.x - (l.ex + (l.right ? 9 : -9))) > 12
    out.set(l.id, { id: l.id, x: l.x, y: l.y, right: l.right, ex: l.ex, ey: l.ey, moved })
  }
  return out
}

/** Arc color per §3: deadline-background gold, work ice, everything else teal. */
export function orbitColor(b: Block, isFocus: boolean): string {
  if (isBackground(b) && b.due != null && !isFocus) return 'var(--gold)'
  return b.tag === 'work' ? 'var(--ice)' : 'var(--teal)'
}

export interface DayFill {
  /** inner-disk sweep degrees — fills 00:00 → 12:00 */
  inner: number
  /** inner→outer band sweep degrees — fills 12:00 → 24:00 */
  outer: number
}

/** Two-stage day progress: a 12-h face can't show a 24-h day on angle alone, so
    radius carries AM vs PM. The inner disk fills clockwise from the top over the
    first 12 h; the inner→outer band fills over the second. Both reach a full
    turn by 24:00. Pure: minutes-of-day in, two sweep angles out. */
export function dayFill(minutesOfDay: number): DayFill {
  const m = Math.max(0, Math.min(1440, minutesOfDay))
  return {
    inner: (Math.min(m, 720) / 720) * 360,
    outer: (Math.max(0, m - 720) / 720) * 360,
  }
}
