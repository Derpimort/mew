/* #94: chipReplyEffect resolves a chip's reply the way the rules floor and the
   executors will, against a given clock, so a pick can tell whether the reply
   still means what it meant when the chip was offered. Pure. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { chipReplyEffect, chipStillMeans } from '../chipEffect'

const TUE = new Date(2026, 5, 9, 9, 0) // Tuesday, June 9
const WED = new Date(2026, 5, 10, 0, 5) // just after midnight

function block(over: Partial<Block>): Block {
  return {
    id: 'x',
    title: 'Deck polish',
    tag: 'work',
    dayKey: '2026-06-09',
    startMin: 9 * 60,
    endMin: 11 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

describe('chipReplyEffect — what a reply does at a given clock', () => {
  it('a move: the target block, the absolute landing day and time', () => {
    const blocks = [block({ id: 'deck' })]
    expect(chipReplyEffect(blocks, 'move the Deck polish to tomorrow at 9:00', TUE)).toEqual({
      kind: 'move',
      target: 'deck',
      toKey: '2026-06-10',
      toStartMin: 540,
      relStartMin: null,
    })
    /* `at` pins the source; with no day word the block keeps its own day */
    expect(chipReplyEffect(blocks, 'move the Deck polish at 9:00 to 14:00', TUE)).toMatchObject({
      target: 'deck',
      toKey: null,
      toStartMin: 840,
    })
  })

  it('a remove: the blocks it removes and the candidates it would ask about', () => {
    const blocks = [
      block({ id: 'g-tue', title: 'Groceries', startMin: 840, endMin: 930 }),
      block({ id: 'g-wed', title: 'Groceries', dayKey: '2026-06-10', startMin: 840, endMin: 930 }),
    ]
    expect(chipReplyEffect(blocks, 'remove the Groceries today at 14:00', TUE)).toEqual({
      kind: 'remove',
      remove: ['g-tue'],
      candidates: [],
    })
    expect(chipReplyEffect(blocks, 'remove the Groceries today at 14:00', WED)).toEqual({
      kind: 'remove',
      remove: ['g-wed'],
      candidates: [],
    })
  })

  it('the rescue split: its target and the absolute day the tail lands on', () => {
    const blocks = [block({ id: 'deck' })]
    expect(
      chipReplyEffect(blocks, 'split the Deck polish around 9:30-10:15, keep 45m after', TUE)
    ).toEqual({
      kind: 'split',
      target: 'deck',
      dayKey: '2026-06-09',
      gapStartMin: 570,
      gapEndMin: 615,
      tailMin: 45,
    })
  })

  it('an acknowledgment changes nothing: null', () => {
    expect(chipReplyEffect([block({})], 'ok, keep both as they are', TUE)).toBeNull()
    expect(chipReplyEffect([block({})], 'ok, keep it as planned', TUE)).toBeNull()
  })
})

describe('chipStillMeans — offered Tuesday, picked Wednesday 00:05', () => {
  const later = [block({ id: 'deck', dayKey: '2026-06-10', startMin: 14 * 60, endMin: 16 * 60 })]

  it('"tomorrow" moved a day: false', () => {
    expect(chipStillMeans(later, 'move the Deck polish to tomorrow', TUE, WED)).toBe(false)
  })

  it('"today" moved a day, and so did the block it reaches: false', () => {
    const today = [block({ id: 'deck' })]
    expect(chipStillMeans(today, 'move the Deck polish to today at 10:15', TUE, WED)).toBe(false)
    expect(
      chipStillMeans(today, 'split the Deck polish around 9:30-10:15, keep 45m after', TUE, WED)
    ).toBe(false)
  })

  it('a weekday word still names the same day for the same block: true', () => {
    expect(chipStillMeans(later, 'move the Deck polish to thursday', TUE, WED)).toBe(true)
    expect(
      chipStillMeans(
        later,
        'split the Deck polish around 14:30-15:00 on thursday, keep 60m after',
        TUE,
        WED
      )
    ).toBe(true)
  })

  it('only the day moved (the same future block): false, for a split too', () => {
    expect(
      chipStillMeans(
        later,
        'split the Deck polish around 14:30-15:00 tomorrow, keep 60m after',
        TUE,
        WED
      )
    ).toBe(false)
  })

  it('only the target moved (same day, a same-titled block now nearest): false', () => {
    const twins = [
      block({ id: 'deck-tue', startMin: 14 * 60, endMin: 15 * 60 }),
      block({ id: 'deck-wed', dayKey: '2026-06-10', startMin: 14 * 60, endMin: 15 * 60 }),
    ]
    expect(
      chipStillMeans(twins, 'move the Deck polish at 14:00 to thursday at 9:00', TUE, WED)
    ).toBe(false)
  })

  it("a remove that now reaches another day's block: false", () => {
    const groceries = [
      block({ id: 'g-tue', title: 'Groceries', startMin: 840, endMin: 930 }),
      block({ id: 'g-wed', title: 'Groceries', dayKey: '2026-06-10', startMin: 840, endMin: 930 }),
    ]
    expect(chipStillMeans(groceries, 'remove the Groceries today at 14:00', TUE, WED)).toBe(false)
  })

  it('an acknowledgment always still means nothing: true', () => {
    expect(chipStillMeans(later, 'ok, keep both as they are', TUE, WED)).toBe(true)
  })
})

/* ── peer review of #98 (coderpa): every kind that acts is modelled ──── */

