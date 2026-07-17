import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { overlaps } from '../week'
import { candidateSlots, PACING_REST_MIN, restInsertion, scoreSlots } from '../scheduler'

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
    const cands = candidateSlots(
      [busy],
      { title: 'deep work', tag: 'work', durationMin: 60 },
      D,
      NOW
    )
    const today = cands.filter((c) => c.dayKey === D) // overlap is a same-day notion
    expect(today.length).toBeGreaterThan(0)
    for (const c of today)
      expect(overlaps(c.startMin, c.endMin, busy.startMin, busy.endMin)).toBe(false)
  })

  it('a due deadline confines candidates to today and gates anything ending late', () => {
    const cands = candidateSlots(
      [],
      { title: 'report', tag: 'work', durationMin: 60, due: 10 * 60 },
      D,
      NOW
    )
    expect(cands.length).toBeGreaterThan(0)
    for (const c of cands) {
      expect(c.dayKey).toBe(D)
      expect(c.endMin).toBeLessThanOrEqual(10 * 60)
    }
  })

  it('returns nothing when no gap fits the duration', () => {
    const full = mk({ title: 'All day', startMin: 8 * 60, endMin: 18 * 60 + 30 })
    expect(
      candidateSlots([full], { title: 'x', tag: 'work', durationMin: 60, due: 18 * 60 }, D, NOW)
    ).toEqual([])
  })

  it('spans multiple days when there is no due deadline', () => {
    const cands = candidateSlots([], { title: 'x', tag: 'work', durationMin: 60 }, D, NOW, 3)
    expect(new Set(cands.map((c) => c.dayKey)).size).toBeGreaterThan(1)
  })
})

