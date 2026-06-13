import { describe, expect, it } from 'vitest'
import { computeInsights, prefContradictions, proposeKinderPlan } from '../insights'
import { aggregates, consolidate } from '../memory'
import { findFreeSlot } from '../week'
import type { Block, MemoryEvent } from '../types'
import { addDaysKey, dayKey } from '../time'
import type { PrefPayload } from '../types'

const TODAY = new Date(2026, 5, 10) // Wednesday
const todayKey = dayKey(TODAY)

let n = 0
function ev(over: Partial<MemoryEvent>): MemoryEvent {
  const day = over.dayKey ?? addDaysKey(todayKey, -1)
  const d = new Date(day + 'T12:00:00')
  return { id: String(n++), ts: d.getTime(), kind: 'completed', dayKey: day, ...over }
}

/** Two weeks of texture: mornings hold, late slips, "inbox sweep" rolls, +20min lateness. */
function richHistory(): MemoryEvent[] {
  const events: MemoryEvent[] = []
  for (let i = 1; i <= 14; i++) {
    const day = addDaysKey(todayKey, -i)
    const dow = (new Date(day + 'T12:00:00').getDay() + 6) % 7
    if (dow >= 5) continue // weekdays only
    const end = 9 * 60 + 330
    const doneAt = new Date(day + 'T00:00:00')
    doneAt.setMinutes(end + 20)
    events.push(
      ev({
        dayKey: day,
        ts: doneAt.getTime(),
        kind: 'completed',
        plannedMin: 330,
        deep: true,
        title: 'Deep work',
        startMin: 9 * 60,
        endMin: end,
      }),
    )
    events.push(
      ev({
        dayKey: day,
        kind: dow <= 1 ? 'completed' : 'rolled',
        plannedMin: 45,
        title: 'Inbox sweep',
        startMin: 15 * 60 + 30,
        endMin: 16 * 60 + 15,
      }),
    )
    if (dow >= 2) {
      const dr = new Date(day + 'T15:40:00')
      events.push(ev({ dayKey: day, ts: dr.getTime(), kind: 'drift' }))
    }
    events.push(ev({ dayKey: day, kind: 'rest_kept' }))
  }
  return events
}

describe('GBrain insights — patterns from the user’s own history', () => {
  const events = richHistory()
  const agg = aggregates(events, TODAY)
  const ins = computeInsights(events, agg, TODAY)

  it('finds where follow-through lives: mornings hold, late afternoons slip', () => {
    expect(ins.bestBand?.band).toBe('morning')
    expect(ins.bestBand?.rate).toBe(1)
    expect(ins.worstBand?.band).toBe('late')
    expect(ins.worstBand!.rate!).toBeLessThan(0.5)
    expect(ins.lines.join(' ')).toMatch(/mornings hold/)
  })

  it('names chronic rollers with their count', () => {
    expect(ins.chronicRollers[0]).toMatchObject({ title: 'inbox sweep' })
    expect(ins.chronicRollers[0].rolls).toBeGreaterThanOrEqual(2)
    expect(ins.lines.join(' ')).toMatch(/inbox sweep.*rolled forward/)
  })

  it('measures completion lateness and implies a booking correction', () => {
    expect(ins.latenessMin).toBeGreaterThanOrEqual(15)
    expect(ins.estimateFactor).toBeGreaterThan(1)
    expect(ins.lines.join(' ')).toMatch(/min past their end/)
  })

  it('spots where drift clusters', () => {
    expect(ins.driftBand).toBe('late')
  })

  it('says nothing it cannot back: thin history → no band/lateness claims', () => {
    const thin = events.slice(0, 3)
    const tIns = computeInsights(thin, aggregates(thin, TODAY), TODAY)
    expect(tIns.bestBand).toBeNull()
    expect(tIns.latenessMin).toBeNull()
  })
})

