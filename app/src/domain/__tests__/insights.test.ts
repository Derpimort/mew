import { describe, expect, it } from 'vitest'
import { computeInsights, dayDebrief, delegationCandidates, prefContradictions, proposeKinderPlan, taskDurations, weekReview } from '../insights'
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

describe('delegationCandidates — co-occurrence with receipts', () => {
  const NOW = TODAY.getTime()
  const LINK = { from: 'task/doc-review', to: 'person/robin' }
  /* 3 shared runs + 1 solo inside the window */
  const shared = (daysAgo: number) =>
    ev({ title: 'Doc review — Robin', dayKey: addDaysKey(todayKey, -daysAgo) })
  const solo = (daysAgo: number) => ev({ title: 'Doc review', dayKey: addDaysKey(todayKey, -daysAgo) })

  it('a pair with ≥3 shared runs, a solo run, and a graph edge is a candidate', () => {
    const events = [shared(2), shared(7), shared(12), solo(4)]
    const out = delegationCandidates(events, [LINK], NOW)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ taskKind: 'doc-review', person: 'robin', personLabel: 'Robin', count: 3 })
    expect(out[0].label).toBe('doc review')
  })

  it('two shared runs are coincidence, not a pattern', () => {
    expect(delegationCandidates([shared(2), shared(7), solo(4)], [LINK], NOW)).toHaveLength(0)
  })

  it('the 28-day window holds: old runs do not count', () => {
    const events = [shared(2), shared(7), shared(35), solo(4)] // third run aged out
    expect(delegationCandidates(events, [LINK], NOW)).toHaveLength(0)
  })

  it('without a solo run the thread is already theirs — no candidate', () => {
    expect(delegationCandidates([shared(2), shared(7), shared(12)], [LINK], NOW)).toHaveLength(0)
  })

  it('no graph edge, no receipts, no candidate — counts alone are not enough', () => {
    const events = [shared(2), shared(7), shared(12), solo(4)]
    expect(delegationCandidates(events, [], NOW)).toHaveLength(0)
    expect(delegationCandidates(events, [{ from: 'task/doc-review', to: 'week/2026-06-08' }], NOW)).toHaveLength(0)
  })

  it('multiple candidates sort by count, multi-word people get proper labels', () => {
    const events = [
      shared(2), shared(7), shared(12), solo(4),
      ev({ title: 'Sprint notes — Dana K', dayKey: addDaysKey(todayKey, -1) }),
      ev({ title: 'Sprint notes — Dana K', dayKey: addDaysKey(todayKey, -3) }),
      ev({ title: 'Sprint notes — Dana K', dayKey: addDaysKey(todayKey, -5) }),
      ev({ title: 'Sprint notes — Dana K', dayKey: addDaysKey(todayKey, -8) }),
      ev({ title: 'Sprint notes', dayKey: addDaysKey(todayKey, -6) }),
    ]
    const links = [LINK, { from: 'task/sprint-notes', to: 'person/dana-k' }]
    const out = delegationCandidates(events, links, NOW)
    expect(out.map((c) => c.person)).toEqual(['dana-k', 'robin'])
    expect(out[0].personLabel).toBe('Dana K')
    expect(out[0].count).toBe(4)
  })
})

