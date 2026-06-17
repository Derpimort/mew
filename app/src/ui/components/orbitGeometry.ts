/* Fixed 12-hour clock-face geometry. 12 sits at the top and never moves; a
   block rides an arc at its real start→end clock angle; now is a hand that
   sweeps the face. The whole day fits on a 12-h face because RADIUS carries two
   things: the half (a 9 AM and 9 PM share an angle but never a band) and, within
   each half, COMMITMENT. Two ring lines are the dividers — the inner ring splits
   the AM half, the outer ring the PM half — yielding four importance-tiered
   bands, centre → out: AM-confirmed (inside the inner ring), AM-bg/rest (outside
   it), PM-confirmed (inside the outer ring), PM-bg/rest (outside it). Confirmed
   work rides nearer the centre; background/rest rides further out. Within a band,
   time-overlapping blocks step one lane (greedy). Done blocks stay on the face as
   completed markers. Labels are callouts outside the bezel with per-side greedy
   de-collision. All pure — tested like the week model is. */

import type { Block } from '../../domain/types'
import { isBackground } from '../../domain/week'
import { clockDeg, rPolar } from './dialGeometry'

/* Radii, centre → out (SVG units around cx,cy). Radius now encodes COMMITMENT
   within each half: two ring lines are the dividers and four importance-tiered
   event bands fall out, AM nested inside PM —
     countdown (inside the AM-confirmed band) ·
     AM-confirmed band (inside ri) · inner ring (ri) · AM-bg/rest band (outside ri) ·
     AM|PM fill boundary (mid) ·
     PM-confirmed band (inside ro) · outer ring (ro) · PM-bg/rest band (outside ro) ·
     bezel (pm) · hour ticks + now-hand (tick) · numerals (num).
   `ri` splits the AM half by commitment, `ro` splits the PM half; `mid` is where
   the AM day-fill zone hands off to the PM zone, sitting in the clear gap between
   the AM-bg and PM-confirmed bands so the wash, rings, and events read as one
   system (see dayFill + bandBaseFor for the exact seams). */
export const OG = {
  cx: 300,
  cy: 354,
  w: 760,
  h: 664,
  // ox centres the dial axis (cx) in the stage: cx + ox = w/2, so the
  // countdown can anchor at left:50% and margins stay symmetric.
  ox: 80,
  disk: 90, // clear centre for the countdown; the AM zone fill starts here
  ri: 128, // inner ring — the AM commitment divider
  ro: 210, // outer ring — the PM commitment divider
  mid: 174, // AM→PM day-fill zone boundary (between AM-bg and PM-confirmed bands)
  pm: 252, // bezel — outer edge of the PM zone
  tick: 262,
  num: 274,
} as const
export const LANE_STEP = 8
/** Half-gap from a divider ring to its band's base lane: confirmed blocks sit
    BAND inside the ring (then step further in), background BAND outside (then
    step further out). Sized so a couple of de-collision lanes never cross the
    adjacent ring or the AM|PM boundary. */
export const BAND = 18
export const LABEL_R = OG.num + 14 // callouts just outside the numerals
export const LABEL_GAP = 16

/** AM = the first half of the day; its two bands nest inside the PM half. */
export const isAM = (b: Block): boolean => b.startMin < 720

/** "Confirmed/important" — a held block that isn't background, optional/tentative,
    or a pacing rest. Confirmed blocks ride INSIDE their half's divider ring;
    background/rest ride OUTSIDE it. One helper so render + tests agree. */
export const isCommitted = (b: Block): boolean => !isBackground(b) && !b.optional && b.tag !== 'rest'

/** Base lane radius for a block's importance band, before lane de-collision.
    Four bands, centre → out: AM-confirmed (ri−BAND), AM-bg (ri+BAND),
    PM-confirmed (ro−BAND), PM-bg (ro+BAND). Pure — block in, base radius out. */
export function bandBaseFor(b: Block): number {
  const ring = isAM(b) ? OG.ri : OG.ro
  return isCommitted(b) ? ring - BAND : ring + BAND
}

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
    Done blocks stay as completed markers. Equal-start blocks tie-break on the
    DRAWN end (crossDaySpan), so a folded overnight block — whose raw endMin
    wrapped below its start — orders by the arc it actually paints, not the
    collapsed wrap. */
