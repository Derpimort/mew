/* #75 slice 3, the pure half: a batch over repeating blocks. With no answer yet
   a series stays whole and is named, so the store can ask; with an answer the
   change reaches exactly the occurrences that answer names — this one, this and
   the later ones, or the whole series — and the list token follows, since the
   plan now crosses days. A move onto one day is the exception: a series keeps
   its own days. The keyless grammar carries the scope word on a batch ask, and a
   scope answer read after midnight still means the day it named. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { batchToken, planBatch } from '../batch'
import { parseCommand } from '../parse'

const TUE = '2026-06-09'
const WED = '2026-06-10'
const THU = '2026-06-11'
const NOW = new Date(2026, 5, 9, 9, 0)

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Gym',
    tag: 'health',
    dayKey: TUE,
    startMin: 9 * 60,
    endMin: 9 * 60 + 30,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/** a three-day series: Tuesday, Wednesday, Thursday at 9:00 */
const series = (over: Partial<Block> = {}) => [
  block({ id: 's-tue', dayKey: TUE, recurringBlockId: 'r1', ...over }),
  block({ id: 's-wed', dayKey: WED, recurringBlockId: 'r1', ...over }),
  block({ id: 's-thu', dayKey: THU, recurringBlockId: 'r1', ...over }),
]

const ids = (bs: { id: string }[]) => bs.map((b) => b.id)
const moved = (plan: ReturnType<typeof planBatch>) =>
  plan.moves.map((m) => [m.block.id, m.dayKey, m.startMin])

describe('planBatch — a series with no answer yet', () => {
  it('keeps every occurrence where it is and names it, so the store can ask', () => {
    const plan = planBatch(series(), { dayKey: TUE }, { kind: 'shift', deltaMin: 30 })
    expect(plan.moves).toEqual([])
    expect(plan.skipped.map((s) => [s.block.id, s.reason])).toEqual([['s-tue', 'repeating']])
    /* the selector still only picked Tuesday's: no answer, no widening */
    expect(ids(plan.selected)).toEqual(['s-tue'])
  })

  it('a one-off in the same sweep still moves — only the series waits', () => {
    const own = block({ id: 'deck', title: 'Deck', startMin: 11 * 60, endMin: 12 * 60 })
    const plan = planBatch(
      [...series(), own],
      { dayKey: TUE },
      { kind: 'shift', deltaMin: 30 },
      [],
      undefined
    )
    expect(moved(plan)).toEqual([['deck', TUE, 11 * 60 + 30]])
    expect(plan.skipped.map((s) => s.reason)).toEqual(['repeating'])
  })
})

