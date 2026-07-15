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
import { fmtTime } from '../../domain/time'
import { clockDeg, rPolar } from './dialGeometry'

/* Radii, centre → out (SVG units around cx,cy). Radius encodes COMMITMENT within
   each half — but only TWO ring lines are DRAWN (inner ri + outer bezel pm); the
   PM divider `ro` stays a pure band-placement reference, not a circle, so the
   face reads as two clean rings, not three. Four importance-tiered event bands
   still fall out, AM nested inside PM —
     countdown (inside the AM-confirmed band) ·
     AM-confirmed band (inside ri) · inner ring (ri, drawn) · AM-bg/rest band (outside ri) ·
     PM-confirmed band (inside ro) · [ro: invisible divider] · PM-bg/rest band (outside ro) ·
     outer ring (pm, drawn) + hour ticks + now-hand (tick) · numerals (num).
   `ri` splits the AM half by commitment, `ro` splits the PM half (as math, not a
   line); the outer ring (pm) is the bezel and carries the ticks + 12/3/6/9
   numerals as one combined marked ring. The day-fill wash aligns to the two rings:
   the AM zone fills the inner disk up to the inner ring (disk→ri), the PM zone
   fills the gap between the rings (ri→pm) — see dayFill + bandBaseFor. */
export const OG = {
  cx: 300,
  cy: 354,
  w: 760,
  h: 690, // a clear bottom strip below the 6 o'clock numeral for the hover readout
  // ox centres the dial axis (cx) in the stage: cx + ox = w/2, so the
  // countdown can anchor at left:50% and margins stay symmetric.
  ox: 80,
  disk: 90, // clear centre for the countdown; the AM zone fill starts here
  ri: 170, // inner ring (drawn) — pushed out so it clears the centre text stack (countdown→meta→task) and tightens the formerly-wide inner→outer gap; the AM-bg/PM-confirmed seam now guarantees ≤2 de-collision lanes (was 3) — see the seam test. PAIRED with .clk-center's width bound in components.css (ri=170 → 340px ring; the 290px text box's corners sit ≈168 from centre) — change both together
  ro: 224, // PM commitment divider — a band-placement reference, NOT drawn (two rings only); held as ri grew (raising it would push PM-bg past the bezel), narrowing the AM-bg→PM-confirmed seam to a 2-lane guarantee. That guarantee is CENTRE-LINE ordering, not daylight: at full 2+2 density the deepest lanes sit at 196/198, so 3.5px arc strokes can visually graze where angles overlap — the seam test pins the ordering invariant
  pm: 258, // outer ring (drawn) — the bezel, now carrying the hour ticks + numerals
  tick: 258, // hour ticks sit ON the outer ring (pm), unifying ring + markers
  num: 272, // numerals just outside the outer ring + ticks
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
export const isCommitted = (b: Block): boolean =>
  !isBackground(b) && !b.optional && b.tag !== 'rest'

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
    return {
      drawStart: 0,
      drawEnd: Math.min(endMin, DAY_MIN),
      continuesAfter: false,
      continuesFrom: true,
      endLabelMin,
    }
  }
  // spills past midnight, either stored shape — clip the drawn arc to day-end
  const spills = endMin > DAY_MIN || endMin <= startMin
  if (spills) {
    return {
      drawStart: startMin,
      drawEnd: DAY_MIN,
      continuesAfter: true,
      continuesFrom: false,
      endLabelMin,
    }
  }
  // same-day (24:00 end included): unclipped, no carry
  return {
    drawStart: startMin,
    drawEnd: endMin,
    continuesAfter: false,
    continuesFrom: false,
    endLabelMin,
  }
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
    .sort(
      (a, b) =>
        a.startMin - b.startMin ||
        crossDaySpan(a.startMin, a.endMin).drawEnd - crossDaySpan(b.startMin, b.endMin).drawEnd
    )
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
  const arc = new Map<string, CrossDaySpan>(
    vis.map((b) => [b.id, crossDaySpan(b.startMin, b.endMin)])
  )
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
      while (
        lanes[k]?.some((o) => bs.drawStart < span(o).drawEnd && span(o).drawStart < bs.drawEnd)
      )
        k++
      ;(lanes[k] ??= []).push(b)
      out.set(b.id, bandBaseFor(b) + dir * k * LANE_STEP)
    }
  }
  // confirmed bands step inward (toward centre); background/rest step outward
  place(
    vis.filter((b) => isAM(b) && isCommitted(b)),
    -1
  )
  place(
    vis.filter((b) => isAM(b) && !isCommitted(b)),
    1
  )
  place(
    vis.filter((b) => !isAM(b) && isCommitted(b)),
    -1
  )
  place(
    vis.filter((b) => !isAM(b) && !isCommitted(b)),
    1
  )
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

