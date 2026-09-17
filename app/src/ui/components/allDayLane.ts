/* The week's all-day lane (#27) — pure layout, unit-tested without a DOM.
   All-day entries are labels on the day, so they never enter the time-true
   grid: they ride a strip between the date header and 0:00, one chip per
   entry. A multi-day span is ONE continuous chip across the columns it covers
   (clipped to the visible week, with a flag on the clipped side), chips pack
   into rows first-fit, and a crowded lane collapses to "+N more" per column
   until the owner asks to see everything. The view only renders this. */

import type { Block } from '../../domain/types'
import { isAllDay } from '../../domain/week'

export interface LaneChip {
  block: Block
  /** index of the first VISIBLE day it covers */
  col: number
  /** visible days covered, ≥ 1 */
  span: number
  /** packed row, 0-based — shared across every column the chip covers */
  row: number
  /** the entry began before the visible week */
  clippedStart: boolean
  /** …or runs past its end */
  clippedEnd: boolean
}

export interface AllDayLayout {
  chips: LaneChip[]
  /** rows the whole lane needs */
  rows: number
}

/** Pack the week's all-day entries into rows: earliest first, longer spans
    before shorter ones on the same day, each into the first row whose columns
    are all free. Rolled entries and anything outside the week stay out. */
export function layoutAllDay(blocks: Block[], weekDayKeys: readonly string[]): AllDayLayout {
  const n = weekDayKeys.length
  if (n === 0) return { chips: [], rows: 0 }
  const first = weekDayKeys[0]
  const last = weekDayKeys[n - 1]
  const placed = blocks
    .filter((b) => isAllDay(b) && b.status !== 'rolled')
    .map((b) => {
      const end = b.endDayKey ?? b.dayKey
      if (end < first || b.dayKey > last) return null
      const from = b.dayKey < first ? first : b.dayKey
      const to = end > last ? last : end
      const col = weekDayKeys.indexOf(from)
      const lastCol = weekDayKeys.indexOf(to)
      if (col === -1 || lastCol < col) return null
      return {
        block: b,
        col,
        span: lastCol - col + 1,
        clippedStart: b.dayKey < first,
        clippedEnd: end > last,
      }
    })
    .filter((c): c is Omit<LaneChip, 'row'> => c != null)
    .sort(
      (a, z) =>
        a.col - z.col ||
        z.span - a.span ||
        a.block.dayKey.localeCompare(z.block.dayKey) ||
        a.block.title.localeCompare(z.block.title) ||
        a.block.id.localeCompare(z.block.id)
    )

  const taken: boolean[][] = []
  const chips: LaneChip[] = placed.map((c) => {
    let row = 0
    for (; ; row++) {
      taken[row] ??= Array.from({ length: n }, () => false)
      let free = true
      for (let i = c.col; i < c.col + c.span; i++) if (taken[row][i]) free = false
      if (free) break
    }
    for (let i = c.col; i < c.col + c.span; i++) taken[row][i] = true
    return { ...c, row }
  })
  return { chips, rows: taken.length }
}

/** A crowded lane shows at most this many lines — two of chips and a third
    holding "+N more" wherever something is tucked away. */
export const LANE_MAX_LINES = 3

export interface LaneMore {
  col: number
  /** tucked-away chips covering this column */
  count: number
}

export interface AllDayLaneView {
  visible: LaneChip[]
  more: LaneMore[]
  /** lines to draw: chip rows, plus the "+N more" line when collapsed */
  lines: number
  /** the full lane needs more than LANE_MAX_LINES — a show-less exists when open */
  collapsible: boolean
}

/** What to draw. Collapsed (the default) keeps a crowded lane to three lines:
    rows 0–1 stay whole — a span is never cut — and each column that hides
    anything says how much, once. Expanded draws every row. */
export function viewAllDay(layout: AllDayLayout, expanded: boolean): AllDayLaneView {
  const collapsible = layout.rows > LANE_MAX_LINES
  if (!collapsible || expanded) {
    return { visible: layout.chips, more: [], lines: layout.rows, collapsible }
  }
  const keep = LANE_MAX_LINES - 1
  const counts = new Map<number, number>()
  for (const c of layout.chips) {
    if (c.row < keep) continue
    for (let i = c.col; i < c.col + c.span; i++) counts.set(i, (counts.get(i) ?? 0) + 1)
  }
  return {
    visible: layout.chips.filter((c) => c.row < keep),
    more: [...counts].sort(([a], [z]) => a - z).map(([col, count]) => ({ col, count })),
    lines: LANE_MAX_LINES,
    collapsible,
  }
}

/* the lane's box, in px — the view sizes the strip with these AND hands the
   same total back to the time grid, so a week with all-day entries keeps the
   page's height: the grid gives up exactly what the lane takes */
export const LANE_LINE_PX = 18
export const LANE_GAP_PX = 3
export const LANE_PAD_TOP_PX = 4
export const LANE_PAD_BOTTOM_PX = 6
export const LANE_RULE_PX = 1
export const LANE_MARGIN_PX = 6

/** The strip's own height (border-box) for `lines` lines; 0 draws no strip. */
export function laneBoxPx(lines: number): number {
  if (lines <= 0) return 0
  return (
    LANE_PAD_TOP_PX +
    lines * LANE_LINE_PX +
    (lines - 1) * LANE_GAP_PX +
    LANE_PAD_BOTTOM_PX +
    LANE_RULE_PX
  )
}

/** Everything the lane takes from the page: its box plus the margin under it. */
export function laneSpacePx(lines: number): number {
  return lines <= 0 ? 0 : laneBoxPx(lines) + LANE_MARGIN_PX
}
