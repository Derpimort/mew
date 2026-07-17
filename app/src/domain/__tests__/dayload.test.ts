/* The honest day-load meter (#301) — pure pins. Throughput is demonstrated,
   never hoped (median of lived days, under a #287-grade floor); the line is
   kindness voice; the trim chip's reply is phrased against ruleParse's REAL
   grammar and pinned against it here, where it is produced. */

import { describe, expect, it } from 'vitest'
import type { Block, MemoryEvent } from '../types'
import type { MemoryAggregates } from '../memory'
import { addDaysKey } from '../time'
import { parseCommand } from '../parse'
import { NUDGES, type NudgeCtx } from '../nudges/library'
import {
  DAY_LOAD_GIVE,
  dayLoadAria,
  dayLoadAssessment,
  dayLoadFiredKey,
  dayLoadLevel,
  dayThroughputMin,
  trimMove,
} from '../insights'

const TODAY = '2026-06-09' // a Tuesday
const NOW = new Date('2026-06-09T08:00:00')

const agg = (over: Partial<MemoryAggregates> = {}): MemoryAggregates => ({
  realisticBestH: 4,
  carryRatioByWeek: [],
  carryRatio: 0,
  restKeptRatio: null,
  restSkippedStreak: 0,
  ...over,
})

let seq = 0
function completed(
  dayKey: string,
  plannedMin: number,
  over: Partial<MemoryEvent> = {}
): MemoryEvent {
  return {
    id: `e${seq++}`,
    ts: new Date(dayKey + 'T17:00:00').getTime(),
    kind: 'completed',
    dayKey,
    tag: 'work',
    plannedMin,
    deep: plannedMin >= 60,
    ...over,
  }
}

/** N lived days ending yesterday, each `minPerDay` of completed work split
    into a deep block and a shallow one (two outcomes per day). */
function livedDays(n: number, minPerDay = 300): MemoryEvent[] {
  const out: MemoryEvent[] = []
  for (let i = 1; i <= n; i++) {
    const k = addDaysKey(TODAY, -i)
    out.push(completed(k, minPerDay - 60), completed(k, 60))
  }
  return out
}

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? `b${seq++}`,
    title: 'Budget model',
    tag: 'work',
    dayKey: addDaysKey(TODAY, 1),
    startMin: 9 * 60,
    endMin: 12 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

describe('dayThroughputMin — demonstrated, never hoped', () => {
  it('is the median of per-day completed work minutes over the lived days', () => {
    expect(dayThroughputMin(livedDays(15), agg(), TODAY)).toBe(300)
  })

  it('reads only the most recent ~14 lived days inside the 28-day window', () => {
    /* 14 recent days at 300 + an older heavy outlier: the outlier is beyond
       the 14 lived days and must not move the median */
    const events = [...livedDays(14), completed(addDaysKey(TODAY, -20), 600)]
    expect(dayThroughputMin(events, agg(), TODAY)).toBe(300)
  })

  it('excludes today (still being lived) and non-work completions', () => {
    const events = [
      ...livedDays(15),
      completed(TODAY, 480), // today's own throughput is not yet demonstrated
      completed(addDaysKey(TODAY, -1), 480, { tag: 'private' }), // a walk is not work throughput
    ]
    expect(dayThroughputMin(events, agg(), TODAY)).toBe(300)
  })

  it('holds the #287-grade floor: <10 outcomes, or <3 distinct days, → null', () => {
    expect(dayThroughputMin(livedDays(4), agg(), TODAY)).toBeNull() // 8 outcomes
    const twoDays = [
      ...Array.from({ length: 6 }, () => completed(addDaysKey(TODAY, -1), 60)),
      ...Array.from({ length: 6 }, () => completed(addDaysKey(TODAY, -2), 60)),
    ]
    expect(dayThroughputMin(twoDays, agg(), TODAY)).toBeNull()
  })

  it('never knows "your usual" before the realistic best does (coherent claims)', () => {
    expect(dayThroughputMin(livedDays(15), agg({ realisticBestH: null }), TODAY)).toBeNull()
  })
})

