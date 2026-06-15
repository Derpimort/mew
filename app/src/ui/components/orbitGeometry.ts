/* Fixed 12-hour clock-face geometry. 12 sits at the top and never moves; a
   block rides an arc at its real start→end clock angle; now is a hand that
   sweeps the face. Same-angle blocks step inward one compact lane so arcs never
   share a radius. Day progress is a two-stage wash — the inner disk fills over
   the first 12 h, the inner→outer band over the second — ending at the now
   notch. Labels are callouts outside the bezel with per-side greedy
   de-collision. All pure — tested like the week model is. */

import type { Block } from '../../domain/types'
import { isBackground } from '../../domain/week'
import { clockDeg, rPolar } from './dialGeometry'

/* Radii, centre → out (SVG units around cx,cy):
   countdown · inner-fill ring (ri) · outer-fill ring (ro) · task arcs (task,
   just above ro with small padding) · hour ticks + now-hand (tick) · numerals
   (num). The time layers and the task ring are close in scale — compact. */
export const OG = {
  cx: 300,
  cy: 354,
  w: 760,
  h: 664,
  // ox centres the dial axis (cx) in the stage: cx + ox = w/2, so the
  // countdown can anchor at left:50% and margins stay symmetric.
  ox: 80,
  ri: 130,
  ro: 192,
  task: 220,
  tick: 238,
  num: 252,
} as const
export const LANE_STEP = 8
export const LABEL_R = OG.num + 14 // callouts just outside the numerals
export const LABEL_GAP = 16

/** Visible set: today's open blocks whose window intersects [now, now+12h).
    Forward-clipping at ~12h keeps a block and its 12-hours-later twin from
    landing on the same clock angle. Done blocks leave — they're mews. */
export function visibleOrbit(blocks: Block[], todayKey: string, nowH: number): Block[] {
  return blocks
    .filter(
      (b) =>
        b.dayKey === todayKey &&
        b.status === 'open' &&
        b.endMin / 60 > nowH &&
        b.startMin / 60 < nowH + 11.2,
    )
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
}

export function isRunning(b: Block, nowH: number): boolean {
  return b.startMin / 60 <= nowH && nowH < b.endMin / 60
}

/** Lane radii on a fixed face: blocks at different times sit at different
    ANGLES, so they share the outer task ring — compact, hugging the time
    layers. Only blocks that genuinely overlap in time would collide at a shared
    radius, so each takes the outermost lane free of a time-overlap with what's
    already there (greedy interval colouring). Focus is placed first, so it
    keeps the outer ring; an overlapping sibling steps one lane inward. */
export function radiiFor(vis: Block[], focusId: string | null, _nowH: number): Map<string, number> {
  const order = [...vis].sort((a, b) => {
    if (a.id === focusId) return -1
    if (b.id === focusId) return 1
    return a.startMin - b.startMin || a.endMin - b.endMin
  })
  const lanes: Block[][] = []
  const out = new Map<string, number>()
  for (const b of order) {
    let k = 0
    while (lanes[k]?.some((o) => b.startMin < o.endMin && o.startMin < b.endMin)) k++
    ;(lanes[k] ??= []).push(b)
    out.set(b.id, OG.task - k * LANE_STEP)
  }
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
    const deg = clockDeg(b.endMin / 60)
    const [ex, ey] = rPolar(OG.cx, OG.cy, radii.get(b.id) ?? OG.task, deg)
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
