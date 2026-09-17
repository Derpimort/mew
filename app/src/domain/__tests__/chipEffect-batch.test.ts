/* #75 follow-up: chipReplyEffect models the batch confirm's yes (#94) the way
   execBatch resolves it: the selector's day and a move's day made absolute, and
   the blocks that selector picks. A confirm that names its days as weekdays still
   acts after midnight; one that says "today" or "tomorrow" now means other days,
   so it does not. Pure. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { chipReplyEffect, chipStillMeans } from '../chipEffect'

const TUE_2350 = new Date(2026, 5, 9, 23, 50) // Tuesday, June 9
const WED_0005 = new Date(2026, 5, 10, 0, 5) // just after midnight
const WED = '2026-06-10'
const THU = '2026-06-11'

function block(over: Partial<Block>): Block {
  return {
    id: 'x',
    title: 'Deck',
    tag: 'work',
    dayKey: THU,
    startMin: 15 * 60,
    endMin: 16 * 60,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/** a deck and a run on Wednesday and on Thursday afternoon */
const week = (): Block[] =>
  [WED, THU].flatMap((day) => [
    block({ id: `deck-${day}`, dayKey: day }),
    block({
      id: `run-${day}`,
      title: 'Run',
      tag: 'health',
      dayKey: day,
      startMin: 17 * 60,
      endMin: 18 * 60,
    }),
  ])

describe('chipReplyEffect — a batch confirm', () => {
  it('resolves a shift to its absolute day, the blocks it picks, the minutes and the count', () => {
    expect(
      chipReplyEffect(
        week(),
        'push everything after 15:00 on thursday later by 60 min — yes, all 2 · k7f2',
        TUE_2350
      )
    ).toEqual({
      kind: 'batch',
      dayKey: THU,
      selected: [`deck-${THU}`, `run-${THU}`],
      op: 'shift',
      deltaMin: 60,
      toDayKey: null,
      confirmCount: 2,
      confirmToken: 'k7f2',
    })
  })

  it('resolves a move to another day with both days absolute', () => {
    expect(
      chipReplyEffect(week(), "move all tomorrow's health to thursday — yes, all 1", TUE_2350)
    ).toEqual({
      kind: 'batch',
      dayKey: WED,
      selected: [`run-${WED}`],
      op: 'moveToDay',
      deltaMin: null,
      toDayKey: THU,
      confirmCount: 1,
      confirmToken: null,
    })
  })

  it.each([
    'push everything after 15:00 on thursday later by 60 min — yes, all 2',
    "move all thursday's work to saturday — yes, all 1",
  ])('a confirm naming weekdays still means the same after midnight: "%s"', (reply) => {
    expect(chipStillMeans(week(), reply, TUE_2350, WED_0005)).toBe(true)
  })

  it.each([
    'push everything after 15:00 tomorrow later by 60 min — yes, all 2',
    "move all tomorrow's health to thursday — yes, all 1",
    "move all thursday's work to tomorrow — yes, all 1",
  ])('a confirm naming "today" or "tomorrow" does not: "%s"', (reply) => {
    expect(chipStillMeans(week(), reply, TUE_2350, WED_0005)).toBe(false)
  })

  it('picked on the day it was offered, a "tomorrow" confirm still means the same', () => {
    expect(
      chipStillMeans(
        week(),
        'push everything after 15:00 tomorrow later by 60 min — yes, all 2',
        TUE_2350,
        new Date(2026, 5, 9, 23, 59)
      )
    ).toBe(true)
  })
})
