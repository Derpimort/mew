/* The all-day lane's layout (#27), pinned as pure logic: which chips a week
   shows, where each one starts and how far it spans (one chip per multi-day
   entry, clipped to the week with a flag on the clipped side), how rows pack,
   how a crowded lane folds to "+N more" without ever cutting a span, and the
   box height the time grid hands back. No DOM, no store. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../../../domain/types'
import { LANE_MAX_LINES, laneBoxPx, laneSpacePx, layoutAllDay, viewAllDay } from '../allDayLane'

const WEEK = [
  '2026-09-21', // Mon
  '2026-09-22',
  '2026-09-23',
  '2026-09-24',
  '2026-09-25',
  '2026-09-26',
  '2026-09-27', // Sun
]

function label(id: string, dayKey: string, endDayKey?: string, over: Partial<Block> = {}): Block {
  return {
    id,
    title: id,
    tag: 'private',
    dayKey,
    startMin: 0,
    endMin: 0,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    allDay: true,
    ...(endDayKey ? { endDayKey } : {}),
    ...over,
  }
}

const timed = (id: string, dayKey: string): Block => ({
  ...label(id, dayKey),
  allDay: undefined,
  startMin: 540,
  endMin: 600,
})

const place = (blocks: Block[]) =>
  layoutAllDay(blocks, WEEK).chips.map((c) => [c.block.id, c.col, c.span, c.row])

describe('layoutAllDay — one chip per entry, spanning its days', () => {
  it('a Mon–Wed OOO is ONE chip over columns 0–2; a single day covers one column', () => {
    expect(place([label('ooo', WEEK[0], WEEK[2]), label('hol', WEEK[3])])).toEqual([
      ['ooo', 0, 3, 0],
      ['hol', 3, 1, 0],
    ])
  })

  it('only all-day, non-rolled entries that touch the week get a chip', () => {
    const blocks = [
      timed('meeting', WEEK[1]),
      label('rolled', WEEK[1], undefined, { status: 'rolled' }),
      label('last-week', '2026-09-14', '2026-09-20'),
      label('next-week', '2026-09-28'),
      label('kept', WEEK[1], undefined, { status: 'done' }),
    ]
    expect(place(blocks)).toEqual([['kept', 1, 1, 0]])
  })

  it('a span running past the week is clipped to it, flagged on the clipped side', () => {
    const { chips } = layoutAllDay(
      [label('trip', '2026-09-18', WEEK[1]), label('conf', WEEK[5], '2026-10-01')],
      WEEK
    )
    expect(chips.map((c) => [c.block.id, c.col, c.span, c.clippedStart, c.clippedEnd])).toEqual([
      ['trip', 0, 2, true, false],
      ['conf', 5, 2, false, true],
    ])
    const whole = layoutAllDay([label('sabbatical', '2026-09-01', '2026-10-31')], WEEK).chips[0]
    expect([whole.col, whole.span, whole.clippedStart, whole.clippedEnd]).toEqual([
      0,
      7,
      true,
      true,
    ])
  })

  it('rows pack first-fit: longer spans first, a chip never shares a column in its row', () => {
    const blocks = [
      label('bday', WEEK[1]), // Tue
      label('ooo', WEEK[0], WEEK[2]), // Mon–Wed
      label('hol', WEEK[0]), // Mon
      label('pay', WEEK[3]), // Thu — row 0 is free there
    ]
    expect(place(blocks)).toEqual([
      ['ooo', 0, 3, 0],
      ['hol', 0, 1, 1],
      ['bday', 1, 1, 1],
      ['pay', 3, 1, 0],
    ])
    expect(layoutAllDay(blocks, WEEK).rows).toBe(2)
  })

  it('ties break by title then id, so the lane never reshuffles between renders', () => {
    const a = place([label('b', WEEK[4]), label('a', WEEK[4])])
    const b = place([label('a', WEEK[4]), label('b', WEEK[4])])
    expect(a).toEqual(b)
    expect(a.map((r) => r[0])).toEqual(['a', 'b'])
  })

  it('an empty week (or no keys) lays out nothing', () => {
    expect(layoutAllDay([], WEEK)).toEqual({ chips: [], rows: 0 })
    expect(layoutAllDay([label('x', WEEK[0])], [])).toEqual({ chips: [], rows: 0 })
  })
})

describe('viewAllDay — a crowded lane folds to "+N more"', () => {
  const crowded = [
    label('ooo', WEEK[3], WEEK[5]), // Thu–Sat, row 0
    label('a', WEEK[4]),
    label('b', WEEK[4]),
    label('c', WEEK[4]),
    label('d', WEEK[4]),
  ]

  it('up to LANE_MAX_LINES rows show whole — nothing folds', () => {
    const layout = layoutAllDay(crowded.slice(0, 3), WEEK)
    expect(layout.rows).toBe(LANE_MAX_LINES)
    expect(viewAllDay(layout, false)).toMatchObject({ more: [], lines: 3, collapsible: false })
  })

  it('past the line: two rows stay, and each hiding column says how many, once', () => {
    const layout = layoutAllDay(crowded, WEEK)
    expect(layout.rows).toBe(5)
    const view = viewAllDay(layout, false)
    expect(view.visible.map((c) => c.block.id)).toEqual(['ooo', 'a'])
    expect(view.more).toEqual([{ col: 4, count: 3 }])
    expect(view.lines).toBe(LANE_MAX_LINES)
    expect(view.collapsible).toBe(true)
  })

  it('a span in a folded row is counted on every column it covers — never cut', () => {
    const blocks = [label('x', WEEK[0]), label('y', WEEK[0]), label('span', WEEK[0], WEEK[1])]
    // span sorts first (longest) → row 0; x, y fill rows 1–2 on Monday… add a 4th row
    const layout = layoutAllDay([...blocks, label('z', WEEK[0])], WEEK)
    const view = viewAllDay(layout, false)
    expect(view.visible.every((c) => c.row < 2)).toBe(true)
    expect(view.more).toEqual([{ col: 0, count: 2 }])
    // two Tue–Thu spans take rows 0–1, so the Wed–Thu spans fold into rows 2–3:
    // each folded two-day chip counts on both of its columns
    const wide = layoutAllDay(
      [
        label('p', WEEK[1], WEEK[3]),
        label('q', WEEK[1], WEEK[3]),
        label('r', WEEK[2], WEEK[3]),
        label('s', WEEK[2], WEEK[3]),
      ],
      WEEK
    )
    expect(wide.chips.map((c) => [c.block.id, c.row])).toEqual([
      ['p', 0],
      ['q', 1],
      ['r', 2],
      ['s', 3],
    ])
    expect(viewAllDay(wide, false).more).toEqual([
      { col: 2, count: 2 },
      { col: 3, count: 2 },
    ])
  })

  it('expanded draws every row, no "+N more", and stays collapsible', () => {
    const view = viewAllDay(layoutAllDay(crowded, WEEK), true)
    expect(view.visible).toHaveLength(5)
    expect(view).toMatchObject({ more: [], lines: 5, collapsible: true })
  })
})

describe('the lane box — the grid hands back exactly this', () => {
  it('no lines, no strip, no space taken', () => {
    expect(laneBoxPx(0)).toBe(0)
    expect(laneSpacePx(0)).toBe(0)
  })

  it('one line: 4 pad + 18 line + 6 pad + 1 rule, plus the 6px margin under it', () => {
    expect(laneBoxPx(1)).toBe(29)
    expect(laneSpacePx(1)).toBe(35)
  })

  it('each further line adds a line and a 3px gap', () => {
    expect(laneBoxPx(3) - laneBoxPx(2)).toBe(21)
    expect(laneSpacePx(3)).toBe(77)
  })
})
