/* Circadian meal anchors (#298, v0.5 plan 16a). The live RC transcript this
   pins: "lunch's at 15:30–16:15, dinner at 17:00–18:00, and two snack breaks
   tucked in — 14:30–14:45 and 16:30–16:45" — meals landing in whatever free
   air scored best because the scheduler had no concept of a meal. These
   tests pin the recognizer, the windows, the adjacency term, and the
   scoreSlots seam every placement path inherits. */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SUSTENANCE_MEALS, type Block, type PrefPayload } from '../types'
import { generateScenarios } from '../scenarios'
import { scoreSlots, type ScoreWeights, type SlotQuery } from '../scheduler'
import {
  MEAL_WINDOWS,
  mealAdjacencyPenalty,
  mealClassOf,
  mealWindowFor,
  scaffoldDay,
  scaffoldLine,
  type MealWindow,
  type ScaffoldPlacement,
} from '../sustenance'

const D = '2026-06-09' // Tuesday
const NOW = 8 * 60 // 08:00 — the working-day start

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
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
  } as Block
}

const inAny = (wins: readonly MealWindow[], c: { startMin: number; endMin: number }) =>
  wins.some((w) => c.startMin >= w.startMin && c.endMin <= w.endMin)

/** run the scorer, take its top pick, and materialise it as a placed block —
    the same shape execPlan's deterministic floor follows */
function placeTop(
  blocks: Block[],
  q: SlotQuery,
  prefs: PrefPayload[] = []
): { top: { dayKey: string; startMin: number; endMin: number }; block: Block } {
  const top = scoreSlots(blocks, q, D, NOW, prefs)[0]
  const block = mk({
    title: q.title,
    tag: q.tag,
    dayKey: top.dayKey,
    startMin: top.startMin,
    endMin: top.endMin,
  })
  return { top, block }
}

describe('sustenance — mealClassOf (head-anchored recognizer)', () => {
  it('classifies the whole base and head-anchored phrasings', () => {
    expect(mealClassOf('lunch')).toBe('lunch')
    expect(mealClassOf('Lunch with Sam')).toBe('lunch')
    expect(mealClassOf('Lunch — with Sam')).toBe('lunch')
    expect(mealClassOf('  Lunch  ')).toBe('lunch')
    expect(mealClassOf('Dinner?')).toBe('dinner')
    expect(mealClassOf('BREAKFAST')).toBe('breakfast')
    expect(mealClassOf('brunch')).toBe('breakfast')
    expect(mealClassOf('supper with folks')).toBe('dinner')
    expect(mealClassOf('Snack break')).toBe('snack')
  })

  it('"order lunch" is an errand, not the meal — non-head words never classify', () => {
    expect(mealClassOf('order lunch')).toBeNull()
    expect(mealClassOf('team lunch')).toBeNull()
    expect(mealClassOf('prep dinner ingredients')).toBeNull()
  })

  it('only explicit meal words — coffee/tea/break stay out; word boundaries hold', () => {
    expect(mealClassOf('coffee')).toBeNull()
    expect(mealClassOf('coffee break')).toBeNull()
    expect(mealClassOf('tea with mentor')).toBeNull()
    expect(mealClassOf('break')).toBeNull()
    expect(mealClassOf('lunchbox shopping')).toBeNull()
    expect(mealClassOf('breakfasting')).toBeNull()
  })

  it('is total — empty, whitespace, punctuation, numbers all return null, never throw', () => {
    expect(mealClassOf('')).toBeNull()
    expect(mealClassOf('   ')).toBeNull()
    expect(mealClassOf('— detail only')).toBeNull()
    expect(mealClassOf('12:30 things')).toBeNull()
  })
})

