import { describe, expect, it } from 'vitest'
import type { MemoryEvent, Tag } from '../types'
import type { MemoryAggregates } from '../memory'
import {
  adminBatch,
  demonstratedDeepWindows,
  energyProfile,
  isAdminTask,
  isDeepTask,
} from '../energy'

/* the profile reads the trailing 28 days; these three weekdays (Tue/Wed/Thu)
   sit inside that window and clear the ≥3-distinct-weekday half of the floor */
const TODAY = new Date('2026-06-15T09:00:00')
const DAYS = ['2026-06-02', '2026-06-03', '2026-06-04']

/* the realistic best is known — energyProfile is gated on it, like the load
   meter, so the two capacity reads can't contradict */
const AGG: MemoryAggregates = {
  realisticBestH: 4,
  carryRatioByWeek: [],
  carryRatio: 0,
  restKeptRatio: null,
  restSkippedStreak: 0,
}

const MORNING = 9 * 60
const MIDDAY = 13 * 60
const LATE = 16 * 60
const EVENING = 20 * 60

let seq = 0
function ev(over: Partial<MemoryEvent>): MemoryEvent {
  return {
    id: `e${seq++}`,
    ts: 0,
    kind: 'completed',
    dayKey: DAYS[0],
    ...over,
  } as MemoryEvent
}

/** completed + rolled outcomes for one (band, tag, deep) cell, spread round-
    robin across the three weekdays so the floor's weekday spread always holds */
function cell(
  startMin: number,
  tag: Tag,
  deep: boolean,
  done: number,
  rolled: number
): MemoryEvent[] {
  const out: MemoryEvent[] = []
  let i = 0
  const base = { startMin, tag, deep, plannedMin: deep ? 90 : 30, title: 'x' }
  for (let k = 0; k < done; k++, i++)
    out.push(ev({ ...base, kind: 'completed', dayKey: DAYS[i % DAYS.length] }))
  for (let k = 0; k < rolled; k++, i++)
    out.push(ev({ ...base, kind: 'rolled', dayKey: DAYS[i % DAYS.length] }))
  return out
}

describe('energyProfile — (band × task-type) completion, learned from what you finish', () => {
  it('reports the completion rate per band per tag from local memory', () => {
    const events = [
      ...cell(MORNING, 'work', true, 4, 1), // morning deep 4/5 = 0.8
      ...cell(MORNING, 'private', false, 3, 0), // morning admin 3/3 = 1.0
      ...cell(EVENING, 'work', true, 3, 3), // evening deep 3/6 = 0.5
      ...cell(MIDDAY, 'health', false, 3, 0), // midday health 3/3 = 1.0
    ]
    const p = energyProfile(events, AGG, TODAY)
    expect(p).not.toBeNull()
    expect(p!.cells.morning.deep.rate).toBeCloseTo(0.8)
    expect(p!.cells.morning.admin.rate).toBeCloseTo(1)
    expect(p!.cells.evening.deep.rate).toBeCloseTo(0.5)
    expect(p!.cells.midday.health.rate).toBeCloseTo(1)
    // a cell with no data (or under the per-cell floor) claims nothing
    expect(p!.cells.late.deep.rate).toBeNull()
  })

  it('short work counts as admin, deep work as deep (the 60-min line)', () => {
    const events = [
      ...cell(MORNING, 'work', false, 4, 0), // 30-min work → admin class
      ...cell(MIDDAY, 'work', true, 4, 0), // 90-min work → deep class
      ...cell(LATE, 'private', false, 3, 0),
    ]
    const p = energyProfile(events, AGG, TODAY)!
    expect(p.cells.morning.admin.rate).toBeCloseTo(1)
    expect(p.cells.morning.deep.rate).toBeNull() // no deep work in the morning here
    expect(p.cells.midday.deep.rate).toBeCloseTo(1)
  })

  it('is null under the outcome floor (fewer than ~two honest weeks)', () => {
    const events = cell(MORNING, 'work', true, 5, 4) // 9 outcomes < 10
    expect(energyProfile(events, AGG, TODAY)).toBeNull()
  })

  it('is null under the weekday-spread floor (all on one day)', () => {
    const events = Array.from({ length: 12 }, () =>
      ev({
        kind: 'completed',
        dayKey: DAYS[0],
        startMin: MORNING,
        tag: 'work',
        deep: true,
        plannedMin: 90,
      })
    )
    expect(energyProfile(events, AGG, TODAY)).toBeNull()
  })

  it('is null until the realistic best is known (the shared capacity gate)', () => {
    const events = [...cell(MORNING, 'work', true, 6, 0), ...cell(EVENING, 'work', true, 6, 0)]
    expect(energyProfile(events, { ...AGG, realisticBestH: null }, TODAY)).toBeNull()
  })
})

describe('demonstratedDeepWindows — spread vs peak, never a textbook curve', () => {
  it('spreads across EVERY window when deep completion is flat across bands', () => {
    const events = [
      ...cell(MORNING, 'work', true, 4, 1),
      ...cell(MIDDAY, 'work', true, 4, 1),
      ...cell(LATE, 'work', true, 4, 1),
      ...cell(EVENING, 'work', true, 4, 1),
    ]
    const p = energyProfile(events, AGG, TODAY)!
    // morning/midday/late/evening bands → morning + afternoon + evening windows
    expect(demonstratedDeepWindows(p)).toEqual(['morning', 'afternoon', 'evening'])
  })

  it('leans to the one window that genuinely dominates', () => {
    const events = [
      ...cell(MORNING, 'work', true, 5, 0), // 1.0
      ...cell(MIDDAY, 'work', true, 1, 4), // 0.2
      ...cell(LATE, 'work', true, 1, 4), // 0.2
      ...cell(EVENING, 'work', true, 1, 4), // 0.2
    ]
    const p = energyProfile(events, AGG, TODAY)!
    expect(demonstratedDeepWindows(p)).toEqual(['morning'])
  })
})

describe('adminBatch — quick and dusted, one contiguous run', () => {
  it('clusters ≥2 low-focus items and reports the run length', () => {
    const b = adminBatch([
      { tag: 'work', durationMin: 120 }, // deep — excluded
      { tag: 'private', durationMin: 45 }, // admin
      { tag: 'work', durationMin: 30 }, // short work → admin
      { tag: 'health', durationMin: 60 }, // health — excluded
    ])
    expect(b).not.toBeNull()
    expect(b!.tasks.map((t) => t.durationMin)).toEqual([45, 30])
    expect(b!.totalMin).toBe(75)
  })

  it('returns null with fewer than two batchable items', () => {
    expect(
      adminBatch([
        { tag: 'private', durationMin: 45 },
        { tag: 'work', durationMin: 120 },
      ])
    ).toBeNull()
  })

  it('leaves due-bound and stated-window items out of the run (stated word wins)', () => {
    // only one item is freely batchable → nothing to cluster
    expect(
      adminBatch([
        { tag: 'private', durationMin: 30, due: 12 * 60 },
        { tag: 'private', durationMin: 30, window: 'afternoon' },
        { tag: 'private', durationMin: 30 },
      ])
    ).toBeNull()
  })

  it('classifies tasks by tag and the deep line', () => {
    expect(isDeepTask({ tag: 'work', durationMin: 60 })).toBe(true)
    expect(isDeepTask({ tag: 'work', durationMin: 45 })).toBe(false)
    expect(isAdminTask({ tag: 'work', durationMin: 45 })).toBe(true)
    expect(isAdminTask({ tag: 'private', durationMin: 120 })).toBe(true)
    expect(isAdminTask({ tag: 'health', durationMin: 30 })).toBe(false)
  })
})
