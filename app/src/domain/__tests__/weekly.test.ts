/* The weekly planning ritual (#304) — the Sunday invite's composer, the
   keyless task defaults, and the engine gate (Sunday-only, once per ISO week
   via the persisted weekKey). Same harness shape as engine.test.ts. */

import { describe, expect, it } from 'vitest'
import { buildCtx, evaluateTick, type TickInputs } from '../nudges/engine'
import { composeWeeklyRitual, ritualTasks } from '../nudges/weekly'
import { computeInsights } from '../insights'
import type { Block } from '../types'
import type { MemoryAggregates } from '../memory'

/** Sunday, June 14 2026 — its ISO week's Monday is June 8. */
const SUN = '2026-06-14'
const WEEK_KEY = '2026-06-08'

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Q3 deck — deep work',
    tag: 'work',
    dayKey: SUN,
    startMin: 9 * 60,
    endMin: 11.5 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

const agg: MemoryAggregates = {
  realisticBestH: 5.5,
  carryRatioByWeek: [0.1, 0.1, 0.1, 0.1],
  carryRatio: 0.1,
  restKeptRatio: 0.9,
  restSkippedStreak: 0,
}

function tick(over: Partial<TickInputs>): TickInputs {
  return {
    nowMs: Date.UTC(2026, 5, 14, 17, 0),
    nowMin: 17 * 60,
    todayKey: SUN,
    blocks: [],
    agg,
    idleMin: 0,
    interruptionsLastHour: 0,
    guardUntilMin: null,
    weeklyRitualMin: 17 * 60,
    ...over,
  }
}

const fresh = { lastFired: {}, lastDriftBlockId: null }
const noInsights = computeInsights([], agg, new Date(Date.UTC(2026, 5, 14)))

describe('the weekly ritual gate (engine)', () => {
  it('fires on Sunday at the set time — one chip, the persisted weekKey', () => {
    const out = evaluateTick(buildCtx(tick({}), fresh))
    expect(out[0]?.type).toBe('weekly-ritual')
    expect(out[0].key).toBe(WEEK_KEY)
    expect(out[0].actions).toEqual([{ id: 'plan', label: 'plan my week', kind: 'primary' }])
    expect(out[0].body).toMatch(/shape the coming week/)
  })

  it('stays silent before its time, and on any day that is not Sunday', () => {
    const early = evaluateTick(buildCtx(tick({ nowMin: 16 * 60 + 59 }), fresh))
    expect(early.some((n) => n.type === 'weekly-ritual')).toBe(false)
    const saturday = evaluateTick(
      buildCtx(tick({ todayKey: '2026-06-13', nowMs: Date.UTC(2026, 5, 13, 17, 0) }), fresh)
    )
    expect(saturday.some((n) => n.type === 'weekly-ritual')).toBe(false)
  })

  it("this week's persisted key holds it silent — a restart cannot re-fire it", () => {
    const out = evaluateTick(
      buildCtx(tick({}), {
        lastFired: { 'weekly-ritual': { ts: Date.UTC(2026, 5, 14, 17, 0), key: WEEK_KEY } },
        lastDriftBlockId: null,
      })
    )
    expect(out.some((n) => n.type === 'weekly-ritual')).toBe(false)
  })

  it("LAST week's key does not hold this week — once per ISO week, not once ever", () => {
    const out = evaluateTick(
      buildCtx(tick({}), {
        lastFired: { 'weekly-ritual': { ts: Date.UTC(2026, 5, 7, 17, 0), key: '2026-06-01' } },
        lastDriftBlockId: null,
      })
    )
    expect(out[0]?.type).toBe('weekly-ritual')
  })

  it('no weeklyRitualMin ⇒ silent — the same no-theater degradation as the dailies', () => {
    const out = evaluateTick(buildCtx(tick({ weeklyRitualMin: undefined }), fresh))
    expect(out.some((n) => n.type === 'weekly-ritual')).toBe(false)
  })
})

describe('composeWeeklyRitual', () => {
  const comingWeek = [
    mk({
      title: 'Interview with Pooran',
      dayKey: '2026-06-15',
      startMin: 10 * 60,
      endMin: 11 * 60,
    }),
    mk({ title: '1:1 with Dana', dayKey: '2026-06-17', startMin: 13 * 60, endMin: 13.5 * 60 }),
    mk({ title: 'Roadmap draft — deep work', dayKey: '2026-06-16' }), // flexible: not counted
  ]

  it('names the coming week’s fixed load and the invitation', () => {
    const { body } = composeWeeklyRitual(comingWeek, SUN, noInsights)
    expect(body).toMatch(/^sunday — want to shape the coming week/)
    expect(body).toMatch(/two fixed meetings already hold their spots/)
    expect(body).toMatch(/you pick the shape/)
  })

  it('a clean calendar is a clean page — and best hours ride in when known', () => {
    const { body } = composeWeeklyRitual([], SUN, noInsights)
    expect(body).toMatch(/clean page/)
    const withBest = composeWeeklyRitual([], SUN, {
      ...noInsights,
      bestBand: { band: 'morning', label: 'mornings', attempted: 10, completed: 9, rate: 0.9 },
    })
    expect(withBest.body).toMatch(/in your mornings/)
  })

  it('speaks positively — no verdict vocabulary anywhere', () => {
    const { body } = composeWeeklyRitual(comingWeek, SUN, noInsights)
    expect(body).not.toMatch(/missed|failed|behind|overdue/i)
  })
})

describe('ritualTasks — the keyless defaults', () => {
  it('captures lead (their own words), habits follow, anchors fill — deterministic', () => {
    const tasks = ritualTasks({
      realisticBestH: 5.5,
      captures: ['Call the accountant', 'Draft the offsite plan'],
      prefs: [
        { kind: 'time-default', match: 'gym', value: 'starts 07:00', stated: 'gym is always 7am' },
        { kind: 'flexibility', match: 'standup', value: 'never moves', stated: 'standup is fixed' },
      ],
    })
    expect(tasks.map((t) => t.title)).toEqual([
      'Call the accountant',
      'Draft the offsite plan',
      'Gym', // the time-default habit, capitalized; the flexibility rule is not a task
      'Deep work I',
      'Deep work II',
      'Deep work III',
      'Deep work IV', // 5.5h realistic best ⇒ four 90-min anchors
    ])
    expect(tasks.find((t) => t.title === 'Gym')?.tag).toBe('private')
    expect(tasks.filter((t) => /^Deep work/.test(t.title)).every((t) => t.durationMin === 90)).toBe(
      true
    )
    /* distinct BASE titles by construction — the picker's byte-exact apply
       must never fold two places into one move (#89 de-dup is base+day) */
    const bases = tasks.map((t) => t.title.split('—')[0].trim().toLowerCase())
    expect(new Set(bases).size).toBe(bases.length)
  })

  it('cold start still proposes a plannable week: two anchors minimum', () => {
    const tasks = ritualTasks({ realisticBestH: null, captures: [], prefs: [] })
    expect(tasks).toEqual([
      { title: 'Deep work I', tag: 'work', durationMin: 90 },
      { title: 'Deep work II', tag: 'work', durationMin: 90 },
    ])
  })

  it('a capture already naming a habit wins the slot — no doubled task', () => {
    const tasks = ritualTasks({
      realisticBestH: 3,
      captures: ['gym'],
      prefs: [
        { kind: 'time-default', match: 'gym', value: 'starts 07:00', stated: 'gym is always 7am' },
      ],
    })
    expect(tasks.filter((t) => t.title.toLowerCase() === 'gym')).toHaveLength(1)
  })
})