describe('planBatch — the three answers', () => {
  it('"just this one" moves the occurrence the selector picked, and no other', () => {
    const plan = planBatch(series(), { dayKey: TUE }, { kind: 'shift', deltaMin: 30 }, [], 'this')
    expect(moved(plan)).toEqual([['s-tue', TUE, 9 * 60 + 30]])
    expect(plan.skipped).toEqual([])
  })

  it('"just this one" keeps the rest of the sweep: the one-offs still move too', () => {
    /* the answer narrows the SERIES, never the selection — a sweep that picked
       two one-off blocks and one occurrence still moves all three */
    const deck = block({ id: 'deck', title: 'Deck', startMin: 11 * 60, endMin: 12 * 60 })
    const inbox = block({ id: 'inbox', title: 'Inbox', startMin: 14 * 60, endMin: 14 * 60 + 30 })
    const plan = planBatch(
      [...series(), deck, inbox],
      { dayKey: TUE },
      { kind: 'shift', deltaMin: 30 },
      [],
      'this'
    )
    expect(moved(plan)).toEqual([
      ['s-tue', TUE, 9 * 60 + 30],
      ['deck', TUE, 11 * 60 + 30],
      ['inbox', TUE, 14 * 60 + 30],
    ])
    expect(plan.skipped).toEqual([])
  })

  it('"this and the ones after" reaches the later occurrences, on their own days', () => {
    const plan = planBatch(
      series(),
      { dayKey: TUE },
      { kind: 'shift', deltaMin: 30 },
      [],
      'following'
    )
    expect(moved(plan)).toEqual([
      ['s-tue', TUE, 9 * 60 + 30],
      ['s-wed', WED, 9 * 60 + 30],
      ['s-thu', THU, 9 * 60 + 30],
    ])
  })

  it('"the whole series" reaches an earlier occurrence too', () => {
    /* the selector picks Wednesday's; Tuesday's is behind it */
    const following = planBatch(
      series(),
      { dayKey: WED },
      { kind: 'shift', deltaMin: 30 },
      [],
      'following'
    )
    expect(ids(following.selected)).toEqual(['s-wed', 's-thu'])

    const whole = planBatch(
      series(),
      { dayKey: WED },
      { kind: 'shift', deltaMin: 30 },
      [],
      'series'
    )
    expect(ids(whole.selected)).toEqual(['s-tue', 's-wed', 's-thu'])
    expect(moved(whole)).toEqual([
      ['s-tue', TUE, 9 * 60 + 30],
      ['s-wed', WED, 9 * 60 + 30],
      ['s-thu', THU, 9 * 60 + 30],
    ])
  })

  it('an occurrence earlier the same day is not "after"; a later one is', () => {
    const early = block({ id: 'early', dayKey: WED, startMin: 8 * 60, recurringBlockId: 'r1' })
    const late = block({ id: 'late', dayKey: WED, startMin: 15 * 60, recurringBlockId: 'r1' })
    const pool = [early, block({ id: 'noon', dayKey: WED, startMin: 12 * 60 }), late]
    /* the selector's window picks only the noon-ish window, so the series
       occurrence it picks is `late` — "after" is read on the day, then the clock */
    const plan = planBatch(
      [...pool],
      { dayKey: WED, afterMin: 15 * 60 },
      { kind: 'shift', deltaMin: 30 },
      [],
      'following'
    )
    expect(ids(plan.selected)).toEqual(['late'])
    expect(
      ids(
        planBatch(
          [...pool],
          { dayKey: WED, afterMin: 15 * 60 },
          { kind: 'shift', deltaMin: 30 },
          [],
          'series'
        ).selected
      )
    ).toEqual(['early', 'late'])
  })

  it('a done occurrence never joins an answer', () => {
    const [tue, wed, thu] = series()
    const plan = planBatch(
      [tue, { ...wed, status: 'done' }, thu],
      { dayKey: TUE },
      { kind: 'shift', deltaMin: 30 },
      [],
      'series'
    )
    expect(ids(plan.selected)).toEqual(['s-tue', 's-thu'])
    expect(moved(plan)).toEqual([
      ['s-tue', TUE, 9 * 60 + 30],
      ['s-thu', THU, 9 * 60 + 30],
    ])
  })

  it('a retag across a series keeps every occurrence where it is', () => {
    const plan = planBatch(
      series({ tag: 'private' }),
      { dayKey: TUE },
      { kind: 'setTag', tag: 'work' },
      [],
      'series'
    )
    expect(plan.moves.map((m) => [m.block.id, m.dayKey, m.startMin, m.tag])).toEqual([
      ['s-tue', TUE, 9 * 60, 'work'],
      ['s-wed', WED, 9 * 60, 'work'],
      ['s-thu', THU, 9 * 60, 'work'],
    ])
  })
})