describe('chipReplyEffect — which-block, series-scope and placing replies', () => {
  const twins = [
    block({ id: 'gym-tue', title: 'gym', startMin: 18 * 60, endMin: 19 * 60 }),
    block({
      id: 'gym-wed',
      title: 'gym',
      dayKey: '2026-06-10',
      startMin: 18 * 60,
      endMin: 19 * 60,
    }),
  ]

  it('complete / edit / resize reach a target the way their executors do, so a day later they reach another block', () => {
    expect(chipReplyEffect(twins, 'done with gym at 18:00', TUE)).toEqual({
      kind: 'complete',
      target: 'gym-tue',
    })
    for (const reply of [
      'done with gym at 18:00',
      'make gym at 18:00 90 min',
      'rename gym at 18:00 to lifting',
    ]) {
      expect(chipStillMeans(twins, reply, TUE, WED), reply).toBe(false)
    }
  })

  it('duplicate: its landing day is absolute — "tomorrow" moves a day, a weekday holds', () => {
    const later = [block({ id: 'deck', dayKey: '2026-06-10' })]
    expect(chipReplyEffect(later, 'duplicate the Deck polish to tomorrow', TUE)).toMatchObject({
      kind: 'duplicate',
      target: 'deck',
      toKey: '2026-06-10',
    })
    expect(chipStillMeans(later, 'duplicate the Deck polish to tomorrow', TUE, WED)).toBe(false)
    expect(chipStillMeans(later, 'duplicate the Deck polish to thursday', TUE, WED)).toBe(true)
  })

  it('a plan: a place with a relative day moves a day, a weekday-named one holds', () => {
    expect(chipStillMeans([], 'block 1h for the budget review tomorrow at 9', TUE, WED)).toBe(false)
    expect(chipStillMeans([], 'block 1h for the budget review on thursday at 9', TUE, WED)).toBe(
      true
    )
  })

  it('relmove: "the next free slot" searches from today, so it never still means across a day; "later" on a future block does', () => {
    const later = [block({ id: 'deck', dayKey: '2026-06-10' })]
    expect(chipReplyEffect(later, 'move the Deck polish to the next free slot', TUE)).toMatchObject(
      {
        kind: 'relmove',
        target: 'deck',
      }
    )
    expect(chipStillMeans(later, 'move the Deck polish to the next free slot', TUE, WED)).toBe(
      false
    )
    expect(chipStillMeans(later, 'push the Deck polish later', TUE, WED)).toBe(true)
  })

  it('fail closed: a kind that acts without a modelled target (clear) carries its day', () => {
    const e = chipReplyEffect([block({})], 'clear today', TUE)
    expect(e?.kind).toBe('clear')
    expect(chipStillMeans([block({})], 'clear today', TUE, WED)).toBe(false)
  })

  it('the weekly ritual ask means the week it is spoken in', () => {
    expect(chipStillMeans([], 'plan my week', TUE, WED)).toBe(true)
    const sunday = new Date(2026, 5, 14, 17, 0)
    const monday = new Date(2026, 5, 15, 0, 5)
    expect(chipStillMeans([], 'plan my week', sunday, monday)).toBe(false)
  })

  it('a move pins its target by `at` among same-named blocks on one day (Q5)', () => {
    const sameDay = [
      block({ id: 'deck-am', dayKey: '2026-06-10', startMin: 9 * 60, endMin: 10 * 60 }),
      block({ id: 'deck-pm', dayKey: '2026-06-10', startMin: 14 * 60, endMin: 15 * 60 }),
    ]
    expect(
      chipReplyEffect(sameDay, 'move the Deck polish at 14:00 to thursday', TUE)
    ).toMatchObject({ target: 'deck-pm' })
  })

  it('a split "tomorrow" places its tail a day on (Q3)', () => {
    expect(
      chipReplyEffect(
        [block({ id: 'deck', dayKey: '2026-06-10' })],
        'split the Deck polish around 9:30-10:15 tomorrow, keep 45m after',
        TUE
      )
    ).toMatchObject({ kind: 'split', target: 'deck', dayKey: '2026-06-10' })
  })
})

/* ── peer re-review of #98 (coderpa): V8 and V9 ────────────────────────── */

describe('chipReplyEffect — a real resize reply, and a done block the offer meant', () => {
  const twins = (tueStatus: Block['status']) => [
    block({ id: 'gym-tue', title: 'gym', startMin: 18 * 60, endMin: 19 * 60, status: tueStatus }),
    block({
      id: 'gym-wed',
      title: 'gym',
      dayKey: '2026-06-10',
      startMin: 18 * 60,
      endMin: 19 * 60,
    }),
  ]

  it('V8: "make gym at 18:00 30 min longer" is a resize, and a day later it reaches Wednesday\'s gym', () => {
    expect(chipReplyEffect(twins('open'), 'make gym at 18:00 30 min longer', TUE)).toMatchObject({
      kind: 'resize',
      target: 'gym-tue',
      resize: { relDurationMin: 30 },
    })
    expect(chipStillMeans(twins('open'), 'make gym at 18:00 30 min longer', TUE, WED)).toBe(false)
  })

  it("V9: a complete whose offered block was marked done before the pick still reads Tuesday's, so the stale pick is refused", () => {
    expect(chipReplyEffect(twins('done'), 'done with gym at 18:00', TUE)).toEqual({
      kind: 'complete',
      target: 'gym-tue',
    })
    expect(chipStillMeans(twins('done'), 'done with gym at 18:00', TUE, WED)).toBe(false)
  })
})
