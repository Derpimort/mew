import { describe, expect, it } from 'vitest'
import { aggregates, heavyCarryWeeks } from '../memory'
import { project } from '../project'
import type { Block, MemoryEvent, RoutingMatrix } from '../types'
import { addDaysKey, dayKey } from '../time'

const TODAY = new Date(2026, 5, 9)
const todayKey = dayKey(TODAY)

let n = 0
function ev(over: Partial<MemoryEvent>): MemoryEvent {
  return { id: String(n++), ts: 0, kind: 'completed', dayKey: addDaysKey(todayKey, -1), ...over }
}

describe('memory — history informs', () => {
  it('realistic best is the trailing median of completed deep-work hours', () => {
    const events: MemoryEvent[] = []
    // 5 days: 5h, 5.5h, 6h, 5.5h, 4h of completed deep work
    const hours = [5, 5.5, 6, 5.5, 4]
    hours.forEach((h, i) => {
      events.push(ev({ dayKey: addDaysKey(todayKey, -(i + 1)), deep: true, plannedMin: h * 60 }))
    })
    expect(aggregates(events, TODAY).realisticBestH).toBe(5.5)
  })

  it('needs 3+ days of data before it claims a number', () => {
    const events = [ev({ deep: true, plannedMin: 300 })]
    expect(aggregates(events, TODAY).realisticBestH).toBeNull()
  })

  it('today’s completions don’t count yet — the day isn’t history until it ends', () => {
    const events = [
      ev({ dayKey: todayKey, deep: true, plannedMin: 600 }),
      ev({ dayKey: addDaysKey(todayKey, -1), deep: true, plannedMin: 300 }),
      ev({ dayKey: addDaysKey(todayKey, -2), deep: true, plannedMin: 300 }),
      ev({ dayKey: addDaysKey(todayKey, -3), deep: true, plannedMin: 300 }),
    ]
    expect(aggregates(events, TODAY).realisticBestH).toBe(5)
  })

  it('four heavy weeks trip the kinder-plan threshold', () => {
    const agg = {
      realisticBestH: 5,
      carryRatioByWeek: [0.31, 0.4, 0.35, 0.5],
      carryRatio: 0.5,
      restKeptRatio: 0.5,
      restSkippedStreak: 0,
    }
    expect(heavyCarryWeeks(agg)).toBe(true)
    expect(heavyCarryWeeks({ ...agg, carryRatioByWeek: [0.31, 0.1, 0.35, 0.5] })).toBe(false)
  })
})

describe('calendar projection — privacy routing (acceptance #6)', () => {
  const blocks: Block[] = [
    {
      id: 'w1',
      title: 'Q3 deck',
      tag: 'work',
      dayKey: todayKey,
      startMin: 540,
      endMin: 690,
      protected: true,
      status: 'open',
      calendarRefs: [],
      estimateSource: 'user',
    },
    {
      id: 'p1',
      title: 'Walk',
      tag: 'private',
      dayKey: todayKey,
      startMin: 960,
      endMin: 1020,
      protected: true,
      status: 'open',
      calendarRefs: [],
      estimateSource: 'user',
    },
    {
      id: 'h1',
      title: 'Dentist',
      tag: 'health',
      dayKey: todayKey,
      startMin: 720,
      endMin: 780,
      protected: true,
      status: 'open',
      calendarRefs: [],
      estimateSource: 'user',
    },
  ]
  const matrix: RoutingMatrix = {
    workCal: { work: 'details', private: 'busy', health: 'hidden' },
  }

  it('work calendar sees details for work, "Busy" for private, nothing for hidden health', () => {
    const out = project(blocks, matrix, 'workCal')
    expect(out).toHaveLength(2)
    expect(out.find((e) => e.blockId === 'w1')!.title).toBe('Q3 deck')
    const walk = out.find((e) => e.blockId === 'p1')!
    expect(walk.title).toBe('Busy') // the walk is yours; work sees only Busy
    expect(out.find((e) => e.blockId === 'h1')).toBeUndefined()
  })

  it('an unknown calendar sees nothing at all', () => {
    expect(project(blocks, matrix, 'nope')).toHaveLength(0)
  })
})