/** How many title characters fit between a callout's anchor and the svg edge.
    SVG clips at the viewBox, so a label near 3/9 o'clock only has the narrow
    strip beside the bezel — a long title (especially the un-truncated
    hover/focus state) ran off the boundary and was cut mid-glyph. The budget
    is that remaining strip, minus `reservePx` (the inline time note that
    follows the title), at an average Hanken Grotesk advance of ~0.58em. */
export function labelBudget(x: number, right: boolean, fontPx: number, reservePx = 0): number {
  const EDGE_PAD = 10 // breathing room inside the svg edge
  const left = -OG.ox + EDGE_PAD
  const rightEdge = -OG.ox + OG.w - EDGE_PAD
  const room = (right ? rightEdge - x : x - left) - reservePx
  return Math.max(0, Math.floor(room / (fontPx * 0.58)))
}

/** Ellipsize a callout title into its budget — never let the svg clip it. */
export function fitLabel(title: string, budget: number): string {
  if (title.length <= budget) return title
  if (budget <= 1) return '…'
  return title.slice(0, budget - 1).trimEnd() + '…'
}

/** Where the hover/focus reveal anchors: usually the callout's own x, but a
    label hugging the 3/9 o'clock edge only affords a handful of characters per
    line — too narrow even to wrap ("Managemen / t Team / Wednesda…"). The
    reveal nudges such an anchor inward just far enough for `minChars` a line;
    the halo keeps it legible over anything it now overlaps, and the resting
    layout is untouched. */
export function revealAnchorX(x: number, right: boolean, fontPx: number, minChars = 14): number {
  const EDGE_PAD = 10
  const need = Math.ceil(minChars * fontPx * 0.58) + 1 // +1px: floor-proof the char budget
  return right
    ? Math.min(x, -OG.ox + OG.w - EDGE_PAD - need)
    : Math.max(x, -OG.ox + EDGE_PAD + need)
}

/** Wrap a callout title into whole-word lines of ≤ budget chars. Hover/focus
    reads with THIS, not the ellipsis: the reveal states exist to make the task
    legible in place, so a tight edge budget stacks lines instead of eating
    characters. A word longer than a whole line hard-breaks; past maxLines the
    tail ellipsizes (the click card always holds the untruncated title). */
export function wrapLabel(title: string, budget: number, maxLines = 3): string[] {
  if (budget <= 1) return ['…']
  const lines: string[] = []
  let cur = ''
  for (const word of title.split(/\s+/).filter(Boolean)) {
    let w = word
    if (cur && cur.length + 1 + w.length <= budget) {
      cur += ' ' + w
      continue
    }
    if (cur) lines.push(cur)
    while (w.length > budget) {
      lines.push(w.slice(0, budget))
      w = w.slice(budget)
    }
    cur = w
  }
  if (cur) lines.push(cur)
  if (!lines.length) return ['…']
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = fitLabel(
      `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`,
      budget
    )
    return kept
  }
  return lines
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
    radius carries AM vs PM, aligned to the two rings. The AM zone (the inner disk
    out to the inner ring, disk→ri) fills clockwise from the top over the first
    12 h; the PM zone (the gap between the rings, ri→pm) fills over the second.
    Both reach a full turn by 24:00 — so the wash backs the same two halves the
    bands tier. Pure: minutes-of-day in, two sweep angles out. */
export function dayFill(minutesOfDay: number): DayFill {
  const m = Math.max(0, Math.min(1440, minutesOfDay))
  return {
    inner: (Math.min(m, 720) / 720) * 360,
    outer: (Math.max(0, m - 720) / 720) * 360,
  }
}

/* ── Accessibility: name & order for the dial's arcs (WCAG 2.2 §1.1.1, §4.1.2,
   §2.1.1 · APG Application pattern) ──────────────────────────────────────────
   Each arc is an interactive button on a 2-D surface, so it needs a text name and
   the visible set needs a deterministic focus order. Both are pure functions of
   (blocks [, radii]) — the component only wires the roving tabindex and reads
   these, keeping the a11y contract testable like the rest of the geometry. */

/** A spoken tag word for an arc's name. External (calendar) blocks say so; rest
    reads as "rest" (the earned-rest framing is the chip's, not the dial name's);
    optional adds "tentative". Positive-only voice — never "overdue"/"failed". */
function spokenTag(b: Block): string {
  if (b.external) return 'calendar'
  const base =
    b.tag === 'work' ? 'work' : b.tag === 'rest' ? 'rest' : b.tag === 'health' ? 'health' : 'life'
  return b.optional ? `${base}, tentative` : base
}