describe('planBatch — the laws still hold across a series', () => {
  it('a move onto one day is refused past this occurrence: a series keeps its days', () => {
    const whole = planBatch(
      series(),
      { dayKey: TUE },
      { kind: 'moveToDay', toDayKey: THU },
      [],
      'series'
    )
    expect(whole.moves).toEqual([])
    expect(whole.skipped.map((s) => [s.block.id, s.reason])).toEqual([
      ['s-tue', 'series-day'],
      ['s-wed', 'series-day'],
      ['s-thu', 'series-day'],
    ])
    /* this one alone still moves — an occurrence may sit on another day */
    const one = planBatch(
      series(),
      { dayKey: TUE },
      { kind: 'moveToDay', toDayKey: THU },
      [],
      'this'
    )
    expect(moved(one)).toEqual([['s-tue', THU, 9 * 60]])
  })

  it('a calendar occurrence is named, never moved, whatever the answer', () => {
    const [tue, wed, thu] = series()
    const plan = planBatch(
      [tue, { ...wed, external: { calId: 'c', eventId: 'e' } }, thu],
      { dayKey: TUE },
      { kind: 'shift', deltaMin: 30 },
      [],
      'series'
    )
    expect(moved(plan)).toEqual([
      ['s-tue', TUE, 9 * 60 + 30],
      ['s-thu', THU, 9 * 60 + 30],
    ])
    expect(plan.skipped.map((s) => [s.block.id, s.reason])).toEqual([['s-wed', 'calendar']])
  })

  it('a repeating standup is fixed-time: an answer never moves it, a retag still takes', () => {
    /* fixed-time is read before the series question, so "which occurrences?"
       never becomes a way around it (#122's law) */
    const standups = series({ title: 'Standup', tag: 'work' })
    const move = planBatch(standups, { dayKey: TUE }, { kind: 'shift', deltaMin: 30 }, [], 'series')
    expect(move.moves).toEqual([])
    expect(move.skipped.map((s) => s.reason)).toEqual(['fixed', 'fixed', 'fixed'])

    const retag = planBatch(
      standups,
      { dayKey: TUE },
      { kind: 'setTag', tag: 'private' },
      [],
      'series'
    )
    expect(ids(retag.moves.map((m) => m.block))).toEqual(['s-tue', 's-wed', 's-thu'])
  })

  it('an occurrence the shift would run past midnight stays put, named on its own day', () => {
    /* an evening series at 22:00; only Wednesday's runs to midnight, so only
       Wednesday's cannot take the half hour */
    const late = series({ startMin: 22 * 60, endMin: 22 * 60 + 30 })
    const plan = planBatch(
      [late[0], { ...late[1], startMin: 23 * 60 + 45, endMin: 24 * 60 }, late[2]],
      { dayKey: TUE },
      { kind: 'shift', deltaMin: 30 },
      [],
      'series'
    )
    expect(plan.skipped.map((s) => [s.block.id, s.reason])).toEqual([['s-wed', 'off-day']])
    expect(moved(plan)).toEqual([
      ['s-tue', TUE, 22 * 60 + 30],
      ['s-thu', THU, 22 * 60 + 30],
    ])
  })

  it('the list token changes when an answer widens the plan', () => {
    const one = planBatch(series(), { dayKey: TUE }, { kind: 'shift', deltaMin: 30 }, [], 'this')
    const all = planBatch(series(), { dayKey: TUE }, { kind: 'shift', deltaMin: 30 }, [], 'series')
    expect(batchToken(one)).not.toBe(batchToken(all))
    /* and it is stable for the same answer, so a yes still lands */
    expect(batchToken(all)).toBe(
      batchToken(
        planBatch(series(), { dayKey: TUE }, { kind: 'shift', deltaMin: 30 }, [], 'series')
      )
    )
  })
})

describe('the keyless grammar carries a scope word on a batch ask', () => {
  it("each chip's wording parses back to its answer, selection intact", () => {
    const base = 'push all work after 5pm back 30 min'
    const plain = parseCommand(base, NOW)
    expect(plain.kind).toBe('batch')
    expect(plain.seriesScope).toBeUndefined()

    for (const [phrase, scope] of [
      ['just this one', 'this'],
      ['this and following', 'following'],
      ['across the whole series', 'series'],
    ] as const) {
      const cmd = parseCommand(`${base} ${phrase}`, NOW)
      expect(cmd.kind).toBe('batch')
      expect(cmd.seriesScope).toBe(scope)
      /* the scope word never leaks into the selection it re-issues */
      expect(cmd.batch).toEqual(plain.batch)
    }
  })

  it('a retag ask keeps its tag and its scope together', () => {
    const cmd = parseCommand("tag all of tomorrow's calls as work across the whole series", NOW)
    expect(cmd.kind).toBe('batch')
    expect(cmd.seriesScope).toBe('series')
    expect(cmd.batch).toMatchObject({ op: 'setTag', toTag: 'work', titleQuery: 'calls' })
  })
})