describe('dayLoadAssessment — one day against the line', () => {
  const tomorrow = addDaysKey(TODAY, 1)

  it('is null under the data floor: no meter, no tint, no claims', () => {
    expect(dayLoadAssessment([block({})], tomorrow, null)).toBeNull()
  })

  it('speaks the kindness line with halves voice and flags over past the give', () => {
    const blocks = [
      block({ startMin: 9 * 60, endMin: 13 * 60 }), // 240
      block({ id: 'b2', title: 'Spec draft — deep work', startMin: 14 * 60, endMin: 17 * 60 }), // 180
    ]
    const a = dayLoadAssessment(blocks, tomorrow, 300)!
    expect(a).toMatchObject({ plannedMin: 420, throughputMin: 300, over: true })
    expect(a.line).toBe(`that's 7h of work against your usual 5 — want me to keep it kind?`)
  })

  it('speaks halves as ½ — the median has no finer digits', () => {
    const a = dayLoadAssessment(
      [block({ startMin: 9 * 60, endMin: 15 * 60 + 30 })], // 390
      tomorrow,
      330
    )!
    expect(a.line).toBe(`that's 6½h of work against your usual 5½ — want me to keep it kind?`)
  })

  it('under the line (within the give) is not over — silence is law upstream', () => {
    const a = dayLoadAssessment(
      [block({ startMin: 9 * 60, endMin: 9 * 60 + Math.round(300 * DAY_LOAD_GIVE) })],
      tomorrow,
      300
    )!
    expect(a.over).toBe(false) // exactly at the line: not past it
  })

  it('counts work only — optional holds no time, background holds no user, rest is rest', () => {
    const blocks = [
      block({}),
      block({ id: 'o', optional: true, startMin: 13 * 60, endMin: 17 * 60 }),
      block({ id: 'g', attention: 'background', startMin: 13 * 60, endMin: 17 * 60 }),
      block({ id: 'r', tag: 'rest', startMin: 17 * 60, endMin: 18 * 60 }),
    ]
    expect(dayLoadAssessment(blocks, tomorrow, 300)!.plannedMin).toBe(180)
  })

  it('voice pin: the meter never says overloaded / behind / too much', () => {
    const a = dayLoadAssessment([block({ startMin: 8 * 60, endMin: 18 * 60 })], tomorrow, 300)!
    expect(a.over).toBe(true)
    for (const text of [a.line, dayLoadAria(a)]) {
      expect(text).not.toMatch(/\b(overloaded|behind|too much|missed|failed|overdue)\b/i)
    }
  })
})

describe('dayLoadLevel — the tint is a pinnable step, relative to the OWN line', () => {
  it('grades quiet → filling → near the usual → past the line', () => {
    expect(dayLoadLevel(0, 300)).toBe(0)
    expect(dayLoadLevel(150, 300)).toBe(0) // half a usual day is quiet
    expect(dayLoadLevel(180, 300)).toBe(1)
    expect(dayLoadLevel(255, 300)).toBe(2)
    expect(dayLoadLevel(345, 300)).toBe(2) // at the line, not past it — matches `over`
    expect(dayLoadLevel(346, 300)).toBe(3)
  })

  it('is 0 whenever throughput is unknowable — the floor tints nothing', () => {
    expect(dayLoadLevel(600, null)).toBe(0)
  })
})

describe('dayLoadAria — the label carries the hours the wash only hints', () => {
  it('speaks both numbers', () => {
    const a = dayLoadAssessment(
      [block({ startMin: 9 * 60, endMin: 13 * 60 })],
      addDaysKey(TODAY, 1),
      330
    )!
    expect(dayLoadAria(a)).toBe('holds 4h of work — your usual is 5½h')
  })
})

