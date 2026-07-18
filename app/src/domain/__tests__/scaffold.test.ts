/* weekScaffold (#349) — the owner's learned week-shape, drafted for a target
   week from LOCAL memory alone. Pure + keyless + deterministic; EMPTY under the
   floor (no confirmed shape ⇒ no scaffold, never a guess); schedules AROUND
   existing/external events, never over them. These pin the domain contract; the
   store suite pins that the draft commits ONLY on accept, through the executor. */

import { describe, expect, it } from 'vitest'
import type { Block, MemoryEvent } from '../types'
import type { LearnedRule } from '../prefs'
import { weekScaffold } from '../scaffold'
import { fromDayKey, weekKey, weekKeys } from '../time'

/* Wednesday 2026-07-15 is "now"; the coming week's Monday is the default target. */
const NOW = new Date('2026-07-15T09:00:00')
const TARGET = weekKey(new Date('2026-07-22T09:00:00')) // 2026-07-20 (Mon)
const DAYS = weekKeys(fromDayKey(TARGET)) // Mon–Sun of the target week

let seq = 0
const ev = (o: Partial<MemoryEvent>): MemoryEvent =>
  ({ id: `e${seq++}`, ts: seq, kind: 'completed', dayKey: '2026-07-07', ...o }) as MemoryEvent
const rule = (r: LearnedRule): MemoryEvent => ev({ kind: 'learned_rule', rule: r })

let bseq = 0
const blk = (o: Partial<Block>): Block =>
  ({
    id: `b${bseq++}`,
    title: 'x',
    tag: 'work',
    dayKey: DAYS[0],
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...o,
  }) as Block

/* ≥10 completed deep-work outcomes across 3 weekdays inside the trailing 28-day
   window, all in one band — clears the energy floor and demonstrates exactly one
   deep window (energyProfile / demonstratedDeepWindows, #321). */
const EDAYS = ['2026-07-07', '2026-07-08', '2026-07-09'] // Tue/Wed/Thu, in-window
function energyDeepAt(startMin: number): MemoryEvent[] {
  const out: MemoryEvent[] = []
  for (let i = 0; i < 12; i++)
    out.push(
      ev({
        kind: 'completed',
        dayKey: EDAYS[i % 3],
        startMin,
        tag: 'work',
        deep: true,
        plannedMin: 90,
        title: 'deep',
      })
    )
  return out
}

describe('weekScaffold — drafts from confirmed rules', () => {
  it('turns each confirmed rule into a placement in the target week, sized/tagged/windowed by the rule', () => {
    const mem = [
      rule({ match: 'weekly review', tag: 'work', durationMin: 60, window: 'afternoon' }),
      rule({ match: 'gym', tag: 'health', durationMin: 45, window: 'morning' }),
    ]
    const out = weekScaffold(mem, [], TARGET, NOW)
    expect(out).toHaveLength(2)

    const review = out.find((p) => p.title === 'weekly review')!
    expect(review.tag).toBe('work')
    expect(review.endMin! - review.startMin!).toBe(60)
    expect(review.startMin!).toBeGreaterThanOrEqual(12 * 60) // afternoon
    expect(review.startMin!).toBeLessThan(17 * 60)
    expect(DAYS).toContain(review.dayKey) // lands inside the target week

    const gym = out.find((p) => p.title === 'gym')!
    expect(gym.tag).toBe('health')
    expect(gym.endMin! - gym.startMin!).toBe(45)
    expect(gym.startMin!).toBeLessThan(12 * 60) // morning
    expect(DAYS).toContain(gym.dayKey)
  })

  it('a confirmed rule that carries a recurrence expands across the week (expandRrule)', () => {
    const mem = [
      rule({
        match: 'standup',
        tag: 'work',
        durationMin: 15,
        window: 'morning',
        rrule: { freq: 'WEEKLY', interval: 1, byday: ['MO', 'TU', 'WE', 'TH', 'FR'] },
      }),
    ]
    const out = weekScaffold(mem, [], TARGET, NOW)
    expect(out).toHaveLength(5) // Mon–Fri
    expect(out.every((p) => p.title === 'standup' && p.startMin === 9 * 60)).toBe(true)
    expect(new Set(out.map((p) => p.dayKey)).size).toBe(5) // one per weekday
    for (const p of out) expect(DAYS.slice(0, 5)).toContain(p.dayKey)
  })
})

