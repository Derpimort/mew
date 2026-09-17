/* #75: batch changes — the pure half. selectBatch picks what list_blocks shows
   that day; planBatch says exactly what moves where and what stays put and why.
   Plus the keyless grammar for the two commonest wide changes. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { batchToken, planBatch, selectBatch } from '../batch'
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

  it('a shift that ends exactly at midnight still fits the day', () => {
    const late = block({ id: 'late', startMin: 23 * 60, endMin: 23 * 60 + 30 })
    const plan = planBatch([late], { dayKey: TODAY }, { kind: 'shift', deltaMin: 30 })
    expect(plan.moves.map((m) => [m.block.id, m.startMin, m.endMin])).toEqual([
      ['late', 23 * 60 + 30, 24 * 60],
    ])
  })

  it('a done fixed block or a background block at the new time is no obstacle', () => {
    const deck = block({ id: 'deck' })
    const doneCall = block({
      id: 'call',
      title: 'Client call',
      status: 'done',
      startMin: 16 * 60,
      endMin: 16 * 60 + 30,
    })
    const music = block({
      id: 'music',
      title: 'Focus music',
      attention: 'background',
      external: { calId: 'c', eventId: 'm' },
      startMin: 16 * 60,
      endMin: 17 * 60,
    })
    for (const other of [doneCall, music]) {
      const plan = planBatch(
        [deck, other],
        { dayKey: TODAY, titleQuery: 'deck' },
        { kind: 'shift', deltaMin: 60 }
      )
      expect(plan.moves.map((m) => m.block.id)).toEqual(['deck'])
    }
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

describe('batchToken — the list a confirm names', () => {
  const a = block({ id: 'a' })
  const b = block({ id: 'b', startMin: 17 * 60, endMin: 18 * 60 })
  const shift = (bs: Block[]) => planBatch(bs, { dayKey: TODAY }, { kind: 'shift', deltaMin: 60 })

  it('the same moves give the same token, whatever order the week holds them in', () => {
    expect(batchToken(shift([a, b]))).toBe(batchToken(shift([b, a])))
    expect(batchToken(shift([a, b]))).toMatch(/^[a-z0-9]+$/)
  })

  it('another block in the list, or a block landing elsewhere, gives another token', () => {
    const c = block({ id: 'c', startMin: 19 * 60, endMin: 20 * 60 })
    expect(batchToken(shift([a, b, c]))).not.toBe(batchToken(shift([a, b])))
    const bMoved = { ...b, startMin: 17 * 60 + 5, endMin: 18 * 60 + 5 }
    expect(batchToken(shift([a, bMoved]))).not.toBe(batchToken(shift([a, b])))
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
    [
      'push everything after 9am and before noon on thursday back 30 min',
      { dayOffset: 2, afterMin: 540, beforeMin: 720, op: 'shift', deltaMin: 30 },
    ],
    [
      'push all work "deck" after 9:00 and before 12:00 on thursday later by 30 min — yes, all 3 · k7f2',
      {
        dayOffset: 2,
        afterMin: 540,
        beforeMin: 720,
        tag: 'work',
        titleQuery: 'deck',
        op: 'shift',
        deltaMin: 30,
        confirmCount: 3,
        confirmToken: 'k7f2',
      },
    ],
    ['push everything back an hour', { op: 'shift', deltaMin: 60 }],
    [
      `move all today's "work" to tomorrow — yes, all 2 · 1x9`,
      {
        dayOffset: 0,
        titleQuery: 'work',
        op: 'moveToDay',
        toDayOffset: 1,
        confirmCount: 2,
        confirmToken: '1x9',
      },
    ],
    [
      "move all today's blocks after 15:00 to tomorrow",
      { dayOffset: 0, afterMin: 900, op: 'moveToDay', toDayOffset: 1 },
    ],
    [
      "move all today's work to 2026-06-17 — yes, all 2 · zz",
      {
        dayOffset: 0,
        tag: 'work',
        op: 'moveToDay',
        toDayOffset: 8,
        confirmCount: 2,
        confirmToken: 'zz',
      },
    ],
    [
      'push all health on 2026-06-19 earlier by 15 min',
      { dayOffset: 10, tag: 'health', op: 'shift', deltaMin: -15 },
    ],
    ['move all my blocks to friday', { op: 'moveToDay', toDayOffset: 3 }],
    ['move all blocks to friday', { op: 'moveToDay', toDayOffset: 3 }],
    ['move all my work to friday', { tag: 'work', op: 'moveToDay', toDayOffset: 3 }],
  ])('"%s"', (text, batch) => {
    expect(parseCommand(text, NOW)).toEqual({ kind: 'batch', batch })
  })

  it('a bare hour asks am or pm instead of reading a block called "everything after 3"', () => {
    expect(parseCommand('push everything after 3 back an hour', NOW)).toEqual({
      kind: 'chat',
      reply: `after 3am or 3pm? say "after 3pm" and I'll line them up.`,
    })
  })

  it('a date past two weeks, or one already gone, is no batch day', () => {
    expect(parseCommand("move all today's work to 2026-06-30", NOW).kind).not.toBe('batch')
    expect(parseCommand("move all today's work to 2026-06-08", NOW).kind).not.toBe('batch')
  })

  it('a title that starts with "all" stays a single-block move', () => {
    expect(parseCommand('move all hands to friday', NOW)).toMatchObject({
      kind: 'move',
      query: 'all hands',
    })
    expect(parseCommand('push all hands back an hour', NOW)).toMatchObject({
      kind: 'move',
      relStartMin: 60,
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
