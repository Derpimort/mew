/* #74: merge adjacent same-tag blocks — the pure half. mergeCandidates names the
   run a merge ask means; mergeRun decides whether it can become one block, or
   exactly why not. Plus the keyless grammar ("merge" / "join" / "combine"). */

import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { mergeCandidates, mergeRun } from '../week'
import { parseCommand } from '../parse'

const TODAY = '2026-06-09' // a Tuesday
const WED = '2026-06-10'
const NOW = new Date(2026, 5, 9, 8, 0)

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Deck',
    tag: 'work',
    dayKey: TODAY,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}
const ids = (bs: Block[]) => bs.map((b) => b.id)

describe('mergeCandidates — which blocks a merge ask names', () => {
  const week = [
    block({ id: 'wed-1', dayKey: WED, startMin: 9 * 60, endMin: 10 * 60 }),
    block({ id: 'tue-only', startMin: 14 * 60, endMin: 15 * 60 }),
    block({ id: 'wed-2', dayKey: WED, startMin: 11 * 60, endMin: 12 * 60 }),
    block({ id: 'past', dayKey: '2026-06-08' }),
    block({ id: 'other', title: 'Gym', dayKey: WED }),
  ]

  it('nothing by that name from today on: none', () => {
    expect(mergeCandidates(week, 'standup', TODAY)).toEqual({ status: 'none' })
  })

  it('with no pin, the soonest day that holds two (today holds one, Wednesday two); past days never count', () => {
    const r = mergeCandidates(week, 'deck', TODAY)
    expect(r).toMatchObject({ status: 'ok', dayKey: WED })
    expect(r.status === 'ok' && ids(r.parts)).toEqual(['wed-1', 'wed-2'])
  })

  it('a day with one match: single, naming it', () => {
    expect(mergeCandidates(week, 'deck', TODAY, { dayKey: TODAY })).toMatchObject({
      status: 'single',
      block: { id: 'tue-only' },
    })
  })

  it('`at` pins the run: that block and the next match after it that day', () => {
    const three = [
      block({ id: 'a', startMin: 9 * 60, endMin: 10 * 60 }),
      block({ id: 'b', startMin: 11 * 60, endMin: 12 * 60 }),
      block({ id: 'c', startMin: 13 * 60, endMin: 14 * 60 }),
    ]
    const r = mergeCandidates(three, 'deck', TODAY, { at: 11 * 60 })
    expect(r.status === 'ok' && ids(r.parts)).toEqual(['b', 'c'])
    expect(mergeCandidates(three, 'deck', TODAY, { at: 13 * 60 })).toMatchObject({
      status: 'single',
      block: { id: 'c' },
    })
  })
})

describe('mergeRun — one block, or exactly why not', () => {
  it('two parts across free air: the first keeps its id and spans both', () => {
    const bs = [block({ id: 'a' }), block({ id: 'b', startMin: 11 * 60, endMin: 12 * 60 })]
    expect(mergeRun(bs, ['b', 'a'])).toEqual({
      ok: true,
      keep: bs[0],
      removeIds: ['b'],
      startMin: 9 * 60,
      endMin: 12 * 60,
    })
  })

  it('overlapping parts merge to the widest span', () => {
    const bs = [
      block({ id: 'a', startMin: 9 * 60, endMin: 11 * 60 }),
      block({ id: 'b', startMin: 10 * 60, endMin: 10 * 60 + 30 }),
    ]
    expect(mergeRun(bs, ['a', 'b'])).toMatchObject({ ok: true, startMin: 9 * 60, endMin: 11 * 60 })
  })

  it.each([
    [
      'a fixed call',
      block({
        id: 'x',
        title: 'Client call',
        startMin: 10 * 60,
        endMin: 10 * 60 + 30,
        protected: true,
      }),
    ],
    [
      'a calendar event',
      block({
        id: 'x',
        title: 'Planning',
        startMin: 10 * 60,
        endMin: 10 * 60 + 30,
        external: { calId: 'c', eventId: 'e' },
      }),
    ],
    [
      "another of the owner's blocks",
      block({ id: 'x', title: 'Email', startMin: 10 * 60, endMin: 10 * 60 + 30 }),
    ],
    [
      'a done block',
      block({ id: 'x', title: 'Email', startMin: 10 * 60, endMin: 10 * 60 + 30, status: 'done' }),
    ],
  ])('%s in the span stops it, and is named as the blocker', (_what, between) => {
    const bs = [block({ id: 'a' }), between, block({ id: 'b', startMin: 11 * 60, endMin: 12 * 60 })]
    expect(mergeRun(bs, ['a', 'b'])).toMatchObject({
      ok: false,
      reason: 'blocked',
      blockers: [between],
    })
  })

  it('a background block or an all-day label in the span holds no slot, so the merge goes ahead', () => {
    const bs = [
      block({ id: 'a' }),
      block({
        id: 'bg',
        title: 'Podcast',
        startMin: 10 * 60,
        endMin: 10 * 60 + 30,
        attention: 'background',
      }),
      block({ id: 'hol', title: 'Holiday', startMin: 0, endMin: 0, allDay: true }),
      block({ id: 'b', startMin: 11 * 60, endMin: 12 * 60 }),
    ]
    expect(mergeRun(bs, ['a', 'b'])).toMatchObject({ ok: true, endMin: 12 * 60 })
  })

  it.each([
    ['external', { external: { calId: 'c', eventId: 'e' } }],
    ['done', { status: 'done' as const }],
    ['series', { recurringBlockId: 's1', rrule: { freq: 'WEEKLY' as const, interval: 1 } }],
    ['tags', { tag: 'private' as const }],
    ['days', { dayKey: WED }],
  ])('a part that is %s never merges', (reason, over) => {
    const bs = [block({ id: 'a' }), block({ id: 'b', startMin: 10 * 60, endMin: 11 * 60, ...over })]
    expect(mergeRun(bs, ['a', 'b'])).toMatchObject({ ok: false, reason })
  })

  it('fewer than two parts: few', () => {
    expect(mergeRun([block({ id: 'a' })], ['a'])).toMatchObject({ ok: false, reason: 'few' })
  })
})

describe('the keyless grammar — merge / join / combine', () => {
  it.each([
    ['merge my two deck blocks', { kind: 'merge', query: 'deck', merge: {} }],
    [
      'join the writing blocks tomorrow',
      { kind: 'merge', query: 'writing', merge: { dayOffset: 1 } },
    ],
    [
      'combine both gym blocks on thursday',
      { kind: 'merge', query: 'gym', merge: { dayOffset: 2 } },
    ],
    [
      'merge the deck at 11:00 with the next one',
      { kind: 'merge', query: 'deck', at: '11:00', merge: {} },
    ],
    ['join the deck blocks together', { kind: 'merge', query: 'deck', merge: {} }],
  ])('"%s"', (text, want) => {
    expect(parseCommand(text, NOW)).toEqual(want)
  })

  it('"join the standup at 9" is not a merge (no merge word)', () => {
    expect(parseCommand('join the standup at 9', NOW).kind).not.toBe('merge')
  })
})