describe('sustenance — MEAL_WINDOWS & mealWindowFor (defaults, pref recenter)', () => {
  it('carries the research-grounded defaults', () => {
    expect(MEAL_WINDOWS.breakfast).toEqual([{ startMin: 7 * 60, endMin: 9 * 60 + 30 }])
    expect(MEAL_WINDOWS.lunch).toEqual([{ startMin: 12 * 60, endMin: 14 * 60 }])
    expect(MEAL_WINDOWS.dinner).toEqual([{ startMin: 18 * 60 + 30, endMin: 20 * 60 + 30 }])
    expect(MEAL_WINDOWS.snack).toEqual([
      { startMin: 10 * 60, endMin: 11 * 60 + 30 },
      { startMin: 15 * 60, endMin: 16 * 60 + 30 },
    ])
  })

  it('no matching pref (or no parseable time) means the defaults', () => {
    expect(mealWindowFor('lunch')).toEqual(MEAL_WINDOWS.lunch)
    const gym: PrefPayload = {
      kind: 'time-default',
      match: 'gym',
      value: 'starts 07:00',
      stated: 'gym is 7am',
    }
    const fact: PrefPayload = {
      kind: 'fact',
      match: 'lunch',
      value: 'is light',
      stated: 'lunch is light',
    }
    const vague: PrefPayload = {
      kind: 'time-default',
      match: 'lunch',
      value: 'earlyish',
      stated: 'lunch earlyish',
    }
    expect(mealWindowFor('lunch', [gym, fact, vague])).toEqual(MEAL_WINDOWS.lunch)
  })

  it('a time-default pref naming the class recenters the window, same width', () => {
    const pref: PrefPayload = {
      kind: 'time-default',
      match: 'lunch',
      value: 'starts 15:00',
      stated: 'lunch starts 15:00',
    }
    expect(mealWindowFor('lunch', [pref])).toEqual([{ startMin: 14 * 60, endMin: 16 * 60 }])
  })

  it('a snack pref recenters only the nearest window; the other stays', () => {
    const pref: PrefPayload = {
      kind: 'time-default',
      match: 'snack',
      value: 'at 3pm',
      stated: 'snack at 3pm',
    }
    expect(mealWindowFor('snack', [pref])).toEqual([
      { startMin: 10 * 60, endMin: 11 * 60 + 30 },
      { startMin: 14 * 60 + 15, endMin: 15 * 60 + 45 },
    ])
  })

  it('a recentered window stays inside the day, width kept', () => {
    const late: PrefPayload = {
      kind: 'time-default',
      match: 'dinner',
      value: 'starts 23:30',
      stated: 'dinner at 23:30',
    }
    expect(mealWindowFor('dinner', [late])).toEqual([{ startMin: 22 * 60, endMin: 24 * 60 }])
    const early: PrefPayload = {
      kind: 'time-default',
      match: 'breakfast',
      value: 'starts 00:30',
      stated: 'breakfast at 00:30',
    }
    expect(mealWindowFor('breakfast', [early])).toEqual([{ startMin: 0, endMin: 150 }])
  })

  it('the pref match goes through the recognizer — "brunch" shifts breakfast, "order lunch" shifts nothing', () => {
    const brunch: PrefPayload = {
      kind: 'time-default',
      match: 'brunch',
      value: 'starts 10:00',
      stated: 'brunch at 10',
    }
    expect(mealWindowFor('breakfast', [brunch])).toEqual([
      { startMin: 8 * 60 + 45, endMin: 11 * 60 + 15 },
    ])
    const errand: PrefPayload = {
      kind: 'time-default',
      match: 'order lunch',
      value: 'starts 11:00',
      stated: 'order lunch at 11',
    }
    expect(mealWindowFor('lunch', [errand])).toEqual(MEAL_WINDOWS.lunch)
  })
})

describe('sustenance — mealAdjacencyPenalty', () => {
  const lunchBlock = mk({ title: 'Lunch', tag: 'private', startMin: 12 * 60, endMin: 13 * 60 })

  it('clear air scores 1; crowding collapses linearly to 0', () => {
    expect(mealAdjacencyPenalty('dinner', 18 * 60 + 30, [lunchBlock])).toBe(1) // 5.5h after
    expect(mealAdjacencyPenalty('dinner', 15 * 60, [lunchBlock])).toBe(0.5) // 2h of 4h
    expect(mealAdjacencyPenalty('dinner', 13 * 60, [lunchBlock])).toBe(0) // right at lunch end
    expect(mealAdjacencyPenalty('dinner', 12 * 60 + 30, [lunchBlock])).toBe(0) // inside its extent
  })

  it('breakfast/lunch pair uses the ~2.5h gap, measured in either direction', () => {
    const bfast = mk({ title: 'Breakfast', tag: 'private', startMin: 8 * 60, endMin: 8 * 60 + 30 })
    expect(mealAdjacencyPenalty('lunch', 10 * 60, [bfast])).toBe(0.6) // 90 of 150
    expect(mealAdjacencyPenalty('breakfast', 9 * 60, [lunchBlock])).toBe(1) // 3h before lunch starts
    expect(mealAdjacencyPenalty('breakfast', 11 * 60, [lunchBlock])).toBeCloseTo(60 / 150)
  })

  it('unpaired classes are exempt: snacks, same-class, and non-meal blocks', () => {
    const snack = mk({
      title: 'Snack',
      tag: 'private',
      startMin: 13 * 60 + 30,
      endMin: 13 * 60 + 45,
    })
    const work = mk({ title: 'Deep work', startMin: 13 * 60, endMin: 18 * 60 })
    expect(mealAdjacencyPenalty('dinner', 14 * 60, [snack, work])).toBe(1)
    expect(mealAdjacencyPenalty('lunch', 13 * 60 + 15, [lunchBlock])).toBe(1) // same class: not this term's job
  })

  it('rolled meal blocks moved away and no longer count', () => {
    const rolled = mk({
      title: 'Lunch',
      tag: 'private',
      status: 'rolled',
      startMin: 12 * 60,
      endMin: 13 * 60,
    })
    expect(mealAdjacencyPenalty('dinner', 14 * 60, [rolled])).toBe(1)
  })
})