describe('trimMove — the one honest keyless trim', () => {
  const tomorrow = addDaysKey(TODAY, 1) // Wednesday
  const overDay = [
    block({ id: 'spec', title: 'Spec draft — deep work', startMin: 9 * 60, endMin: 13 * 60 }), // 240
    block({ id: 'budget', startMin: 14 * 60, endMin: 17 * 60 }), // Budget model, 180
  ]

  it('prefers the smallest block that covers the whole excess, onto the lightest weekday', () => {
    const t = trimMove(overDay, tomorrow, TODAY, 8 * 60, 300)! // excess 120
    expect(t.blockId).toBe('budget')
    expect(t.toDayKey).toBe(addDaysKey(TODAY, 2)) // Thursday, empty
    expect(t.reply).toBe('move the Budget model to thursday')
  })

  it('…and that reply IS the floor grammar: ruleParse executes it verbatim', () => {
    const intent = parseCommand('move the Budget model to thursday', NOW)
    expect(intent).toMatchObject({ kind: 'move', query: 'budget model', toDayKey: '2' })
    expect(intent.toStartMin).toBeUndefined() // the executor finds clear air
  })

  it("the keep chip's reply parses as plain chat — inert on the floor by construction", () => {
    expect(parseCommand('ok, keep it as planned', NOW)).toMatchObject({ kind: 'chat' })
  })

  it('skips what is not MEW\'s to move: fixed, external, background, ambiguous, " to "-titled', () => {
    const blocks = [
      block({ id: 'sync', title: 'Design sync', startMin: 9 * 60, endMin: 13 * 60 }), // fixed words
      block({
        id: 'ext',
        title: 'Offsite',
        startMin: 13 * 60,
        endMin: 15 * 60,
        external: { calId: 'c', eventId: 'e' },
      }),
      block({
        id: 'bg',
        title: 'Long export',
        startMin: 9 * 60,
        endMin: 15 * 60,
        attention: 'background',
      }),
      block({ id: 'reply', title: 'Reply to Sam', startMin: 15 * 60, endMin: 17 * 60 }), // " to " breaks the move grammar
      block({ id: 'twin', title: 'Budget model', startMin: 17 * 60, endMin: 18 * 60 }),
      block({
        id: 'twin2',
        title: 'Budget model',
        dayKey: addDaysKey(TODAY, 3),
        startMin: 9 * 60,
        endMin: 10 * 60,
      }), // twin base elsewhere → ambiguous
    ]
    expect(trimMove(blocks, tomorrow, TODAY, 8 * 60, 300)).toBeNull()
  })

  it('falls back to the largest partial trim when nothing covers the excess', () => {
    const blocks = [
      block({
        id: 'ext',
        title: 'All-hands',
        startMin: 8 * 60,
        endMin: 14 * 60,
        external: { calId: 'c', eventId: 'e' },
      }), // 360 immovable
      block({ id: 'notes', title: 'Board notes', startMin: 15 * 60, endMin: 16 * 60 + 30 }), // 90 movable < excess 150
    ]
    const t = trimMove(blocks, tomorrow, TODAY, 8 * 60, 300)!
    expect(t.blockId).toBe('notes')
    expect(t.reply).toBe('move the Board notes to thursday')
  })

  it('never lands on a weekend — moving work there is louder, not kinder', () => {
    /* today Thursday: tomorrow Friday is the over day; Sat/Sun are the only
       empty near days but must be skipped for Monday */
    const thu = '2026-06-11'
    const fri = addDaysKey(thu, 1)
    const blocks = [
      block({
        id: 'spec',
        title: 'Spec draft — deep work',
        dayKey: fri,
        startMin: 9 * 60,
        endMin: 13 * 60,
      }),
      block({ id: 'budget', dayKey: fri, startMin: 14 * 60, endMin: 17 * 60 }),
    ]
    const t = trimMove(blocks, fri, thu, 8 * 60, 300)!
    expect(t.toDayKey).toBe('2026-06-15') // Monday
    expect(t.reply).toBe('move the Budget model to monday')
  })

  it('never pushes the target past its own line, and needs real clear air', () => {
    /* every weekday in the horizon already sits at the line → nothing honest */
    const busy = Array.from({ length: 6 }, (_, i) =>
      block({
        id: `d${i}`,
        title: `Held work ${i}`,
        dayKey: addDaysKey(TODAY, i + 1),
        startMin: 9 * 60,
        endMin: 9 * 60 + 330,
      })
    )
    const over = [
      block({
        id: 'spec',
        title: 'Spec draft — deep work',
        startMin: 14 * 60 + 30,
        endMin: 18 * 60 + 30,
      }),
    ]
    expect(trimMove([...busy, ...over], tomorrow, TODAY, 8 * 60, 300)).toBeNull()
  })

  it("today's over day only offers blocks still ahead of the clock", () => {
    const blocks = [
      block({
        id: 'gone',
        dayKey: TODAY,
        title: 'Morning push',
        startMin: 8 * 60,
        endMin: 12 * 60,
      }),
      block({
        id: 'ahead',
        dayKey: TODAY,
        title: 'Board notes',
        startMin: 15 * 60,
        endMin: 17 * 60,
      }),
    ]
    const t = trimMove(blocks, TODAY, TODAY, 13 * 60, 300)!
    expect(t.blockId).toBe('ahead')
  })
})

describe('the right-size nudge defers to the meter (#301 · one guard voice per day per day)', () => {
  const rightSize = NUDGES.find((n) => n.id === 'right-size')!
  const ctx = (lastFired: NudgeCtx['lastFired']): NudgeCtx =>
    ({
      heavyDay: { dayKey: addDaysKey(TODAY, 1), plannedH: 8 },
      todayKey: TODAY,
      lastFired,
    }) as unknown as NudgeCtx

  it('fires on a heavy day the meter has not spoken about', () => {
    expect(rightSize.trigger(ctx({}))).toBe(true)
  })

  it('yields when the meter spoke for that day today', () => {
    const key = dayLoadFiredKey(addDaysKey(TODAY, 1))
    expect(rightSize.trigger(ctx({ [key]: { ts: 1, key: TODAY } }))).toBe(false)
  })

  it('speaks again on a new day — the deferral is per calendar day, like the meter', () => {
    const key = dayLoadFiredKey(addDaysKey(TODAY, 1))
    expect(rightSize.trigger(ctx({ [key]: { ts: 1, key: addDaysKey(TODAY, -1) } }))).toBe(true)
  })
})
