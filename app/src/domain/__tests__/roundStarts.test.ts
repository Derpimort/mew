/* #22 slice C — MEW proposes human times. The issue's last two repro assertions,
   inverted: an empty day asked at 10:07 lands at 10:30 (never 10:07), and an
   hour boundary finally carries weight in a tie. The AC5 property: no domain
   placement path emits a start off the 5-minute grid, whatever ragged anchors
   (now, odd calendar ends) feed it — and already-round inputs place exactly as
   the pre-snap algorithms did. */
import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { roundness, snapStart } from '../time'
import { candidateSlots, restInsertion, scoreSlots, type SlotQuery } from '../scheduler'
import { conflictsWith, findFreeSlot, freeWindows, nextFreeSlot, nextSlotAfter } from '../week'

const D = '2026-07-25'

let n = 0
function mk(over: Partial<Block>): Block {
  return {
    id: `r${n++}`,
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

const onGrid = (min: number) => min % 5 === 0

describe('snapStart — the human start for a ragged anchor', () => {
  it('keeps a quarter-hour exactly (already round)', () => {
    for (const m of [600, 615, 630, 645]) expect(snapStart(m, 24 * 60)).toBe(m)
    expect(snapStart(645, 640)).toBeNull() // …as long as it still fits
  })

  it('moves anything else forward: :00/:30 first, then :15/:45, then the 5-minute grid', () => {
    expect(snapStart(10 * 60 + 7, 24 * 60)).toBe(10 * 60 + 30)
    expect(snapStart(9 * 60 + 40, 24 * 60)).toBe(10 * 60)
    expect(snapStart(22 * 60 + 10, 24 * 60)).toBe(22 * 60 + 30) // the transcript's 22:10
    expect(snapStart(10 * 60 + 7, 10 * 60 + 20)).toBe(10 * 60 + 15)
    expect(snapStart(10 * 60 + 7, 10 * 60 + 12)).toBe(10 * 60 + 10)
    expect(snapStart(10 * 60 + 7, 10 * 60 + 9)).toBeNull()
  })

  it('roundness ranks :00, :30, :15/:45, the grid, then everything else', () => {
    expect([600, 630, 615, 645, 610, 607].map(roundness)).toEqual([0, 1, 2, 2, 3, 4])
  })
})

describe('AC4 — auto-placement into open air lands on a canonical boundary', () => {
  const email: SlotQuery = { title: 'Email update', tag: 'work', durationMin: 60 }

  it('asked at 10:07 on an empty day, the block starts at 10:30, not 10:07', () => {
    const ranked = scoreSlots([], email, D, 10 * 60 + 7).filter((c) => c.dayKey === D)
    expect(ranked[0].startMin).toBe(10 * 60 + 30)
    for (const c of ranked) expect(roundness(c.startMin)).toBeLessThanOrEqual(1)
  })

  it('a tie prefers :00 over the :45 before it, and :30 over the :15 before it', () => {
    // a rest block doesn't count against breathing room, so both starts tie on score
    const breather = (end: number) =>
      mk({ tag: 'rest', title: 'Breather', startMin: end - 15, endMin: end })
    const walk: SlotQuery = { title: 'Walk', tag: 'private', durationMin: 30 }
    const at = (end: number) => scoreSlots([breather(end)], walk, D, end - 15, [], undefined, 0)
    const quarterToEleven = at(10 * 60 + 45)
    expect(quarterToEleven[0].score).toBe(
      quarterToEleven.find((c) => c.startMin === 10 * 60 + 45)!.score
    )
    expect(quarterToEleven[0].startMin).toBe(11 * 60)
    expect(at(10 * 60 + 15)[0].startMin).toBe(10 * 60 + 30)
  })

  it('the earlier half-hour still wins a tie — rounder never means later than it needs to be', () => {
    const ranked = scoreSlots([], email, D, 10 * 60)
    expect(ranked[0].startMin).toBe(10 * 60)
    expect(ranked[1].startMin).toBe(10 * 60 + 30)
  })
})

describe('AC5 — no domain placement path emits a start off the 5-minute grid', () => {
  let seed = 225
  const rand = (k: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed % k
  }
  /** a day of MEW blocks plus ragged calendar events (any minute at all) */
  const raggedDay = (key: string) => {
    const out: Block[] = []
    for (let i = 0; i < 1 + rand(5); i++) {
      const start = 8 * 60 + rand(13 * 60)
      out.push(
        mk({
          dayKey: key,
          startMin: start,
          endMin: start + 10 + rand(110),
          ...(rand(2) ? { external: { calId: 'c', eventId: `e${i}` } } : {}),
          tag: (['work', 'private', 'rest'] as const)[rand(3)],
        })
      )
    }
    return out
  }

  it('candidateSlots, scoreSlots, findFreeSlot, nextFreeSlot, nextSlotAfter, restInsertion', () => {
    let placements = 0
    for (let trial = 0; trial < 300; trial++) {
      const blocks = [...raggedDay(D), ...raggedDay('2026-07-26')]
      const now = 7 * 60 + rand(15 * 60) // any minute
      const dur = 15 + rand(12) * 5 + (rand(4) === 0 ? rand(4) : 0) // mostly grid, sometimes not
      const buffer = [0, 5, 10][rand(3)]
      const q: SlotQuery = { title: `t${trial}`, tag: 'work', durationMin: dur }

      for (const c of candidateSlots(blocks, q, D, now, 1, undefined, buffer)) {
        expect(onGrid(c.startMin)).toBe(true)
        placements++
      }
      for (const c of scoreSlots(blocks, q, D, now, [], undefined, 1, undefined, buffer)) {
        expect(onGrid(c.startMin)).toBe(true)
        // snapping never trades away the conflict-free law
        expect(conflictsWith(blocks, c.dayKey, c.startMin, c.endMin)).toEqual([])
      }
      const first = findFreeSlot(blocks, D, dur, now, undefined, buffer)
      if (first) {
        expect(onGrid(first.startMin)).toBe(true)
        expect(conflictsWith(blocks, D, first.startMin, first.endMin)).toEqual([])
        placements++
      }
      const next = nextFreeSlot(blocks, D, now, dur, 1, buffer)
      if (next) expect(onGrid(next.startMin)).toBe(true)
      const flex = blocks[rand(blocks.length)]
      const after = nextSlotAfter(blocks, flex, now)
      if (after) expect(onGrid(after.startMin)).toBe(true)
      const rest = restInsertion(blocks, D)
      if (rest?.kind === 'place') {
        expect(onGrid(rest.startMin)).toBe(true)
        placements++
      }
    }
    expect(placements).toBeGreaterThan(1000)
  })

  /* the pre-snap first-fit, verbatim — the reference for already-round inputs */
  function legacyFirstFit(blocks: Block[], dur: number, from: number, to: number) {
    const day = blocks
      .filter((b) => b.dayKey === D && b.status === 'open')
      .sort((a, b) => a.startMin - b.startMin)
    let cursor = from
    for (const b of day) {
      if (b.endMin <= cursor) continue
      if (b.startMin - cursor >= dur) break
      cursor = Math.max(cursor, b.endMin)
    }
    return cursor + dur > to ? null : { startMin: cursor, endMin: cursor + dur }
  }

  it('already-round inputs place byte-identically to the pre-snap algorithms', () => {
    for (let trial = 0; trial < 400; trial++) {
      const blocks: Block[] = []
      for (let i = 0; i < rand(6); i++) {
        const start = 8 * 60 + rand(56) * 15
        blocks.push(mk({ startMin: start, endMin: start + 15 * (1 + rand(8)) }))
      }
      const from = 8 * 60 + rand(40) * 15
      const dur = 15 * (1 + rand(8))
      const to = 22 * 60 + 30
      expect(findFreeSlot(blocks, D, dur, from, to)).toEqual(legacyFirstFit(blocks, dur, from, to))

      /* candidate generation: the pre-snap set was each gap's own start plus the
         :00/:30 grid — with quarter-hour anchors that set is unchanged */
      const q: SlotQuery = { title: 'x', tag: 'private', durationMin: dur }
      const legacy: number[] = []
      for (const w of freeWindows(blocks, D, from, to)) {
        const starts = new Set<number>()
        if (w.startMin + dur <= w.endMin) starts.add(w.startMin)
        for (let s = Math.ceil(w.startMin / 30) * 30; s + dur <= w.endMin; s += 30) starts.add(s)
        legacy.push(...[...starts].sort((a, b) => a - b))
      }
      expect(candidateSlots(blocks, q, D, from, 0, to).map((c) => c.startMin)).toEqual(legacy)
    }
  })
})