describe('scheduler seam — the quoted-transcript regression pin (free day)', () => {
  it('free Tuesday: lunch 12:00–14:00, dinner 18:30–20:30 and ≥4h after lunch, snacks in their windows', () => {
    let blocks: Block[] = []
    const lunch = placeTop(blocks, { title: 'Lunch', tag: 'private', durationMin: 45 })
    expect(lunch.top.dayKey).toBe(D)
    expect(inAny(MEAL_WINDOWS.lunch, lunch.top)).toBe(true)
    expect(lunch.top.startMin).toBe(12 * 60) // the window's leading edge on an empty day
    blocks = [...blocks, lunch.block]

    const dinner = placeTop(blocks, { title: 'Dinner', tag: 'private', durationMin: 60 })
    expect(dinner.top.dayKey).toBe(D)
    expect(inAny(MEAL_WINDOWS.dinner, dinner.top)).toBe(true)
    expect(dinner.top.startMin - lunch.top.endMin).toBeGreaterThanOrEqual(4 * 60)
    blocks = [...blocks, dinner.block]

    const snack1 = placeTop(blocks, { title: 'Snack', tag: 'private', durationMin: 15 })
    expect(inAny(MEAL_WINDOWS.snack, snack1.top)).toBe(true)
    blocks = [...blocks, snack1.block]
    const snack2 = placeTop(blocks, { title: 'Snack', tag: 'private', durationMin: 15 })
    expect(inAny(MEAL_WINDOWS.snack, snack2.top)).toBe(true)

    // the transcript's shape cannot reproduce: no 15:30 lunch, no 17:00 dinner
    expect(lunch.top.endMin).toBeLessThanOrEqual(14 * 60)
    expect(dinner.top.startMin).toBeGreaterThanOrEqual(18 * 60 + 30)
  })

  it('dinner reaches past the working-day cap into its own window (18:30+)', () => {
    const top = scoreSlots([], { title: 'Dinner', tag: 'private', durationMin: 60 }, D, NOW)[0]
    expect(top.startMin).toBeGreaterThanOrEqual(18 * 60 + 30)
    expect(top.endMin).toBeLessThanOrEqual(20 * 60 + 30)
  })

  it('off-window candidates stay listed with a non-zero score — biased, never excluded', () => {
    const ranked = scoreSlots([], { title: 'Lunch', tag: 'private', durationMin: 60 }, D, NOW)
    const off = ranked.filter((c) => c.dayKey === D && !inAny(MEAL_WINDOWS.lunch, c))
    expect(off.length).toBeGreaterThan(0)
    for (const c of off) {
      expect(c.score).toBeGreaterThan(0)
      expect(c.score).toBeLessThan(ranked[0].score)
    }
  })

  it('breakfast lands inside its window even with the day starting 8:00', () => {
    const top = scoreSlots([], { title: 'Breakfast', tag: 'private', durationMin: 30 }, D, NOW)[0]
    expect(inAny(MEAL_WINDOWS.breakfast, top)).toBe(true)
    expect(top.startMin).toBe(8 * 60)
  })

  it('a busy mid-morning sends a snack to the mid-afternoon window', () => {
    const busy = mk({ title: 'Deep work', startMin: 8 * 60, endMin: 12 * 60 })
    const top = scoreSlots(
      [busy],
      { title: 'Snack', tag: 'private', durationMin: 15 },
      D,
      NOW
    ).find((c) => c.dayKey === D)!
    expect(top.startMin).toBe(15 * 60)
  })
})