export function visibleOrbit(blocks: Block[], todayKey: string, _nowH: number): Block[] {
  return blocks
    .filter((b) => b.dayKey === todayKey && (b.status === 'open' || b.status === 'done'))
    .sort((a, b) => a.startMin - b.startMin || crossDaySpan(a.startMin, a.endMin).drawEnd - crossDaySpan(b.startMin, b.endMin).drawEnd)
}

export function isRunning(b: Block, nowH: number): boolean {
  return b.startMin / 60 <= nowH && nowH < b.endMin / 60
}

/** Lane radii — four importance-tiered bands (centre → out): AM-confirmed inside
    the inner ring, AM-bg/rest outside it, PM-confirmed inside the outer ring,
    PM-bg/rest outside it. So radius reads as COMMITMENT within each half.
    Confirmed bands step INWARD from just inside their ring; background bands step
    OUTWARD from just outside it. Within a band a block only leaves its base lane
    when it time-overlaps something already placed (greedy interval colouring),
    so a clear half stays compact on the base ring. Focus is placed first, so it
    keeps its band's base lane (and stays visually dominant via glow, not radius). */
export function radiiFor(vis: Block[], focusId: string | null, _nowH: number): Map<string, number> {
  const out = new Map<string, number>()
  // De-collision runs on each block's DRAWN today-arc, not raw start/end: a
  // folded overnight block (endMin wrapped below startMin) would otherwise test
  // as a near-empty interval and mis-lane against neighbours it truly overlaps.
  // crossDaySpan is the single source of that folding — compute once per block
  // (this is the O(n²) lane loop's inner test) and read drawStart/drawEnd.
  const arc = new Map<string, CrossDaySpan>(vis.map((b) => [b.id, crossDaySpan(b.startMin, b.endMin)]))
  const span = (b: Block) => arc.get(b.id) ?? crossDaySpan(b.startMin, b.endMin)
  const place = (group: Block[], dir: 1 | -1) => {
    const order = [...group].sort((a, b) => {
      if (a.id === focusId) return -1
      if (b.id === focusId) return 1
      return a.startMin - b.startMin || span(a).drawEnd - span(b).drawEnd
    })
    const lanes: Block[][] = []
    for (const b of order) {
      const bs = span(b)
      let k = 0
      while (lanes[k]?.some((o) => bs.drawStart < span(o).drawEnd && span(o).drawStart < bs.drawEnd)) k++
      ;(lanes[k] ??= []).push(b)
      out.set(b.id, bandBaseFor(b) + dir * k * LANE_STEP)
    }
  }
  // confirmed bands step inward (toward centre); background/rest step outward
  place(vis.filter((b) => isAM(b) && isCommitted(b)), -1)
  place(vis.filter((b) => isAM(b) && !isCommitted(b)), 1)
  place(vis.filter((b) => !isAM(b) && isCommitted(b)), -1)
  place(vis.filter((b) => !isAM(b) && !isCommitted(b)), 1)
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
  /** AM-zone sweep degrees — fills 00:00 → 12:00 */
  inner: number
  /** PM-zone sweep degrees — fills 12:00 → 24:00 */
  outer: number
}

/** Two-stage day progress: a 12-h face can't show a 24-h day on angle alone, so
    radius carries AM vs PM. The AM zone (the inner annulus the two AM bands ride,
    inside `mid`) fills clockwise from the top over the first 12 h; the PM zone
    (`mid → pm`, the two PM bands) fills over the second. Both reach a full turn
    by 24:00 — so the wash backs the same two halves the bands tier. Pure:
    minutes-of-day in, two sweep angles out. */
export function dayFill(minutesOfDay: number): DayFill {
  const m = Math.max(0, Math.min(1440, minutesOfDay))
  return {
    inner: (Math.min(m, 720) / 720) * 360,
    outer: (Math.max(0, m - 720) / 720) * 360,
  }
}
