/* The Focus dial on any day (#23 slice 1), pinned as pure logic: the day wash
   per case (today to now, a lived day full, a day ahead empty), today's words
   exactly as they were, the resting centre's summary (positive, all-day labels
   left out), and the geometry contract the whole slice rests on — a fixture day
   with overlapping, overnight, done and background blocks lays out on ANY day
   byte-for-byte as it would if that day were today. No DOM, no store. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../../../domain/types'
import { dayFill, dialFocusOrder, radiiFor, resolveLabels, visibleOrbit } from '../orbitGeometry'
import {
  dayLine,
  daySummary,
  daySummaryLine,
  dayTitle,
  dialAriaLabel,
  spokenDay,
  stepDay,
  washMinute,
} from '../dialDay'

const TODAY = '2026-09-16' // a Wednesday

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'X',
    tag: 'work',
    dayKey: TODAY,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

describe('washMinute — the day wash, per case', () => {
  it('today fills to the now notch (unchanged)', () => {
    expect(washMinute(TODAY, TODAY, 580)).toBe(580)
    expect(dayFill(washMinute(TODAY, TODAY, 580))).toEqual(dayFill(580))
  })

  it('a lived day is full; a day ahead is empty', () => {
    expect(dayFill(washMinute('2026-09-15', TODAY, 580))).toEqual({ inner: 360, outer: 360 })
    expect(dayFill(washMinute('2026-09-17', TODAY, 580))).toEqual({ inner: 0, outer: 0 })
    // across month and year edges, by calendar key
    expect(washMinute('2025-12-31', TODAY, 580)).toBe(1440)
    expect(washMinute('2026-10-01', TODAY, 580)).toBe(0)
  })
})

describe("today's words are exactly what they were", () => {
  it('the date line matches the live clock’s own format', () => {
    const now = new Date(2026, 8, 16, 9, 40)
    const clockLine = `Wed · ${now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    expect(dayLine(TODAY)).toBe(clockLine)
  })

  it('the dial’s accessible name on today is unchanged; another day names itself', () => {
    expect(dialAriaLabel(TODAY, TODAY)).toBe("focus dial: 12-hour clock showing today's tasks")
    expect(dialAriaLabel('2026-09-15', TODAY)).toBe(
      `focus dial: 12-hour clock showing the tasks for ${spokenDay('2026-09-15')}`
    )
    expect(spokenDay('2026-09-15')).toMatch(/^Tuesday, \S+ 15$/)
  })

  it('the steps reach the day before and after, across month edges', () => {
    expect(stepDay(TODAY, -1)).toBe('2026-09-15')
    expect(stepDay('2026-09-30', 1)).toBe('2026-10-01')
    expect(dayTitle('2026-09-15')).toBe('Tuesday, Sep 15')
  })
})

describe('daySummary — the resting centre off today', () => {
  it('counts timed blocks, mews and committed hours; all-day labels, optional and background time stay out', () => {
    const day = '2026-09-15'
    const blocks = [
      mk({ dayKey: day, startMin: 540, endMin: 660, status: 'done' }), // 2h, a mew
      mk({ dayKey: day, startMin: 780, endMin: 840 }), // 1h
      mk({ dayKey: day, startMin: 900, endMin: 960, optional: true }), // counts, holds no time
      mk({ dayKey: day, startMin: 600, endMin: 780, attention: 'background' }), // counts, holds the clock
      mk({ dayKey: day, startMin: 0, endMin: 0, allDay: true, title: 'Holiday' }), // a label, not a block
      mk({ dayKey: day, status: 'rolled' }), // moved on
      mk({ dayKey: TODAY }), // another day
    ]
    const s = daySummary(blocks, day)
    expect(s).toEqual({ blocks: 4, mews: 1, committedMin: 180 })
    expect(daySummaryLine(s)).toBe('4 blocks · 3h committed · 1 mew')
  })

  it('positive voice: an empty day is clear, a day with nothing done names no shortfall', () => {
    expect(daySummaryLine(daySummary([], TODAY))).toBe('a clear day — nothing on the books')
    const line = daySummaryLine(daySummary([mk({})], TODAY))
    expect(line).toBe('1 block · 1h committed')
    expect(line).not.toMatch(/missed|failed|behind|overdue|0 mews/i)
  })
})

describe('any day lays out exactly as today would', () => {
  /* overlapping work, an overnight carry, a done marker, a background block,
     and an all-day label that must stay off the ring */
  const fixture = (day: string): Block[] => [
    mk({ id: 'deep', dayKey: day, startMin: 540, endMin: 690, title: 'Deep work' }),
    mk({ id: 'sync', dayKey: day, startMin: 600, endMin: 630, title: 'Sync' }),
    mk({ id: 'done', dayKey: day, startMin: 480, endMin: 510, status: 'done', title: 'Standup' }),
    mk({
      id: 'bg',
      dayKey: day,
      startMin: 780,
      endMin: 960,
      attention: 'background',
      title: 'Restore',
    }),
    mk({ id: 'late', dayKey: day, startMin: 22 * 60, endMin: 26 * 60, title: 'Deploy' }),
    mk({ id: 'rest', dayKey: day, startMin: 720, endMin: 780, tag: 'rest', title: 'Lunch' }),
    mk({ id: 'hol', dayKey: day, startMin: 0, endMin: 0, allDay: true, title: 'Holiday' }),
  ]
  const layout = (day: string) => {
    const vis = visibleOrbit(fixture(day), day, 9.5)
    const radii = radiiFor(vis, null, 9.5)
    const labels = resolveLabels(
      vis.filter((b) => b.status === 'open'),
      radii
    )
    return {
      ids: vis.map((b) => b.id),
      radii: [...radii],
      labels: [...labels],
      order: dialFocusOrder(vis),
    }
  }

  it('a past, a future and a far day match today byte for byte', () => {
    const today = JSON.stringify(layout(TODAY))
    for (const day of ['2026-09-15', '2026-09-17', '2027-02-28']) {
      expect(JSON.stringify(layout(day))).toBe(today)
    }
    expect(layout(TODAY).ids).not.toContain('hol')
    expect(layout(TODAY).ids).toHaveLength(6)
  })
})