describe('scheduler seam — packed noon (hard preference, never a hard wall)', () => {
  const packed = [
    mk({ title: 'Deep work', startMin: 8 * 60, endMin: 11 * 60 + 30 }),
    mk({ title: 'Meetings', startMin: 11 * 60 + 30, endMin: 14 * 60 + 30 }),
  ]

  it('with the whole window held, the best same-day lunch is off-window and still returned', () => {
    const ranked = scoreSlots(packed, { title: 'Lunch', tag: 'private', durationMin: 60 }, D, NOW)
    const today = ranked.filter((c) => c.dayKey === D)
    expect(today.length).toBeGreaterThan(0)
    const best = today[0]
    expect(inAny(MEAL_WINDOWS.lunch, best)).toBe(false)
    expect(best.startMin).toBeGreaterThanOrEqual(14 * 60 + 30) // the only air left today
    expect(best.score).toBeGreaterThan(0) // near-zero beats zero — never excluded
    expect(best.why).toContain('outside the usual lunch window')
  })

  it('an off-window pick is never preferred while in-window air exists', () => {
    const lighter = [mk({ title: 'Meetings', startMin: 11 * 60 + 30, endMin: 13 * 60 })]
    const best = scoreSlots(
      lighter,
      { title: 'Lunch', tag: 'private', durationMin: 60 },
      D,
      NOW
    ).find((c) => c.dayKey === D)!
    expect(inAny(MEAL_WINDOWS.lunch, best)).toBe(true)
    expect(best.startMin).toBe(13 * 60)
  })

  it('adjacency keeps dinner a real stretch after a forced 14:30 lunch', () => {
    const lateLunch = mk({
      title: 'Lunch',
      tag: 'private',
      startMin: 14 * 60 + 30,
      endMin: 15 * 60 + 30,
    })
    const ranked = scoreSlots(
      [...packed, lateLunch],
      { title: 'Dinner', tag: 'private', durationMin: 60 },
      D,
      NOW
    )
    const best = ranked.find((c) => c.dayKey === D)!
    expect(inAny(MEAL_WINDOWS.dinner, best)).toBe(true)
    expect(best.startMin - lateLunch.endMin).toBeGreaterThanOrEqual(4 * 60)
    // the too-close 18:30 slot is still offered, named, and outranked
    const crowded = ranked.find((c) => c.dayKey === D && c.startMin === 18 * 60 + 30)!
    expect(crowded.why).toContain('close to another meal')
    expect(crowded.score).toBeLessThan(best.score)
  })
})

describe("scheduler seam — the user's word outranks the default", () => {
  it('a remembered "lunch starts 15:00" shifts the window and the placement follows', () => {
    const prefs: PrefPayload[] = [
      { kind: 'time-default', match: 'lunch', value: 'starts 15:00', stated: 'lunch starts 15:00' },
    ]
    const top = scoreSlots(
      [],
      { title: 'Lunch', tag: 'private', durationMin: 60 },
      D,
      NOW,
      prefs
    )[0]
    expect(top.startMin).toBe(15 * 60)
    expect(top.why).toContain('matches your rule')
  })

  it('an explicit window in the ask disengages the class default entirely', () => {
    const meal: SlotQuery = { title: 'Lunch', tag: 'private', durationMin: 60, window: 'evening' }
    const control: SlotQuery = {
      title: 'Errands',
      tag: 'private',
      durationMin: 60,
      window: 'evening',
    }
    const mealRanked = scoreSlots([], meal, D, NOW)
    expect(mealRanked[0].startMin).toBeGreaterThanOrEqual(17 * 60) // the stated evening, un-crushed
    expect(mealRanked[0].score).toBeGreaterThanOrEqual(0.8)
    expect(mealRanked).toEqual(scoreSlots([], control, D, NOW)) // byte-identical to any non-meal ask
  })
})

