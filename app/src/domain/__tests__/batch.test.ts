/* #75: batch changes — the pure half. selectBatch picks what list_blocks shows
   that day; planBatch says exactly what moves where and what stays put and why.
   Plus the keyless grammar for the two commonest wide changes. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { planBatch, selectBatch } from '../batch'
import { parseCommand } from '../parse'

const TODAY = '2026-06-09' // a Tuesday
const WED = '2026-06-10'
const NOW = new Date(2026, 5, 9, 9, 0)

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Deck',
    tag: 'work',
    dayKey: TODAY,
    startMin: 15 * 60,
    endMin: 16 * 60,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}
const ids = (bs: { id: string }[]) => bs.map((b) => b.id)

describe('selectBatch — what the selector picks', () => {
  const day = [
    block({ id: 'early', title: 'Email', startMin: 9 * 60, endMin: 10 * 60 }),
    block({ id: 'deck', startMin: 15 * 60, endMin: 16 * 60 }),
    block({ id: 'run', title: 'Run', tag: 'health', startMin: 17 * 60, endMin: 18 * 60 }),
    block({ id: 'hol', title: 'Holiday', startMin: 0, endMin: 24 * 60, allDay: true }),
    block({ id: 'wed', dayKey: WED, startMin: 16 * 60, endMin: 17 * 60 }),
  ]

  it('blocks STARTING at or after / before a minute, on that day only, all-day labels aside', () => {
    expect(ids(selectBatch(day, { dayKey: TODAY, afterMin: 15 * 60 }))).toEqual(['deck', 'run'])
    expect(ids(selectBatch(day, { dayKey: TODAY, beforeMin: 15 * 60 }))).toEqual(['early'])
    expect(ids(selectBatch(day, { dayKey: TODAY }))).toEqual(['early', 'deck', 'run'])
  })

  it('a tag and title words narrow it further', () => {
    expect(ids(selectBatch(day, { dayKey: TODAY, tag: 'health' }))).toEqual(['run'])
    expect(ids(selectBatch(day, { dayKey: TODAY, titleQuery: 'dEcK' }))).toEqual(['deck'])
  })
})

describe('planBatch — what moves, and what stays put and why', () => {
  it('a shift moves every open, flexible, one-off block by the same minutes', () => {
    const bs = [block({ id: 'a' }), block({ id: 'b', startMin: 16 * 60, endMin: 17 * 60 })]
    const plan = planBatch(
      bs,
      { dayKey: TODAY, afterMin: 15 * 60 },
      { kind: 'shift', deltaMin: 60 }
    )
    expect(plan.moves.map((m) => [m.block.id, m.dayKey, m.startMin, m.endMin])).toEqual([
      ['a', TODAY, 16 * 60, 17 * 60],
      ['b', TODAY, 17 * 60, 18 * 60],
    ])
    expect(plan.skipped).toEqual([])
  })

  it.each([
    ['calendar', block({ id: 'x', title: 'Planning', external: { calId: 'c', eventId: 'e' } })],
    ['fixed', block({ id: 'x', title: 'Client call' })],
    ['done', block({ id: 'x', status: 'done' })],
    [
      'repeating',
      block({ id: 'x', recurringBlockId: 's1', rrule: { freq: 'WEEKLY', interval: 1 } }),
    ],
  ])('a %s block never moves, and is named with its reason', (reason, b) => {
    const plan = planBatch([b], { dayKey: TODAY }, { kind: 'shift', deltaMin: 60 })
    expect(plan.moves).toEqual([])
    expect(plan.skipped).toEqual([{ block: b, reason }])
  })

  it('a shift that would leave the day stays put: off-day', () => {
    const late = block({ id: 'late', startMin: 23 * 60, endMin: 23 * 60 + 30 })
    expect(planBatch([late], { dayKey: TODAY }, { kind: 'shift', deltaMin: 60 }).skipped).toEqual([
      { block: late, reason: 'off-day' },
    ])
  })

  it('a block whose new time would sit over a fixed or calendar block that stays put is not moved, and names it', () => {
    const deck = block({ id: 'deck' })
    const call = block({
      id: 'call',
      title: 'Client call',
      startMin: 16 * 60,
      endMin: 16 * 60 + 30,
    })
    const plan = planBatch(
      [deck, call],
      { dayKey: TODAY, titleQuery: 'deck' },
      { kind: 'shift', deltaMin: 60 }
    )
    expect(plan.moves).toEqual([])
    expect(plan.skipped).toEqual([{ block: deck, reason: 'lands-on', on: [call] }])
  })

  it('moving to another day keeps each clock, and checks that day for fixed blocks', () => {
    const a = block({ id: 'a' })
    const b = block({ id: 'b', startMin: 10 * 60, endMin: 11 * 60 })
    const wedCall = block({
      id: 'wc',
      title: 'Board call',
      dayKey: WED,
      startMin: 10 * 60,
      endMin: 11 * 60,
    })
    const plan = planBatch(
      [a, b, wedCall],
      { dayKey: TODAY, tag: 'work' },
      { kind: 'moveToDay', toDayKey: WED }
    )
    expect(plan.moves.map((m) => [m.block.id, m.dayKey, m.startMin])).toEqual([['a', WED, 15 * 60]])
    expect(plan.skipped).toEqual([{ block: b, reason: 'lands-on', on: [wedCall] }])
  })
})

describe('the keyless batch grammar', () => {
  it.each([
    ['push everything after 3pm back an hour', { afterMin: 900, op: 'shift', deltaMin: 60 }],
    [
      'pull all work before noon 30 min earlier',
      { beforeMin: 720, tag: 'work', op: 'shift', deltaMin: -30 },
    ],
    [
      'push everything after 15:00 tomorrow later by 60 min — yes, all 5',
      { dayOffset: 1, afterMin: 900, op: 'shift', deltaMin: 60, confirmCount: 5 },
    ],
    [
      "move all of today's work to tomorrow",
      { dayOffset: 0, tag: 'work', op: 'moveToDay', toDayOffset: 1 },
    ],
    [
      "move all thursday's deck review blocks to friday",
      { dayOffset: 2, titleQuery: 'deck review', op: 'moveToDay', toDayOffset: 3 },
    ],
    [
      "move all today's work to tomorrow — yes, all 4",
      { dayOffset: 0, tag: 'work', op: 'moveToDay', toDayOffset: 1, confirmCount: 4 },
    ],
  ])('"%s"', (text, batch) => {
    expect(parseCommand(text, NOW)).toEqual({ kind: 'batch', batch })
  })

  it('a bare hour asks am or pm instead of reading a block called "everything after 3"', () => {
    expect(parseCommand('push everything after 3 back an hour', NOW)).toEqual({
      kind: 'chat',
      reply: `after 3am or 3pm? say "after 3pm" and I'll line them up.`,
    })
  })

  it('single-block moves are untouched', () => {
    expect(parseCommand('push the deck back an hour', NOW)).toMatchObject({
      kind: 'move',
      relStartMin: 60,
    })
    expect(parseCommand('move the deck to tomorrow', NOW)).toMatchObject({
      kind: 'move',
      query: 'deck',
    })
  })
})