describe('the kinder plan, made concrete', () => {
  function mk(over: Partial<Block>): Block {
    return {
      id: over.id ?? String(n++),
      title: 'Deep work',
      tag: 'work',
      dayKey: addDaysKey(todayKey, 1),
      startMin: 9 * 60,
      endMin: 12 * 60,
      protected: true,
      status: 'open',
      calendarRefs: [],
      estimateSource: 'user',
      ...over,
    }
  }

  it('moves overflow off heavy days onto the lightest days with room', () => {
    const tomorrow = addDaysKey(todayKey, 1)
    const blocks = [
      mk({ id: 'a', dayKey: tomorrow, startMin: 8 * 60, endMin: 12 * 60, title: 'Spec — deep work' }),
      mk({ id: 'b', dayKey: tomorrow, startMin: 13 * 60, endMin: 17 * 60, title: 'Build — deep work' }),
      mk({ id: 'c', dayKey: tomorrow, startMin: 17 * 60, endMin: 18 * 60 + 30, title: 'Review — deep work' }),
    ]
    const agg = { realisticBestH: 5, carryRatioByWeek: [], carryRatio: 0, restKeptRatio: null, restSkippedStreak: 0 }
    const { moves, summary } = proposeKinderPlan(blocks, agg, todayKey, findFreeSlot)
    expect(moves.length).toBeGreaterThanOrEqual(1)
    /* the moved blocks land on later, lighter days */
    for (const m of moves) {
      expect(m.toDayKey > m.fromDayKey).toBe(true)
    }
    expect(summary).toContain('→')
  })

  it('proposes nothing when the week is already kind', () => {
    const blocks = [mk({ id: 'a', startMin: 9 * 60, endMin: 12 * 60 })]
    const agg = { realisticBestH: 5, carryRatioByWeek: [], carryRatio: 0, restKeptRatio: null, restSkippedStreak: 0 }
    expect(proposeKinderPlan(blocks, agg, todayKey, findFreeSlot).moves).toHaveLength(0)
  })
})

describe('overnight consolidation — the brain compacts while you sleep', () => {
  it('compacts events older than 8 weeks into weekly summaries, keeps recent raw', () => {
    const recent = ev({ dayKey: addDaysKey(todayKey, -7), kind: 'completed', plannedMin: 60 })
    const old1 = ev({ dayKey: addDaysKey(todayKey, -70), kind: 'completed', plannedMin: 300, deep: true })
    const old2 = ev({ dayKey: addDaysKey(todayKey, -70), kind: 'rolled' })
    const old3 = ev({ dayKey: addDaysKey(todayKey, -69), kind: 'rest_kept' })
    const out = consolidate([recent, old1, old2, old3], TODAY, () => `s${n++}`)
    expect(out.removedIds).toHaveLength(3)
    expect(out.summaries).toHaveLength(1)
    expect(out.summaries[0].kind).toBe('weekly_summary')
    expect(out.summaries[0].summary).toMatchObject({ completed: 1, rolled: 1, restKept: 1, deepMin: 300 })
    expect(out.kept).toContain(recent)
    /* aggregates are unaffected by consolidation (they only read recent raw) */
    expect(aggregates(out.kept, TODAY).realisticBestH).toEqual(aggregates([recent, old1, old2, old3], TODAY).realisticBestH)
  })

  it('is idempotent — summaries never re-consolidate', () => {
    const old = ev({ dayKey: addDaysKey(todayKey, -70), kind: 'completed' })
    const first = consolidate([old], TODAY, () => `s${n++}`)
    const second = consolidate(first.kept, TODAY, () => `s${n++}`)
    expect(second.removedIds).toHaveLength(0)
    expect(second.kept).toEqual(first.kept)
  })

  it('preferences are state, not history — a 90-day-old rule survives compaction intact', () => {
    const pref = ev({
      dayKey: addDaysKey(todayKey, -90),
      kind: 'preference',
      pref: { kind: 'time-default', match: 'gym', value: 'starts 07:00', stated: 'gym is always 7am' },
    })
    const old = ev({ dayKey: addDaysKey(todayKey, -90), kind: 'completed' })
    const out = consolidate([pref, old], TODAY, () => `s${n++}`)
    expect(out.kept).toContain(pref) // the brain-off rulebook never ages out
    expect(out.removedIds).toEqual([old.id]) // ordinary history still compacts
    expect(out.summaries[0].summary).toMatchObject({ completed: 1 }) // and the summary ignores prefs
  })
})