describe('scheduler seam — non-meal scoring is byte-identical', () => {
  it('"order lunch" scores exactly like any other errand, free day and busy day', () => {
    const errand: SlotQuery = { title: 'order lunch', tag: 'private', durationMin: 30 }
    const control: SlotQuery = { title: 'water the plants', tag: 'private', durationMin: 30 }
    expect(scoreSlots([], errand, D, NOW)).toEqual(scoreSlots([], control, D, NOW))
    const busy = [mk({ title: 'AM mtg', startMin: 10 * 60, endMin: 11 * 60 })]
    expect(scoreSlots(busy, errand, D, NOW)).toEqual(scoreSlots(busy, control, D, NOW))
  })

  it('work-titled queries keep their morning default and full-range candidates', () => {
    const ranked = scoreSlots([], { title: 'deep work', tag: 'work', durationMin: 60 }, D, NOW)
    expect(ranked[0].startMin).toBeLessThan(12 * 60)
    expect(ranked[0].why).toContain('morning fit')
    // the widened meal horizon never leaks: non-meal candidates end by DAY_END
    for (const c of ranked) expect(c.endMin).toBeLessThanOrEqual(18 * 60 + 30)
  })
})

describe('scheduler seam — plan-mode inheritance and determinism', () => {
  /* Two pins, two layers: the profile sweep proves the anchor survives ANY
     ScoreWeights a scenario could choose (it rides the total, not a weight);
     the engine pin runs the REAL 15a generateScenarios (#295) — whose
     'front-loaded' earliest bias reads clock order, not scores, and without
     the meal narrowing in choose() front-loaded lunch to 9:30. */
  it('the real 15a engine anchors a braindump lunch in-window in every scenario, earliest bias included', () => {
    let n = 0
    const scenarios = generateScenarios(
      [],
      [
        { title: 'Deck draft', tag: 'work', durationMin: 90 },
        { title: 'Lunch', tag: 'private', durationMin: 60 },
        { title: 'Errands', tag: 'private', durationMin: 30 },
      ],
      { nowMin: NOW, todayKey: D, horizonDays: 6, ids: () => `s${n++}` }
    )
    expect(scenarios.length).toBeGreaterThan(0)
    // the clock-order bias is the path that bypassed scores — it must be exercised
    expect(scenarios.some((s) => s.name === 'front-loaded')).toBe(true)
    for (const s of scenarios) {
      const lunch = s.places.find((p) => p.title === 'Lunch')
      expect(lunch).toBeDefined()
      expect(
        inAny(MEAL_WINDOWS.lunch, {
          startMin: lunch!.startMin,
          endMin: lunch!.startMin + lunch!.durationMin,
        })
      ).toBe(true)
    }
  })

  it('every weight profile a scenario could choose keeps a braindump lunch in-window', () => {
    const day = [mk({ title: 'Deck draft', startMin: 9 * 60, endMin: 10 * 60 + 30 })]
    const profiles: ScoreWeights[] = [
      { timeOfDay: 0.4, rest: 0.35, preference: 0.25 },
      { timeOfDay: 0.6, rest: 0.2, preference: 0.2 },
      { timeOfDay: 0.2, rest: 0.6, preference: 0.2 },
      { timeOfDay: 0.2, rest: 0.2, preference: 0.6 },
    ]
    for (const weights of profiles) {
      const best = scoreSlots(
        day,
        { title: 'Lunch', tag: 'private', durationMin: 60 },
        D,
        NOW,
        [],
        weights
      ).find((c) => c.dayKey === D)!
      expect(inAny(MEAL_WINDOWS.lunch, best)).toBe(true)
    }
  })

  it('meal ranking is deterministic and keyless, scores in [0,1]', () => {
    const blocks = [mk({ title: 'Lunch', tag: 'private', startMin: 12 * 60, endMin: 13 * 60 })]
    const q: SlotQuery = { title: 'Dinner', tag: 'private', durationMin: 60 }
    const a = scoreSlots(blocks, q, D, NOW)
    const b = scoreSlots(blocks, q, D, NOW)
    expect(a).toEqual(b)
    expect(a.every((c) => c.score >= 0 && c.score <= 1)).toBe(true)
  })
})

/* ── the standing day-scaffold (#299, v0.5 plan 16b) ─────────────────── */

