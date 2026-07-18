/* list_blocks' readout (#333) — the pure, itemized, addressable calendar view.
   Pins the load-bearing shape: exact title + start–end + tag on every line, a
   ✓ on the done ones (a done block is LISTED, never hidden), the week grouped by
   day, positive voice on a clear day, and — the law — that reading never
   mutates. */

import { describe, expect, it } from 'vitest'
import { listReadout } from '../listing'
import { addDaysKey } from '../time'
import type { Block, BlockStatus, Tag } from '../types'

const TODAY = '2026-06-10' // a Wednesday
const TOMORROW = addDaysKey(TODAY, 1) // Thursday

let n = 0
function blk(over: Partial<Block> = {}): Block {
  return {
    id: `b${n++}`,
    title: 'deep work',
    tag: 'work',
    dayKey: TODAY,
    startMin: 9 * 60,
    endMin: 11 * 60,
    protected: true,
    status: 'open' as BlockStatus,
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

const today = (day: Block[]) => listReadout(day, { dayKeys: [TODAY], todayKey: TODAY })

describe('listReadout — a single day', () => {
  it('itemizes each block with exact title, start–end, and tag', () => {
    const out = today([
      blk({ title: 'deep work', startMin: 9 * 60, endMin: 11 * 60 }),
      blk({ title: 'the Q3 deck', tag: 'work', startMin: 14 * 60, endMin: 15 * 60 }),
    ])
    expect(out).toBe(
      ["here's today:", '- 9:00–11:00 deep work [work]', '- 14:00–15:00 the Q3 deck [work]'].join(
        '\n'
      )
    )
  })

  it('lists a done block WITH a ✓ — a finished block is still there, never hidden', () => {
    const out = today([
      blk({ title: 'inbox sweep', startMin: 11 * 60 + 30, endMin: 12 * 60, status: 'done' }),
      blk({ title: 'deep work', startMin: 9 * 60, endMin: 11 * 60 }),
    ])
    // sorted by start; the done one carries a ✓, the open one does not
    expect(out).toBe(
      ["here's today:", '- 9:00–11:00 deep work [work]', '- 11:30–12:00 inbox sweep [work] ✓'].join(
        '\n'
      )
    )
    expect(out).toContain('inbox sweep [work] ✓')
    expect(out).not.toContain('deep work [work] ✓')
  })

  it('marks a calendar event and a fixed block so the model knows what it may not touch', () => {
    const out = today([
      blk({
        title: 'staff sync',
        startMin: 10 * 60,
        endMin: 10 * 60 + 30,
        external: { calId: 'c', eventId: 'e' },
      }),
      blk({ title: 'interview', startMin: 15 * 60, endMin: 16 * 60 }),
    ])
    expect(out).toContain('- 10:00–10:30 staff sync [work, calendar]')
    expect(out).toContain('- 15:00–16:00 interview [work, fixed]')
  })

  it('surfaces optional/background/due flags and rest/private tags', () => {
    const out = today([
      blk({
        title: 'phone restore',
        tag: 'private',
        startMin: 13 * 60,
        endMin: 16 * 60,
        attention: 'background',
      }),
      blk({ title: 'ship it', startMin: 16 * 60, endMin: 17 * 60, due: 18 * 60 }),
      blk({
        title: 'maybe gym',
        tag: 'health',
        startMin: 18 * 60,
        endMin: 19 * 60,
        optional: true,
      }),
    ])
    expect(out).toContain('- 13:00–16:00 phone restore [private, background]')
    expect(out).toContain('- 16:00–17:00 ship it [work, due 18:00]')
    expect(out).toContain('- 18:00–19:00 maybe gym [health, optional]')
  })

  it('a clear day answers in positive voice — space, not a lack', () => {
    expect(today([])).toBe('today is clear — nothing on the calendar yet.')
  })

  it('labels a non-today single day by its own name', () => {
    const out = listReadout([blk({ dayKey: TOMORROW, title: 'the deck' })], {
      dayKeys: [TOMORROW],
      todayKey: TODAY,
    })
    expect(out.startsWith("here's tomorrow:")).toBe(true)
  })
})

describe('listReadout — the week', () => {
  const week = () => Array.from({ length: 7 }, (_, i) => addDaysKey(TODAY, i))

  it('groups blocks under a labelled section per non-empty day, skipping empty days', () => {
    const out = listReadout(
      [
        blk({ dayKey: TODAY, title: 'deep work', startMin: 9 * 60, endMin: 11 * 60 }),
        blk({ dayKey: TOMORROW, title: 'the deck', startMin: 9 * 60, endMin: 12 * 60 }),
      ],
      { dayKeys: week(), todayKey: TODAY }
    )
    expect(out).toBe(
      [
        "here's your week:",
        'today:',
        '- 9:00–11:00 deep work [work]',
        'tomorrow:',
        '- 9:00–12:00 the deck [work]',
      ].join('\n')
    )
  })

  it('an all-clear week says so, positively', () => {
    expect(listReadout([], { dayKeys: week(), todayKey: TODAY })).toBe(
      'your week is clear — nothing scheduled yet.'
    )
  })
})

describe('listReadout — the tag filter', () => {
  const mixed = [
    blk({ title: 'deep work', tag: 'work', startMin: 9 * 60, endMin: 11 * 60 }),
    blk({ title: 'lunch', tag: 'private', startMin: 12 * 60, endMin: 13 * 60 }),
  ]

  it('lists only the matching tag and names the filter', () => {
    const out = listReadout(mixed, { dayKeys: [TODAY], todayKey: TODAY, tag: 'private' as Tag })
    expect(out).toBe(["here's today tagged private:", '- 12:00–13:00 lunch [private]'].join('\n'))
  })

  it('an empty filtered day still answers kindly, naming the tag', () => {
    const out = listReadout(mixed, { dayKeys: [TODAY], todayKey: TODAY, tag: 'rest' as Tag })
    expect(out).toBe('today is clear — nothing on the calendar tagged rest yet.')
  })
})

describe('listReadout — the laws', () => {
  it('is read-only: the input blocks are never mutated', () => {
    const blocks = [
      blk({ title: 'deep work', status: 'done' }),
      blk({ title: 'the deck', dayKey: TOMORROW }),
    ]
    const before = JSON.stringify(blocks)
    listReadout(blocks, { dayKeys: [TODAY, TOMORROW], todayKey: TODAY })
    expect(JSON.stringify(blocks)).toBe(before)
  })

  it('positive voice: never {missed, failed, behind, overdue, late}', () => {
    const out = listReadout([blk({ status: 'done' }), blk({ title: 'run', dayKey: TOMORROW })], {
      dayKeys: Array.from({ length: 7 }, (_, i) => addDaysKey(TODAY, i)),
      todayKey: TODAY,
    })
    expect(out).not.toMatch(/missed|failed|behind|overdue|\blate\b/i)
    // an empty day, too
    expect(today([])).not.toMatch(/missed|failed|behind|overdue|\blate\b/i)
  })
})
