import { describe, expect, it } from 'vitest'
import { liveNow } from '../liveNow'
import type { Block } from '../types'

const D = '2026-06-09'

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'X',
    tag: 'work',
    dayKey: D,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

describe('liveNow — the live week decides', () => {
  const deck = mk({ title: 'Q3 deck — deep work', startMin: 9 * 60, endMin: 11.5 * 60 })
  const standup = mk({ title: 'Team standup', startMin: 11.5 * 60, endMin: 12 * 60 })

  it('names the current obligation with minutes left and protection', () => {
    const ln = liveNow([deck, standup], D, 9 * 60 + 40)
    expect(ln.current?.id).toBe(deck.id)
    expect(ln.headline).toBe('Finish Q3 deck.')
    expect(ln.minutesLeft).toBe(110)
    expect(ln.meta.join(' · ')).toContain('protected until 11:30')
  })

  it('transitions at the block boundary — same inputs, only the clock moved (acceptance #2)', () => {
    expect(liveNow([deck, standup], D, 11 * 60 + 29).current?.id).toBe(deck.id)
    expect(liveNow([deck, standup], D, 11 * 60 + 30).current?.id).toBe(standup.id)
  })

  it('verb-led and non-work titles pass through without "Finish"', () => {
    const walk = mk({ title: 'Walk', tag: 'private', startMin: 16 * 60, endMin: 17 * 60 })
    expect(liveNow([walk], D, 16 * 60 + 5).headline).toBe('Walk.')
  })

  it('counts mews and fills the 7-segment strip from done/total', () => {
    const done = mk({ status: 'done', startMin: 8 * 60, endMin: 9 * 60 })
    const ln = liveNow([done, deck, standup, mk({ tag: 'rest', startMin: 18 * 60, endMin: 19 * 60 })], D, 12 * 60 + 30)
    expect(ln.mewsToday).toBe(1)
    expect(ln.segments.filter(Boolean)).toHaveLength(Math.round((1 / 3) * 7))
  })

  it('rests when the day is clear', () => {
    const a = mk({ status: 'done' })
    const ln = liveNow([a], D, 18 * 60)
    expect(ln.resting).toBe(true)
    expect(ln.headline).toMatch(/Resting/)
  })
})
