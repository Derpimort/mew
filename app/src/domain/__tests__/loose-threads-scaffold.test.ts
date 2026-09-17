/* #123's class on the loose-threads rail: the meals the sustenance scaffold
   seeds and the breathers the pacing pass tucks in are MEW's own scaffolding,
   never the owner's loose ends. Once their window has passed they used to sit
   in the rail as "slipped", with done and resume beside them — MEW asking the
   owner to account for blocks MEW placed itself. Pure domain, the level the
   rule lives at; ThreadRail renders looseThreads and nothing else. */

import { describe, expect, it } from 'vitest'
import { looseThreads } from '../week'
import type { Block, Capture } from '../types'

const D = '2026-06-09' // Tuesday
const NOW = 15 * 60 // 15:00 — lunch and the early breather are behind us

function mk(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'X',
    tag: 'work',
    dayKey: D,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/* the day the scaffold builds: the owner's Deck, MEW's seeded Lunch and
   Dinner (#123 'sustenance') and MEW's tucked-in Breather (#123 'pacing') */
const deck = () => mk({ id: 'deck', title: 'Deck', startMin: 540, endMin: 600 })
const lunch = () =>
  mk({
    id: 'lunch',
    title: 'Lunch',
    tag: 'private',
    startMin: 720,
    endMin: 765,
    placedBy: 'sustenance',
  })
const breather = () =>
  mk({
    id: 'breather',
    title: 'Breather',
    tag: 'rest',
    startMin: 840,
    endMin: 860,
    placedBy: 'pacing',
  })
const dinner = () =>
  mk({
    id: 'dinner',
    title: 'Dinner',
    tag: 'private',
    startMin: 1110,
    endMin: 1170,
    placedBy: 'sustenance',
  })

describe("the loose-threads rail lists the owner's own work", () => {
  it("the repro: a seeded meal and a tucked-in breather never slip, the owner's own block still does", () => {
    const t = looseThreads([deck(), lunch(), breather(), dinner()], [], D, NOW)
    expect(t.slipped.map((b) => b.title)).toEqual(['Deck'])
  })

  it('a meal the owner asked for is theirs, and still slips', () => {
    const own = mk({
      id: 'sam',
      title: 'lunch with sam',
      tag: 'private',
      startMin: 780,
      endMin: 840,
    })
    const t = looseThreads([own, lunch()], [], D, NOW)
    expect(t.slipped.map((b) => b.id)).toEqual(['sam'])
  })

  it('the other three lists are exactly as they were', () => {
    const running = mk({
      id: 'r1',
      title: 'restore',
      attention: 'background',
      startMin: 14 * 60,
      endMin: 16 * 60,
      startedAt: 1,
    })
    const followUp = mk({
      id: 'p1',
      title: 'deck — rest of it',
      startMin: 16 * 60,
      endMin: 17 * 60,
    })
    const interrupted = mk({ id: 'i1', title: 'deck', status: 'rolled', rolledToId: 'p1' })
    const cap: Capture = { id: 'c1', title: 'call the bank', createdAt: 0, status: 'open' }
    const t = looseThreads([running, followUp, interrupted, lunch(), breather()], [cap], D, NOW)
    expect(t.running.map((b) => b.id)).toEqual(['r1'])
    expect(t.paused.map((b) => b.id)).toEqual(['p1'])
    expect(t.unplaced.map((c) => c.id)).toEqual(['c1'])
    expect(t.slipped).toEqual([])
  })
})