describe('sustenance — scaffoldDay (the standing day-scaffold, #299)', () => {
  const MEALS = DEFAULT_SUSTENANCE_MEALS
  const meals = (out: ScaffoldPlacement[]) => out.filter((p) => p.tag !== 'rest')
  const rests = (out: ScaffoldPlacement[]) => out.filter((p) => p.tag === 'rest')

  it('Settings defaults ARE the circadian anchors — one home, pinned equal', () => {
    expect([{ startMin: MEALS.lunch.startMin, endMin: MEALS.lunch.endMin }]).toEqual(
      MEAL_WINDOWS.lunch
    )
    expect([{ startMin: MEALS.dinner.startMin, endMin: MEALS.dinner.endMin }]).toEqual(
      MEAL_WINDOWS.dinner
    )
    expect(MEALS.lunch.durationMin).toBe(45)
    expect(MEALS.dinner.durationMin).toBe(60)
  })

  it('an empty day gains lunch + dinner in their windows — unprotected private, today only', () => {
    const out = scaffoldDay([], D, { meals: MEALS, nowMin: NOW })
    expect(out.map((p) => p.title)).toEqual(['Lunch', 'Dinner'])
    const [lunch, dinner] = out
    expect(lunch).toMatchObject({
      tag: 'private',
      dayOffset: 0,
      startMin: 12 * 60,
      durationMin: 45,
      protected: false,
    })
    expect(dinner).toMatchObject({
      tag: 'private',
      dayOffset: 0,
      startMin: 18 * 60 + 30,
      durationMin: 60,
      protected: false,
    })
    // deterministic and pure — the same day always scaffolds the same
    expect(scaffoldDay([], D, { meals: MEALS, nowMin: NOW })).toEqual(out)
  })

  it('a day already holding a lunch-class block gains only dinner — done or titled long, still a lunch', () => {
    const seeded = mk({
      title: 'Lunch, away from screen',
      tag: 'private',
      startMin: 13 * 60,
      endMin: 13 * 60 + 45,
      status: 'done',
    })
    const out = scaffoldDay([seeded], D, { meals: MEALS, nowMin: NOW })
    expect(meals(out).map((p) => p.title)).toEqual(['Dinner'])
  })

  it('a rolled lunch moved away — the day is unfed and gains a fresh one', () => {
    const rolled = mk({
      title: 'Lunch',
      tag: 'private',
      status: 'rolled',
      startMin: 12 * 60,
      endMin: 13 * 60,
    })
    expect(
      meals(scaffoldDay([rolled], D, { meals: MEALS, nowMin: NOW })).map((p) => p.title)
    ).toEqual(['Lunch', 'Dinner'])
  })

  it('a fully-fed day gains nothing — even when a long work run would earn a breather', () => {
    const fed = [
      mk({ title: 'Lunch', tag: 'private', startMin: 12 * 60, endMin: 13 * 60 }),
      mk({ title: 'Dinner — with folks', tag: 'private', startMin: 19 * 60, endMin: 20 * 60 }),
      mk({ title: 'Deep work', startMin: 13 * 60, endMin: 17 * 60 }), // >90m unbroken
    ]
    expect(scaffoldDay(fed, D, { meals: MEALS, nowMin: NOW })).toEqual([])
  })

  it('a wall-to-wall day yields nothing — honest silence, never displacement', () => {
    const packed = [mk({ title: 'Offsite', startMin: 8 * 60, endMin: 21 * 60, protected: true })]
    expect(scaffoldDay(packed, D, { meals: MEALS, nowMin: NOW })).toEqual([])
  })

  it('a morning work run earns its breather alongside the meals — rest-tagged, absorbable', () => {
    const run = [mk({ title: 'Deep work', startMin: 9 * 60, endMin: 12 * 60 })]
    const out = scaffoldDay(run, D, { meals: MEALS, nowMin: NOW })
    /* rest spacing keeps lunch off the back of the 3h run (12:30, not 12:00),
       which leaves the natural seam for the breather restInsertion finds */
    expect(meals(out).map((p) => [p.title, p.startMin])).toEqual([
      ['Lunch', 12 * 60 + 30],
      ['Dinner', 18 * 60 + 30],
    ])
    expect(rests(out)).toHaveLength(1)
    expect(rests(out)[0]).toMatchObject({
      title: 'Breather',
      tag: 'rest',
      startMin: 12 * 60,
      durationMin: 15,
      protected: false,
    })
  })

  it('placements schedule AROUND an external meeting holding the window (candidateSlots law)', () => {
    const meeting = mk({
      title: 'Client sync',
      startMin: 11 * 60 + 30,
      endMin: 14 * 60 + 30,
      external: { calId: 'work', eventId: 'ev1' },
    })
    const out = scaffoldDay([meeting], D, { meals: MEALS, nowMin: NOW })
    const lunch = meals(out).find((p) => p.title === 'Lunch')!
    expect(lunch.startMin).toBeGreaterThanOrEqual(14 * 60 + 30) // never over it, never moving it
  })

  it('an inbound lunch invite counts as fed — no second lunch beside it', () => {
    const invite = mk({
      title: 'Lunch with the client',
      tag: 'private',
      startMin: 12 * 60 + 30,
      endMin: 13 * 60 + 30,
      external: { calId: 'work', eventId: 'ev2' },
    })
    expect(
      meals(scaffoldDay([invite], D, { meals: MEALS, nowMin: NOW })).map((p) => p.title)
    ).toEqual(['Dinner'])
  })

  it('a late pass (14:00) still feeds the day — off-window named by the clock, no breather behind it', () => {
    const run = [mk({ title: 'Deep work', startMin: 9 * 60, endMin: 12 * 60 })]
    const out = scaffoldDay(run, D, { meals: MEALS, nowMin: 14 * 60 })
    expect(meals(out).map((p) => [p.title, p.startMin])).toEqual([
      ['Lunch', 14 * 60], // as close to the window as the clock allows
      ['Dinner', 19 * 60], // adjacency keeps a real stretch after the late lunch
    ])
    expect(rests(out)).toHaveLength(0) // the morning run's seam is behind the clock — placing there would lie
  })

  it('Settings windows govern when no pref speaks; a remembered time outranks the Settings window', () => {
    const early = { ...MEALS, dinner: { startMin: 18 * 60, endMin: 20 * 60, durationMin: 60 } }
    const bySettings = scaffoldDay([], D, { meals: early, nowMin: NOW })
    expect(meals(bySettings).find((p) => p.title === 'Dinner')!.startMin).toBe(18 * 60)

    const prefs: PrefPayload[] = [
      { kind: 'time-default', match: 'dinner', value: 'starts 20:00', stated: 'dinner at 20:00' },
    ]
    const byPref = scaffoldDay([], D, { prefs, meals: early, nowMin: NOW })
    expect(meals(byPref).find((p) => p.title === 'Dinner')!.startMin).toBe(20 * 60)
  })

  it('a remembered "lunch is always at 1pm" shifts the scaffold forever', () => {
    const prefs: PrefPayload[] = [
      { kind: 'time-default', match: 'lunch', value: 'starts 13:00', stated: 'lunch at 1pm' },
    ]
    const out = scaffoldDay([], D, { prefs, meals: MEALS, nowMin: NOW })
    expect(meals(out).find((p) => p.title === 'Lunch')!.startMin).toBe(13 * 60)
  })

  it('every placement is unprotected non-work — nothing here can ever be a mew or a rescue', () => {
    const run = [mk({ title: 'Deep work', startMin: 9 * 60, endMin: 12 * 60 })]
    for (const p of scaffoldDay(run, D, { meals: MEALS, nowMin: NOW })) {
      expect(p.protected).toBe(false)
      expect(p.tag === 'private' || p.tag === 'rest').toBe(true)
      expect(p.dayOffset).toBe(0)
    }
  })
})

