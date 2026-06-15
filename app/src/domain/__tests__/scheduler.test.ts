import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { overlaps } from '../week'
import { candidateSlots, scoreSlots } from '../scheduler'

const D = '2026-06-09' // Tuesday
const NOW = 8 * 60 // 08:00 — the working-day start

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
  } as Block
}

describe('scheduler — candidateSlots (conflict-free enumeration)', () => {
  it('never overlaps an existing block', () => {
    const busy = mk({ title: 'Standup', startMin: 10 * 60, endMin: 11 * 60 })
    const cands = candidateSlots([busy], { title: 'deep work', tag: 'work', durationMin: 60 }, D, NOW)
    const today = cands.filter((c) => c.dayKey === D) // overlap is a same-day notion
    expect(today.length).toBeGreaterThan(0)
    for (const c of today) expect(overlaps(c.startMin, c.endMin, busy.startMin, busy.endMin)).toBe(false)
  })

  it('a due deadline confines candidates to today and gates anything ending late', () => {
    const cands = candidateSlots([], { title: 'report', tag: 'work', durationMin: 60, due: 10 * 60 }, D, NOW)
    expect(cands.length).toBeGreaterThan(0)
    for (const c of cands) {
      expect(c.dayKey).toBe(D)
      expect(c.endMin).toBeLessThanOrEqual(10 * 60)
    }
  })

  it('returns nothing when no gap fits the duration', () => {
    const full = mk({ title: 'All day', startMin: 8 * 60, endMin: 18 * 60 + 30 })
    expect(candidateSlots([full], { title: 'x', tag: 'work', durationMin: 60, due: 18 * 60 }, D, NOW)).toEqual([])
  })

  it('spans multiple days when there is no due deadline', () => {
    const cands = candidateSlots([], { title: 'x', tag: 'work', durationMin: 60 }, D, NOW, 3)
    expect(new Set(cands.map((c) => c.dayKey)).size).toBeGreaterThan(1)
  })
})

describe('scheduler — scoreSlots (ranking)', () => {
  it('every ranked candidate is conflict-free (the hard gate holds through scoring)', () => {
    const blocks = [
      mk({ title: 'AM mtg', startMin: 9 * 60, endMin: 10 * 60 }),
      mk({ title: 'PM mtg', startMin: 14 * 60, endMin: 15 * 60 }),
    ]
    const ranked = scoreSlots(blocks, { title: 'deep work', tag: 'work', durationMin: 60 }, D, NOW)
    expect(ranked.length).toBeGreaterThan(0)
    for (const c of ranked.filter((c) => c.dayKey === D)) // the blocks are all on D
      for (const b of blocks) expect(overlaps(c.startMin, c.endMin, b.startMin, b.endMin)).toBe(false)
  })

  it('a work item prefers a morning slot over an afternoon one', () => {
    const blocks = [mk({ startMin: 9 * 60, endMin: 14 * 60 }), mk({ startMin: 15 * 60, endMin: 18 * 60 + 30 })]
    const top = scoreSlots(blocks, { title: 'deep work', tag: 'work', durationMin: 60 }, D, NOW)[0]
    expect(top.startMin).toBeLessThan(12 * 60)
  })

  it('penalises a back-to-back slot below a spaced one', () => {
    const blocks = [mk({ startMin: 10 * 60, endMin: 11 * 60 })]
    const onD = scoreSlots(blocks, { title: 'deep work', tag: 'work', durationMin: 60 }, D, NOW).filter((c) => c.dayKey === D)
    const backToBack = onD.find((c) => c.startMin === 11 * 60)! // right after the 10–11 block
    const spaced = onD.find((c) => c.startMin === 11 * 60 + 30)! // a gap before it
    expect(backToBack.score).toBeLessThan(spaced.score)
  })

  it('a time-default preference ranks its hour on top', () => {
    const prefs = [{ kind: 'time-default' as const, match: 'deep work', value: 'starts 09:00', stated: 'deep work is 9am' }]
    const top = scoreSlots([], { title: 'deep work', tag: 'work', durationMin: 60 }, D, NOW, prefs)[0]
    expect(top.startMin).toBe(9 * 60)
    expect(top.why).toContain('matches your rule')
  })

  it('is deterministic and keyless — same inputs, same ranking, scores in [0,1]', () => {
    const blocks = [mk({ startMin: 11 * 60, endMin: 12 * 60 })]
    const a = scoreSlots(blocks, { title: 'x', tag: 'work', durationMin: 60 }, D, NOW)
    const b = scoreSlots(blocks, { title: 'x', tag: 'work', durationMin: 60 }, D, NOW)
    expect(a).toEqual(b)
    expect(a.every((c) => c.score >= 0 && c.score <= 1)).toBe(true)
  })
})