/** The arc's accessible name: "{title} · {start}–{end} · {tag}". A deadline-only
    background block (holds the clock, not you) reads its due time; a cross-midnight
    block reads its real (folded) end so the name agrees with the painted arc. Done
    blocks are announced complete so a screen-reader user hears the same "quiet
    marker" the eye sees. The title is taken before any "— note" tail, matching the
    dial's visible label. */
export function arcAriaLabel(b: Block): string {
  const title = b.title.split('—')[0].trim()
  const span = crossDaySpan(b.startMin, b.endMin)
  const dueOnly = isBackground(b) && b.due != null
  const when = dueOnly
    ? `due ${fmtTime(b.due!)}`
    : `${fmtTime(b.startMin)}–${fmtTime(span.endLabelMin)}${span.continuesAfter ? ', continues tomorrow' : span.continuesFrom ? ', from yesterday' : ''}`
  const done = b.status === 'done' ? ', done' : ''
  return `${title} · ${when} · ${spokenTag(b)}${done}`
}

/** Which single arc holds the roving tab stop (the one tabindex=0 — APG roving
    tabindex). Preference: the arc the keyboard last landed on (if still visible),
    else the live focus item (so Tab lands on "now" first), else the first arc in
    reading order. Returns null only when the face is empty. Pure so the
    "exactly one tab stop, and it's the right one" rule is unit-tested. */
export function rovingFocusId(
  order: string[],
  kbFocus: string | null,
  focusId: string | null
): string | null {
  if (kbFocus && order.includes(kbFocus)) return kbFocus
  if (focusId && order.includes(focusId)) return focusId
  return order[0] ?? null
}

/** Tab/Shift+Tab order for the visible arcs: the same time-then-drawn-end order
    the dial sorts by (visibleOrbit), so the focus ring walks the face the way the
    eye reads it — earliest first, ties broken by the arc actually painted. Pure:
    visible blocks in, their ids in focus order out. */
export function dialFocusOrder(vis: Block[]): string[] {
  return [...vis]
    .sort(
      (a, b) =>
        a.startMin - b.startMin ||
        crossDaySpan(a.startMin, a.endMin).drawEnd - crossDaySpan(b.startMin, b.endMin).drawEnd
    )
    .map((b) => b.id)
}

/** The next focus target when an arrow key steps along one axis from `currentId`.
    TIME (←/→): step to the previous/next arc by start time around the face (wraps,
    so a keyboard-only user never dead-ends). LANE (↑/↓): among arcs near the same
    clock angle, step inward/outward by radius (commitment band); with no near-angle
    neighbour it falls back to a time step so the key is never inert. Returns the
    current id when the set has ≤1 item. Pure: (vis, radii, current, axis, dir) →
    next id, so the stepping contract is unit-tested, not eyeballed. */
export function stepDialFocus(
  vis: Block[],
  radii: Map<string, number>,
  currentId: string | null,
  axis: 'time' | 'lane',
  dir: 1 | -1
): string | null {
  if (vis.length === 0) return currentId
  const order = dialFocusOrder(vis)
  if (vis.length === 1) return order[0]
  // no anchor yet → first/last in reading order, so the first arrow lands on the face
  if (currentId == null || !order.includes(currentId))
    return dir === 1 ? order[0] : order[order.length - 1]

  if (axis === 'time') {
    const i = order.indexOf(currentId)
    return order[(i + dir + order.length) % order.length]
  }

  // LANE: walk the radius among arcs sharing (roughly) the current clock angle.
  const deg = (b: Block) => clockDeg(crossDaySpan(b.startMin, b.endMin).drawStart / 60)
  const cur = vis.find((b) => b.id === currentId)!
  const curDeg = deg(cur)
  const curR = radii.get(currentId) ?? OG.ro
  // angular distance on a circle (handles the 360/0 seam)
  const angGap = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360
    return Math.min(d, 360 - d)
  }
  const sameAngle = vis.filter((b) => b.id !== currentId && angGap(deg(b), curDeg) <= 12)
  // dir −1 = ↑ (toward the rim, larger radius); dir +1 = ↓ (toward the centre,
  // smaller radius) — matching the dial's "background rides outward" mental model.
  const wantLarger = dir === -1
  const candidates = sameAngle
    .map((b) => ({ id: b.id, r: radii.get(b.id) ?? OG.ro }))
    .filter((c) => (wantLarger ? c.r > curR : c.r < curR))
    .sort((a, b) => (wantLarger ? a.r - b.r : b.r - a.r)) // nearest lane first
  if (candidates.length > 0) return candidates[0].id
  // nothing to step to in this band → keep the key useful by stepping in time
  const i = order.indexOf(currentId)
  return order[(i + dir + order.length) % order.length]
}
