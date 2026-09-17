/* #75 slice 2, the pure half: a retag ("tag all of tomorrow's calls as work")
   plans in place, with the same laws as a move (calendar, fixed, done and
   repeating blocks keep their tag and are named; a block that already has the
   tag is named too), and its list token carries the tag. The keyless grammar
   reads the retag and "between X and Y". A plural title word that matches
   nothing tries its singular. A retag confirm naming weekdays still acts after
   midnight. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { batchToken, planBatch, selectBatch } from '../batch'
import { parseCommand } from '../parse'
import { chipStillMeans } from '../chipEffect'

const TODAY = '2026-06-09' // a Tuesday
const WED = '2026-06-10'
const THU = '2026-06-11'
const NOW = new Date(2026, 5, 9, 9, 0)

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Client call',
    tag: 'private',
    dayKey: WED,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}
const ids = (bs: { id: string }[]) => bs.map((b) => b.id)

describe('planBatch — a retag, in place', () => {
  it('retags every open, own, one-off block that has another tag; times stay', () => {
    const a = block({ id: 'a' })
    const b = block({ id: 'b', title: 'Vendor call', startMin: 11 * 60, endMin: 12 * 60 })
    const plan = planBatch([a, b], { dayKey: WED }, { kind: 'setTag', tag: 'work' })
    expect(plan.moves.map((m) => [m.block.id, m.dayKey, m.startMin, m.endMin, m.tag])).toEqual([
      ['a', WED, 9 * 60, 10 * 60, 'work'],
      ['b', WED, 11 * 60, 12 * 60, 'work'],
    ])
    expect(plan.skipped).toEqual([])
  })

  it.each([
    ['calendar', block({ id: 'x', external: { calId: 'c', eventId: 'e' } })],
    ['done', block({ id: 'x', status: 'done' })],
    [
      'repeating',
      block({ id: 'x', recurringBlockId: 's1', rrule: { freq: 'WEEKLY', interval: 1 } }),
    ],
    ['already', block({ id: 'x', tag: 'work' })],
  ])('a %s block keeps its tag and is named', (reason, b) => {
    const plan = planBatch([b], { dayKey: WED }, { kind: 'setTag', tag: 'work' })
    expect(plan.moves).toEqual([])
    expect(plan.skipped).toEqual([{ block: b, reason }])
  })

  it('an own fixed-time block ("Client call") takes the tag: a retag moves nothing, and a move still skips it', () => {
    const call = block({ id: 'x', title: 'Client call' })
    const retag = planBatch([call], { dayKey: WED }, { kind: 'setTag', tag: 'work' })
    expect(retag.moves.map((m) => m.block.id)).toEqual(['x'])
    const shift = planBatch([call], { dayKey: WED }, { kind: 'shift', deltaMin: 60 })
    expect(shift.skipped.map((s) => s.reason)).toEqual(['fixed'])
  })

  it('the list token names the tag: the same blocks retagged differently are a different list', () => {
    const bs = [block({ id: 'a' }), block({ id: 'b', startMin: 11 * 60, endMin: 12 * 60 })]
    const asWork = batchToken(planBatch(bs, { dayKey: WED }, { kind: 'setTag', tag: 'work' }))
    const asHealth = batchToken(planBatch(bs, { dayKey: WED }, { kind: 'setTag', tag: 'health' }))
    expect(asWork).not.toBe(asHealth)
  })
})

describe('selectBatch — a plural that matches nothing tries its singular', () => {
  const day = [
    block({ id: 'cc', title: 'Client call' }),
    block({ id: 'vc', title: 'Vendor call', startMin: 11 * 60, endMin: 12 * 60 }),
    block({ id: 'cs', title: 'Status calls', startMin: 13 * 60, endMin: 14 * 60 }),
  ]
  it('"calls" matches the literal first, and only falls back when nothing matched', () => {
    expect(ids(selectBatch(day, { dayKey: WED, titleQuery: 'calls' }))).toEqual(['cs'])
    const noPlural = day.filter((b) => b.id !== 'cs')
    expect(ids(selectBatch(noPlural, { dayKey: WED, titleQuery: 'calls' }))).toEqual(['cc', 'vc'])
  })
  it('a short word or one not ending in s never falls back', () => {
    expect(ids(selectBatch(day, { dayKey: WED, titleQuery: 'bus' }))).toEqual([])
    expect(ids(selectBatch(day, { dayKey: WED, titleQuery: 'meeting' }))).toEqual([])
  })
})

describe('the keyless grammar — retag and "between"', () => {
  it.each([
    [
      "tag all of tomorrow's calls as work",
      { dayOffset: 1, titleQuery: 'calls', op: 'setTag', toTag: 'work' },
    ],
    ['mark all health on thursday as rest', null],
    [
      "tag all thursday's private as work — yes, all 3 · k7f2",
      {
        dayOffset: 2,
        tag: 'private',
        op: 'setTag',
        toTag: 'work',
        confirmCount: 3,
        confirmToken: 'k7f2',
      },
    ],
    [
      `retag all today's "gym" after 17:00 as health`,
      { dayOffset: 0, titleQuery: 'gym', afterMin: 1020, op: 'setTag', toTag: 'health' },
    ],
    [
      'push everything between 2 and 5pm back 30 min',
      { afterMin: 840, beforeMin: 1020, op: 'shift', deltaMin: 30 },
    ],
    [
      'push everything between 11 and 1pm back 30 min',
      { afterMin: 660, beforeMin: 780, op: 'shift', deltaMin: 30 },
    ],
    [
      'push everything between 12 and 2pm back 30 min',
      { afterMin: 720, beforeMin: 840, op: 'shift', deltaMin: 30 },
    ],
    [
      "move all today's work between 14:00 and 17:00 to tomorrow",
      {
        dayOffset: 0,
        tag: 'work',
        afterMin: 840,
        beforeMin: 1020,
        op: 'moveToDay',
        toDayOffset: 1,
      },
    ],
  ])('"%s"', (text, batch) => {
    const got = parseCommand(text, NOW)
    if (batch == null) expect(got.kind).not.toBe('batch')
    else expect(got).toEqual({ kind: 'batch', batch })
  })

  it('"tag all hands as work" stays out of the batch grammar (a title that starts with "all")', () => {
    expect(parseCommand('tag all hands as work', NOW).kind).not.toBe('batch')
  })
})

describe('a retag confirm picked after midnight (#94)', () => {
  const week = [
    block({ id: 'a', dayKey: THU }),
    block({ id: 'b', dayKey: THU, startMin: 11 * 60, endMin: 12 * 60 }),
    block({ id: 'c', dayKey: THU, startMin: 13 * 60, endMin: 14 * 60 }),
  ]
  const offered = new Date(2026, 5, 9, 23, 50)
  const picked = new Date(2026, 5, 10, 0, 5)
  it('naming a weekday, it still means the same; naming tomorrow, it does not', () => {
    expect(
      chipStillMeans(week, `tag all thursday's "call" as work — yes, all 3 · k7f2`, offered, picked)
    ).toBe(true)
    expect(
      chipStillMeans(week, `tag all tomorrow's "call" as work — yes, all 3 · k7f2`, offered, picked)
    ).toBe(false)
  })
})

void TODAY
