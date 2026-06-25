/* Drag-to-reschedule geometry — pure, tested like the week model. The week grid
   maps a clock-minute to a y-pixel via nxwY (y = min/1440 · H); dragging is the
   inverse, plus a column hit-test for the target day. Nothing here mutates: it
   turns a pointer position into a candidate {dayKey, startMin}, which the store's
   executor (the only mutation path) then validates and commits. */

import type { Block } from '../../domain/types'
import { duration, overlaps } from '../../domain/week'
import { DAY_MIN } from './orbitGeometry'

/** Drop snaps to this grid (minutes) — Google/Outlook use the same 5-min feel. */
export const SNAP_MIN = 5

/** A column's on-screen box, captured at drag start (variable widths: the
    selected day is 2.3× the others, so we hit-test real rects, not a uniform
    stride). Coordinates are viewport-space (getBoundingClientRect). */
export interface ColRect {
  dayKey: string
  left: number
  right: number
}

/** Live drag state, held by the view for the duration of one press. */
export interface DragState {
  id: string
  /** where the block sat when the press began — the bounce-back home */
  fromDayKey: string
  fromStartMin: number
  /** block length in minutes — preserved across the move */
  durationMin: number
  /** pointer offset inside the block at grab time (px from the block's top),
      so the block doesn't jump its top-edge to the cursor on the first move */
  grabOffsetPx: number
  /** the live candidate drop, recomputed on every mousemove */
  toDayKey: string
  toStartMin: number
}

/** Snap a clock-minute to the SNAP_MIN grid, clamped to a real day window so a
    drag past the top/bottom edge still lands on a placeable minute. The block's
    own length is reserved at the foot so its end never runs past midnight. */
export function snapMin(min: number, durationMin: number): number {
  const snapped = Math.round(min / SNAP_MIN) * SNAP_MIN
  const last = DAY_MIN - durationMin
  return Math.max(0, Math.min(last, snapped))
}

/** Pixel-y within a column (0..H) → clock-minute, before snapping. Inverse of
    nxwY: min = y/H · 1440. */
export function minFromY(y: number, H: number): number {
  return (y / H) * DAY_MIN
}

/** Which day a viewport-x falls in — the column whose box contains it, else the
    nearest edge column (a drag that strays past the grid still resolves to the
    closest day rather than vanishing). Empty rects → null (nothing to hit). */
export function dayFromX(clientX: number, cols: ColRect[]): string | null {
  if (!cols.length) return null
  for (const c of cols) {
    if (clientX >= c.left && clientX < c.right) return c.dayKey
  }
  // outside every column → clamp to the nearest edge (left of first / right of last)
  let best = cols[0]
  let bestDist = Infinity
  for (const c of cols) {
    const dist = clientX < c.left ? c.left - clientX : clientX - c.right
    if (dist < bestDist) {
      bestDist = dist
      best = c
    }
  }
  return best.dayKey
}

/** The candidate drop for a pointer position: hit-test the day, invert the y to a
    minute (accounting for where inside the block the user grabbed), then snap.
    Falls back to the drag's origin day when the pointer is off-grid with no
    columns. Pure — the store decides whether it's allowed. */
export function dropTarget(
  drag: DragState,
  clientX: number,
  gridTop: number,
  clientY: number,
  H: number,
  cols: ColRect[]
): { dayKey: string; startMin: number } {
  const dayKey = dayFromX(clientX, cols) ?? drag.fromDayKey
  // the block's TOP edge follows the cursor minus where it was grabbed, so the
  // block slides under the pointer instead of snapping its head to it
  const topY = clientY - gridTop - drag.grabOffsetPx
  const startMin = snapMin(minFromY(topY, H), drag.durationMin)
  return { dayKey, startMin }
}

/** Has the drop actually moved the block off its origin? A press that lands back
    where it started is a click, never a mutation — the view uses this to leave a
    plain click (pin/preview) untouched. */
export function isMoved(drag: DragState): boolean {
  return drag.toDayKey !== drag.fromDayKey || drag.toStartMin !== drag.fromStartMin
}

/** The blocks the dragged block's GHOST would overlap at its candidate drop —
    every other open, time-holding block on the target day whose span crosses the
    ghost's [start, start+duration). This is the live conflict set the view paints
    with a warning glow; it mirrors the domain's conflictsWith shape but runs on
    the *candidate* placement (which isn't in the block list yet) so the feedback
    is instant. Optional/background blocks are transparent — same rule the domain
    uses for real placement, kept identical here on purpose. */
export function ghostConflicts(
  blocks: Block[],
  drag: DragState,
  isTransparent: (b: Block) => boolean
): Block[] {
  const end = drag.toStartMin + drag.durationMin
  return blocks.filter(
    (b) =>
      b.id !== drag.id &&
      b.dayKey === drag.toDayKey &&
      b.status === 'open' &&
      !isTransparent(b) &&
      overlaps(b.startMin, b.endMin, drag.toStartMin, end)
  )
}

/** Seed a fresh drag from the block the user grabbed. The candidate drop starts
    exactly where the block lives, so an immediate mouseup (a plain click) is a
    no-op move. */
export function startDrag(b: Block, grabOffsetPx: number): DragState {
  return {
    id: b.id,
    fromDayKey: b.dayKey,
    fromStartMin: b.startMin,
    durationMin: duration(b),
    grabOffsetPx,
    toDayKey: b.dayKey,
    toStartMin: b.startMin,
  }
}
