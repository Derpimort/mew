/* #107 follow-up: chipReplyEffect models the typed split ask (#73) the way
   execSplit resolves it (a named day narrows the target, `at` pins which, and a
   block to split around resolves on the target's own day). A split chip that
   still reaches the same block around the same gap acts after midnight; one that
   names its day relatively ("today") does not. Pure. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { chipReplyEffect, chipStillMeans } from '../chipEffect'

const TUE = new Date(2026, 5, 9, 9, 0) // Tuesday, June 9
const WED = new Date(2026, 5, 10, 0, 5) // just after midnight
const THU = '2026-06-11'

function block(over: Partial<Block>): Block {
  return {
    id: 'x',
    title: 'Deck',
    tag: 'work',
    dayKey: '2026-06-09',
    startMin: 12 * 60,
    endMin: 15 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/** a deck and a 1pm call on Tuesday, Wednesday and Thursday */
const week = (): Block[] =>
  ['2026-06-09', '2026-06-10', THU].flatMap((day) => [
    block({ id: `deck-${day}`, dayKey: day }),
    block({
      id: `call-${day}`,
      title: 'Client call',
      dayKey: day,
      startMin: 13 * 60,
      endMin: 13 * 60 + 45,
    }),
  ])

describe('chipReplyEffect — a split reply', () => {
  it('resolves the target on its named day and the block it splits around on that same day', () => {
    expect(
      chipReplyEffect(week(), 'split deck at 12:00 around the 13:00 call on thursday', TUE)
    ).toEqual({
      kind: 'split',
      target: `deck-${THU}`,
      around: `call-${THU}`,
      tailMin: null,
      seriesScope: null,
    })
    expect(
      chipReplyEffect(week(), 'split deck at 12:00 around 13:00-13:45, keep 45m after today', TUE)
    ).toEqual({
      kind: 'split',
      target: 'deck-2026-06-09',
      around: { startMin: 780, endMin: 825 },
      tailMin: 45,
      seriesScope: null,
    })
  })

  it('a weekday split chip still means the same split after midnight', () => {
    for (const reply of [
      'split deck at 12:00 around the 13:00 call on thursday',
      'split deck at 12:00 around 13:00-13:45 on thursday',
    ])
      expect(chipStillMeans(week(), reply, TUE, WED)).toBe(true)
  })

  it('a "today" split chip, or its series scope re-ask, reaches another day after midnight', () => {
    for (const reply of [
      'split deck at 12:00 around 13:00-13:45 today',
      'split deck at 12:00 around the 13:00 call today',
      'split deck at 12:00 around 13:00-13:45 today just this one',
    ])
      expect(chipStillMeans(week(), reply, TUE, WED)).toBe(false)
  })

  it('a done target is not a split target, so a done deck never "still means" a live one', () => {
    const blocks = week().map((b) =>
      b.id === `deck-${THU}` ? { ...b, status: 'done' as const } : b
    )
    expect(
      chipReplyEffect(blocks, 'split deck at 12:00 around 13:00-13:45 on thursday', TUE)
    ).toMatchObject({ target: 'none' })
  })
})