describe('scheduler — #302 meeting buffer flows through candidateSlots + scoreSlots', () => {
  const meeting = mk({
    title: 'Client sync',
    startMin: 11 * 60,
    endMin: 12 * 60,
    external: { calId: 'work', eventId: 'ev1' },
  })
  const q = { title: 'deep work', tag: 'work' as const, durationMin: 60 }
  const clearsMargin = (c: { startMin: number; endMin: number }) =>
    c.endMin <= 11 * 60 - 15 || c.startMin >= 12 * 60 + 15 // outside the inflated [10:45,12:15]

  it('candidateSlots buffer 0 reproduces the no-buffer candidates byte-for-byte', () => {
    expect(candidateSlots([meeting], q, D, NOW, 0, undefined, 0)).toEqual(
      candidateSlots([meeting], q, D, NOW, 0)
    )
  })

  it('without a buffer a candidate abuts the meeting edge; with buffer 15 none does', () => {
    const bare = candidateSlots([meeting], q, D, NOW, 0).filter((c) => c.dayKey === D)
    expect(bare.some((c) => c.endMin === 11 * 60)).toBe(true) // 10:00–11:00 abuts the 11:00 start
    const buffered = candidateSlots([meeting], q, D, NOW, 0, undefined, 15).filter(
      (c) => c.dayKey === D
    )
    expect(buffered.length).toBeGreaterThan(0)
    expect(buffered.every(clearsMargin)).toBe(true)
  })

  it('scoreSlots (the plan/suggest_slots path) inherits the buffer for every ranked slot', () => {
    const ranked = scoreSlots([meeting], q, D, NOW, [], undefined, 0, undefined, 15).filter(
      (c) => c.dayKey === D
    )
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked.every(clearsMargin)).toBe(true)
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
    for (const c of ranked.filter((c) => c.dayKey === D))
      // the blocks are all on D
      for (const b of blocks)
        expect(overlaps(c.startMin, c.endMin, b.startMin, b.endMin)).toBe(false)
  })

  it('a work item prefers a morning slot over an afternoon one', () => {
    const blocks = [
      mk({ startMin: 9 * 60, endMin: 14 * 60 }),
      mk({ startMin: 15 * 60, endMin: 18 * 60 + 30 }),
    ]
    const top = scoreSlots(blocks, { title: 'deep work', tag: 'work', durationMin: 60 }, D, NOW)[0]
    expect(top.startMin).toBeLessThan(12 * 60)
  })

  it('penalises a back-to-back slot below a spaced one', () => {
    const blocks = [mk({ startMin: 10 * 60, endMin: 11 * 60 })]
    const onD = scoreSlots(
      blocks,
      { title: 'deep work', tag: 'work', durationMin: 60 },
      D,
      NOW
    ).filter((c) => c.dayKey === D)
    const backToBack = onD.find((c) => c.startMin === 11 * 60)! // right after the 10–11 block
    const spaced = onD.find((c) => c.startMin === 11 * 60 + 30)! // a gap before it
    expect(backToBack.score).toBeLessThan(spaced.score)
  })

  it('a time-default preference ranks its hour on top', () => {
    const prefs = [
      {
        kind: 'time-default' as const,
        match: 'deep work',
        value: 'starts 09:00',
        stated: 'deep work is 9am',
      },
    ]
    const top = scoreSlots(
      [],
      { title: 'deep work', tag: 'work', durationMin: 60 },
      D,
      NOW,
      prefs
    )[0]
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

describe('scheduler — restInsertion (pacing rest in a long run, #103)', () => {
  it('a >90-min continuous run earns one short breather right after the stretch', () => {
    const run = mk({ title: 'Deep work', startMin: 9 * 60, endMin: 11 * 60 + 30 }) // 150 min, > cap
    const r = restInsertion([run], D)
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('place')
    expect(r!.startMin).toBe(11 * 60 + 30) // the air just after the run
    expect(r!.endMin - r!.startMin).toBe(PACING_REST_MIN)
  })

  it('a run built from back-to-back blocks (<15-min air) is one continuous stretch', () => {
    // 09:00–10:30 then 10:35–12:00: 5-min air doesn't break the run → 180 min total
    const blocks = [
      mk({ title: 'A', startMin: 9 * 60, endMin: 10 * 60 + 30 }),
      mk({ title: 'B', startMin: 10 * 60 + 35, endMin: 12 * 60 }),
    ]
    const r = restInsertion(blocks, D)
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('place')
    expect(r!.startMin).toBe(12 * 60) // after the whole stretch
  })

  it('a day already broken by a rest gets nothing added', () => {
    const blocks = [
      mk({ title: 'Morning', startMin: 9 * 60, endMin: 10 * 60 + 30 }),
      mk({ title: 'Lunch', tag: 'rest', startMin: 12 * 60, endMin: 13 * 60 }),
      mk({ title: 'Afternoon', startMin: 13 * 60, endMin: 14 * 60 + 30 }),
    ]
    expect(restInsertion(blocks, D)).toBeNull()
  })

  it('a run under the cap earns nothing', () => {
    const run = mk({ title: 'Short', startMin: 9 * 60, endMin: 10 * 60 + 15 }) // 75 min, < cap
    expect(restInsertion([run], D)).toBeNull()
  })

  it('is idempotent — re-running after the breather lands inserts no second rest', () => {
    const run = mk({ title: 'Deep work', startMin: 9 * 60, endMin: 11 * 60 + 30 })
    const r = restInsertion([run], D)!
    const breather = mk({
      title: 'Breather',
      tag: 'rest',
      startMin: r.startMin,
      endMin: r.endMin,
      protected: false,
    })
    expect(restInsertion([run, breather], D)).toBeNull()
  })

  it('only offers (suggest) when a wall-to-wall run leaves no room without displacing work', () => {
    // work fills the whole day to its end — no free seam at or after the run
    const run = mk({ title: 'All day', startMin: 8 * 60, endMin: 18 * 60 + 30 })
    const r = restInsertion([run], D)
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('suggest')
    expect(r!.startMin).toBe(8 * 60)
    expect(r!.endMin).toBe(18 * 60 + 30)
  })

  it('the inserted breather is short and absorbable (≤20 min)', () => {
    const run = mk({ title: 'Deep work', startMin: 9 * 60, endMin: 11 * 60 })
    const r = restInsertion([run], D)!
    expect(r.endMin - r.startMin).toBeLessThanOrEqual(20)
    expect(r.endMin - r.startMin).toBeGreaterThanOrEqual(10)
  })

  it('a background hold over the run is transparent — it neither forms nor breaks a run', () => {
    const blocks = [
      mk({ title: 'Deep work', startMin: 9 * 60, endMin: 11 * 60 + 30 }),
      mk({
        title: 'Spotify',
        tag: 'private',
        attention: 'background',
        startMin: 9 * 60,
        endMin: 12 * 60,
      }),
    ]
    const r = restInsertion(blocks, D)
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('place') // the background hold doesn't fill the seam
  })

  it('an optional (tentative) block neither counts as the run nor blocks the seam', () => {
    // 150-min run, then an OPTIONAL block sitting in the air after it
    const blocks = [
      mk({ title: 'Deep work', startMin: 9 * 60, endMin: 11 * 60 + 30 }),
      mk({ title: 'Maybe coffee', optional: true, startMin: 11 * 60 + 30, endMin: 12 * 60 }),
    ]
    const r = restInsertion(blocks, D)
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('place')
    expect(r!.startMin).toBe(11 * 60 + 30) // the optional block is transparent to the seam
  })
})