describe('prefContradictions — rules reality has outgrown', () => {
  const TODAY = new Date(2026, 5, 9, 12, 0)
  const gymRule: PrefPayload = { kind: 'time-default', match: 'gym', value: 'starts 07:00', stated: 'gym is always 7am' }
  const deployRule: PrefPayload = { kind: 'duration-default', match: 'deploy', value: '45m', stated: 'deploys take 45' }

  const done = (title: string, dayOffset: number, startMin: number, endMin?: number): MemoryEvent => ({
    id: Math.random().toString(36).slice(2),
    ts: 0,
    kind: 'completed',
    dayKey: addDaysKey('2026-06-09', dayOffset),
    title,
    startMin,
    endMin: endMin ?? startMin + 60,
  })

  it('two misses stay silent; the third fires with the median observed', () => {
    const twice = [done('Gym', -1, 18 * 60), done('Gym', -2, 18 * 60 + 30)]
    expect(prefContradictions([gymRule], twice, TODAY)).toHaveLength(0)
    const thrice = [...twice, done('Gym', -3, 19 * 60)]
    const out = prefContradictions([gymRule], thrice, TODAY)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ count: 3, observed: 'starts 18:30' })
  })

  it('the 60-minute threshold is a real edge: 59 off is conforming, 60 contradicts', () => {
    const near = [done('Gym', -1, 7 * 60 + 59), done('Gym', -2, 7 * 60 + 59), done('Gym', -3, 7 * 60 + 59)]
    expect(prefContradictions([gymRule], near, TODAY)).toHaveLength(0)
    const edge = [done('Gym', -1, 8 * 60), done('Gym', -2, 8 * 60), done('Gym', -3, 8 * 60)]
    expect(prefContradictions([gymRule], edge, TODAY)).toHaveLength(1)
  })

  it('pref-driven placements cannot self-confirm: at-rule completions never count', () => {
    const conforming = [done('Gym', -1, 7 * 60), done('Gym', -2, 7 * 60), done('Gym', -3, 7 * 60), done('Gym', -4, 7 * 60)]
    expect(prefContradictions([gymRule], conforming, TODAY)).toHaveLength(0)
  })

  it('duration: ±25% is the line, three times over it fires with the median', () => {
    const close = [done('Deploy api', -1, 600, 600 + 55), done('Deploy api', -2, 600, 600 + 55), done('Deploy api', -3, 600, 600 + 55)]
    expect(prefContradictions([deployRule], close, TODAY)).toHaveLength(0) // 55m is within 25% of 45m
    const over = [done('Deploy api', -1, 600, 600 + 90), done('Deploy api', -2, 600, 600 + 80), done('Deploy api', -3, 600, 600 + 85)]
    const out = prefContradictions([deployRule], over, TODAY)
    expect(out).toHaveLength(1)
    expect(out[0].observed).toBe('85m')
  })

  it('the window is 14 days: ancient deviations are forgotten', () => {
    const old = [done('Gym', -15, 18 * 60), done('Gym', -16, 18 * 60), done('Gym', -17, 18 * 60)]
    expect(prefContradictions([gymRule], old, TODAY)).toHaveLength(0)
  })

  it('validation reads the rulebook with placement’s grammar: "starts 7am" values and punctuated titles are visible', () => {
    /* both forms are applied at placement (prefs.ts); the old local parsers
       dropped them — a rule could be enforced yet invisible to validation */
    const sevenAm: PrefPayload = { kind: 'time-default', match: 'stand up', value: 'starts 7am', stated: 'standup is at 7' }
    const lived = [done('Stand-up', -1, 18 * 60), done('Stand-up', -2, 18 * 60), done('Stand-up', -3, 18 * 60)]
    const out = prefContradictions([sevenAm], lived, TODAY)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ count: 3, observed: 'starts 18:00' })
  })
})