describe('sustenance — scaffoldLine (the one line it says)', () => {
  const P = (title: string, tag: 'private' | 'rest', startMin: number): ScaffoldPlacement => ({
    title,
    tag,
    dayOffset: 0,
    startMin,
    durationMin: tag === 'rest' ? 15 : 45,
    protected: false,
  })

  it('speaks the canonical line — meals by start time, the breather at the tail', () => {
    expect(
      scaffoldLine([
        P('Lunch', 'private', 12 * 60 + 30),
        P('Dinner', 'private', 19 * 60),
        P('Breather', 'rest', 15 * 60),
      ])
    ).toBe(
      'fed and paced: lunch 12:30, dinner 19:00, a breather at 15:00 — say the word to reshape'
    )
  })

  it('names only what landed; plural breathers join naturally; a fed day says nothing', () => {
    expect(scaffoldLine([P('Dinner', 'private', 19 * 60)])).toBe(
      'fed and paced: dinner 19:00 — say the word to reshape'
    )
    expect(
      scaffoldLine([P('Breather', 'rest', 10 * 60 + 30), P('Breather', 'rest', 15 * 60)])
    ).toBe('fed and paced: breathers at 10:30 and 15:00 — say the word to reshape')
    expect(scaffoldLine([])).toBe('')
  })
})