describe('weekScaffold — recurrences the owner created directly (#159)', () => {
  it('expands a raw recurring series into the target week when it is not already there', () => {
    /* a weekly series anchored in the CURRENT week (its occurrence is not yet in
       the target week), so the scaffold re-derives the standing cadence */
    const anchorDay = weekKeys(NOW)[0] // this week's Monday
    const series = blk({
      title: 'team sync',
      tag: 'work',
      dayKey: anchorDay,
      startMin: 10 * 60,
      endMin: 10 * 60 + 30,
      recurringBlockId: 'r1',
      rrule: { freq: 'WEEKLY', interval: 1 },
    })
    const out = weekScaffold([], [series], TARGET, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('team sync')
    expect(out[0].startMin).toBe(10 * 60)
    expect(out[0].dayKey).toBe(DAYS[0]) // same weekday (Monday), next week
  })

  it('never re-proposes a series already materialized in the target week (dedupe)', () => {
    const already = blk({
      title: 'team sync',
      dayKey: DAYS[0],
      startMin: 10 * 60,
      endMin: 10 * 60 + 30,
      recurringBlockId: 'r1',
      rrule: { freq: 'WEEKLY', interval: 1 },
    })
    expect(weekScaffold([], [already], TARGET, NOW)).toEqual([])
  })
})

describe('weekScaffold — EMPTY under the floor (pinned: no guess without signal)', () => {
  it('returns nothing with no confirmed rules and no recurrences', () => {
    expect(weekScaffold([], [], TARGET, NOW)).toEqual([])
  })

  it('a learned energy profile ALONE never invents a week — bands shape WHERE, not WHETHER', () => {
    // real, floor-clearing energy signal, but zero rules/recurrences → still empty
    expect(weekScaffold(energyDeepAt(9 * 60), [], TARGET, NOW)).toEqual([])
  })
})

describe('weekScaffold — schedules AROUND existing/external events (pinned law)', () => {
  it('places after an external event in the window, never over it', () => {
    const mem = [rule({ match: 'deep work', tag: 'work', durationMin: 90, window: 'morning' })]
    // an external meeting owns Monday 08:00–10:00 (the front of the morning window)
    const ext = blk({
      title: 'offsite',
      dayKey: DAYS[0],
      startMin: 8 * 60,
      endMin: 10 * 60,
      external: { calId: 'c', eventId: 'e' },
    })
    const out = weekScaffold(mem, [ext], TARGET, NOW)
    expect(out).toHaveLength(1)
    const p = out[0]
    expect(p.dayKey).toBe(DAYS[0]) // still Monday — it scheduled around, didn't flee the day
    expect(p.startMin).toBe(10 * 60) // exactly after the external event ends
    // and it never overlaps the external event
    expect(p.startMin!).toBeGreaterThanOrEqual(ext.endMin)
  })

  it('when the whole window is taken it lands on another target day, still never over the event', () => {
    const mem = [rule({ match: 'deep work', tag: 'work', durationMin: 90, window: 'morning' })]
    const ext = blk({
      title: 'all-morning offsite',
      dayKey: DAYS[0],
      startMin: 8 * 60,
      endMin: 12 * 60, // the entire morning window on Monday
      external: { calId: 'c', eventId: 'e' },
    })
    const out = weekScaffold(mem, [ext], TARGET, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].dayKey).not.toBe(DAYS[0]) // Monday morning was full — moved to another day
    expect(out[0].startMin!).toBeLessThan(12 * 60) // still a morning slot
  })
})

describe('weekScaffold — learned energy bands place deep work (#321)', () => {
  it('a deep-work rule with no stated window lands in the DEMONSTRATED band, not the day default', () => {
    // the owner demonstrably finishes deep work in the afternoon (13:00 band)
    const mem = [
      ...energyDeepAt(13 * 60),
      rule({ match: 'refactor', tag: 'work', durationMin: 90 }),
    ]
    const p = weekScaffold(mem, [], TARGET, NOW).find((x) => x.title === 'refactor')!
    expect(p.startMin!).toBeGreaterThanOrEqual(12 * 60) // afternoon window
    expect(p.startMin!).toBeLessThan(17 * 60)
  })

  it('with no energy signal the same rule falls back to the first free slot of a day (honest, no invented band)', () => {
    const mem = [rule({ match: 'refactor', tag: 'work', durationMin: 90 })]
    const p = weekScaffold(mem, [], TARGET, NOW).find((x) => x.title === 'refactor')!
    expect(p.startMin).toBe(8 * 60) // DAY_START — the whole working day was searched
  })
})

describe('weekScaffold — keyless parity & determinism', () => {
  it('same local memory in, same draft out (no Date.now, no randomness, no brain input)', () => {
    const mem = [
      rule({ match: 'weekly review', tag: 'work', durationMin: 60, window: 'afternoon' }),
      rule({ match: 'refactor', tag: 'work', durationMin: 90 }),
      ...energyDeepAt(9 * 60),
    ]
    const a = weekScaffold(mem, [], TARGET, NOW)
    const b = weekScaffold(mem, [], TARGET, NOW)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
  })
})
