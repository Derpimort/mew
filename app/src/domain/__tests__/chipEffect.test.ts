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