describe('dayDebrief — the evening story, two kind lines', () => {
  const D = todayKey
  let bn = 0
  const blk = (over: Partial<Block>): Block => ({
    id: `b${bn++}`,
    title: 'X',
    tag: 'work',
    dayKey: D,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  })
  /* completion at hh:mm today (ts carries the slip signal) */
  const done = (title: string, endMin: number, atH: number, atM: number): MemoryEvent => {
    const d = new Date(D + 'T00:00:00')
    d.setHours(atH, atM, 0, 0)
    return { id: `e${bn++}`, ts: d.getTime(), kind: 'completed', dayKey: D, title, endMin, plannedMin: 60 }
  }
  it('mews, the biggest slip, rest held, and a heavy tomorrow — the full story', () => {
    const blocks = [
      blk({ tag: 'rest', startMin: 18 * 60, endMin: 19 * 60 }), // running at 18:15
      blk({ dayKey: addDaysKey(D, 1), title: 'Spec review — deep work', startMin: 8 * 60, endMin: 12 * 60 }),
      blk({ dayKey: addDaysKey(D, 1), title: 'Deck v2 — deep work', startMin: 13 * 60, endMin: 17 * 60 }),
    ]
    const events = [
      done('Q3 deck — deep work', 11 * 60 + 30, 11, 30), // on time
      done('Reply to Sam', 15 * 60, 15, 40), // +40
      done('Standup', 12 * 60, 12, 15), // +15 (smaller slip)
    ]
    const lines = dayDebrief(blocks, events, D, { realisticBestH: 5.5 } as never, 18 * 60 + 15)
    expect(lines).toEqual([
      '3 mews; the reply to sam slipped 40 past its window; rest held.',
      'tomorrow opens heavy — 8h against your 5.5.',
    ])
  })

  it('an empty day stays silent', () => {
    expect(dayDebrief([], [], D, { realisticBestH: 5.5 } as never, 18 * 60)).toEqual([])
  })

  it('rest still open and not reached = owed, kindly; a light tomorrow is named plainly', () => {
    const blocks = [
      blk({ tag: 'rest', startMin: 20 * 60, endMin: 21 * 60 }), // later tonight
      blk({ dayKey: addDaysKey(D, 1), title: 'Review — deep work', startMin: 9 * 60, endMin: 11 * 60 }),
    ]
    const events = [done('Inbox', 10 * 60, 10, 0)]
    const lines = dayDebrief(blocks, events, D, { realisticBestH: 5.5 } as never, 18 * 60 + 15)
    expect(lines[0]).toBe('1 mew; rest is still owed tonight.')
    expect(lines[1]).toBe('tomorrow holds 2h of deep work.')
  })

  it('checked off much later ≠ worked later: the +300 cap holds, and rolled days omit tomorrow', () => {
    const events = [done('Old thing', 9 * 60, 18, 0)] // +540 → not a slip
    const lines = dayDebrief([blk({ status: 'done' })], events, D, { realisticBestH: null } as never, 18 * 60 + 15)
    expect(lines).toEqual(['1 mew.'])
    expect(lines.join(' ')).not.toMatch(/slipped/)
  })

  it('no shame vocabulary, ever', () => {
    const blocks = [blk({ tag: 'rest', startMin: 12 * 60, endMin: 13 * 60, status: 'rolled' })]
    const events = [done('Deploy', 14 * 60, 14, 50)]
    const lines = dayDebrief(blocks, events, D, { realisticBestH: 5.5 } as never, 18 * 60 + 15)
    expect(lines.join('\n')).not.toMatch(/missed|overdue|failed|behind/i)
    expect(lines[0]).toContain('slipped 50')
  })
})

