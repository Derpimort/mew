import { describe, expect, it } from 'vitest'
import { isRollCandidate, weeklyReview } from '../review'
import type { Block } from '../types'

/* Monday June 8 2026 opens the canonical Mon–Sun window (June 9 is the seed's
   Tuesday). weekKey IS the Monday dayKey. */
const WK = '2026-06-08'
const MON = '2026-06-08'
const TUE = '2026-06-09'
const WED = '2026-06-10'
const THU = '2026-06-11'
const FRI = '2026-06-12'
const SAT = '2026-06-13'
const NEXT_MON = '2026-06-15'

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'X',
    tag: 'work',
    dayKey: WED,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

describe('weeklyReview', () => {
  it('celebrates mews and carries own+flexible unfinished work, tallied by tag', () => {
    const blocks = [
      mk({ id: 'm1', title: 'Deck', tag: 'work', dayKey: MON, status: 'done' }),
      mk({ id: 'm2', title: 'Walk', tag: 'private', dayKey: TUE, status: 'done' }),
      mk({ id: 'c1', title: 'Roadmap draft', tag: 'work', dayKey: WED, status: 'open' }),
      mk({ id: 'c2', title: 'Gym', tag: 'private', dayKey: THU, status: 'open' }),
    ]
    const r = weeklyReview(blocks, [], WK)

    expect(r.weekKey).toBe(WK)
    expect(r.mews.map((b) => b.id).sort()).toEqual(['m1', 'm2'])
    expect(r.carried.map((b) => b.id).sort()).toEqual(['c1', 'c2'])
    expect(r.byTag).toEqual({
      work: { mews: 1, carried: 1 },
      private: { mews: 1, carried: 1 },
    })
    expect(r.empty).toBe(false)
  })

  it('a mew is history, never a roll candidate (pinned)', () => {
    const done = mk({ id: 'd', title: 'Shipped it', status: 'done', dayKey: MON })
    const r = weeklyReview([done], [], WK)
    expect(r.mews).toHaveLength(1)
    expect(r.carried).toHaveLength(0) // a completion is celebrated, never carried
    expect(r.carried.some((b) => b.status === 'done')).toBe(false)
  })

  it('external and fixed-time blocks are never carried (pinned) — not ours to move', () => {
    const blocks = [
      mk({
        id: 'ext',
        title: 'Product sync',
        dayKey: WED,
        status: 'open',
        external: { calId: 'c', eventId: 'e' },
      }),
      mk({ id: 'fix', title: 'Interview with Dana', tag: 'work', dayKey: THU, status: 'open' }),
      mk({ id: 'own', title: 'Spec review', tag: 'work', dayKey: FRI, status: 'open' }),
    ]
    const r = weeklyReview(blocks, [], WK)
    expect(r.carried.map((b) => b.id)).toEqual(['own'])
    expect(r.carried.some((b) => b.id === 'ext')).toBe(false)
    expect(r.carried.some((b) => b.id === 'fix')).toBe(false)
  })

  it('rolled blocks and blocks outside the week are excluded', () => {
    const blocks = [
      mk({ id: 'rolled', dayKey: SAT, status: 'rolled' }),
      mk({ id: 'nextweek', dayKey: NEXT_MON, status: 'open' }),
      mk({ id: 'keep', dayKey: WED, status: 'open' }),
    ]
    const r = weeklyReview(blocks, [], WK)
    expect(r.carried.map((b) => b.id)).toEqual(['keep'])
    expect(r.mews).toHaveLength(0)
  })

  it('is empty under the floor — nothing to celebrate, nothing to carry', () => {
    expect(weeklyReview([], [], WK).empty).toBe(true)
    // a week holding only external + fixed open work is still empty: neither
    // is a mew, neither can be carried.
    const noise = [
      mk({ id: 'e', dayKey: WED, status: 'open', external: { calId: 'c', eventId: 'e' } }),
      mk({ id: 'f', title: 'Standup', dayKey: THU, status: 'open' }),
    ]
    const r = weeklyReview(noise, [], WK)
    expect(r.mews).toHaveLength(0)
    expect(r.carried).toHaveLength(0)
    expect(r.empty).toBe(true)
  })

  it('never invents a completion — mews mirror done blocks exactly, no un-completing', () => {
    const blocks = [
      mk({ id: 'm', status: 'done', dayKey: MON }),
      mk({ id: 'o', status: 'open', dayKey: TUE }),
    ]
    const r = weeklyReview(blocks, [], WK)
    expect(r.mews.map((b) => b.id)).toEqual(['m'])
    // the open block stays open in the source — the review reads, never writes
    expect(blocks.find((b) => b.id === 'o')!.status).toBe('open')
  })
})

describe('isRollCandidate — the human-in-the-loop gate, both ways', () => {
  it('admits the owner’s own, flexible, still-open work', () => {
    expect(isRollCandidate(mk({ status: 'open', title: 'Roadmap draft' }))).toBe(true)
  })

  it('rejects mews, external events, fixed-time, and already-rolled blocks', () => {
    expect(isRollCandidate(mk({ status: 'done' }))).toBe(false) // a mew
    expect(isRollCandidate(mk({ status: 'open', external: { calId: 'c', eventId: 'e' } }))).toBe(
      false
    ) // external
    expect(isRollCandidate(mk({ status: 'open', title: 'Interview' }))).toBe(false) // fixed-time
    expect(isRollCandidate(mk({ status: 'rolled' }))).toBe(false) // already rolled on
  })
})
