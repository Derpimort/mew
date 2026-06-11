import { describe, expect, it } from 'vitest'
import { pixieInputs } from '../pixie'
import type { MemoryAggregates } from '../memory'

const healthyAgg: MemoryAggregates = {
  realisticBestH: 5.5,
  carryRatioByWeek: [0.1, 0.1, 0.1, 0.1],
  carryRatio: 0.1,
  restKeptRatio: 0.9,
  restSkippedStreak: 0,
}

describe('Pixie — condition mirrors sustainability, never volume (acceptance #7)', () => {
  it('a sustainable plan keeps her healthy regardless of how MANY tasks exist', () => {
    // 4 hours of deep work against a 5.5h realistic best — sustainable.
    // pixieInputs has no task-count parameter at all; that is the point.
    const few = pixieInputs({ plannedDeepTodayH: 4, agg: healthyAgg, dayClear: false, nudgeWaiting: false })
    const many = pixieInputs({ plannedDeepTodayH: 4, agg: healthyAgg, dayClear: false, nudgeWaiting: false })
    expect(few.mood).toBe('healthy')
    expect(many.mood).toBe('healthy')
    expect(few.pace).toBe(many.pace)
  })

  it('chronic overload + carry-over + skipped rest wears her down', () => {
    const strained = pixieInputs({
      plannedDeepTodayH: 9,
      agg: {
        realisticBestH: 5.5,
        carryRatioByWeek: [0.35, 0.4, 0.32, 0.38],
        carryRatio: 0.38,
        restKeptRatio: 0.3,
        restSkippedStreak: 3,
      },
      dayClear: false,
      nudgeWaiting: false,
    })
    expect(strained.mood).toBe('rundown')
    expect(strained.pace).toBeLessThan(0.4)
  })

  it('moderate strain reads as drowsy — an invitation, not a verdict', () => {
    const mid = pixieInputs({
      plannedDeepTodayH: 7, // 1.27× realistic best
      agg: { ...healthyAgg, carryRatio: 0.2, restKeptRatio: 0.6 },
      dayClear: false,
      nudgeWaiting: false,
    })
    expect(mid.mood).toBe('drowsy')
  })

  it('a clear day rests her; pace stays in [0,1]', () => {
    const p = pixieInputs({ plannedDeepTodayH: 0, agg: healthyAgg, dayClear: true, nudgeWaiting: false })
    expect(p.resting).toBe(true)
    expect(p.pace).toBeGreaterThanOrEqual(0)
    expect(p.pace).toBeLessThanOrEqual(1)
  })
})