describe('weekReview — last week, one honest line', () => {
  /* last week relative to Wednesday TODAY: Jun 1–7 */
  const LAST = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07']
  const on = (day: string, over: Partial<MemoryEvent>): MemoryEvent =>
    ev({ dayKey: day, ...over })

  it('mews, carry, the band that held, and the top eater — exact line', () => {
    const events = [
      /* 7 morning completions of the same deep block (9:00 start, 5h) */
      ...LAST.slice(0, 5).map((d) =>
        on(d, { title: 'Deep work', startMin: 9 * 60, plannedMin: 300 }),
      ),
      on(LAST[0], { title: 'Inbox sweep', startMin: 15 * 60 + 30, plannedMin: 45 }),
      on(LAST[1], { title: 'Inbox sweep', startMin: 15 * 60 + 30, plannedMin: 45 }),
      /* 3 rolls late in the day */
      ...LAST.slice(2, 5).map((d) =>
        on(d, { kind: 'rolled', title: 'Inbox sweep', startMin: 15 * 60 + 30, plannedMin: 45 }),
      ),
    ]
    const r = weekReview(events, LAST)
    expect(r.lines).toEqual(['last week: 7 mews, carry-over 30%, mornings held 5/5, deep work ate 25h.'])
    expect(r.kinder).toBe(false) // exactly 30 is not past 30
  })

  it('carry past 30% asks for a kinder shape', () => {
    const events = [
      on(LAST[0], { title: 'A', plannedMin: 60 }),
      on(LAST[1], { kind: 'rolled' }),
      on(LAST[2], { kind: 'rolled' }),
    ]
    const r = weekReview(events, LAST)
    expect(r.kinder).toBe(true)
    expect(r.lines[0]).toContain('carry-over 67%')
  })

  it('an empty week stays empty — week one makes no claims', () => {
    expect(weekReview([], LAST)).toEqual({ lines: [], kinder: false })
    /* events exist but outside the window */
    const r = weekReview([ev({ dayKey: todayKey, title: 'X' })], LAST)
    expect(r.lines).toEqual([])
  })

  it('thin bands and small eaters stay unnamed — claims need evidence', () => {
    const events = [
      on(LAST[0], { title: 'A', startMin: 9 * 60, plannedMin: 30 }),
      on(LAST[1], { title: 'B', startMin: 9 * 60, plannedMin: 45 }),
    ]
    const r = weekReview(events, LAST)
    expect(r.lines[0]).toBe('last week: 2 mews, carry-over 0%.')
  })

  it('brain color rides as one extra line, never more', () => {
    const events = [on(LAST[0], { title: 'A', plannedMin: 60 })]
    const r = weekReview(events, LAST, ['debrief: tuesday ran hot', 'debrief: wednesday calm'])
    expect(r.lines).toHaveLength(2)
    expect(r.lines[1]).toBe('debrief: tuesday ran hot')
  })
})

describe('taskDurations — what this task REALLY takes', () => {
  const NOW = TODAY.getTime()
  /* a completion whose stamp implies the actual span */
  const took = (daysAgo: number, title: string, startMin: number, actualMin: number, plannedMin = 60): MemoryEvent => {
    const day = addDaysKey(todayKey, -daysAgo)
    const d = new Date(day + 'T00:00:00')
    d.setMinutes(startMin + actualMin)
    return { id: `t${daysAgo}-${actualMin}`, ts: d.getTime(), kind: 'completed', dayKey: day, title, startMin, plannedMin }
  }

  it('three sane completions yield the actual median, not the plan', () => {
    const events = [
      took(2, 'Interview prep', 9 * 60, 40),
      took(5, 'Interview prep', 9 * 60, 35),
      took(9, 'Interview prep', 9 * 60, 50),
    ]
    expect(taskDurations(events, NOW).get('interview prep')).toEqual({ median: 40, n: 3 })
  })

  it('two data points are an anecdote — n<3 never qualifies', () => {
    const events = [took(2, 'Prep', 9 * 60, 40), took(5, 'Prep', 9 * 60, 40)]
    expect(taskDurations(events, NOW).has('prep')).toBe(false)
  })

  it('an insane stamp falls back to the plan (checked off at night ≠ a 9-hour task)', () => {
    const events = [
      took(2, 'Prep', 9 * 60, 40),
      took(5, 'Prep', 9 * 60, 40),
      took(9, 'Prep', 9 * 60, 9 * 60, 45), // +540 past a 45m plan → plan stands in
    ]
    expect(taskDurations(events, NOW).get('prep')).toEqual({ median: 40, n: 3 })
  })

  it('the 8-week window holds, and even counts average the middles', () => {
    const events = [
      took(2, 'Prep', 9 * 60, 30),
      took(5, 'Prep', 9 * 60, 40),
      took(9, 'Prep', 9 * 60, 50),
      took(12, 'Prep', 9 * 60, 60),
      took(60, 'Prep', 9 * 60, 200), // aged out
    ]
    expect(taskDurations(events, NOW).get('prep')).toEqual({ median: 45, n: 4 })
  })

  it('the em-dash detail half never splits the kind', () => {
    const events = [
      took(2, 'Interview prep — Mira', 9 * 60, 40),
      took(5, 'Interview prep — panel', 9 * 60, 40),
      took(9, 'Interview prep', 9 * 60, 40),
    ]
    expect(taskDurations(events, NOW).get('interview prep')?.n).toBe(3)
  })
})
