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

/** A block never resizes below this — the same floor the keyboard (weekKeys)
    and the edit executor (execEdit) keep, so every resize path shares one min. */
export const MIN_RESIZE_MIN = 15

/** A column's on-screen box, captured at drag start (variable widths: the
    selected day is 2.3× the others, so we hit-test real rects, not a uniform
    stride). Coordinates are viewport-space (getBoundingClientRect). */
export interface ColRect {
  dayKey: string
  left: number
  right: number
}

/** Live drag state, held by the view for the duration of one press. Covers both
    gestures: a `move` slides the block to a new day/start; a `resize` drags one
    edge to change the length, anchoring the opposite edge. */
export interface DragState {
  id: string
  /** where the block sat when the press began — the bounce-back home */
  fromDayKey: string
  fromStartMin: number
  /** the block's end at grab — the resize anchor (a top-edge drag holds it; a
      bottom-edge drag extends from fromStartMin toward it) */
  fromEndMin: number
  /** live length in minutes — constant across a move; the resized length while
      an edge is dragged */
  durationMin: number
  /** pointer offset inside the block at grab time (px from the block's top),
      so the block doesn't jump its top-edge to the cursor on the first move */
  grabOffsetPx: number
  /** the live candidate drop, recomputed on every mousemove */
  toDayKey: string
  toStartMin: number
  /** the gesture: slide the whole block, or drag one edge to resize */
  mode: 'move' | 'resize'
  /** which edge a resize is dragging (unset for a move) */
  edge?: 'top' | 'bottom'
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
    fromEndMin: b.endMin,
    durationMin: duration(b),
    grabOffsetPx,
    toDayKey: b.dayKey,
    toStartMin: b.startMin,
    mode: 'move',
  }
}

/** Seed a fresh resize from the edge the user grabbed. The candidate span starts
    at the block's real span, so an immediate mouseup is a no-op (the store rules
    an unchanged length a click). Resizes never change the day. */
export function startResize(b: Block, edge: 'top' | 'bottom'): DragState {
  return {
    id: b.id,
    fromDayKey: b.dayKey,
    fromStartMin: b.startMin,
    fromEndMin: b.endMin,
    durationMin: duration(b),
    grabOffsetPx: 0,
    toDayKey: b.dayKey,
    toStartMin: b.startMin,
    mode: 'resize',
    edge,
  }
}

/** The candidate span for a resize drag: the grabbed edge follows the cursor
    minute (snapped to the grid), the opposite edge stays anchored. Clamped so
    the block keeps its MIN_RESIZE_MIN floor and never runs past midnight — the
    same bounds the keyboard resize and the edit executor hold. Pure — the store
    decides whether the new length is allowed (a clash still bounces). */
export function resizeTo(
  drag: DragState,
  clientY: number,
  gridTop: number,
  H: number
): { toStartMin: number; durationMin: number } {
  const edgeMin = Math.round(minFromY(clientY - gridTop, H) / SNAP_MIN) * SNAP_MIN
  if (drag.edge === 'top') {
    // the top edge follows the cursor; the block's end stays anchored
    const start = Math.max(0, Math.min(drag.fromEndMin - MIN_RESIZE_MIN, edgeMin))
    return { toStartMin: start, durationMin: drag.fromEndMin - start }
  }
  // the bottom edge follows the cursor; the block's start stays anchored
  const end = Math.max(drag.fromStartMin + MIN_RESIZE_MIN, Math.min(DAY_MIN, edgeMin))
  return { toStartMin: drag.fromStartMin, durationMin: end - drag.fromStartMin }
}

/** Has a resize actually changed the block's span? A press that lands the edge
    back where it started is a click, never a mutation. */
export function isResized(drag: DragState): boolean {
  return (
    drag.toStartMin !== drag.fromStartMin ||
    drag.durationMin !== drag.fromEndMin - drag.fromStartMin
  )
}
