import { describe, expect, it } from 'vitest'
import type { Block, PrefPayload } from '../types'
import { addDaysKey } from '../time'
import { conflictsWith, overlaps } from '../week'
import type { Scenario, ScenarioOpts, ScenarioTask } from '../scenarios'
import { generateScenarios, validateScenario } from '../scenarios'

const D = '2026-06-09' // Tuesday
const NOW = 8 * 60

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

/** deterministic id factory — the injected seam generateScenarios requires */
function counter(): () => string {
  let n = 0
  return () => `sc-${++n}`
}

/* the braindump fixture: a lived-in week — a fixed standup, an external event,
   a fixed call tomorrow, a plain appointment, and a TENTATIVE interview
   (optional + fixed words → still holds its slot) */
const week = [
  mk({ title: 'Standup', startMin: 9 * 60, endMin: 9 * 60 + 30 }),
  mk({
    title: 'Team sync',
    startMin: 13 * 60,
    endMin: 14 * 60,
    external: { calId: 'c', eventId: 'e' },
  }),
  mk({ title: 'Client call', dayKey: '2026-06-10', startMin: 9 * 60, endMin: 11 * 60 }),
  mk({
    title: 'Dentist',
    tag: 'private',
    dayKey: '2026-06-11',
    startMin: 10 * 60,
    endMin: 11 * 60,
  }),
  mk({ title: 'Screening call', optional: true, startMin: 16 * 60, endMin: 17 * 60 }),
]

const tasks: ScenarioTask[] = [
  { title: 'Deck', tag: 'work', durationMin: 120 },
  { title: 'Demo prep', tag: 'work', durationMin: 90 },
  { title: 'Budget review', tag: 'work', durationMin: 60 },
  { title: 'Gym', tag: 'health', durationMin: 60, window: 'evening' },
  { title: 'Emails', tag: 'work', durationMin: 30 },
  { title: 'Groceries', tag: 'private', durationMin: 45 },
]

const OPTS = { nowMin: NOW, todayKey: D, horizonDays: 6 }

function gen(blocks = week, ts = tasks, extra: Partial<Omit<ScenarioOpts, 'ids'>> = {}) {
  return generateScenarios(blocks, ts, { ...OPTS, ...extra, ids: counter() })
}

/** every place must clear the LIVE week — the by-construction guarantee */
function expectConflictFree(blocks: Block[], s: Scenario) {
  for (const p of s.places) {
    const day = addDaysKey(s.todayKey, p.dayOffset)
    expect(conflictsWith(blocks, day, p.startMin, p.startMin + p.durationMin)).toEqual([])
  }
}

/** a scenario may never self-overlap: its own places share the week peacefully */
function expectNoSelfOverlap(s: Scenario) {
  for (let i = 0; i < s.places.length; i++)
    for (let j = i + 1; j < s.places.length; j++) {
      const a = s.places[i]
      const b = s.places[j]
      if (a.dayOffset !== b.dayOffset) continue
      expect(
        overlaps(a.startMin, a.startMin + a.durationMin, b.startMin, b.startMin + b.durationMin)
      ).toBe(false)
    }
}

const BANNED = /failed|doesn't fit|overloaded|missed/i

describe('scenarios — #302 meeting buffer inherits through the scoreSlots seam', () => {
  const EXT_START = 13 * 60 // the fixture's external "Team sync" holds 13:00–14:00 on day D
  const EXT_END = 14 * 60

  it('buffer 0 reproduces the un-buffered scenarios byte-for-byte', () => {
    expect(gen(week, tasks, { bufferMin: 0 })).toEqual(gen(week, tasks))
  })

  it('with buffer 15, no scenario place abuts the external meeting on either edge', () => {
    const BUF = 15
    for (const s of gen(week, tasks, { bufferMin: BUF }))
      for (const p of s.places) {
        if (p.dayOffset !== 0) continue // the external meeting sits on day D (offset 0)
        const end = p.startMin + p.durationMin
        expect(end <= EXT_START - BUF || p.startMin >= EXT_END + BUF).toBe(true)
      }
  })
})

describe('scenarios — generateScenarios (the 6-task braindump)', () => {
  const out = gen()

  it('yields at least two distinct, named, valid scenarios', () => {
    expect(out.length).toBeGreaterThanOrEqual(2)
    expect(new Set(out.map((s) => s.name)).size).toBe(out.length)
    const keys = out.map((s) =>
      s.places
        .map((p) => `${p.dayOffset}:${p.startMin}:${p.durationMin}:${p.title}`)
        .sort()
        .join('|')
    )
    expect(new Set(keys).size).toBe(out.length) // distinct placements, not cosmetic triplicates
  })

  it('every place lands conflict-free against fixed, external and tentative blocks', () => {
    for (const s of out) expectConflictFree(week, s)
  })

  it('a scenario never self-overlaps — placements accumulate', () => {
    for (const s of out) expectNoSelfOverlap(s)
  })

  it('places every task in every scenario when the week has room', () => {
    for (const s of out) {
      expect(s.places).toHaveLength(tasks.length)
      expect(s.line).toContain(`all ${tasks.length} fit`)
    }
  })

  it('ids come from the injected factory, in order', () => {
    expect(out.map((s) => s.id)).toEqual(out.map((_, i) => `sc-${i + 1}`))
  })

  it('dayLoad sums exactly the minutes each day receives', () => {
    for (const s of out) {
      const expected: Record<string, number> = {}
      for (const p of s.places) {
        const key = addDaysKey(s.todayKey, p.dayOffset)
        expected[key] = (expected[key] ?? 0) + p.durationMin
      }
      expect(s.dayLoad).toEqual(expected)
    }
  })

  it('a stated window is honored by every profile (gym stays in the evening)', () => {
    for (const s of out) {
      const gym = s.places.find((p) => p.title === 'Gym')!
      expect(gym.startMin).toBeGreaterThanOrEqual(17 * 60)
    }
  })
})

describe('scenarios — profile character', () => {
  const out = gen()
  const byName = (name: string) => out.find((s) => s.name === name)!

  it('protected mornings puts every work place before noon when mornings are free', () => {
    const s = byName('protected mornings')
    for (const p of s.places.filter((p) => p.tag === 'work'))
      expect(p.startMin).toBeLessThan(12 * 60)
  })

  it('spread even leaves the largest average air before its placements', () => {
    /* breathing room, measured: mean air between each place and the busy
       neighbor (existing held block or earlier place) directly before it */
    const airBefore = (s: Scenario): number => {
      let sum = 0
      for (const p of s.places) {
        const day = addDaysKey(s.todayKey, p.dayOffset)
        const busy = [
          ...week
            .filter((b) => b.dayKey === day && b.status === 'open' && !b.optional)
            .map((b) => b.endMin),
          ...week
            .filter((b) => b.dayKey === day && b.optional) // the tentative interview still holds
            .map((b) => b.endMin),
          ...s.places
            .filter((q) => q !== p && q.dayOffset === p.dayOffset)
            .map((q) => q.startMin + q.durationMin),
          NOW,
        ].filter((end) => end <= p.startMin)
        sum += p.startMin - Math.max(...busy)
      }
      return sum / s.places.length
    }
    const spread = airBefore(byName('spread even'))
    for (const s of out) expect(spread).toBeGreaterThanOrEqual(airBefore(s))
    expect(spread).toBeGreaterThan(airBefore(byName('front-loaded')))
  })

  it("front-loaded's first-day minutes meet or beat every other scenario's", () => {
    const first = (s: Scenario) => s.dayLoad[D] ?? 0
    const front = first(byName('front-loaded'))
    for (const s of out) expect(front).toBeGreaterThanOrEqual(first(s))
  })

  it('bestWindow steers the first profile and its line says so', () => {
    const aligned = gen(week, tasks, { bestWindow: 'afternoon' }).find(
      (s) => s.name === 'protected mornings'
    )!
    expect(aligned.line).toContain('your best afternoons')
    const deck = aligned.places.find((p) => p.title === 'Deck')!
    expect(deck.startMin).toBeGreaterThanOrEqual(12 * 60)
    expect(deck.startMin).toBeLessThan(17 * 60)
  })
})

describe('scenarios — standing preferences reach the oracle', () => {
  const wk = [
    mk({ title: 'Standup', startMin: 9 * 60, endMin: 9 * 60 + 30 }),
    mk({ title: 'Client call', dayKey: '2026-06-10', startMin: 9 * 60, endMin: 11 * 60 }),
  ]
  const ts: ScenarioTask[] = [
    { title: 'Deck', tag: 'work', durationMin: 120 },
    { title: 'Report', tag: 'work', durationMin: 90 },
    { title: 'Groceries', tag: 'private', durationMin: 45 },
  ]
  const prefs: PrefPayload[] = [
    {
      kind: 'time-default',
      match: 'groceries',
      value: 'starts 15:00',
      stated: 'groceries run is 3pm',
    },
  ]
  const groceriesAt = (out: Scenario[], name: string) =>
    out.find((s) => s.name === name)!.places.find((p) => p.title === 'Groceries')!.startMin

  it("a remembered rule steers placement — every profile's preference weight bites", () => {
    const withRule = gen(wk, ts, { prefs })
    for (const name of ['protected mornings', 'spread even'])
      expect(groceriesAt(withRule, name)).toBe(15 * 60)
    // differential proof: without the rule, nothing pulls groceries to 15:00
    expect(groceriesAt(gen(wk, ts), 'protected mornings')).not.toBe(15 * 60)
  })

  it('the rule surfaces in a line through the why distillation', () => {
    const spread = gen(wk, ts, { prefs }).find((s) => s.name === 'spread even')!
    expect(spread.line).toContain('matches your rule')
  })
})

describe('scenarios — honest lines', () => {
  it('a task that fits nowhere is NAMED in the line, and the rest stays valid', () => {
    const full = [
      mk({ title: 'Client call', startMin: 10 * 60, endMin: 13 * 60 }),
      mk({ title: 'Panel', startMin: 13 * 60, endMin: 17 * 60 }),
    ]
    const out = gen(
      full,
      [
        { title: 'Budget review', tag: 'work', durationMin: 180 },
        { title: 'Deck', tag: 'work', durationMin: 120 },
        { title: 'Emails', tag: 'work', durationMin: 30 },
      ],
      { horizonDays: 0 }
    )
    expect(out.length).toBeGreaterThanOrEqual(1)
    for (const s of out) {
      expect(s.line).toContain('budget review waits for next week')
      expect(s.places.map((p) => p.title).sort()).toEqual(['Deck', 'Emails'])
      expectConflictFree(full, s)
    }
  })

  it('several tasks that fit nowhere are all accounted for — never silently dropped', () => {
    const full = [mk({ title: 'Offsite meeting', startMin: 8 * 60, endMin: 17 * 60 })]
    const out = gen(
      full,
      [
        { title: 'Deck', tag: 'work', durationMin: 240 },
        { title: 'Budget review', tag: 'work', durationMin: 120 },
        { title: 'Emails', tag: 'work', durationMin: 30 },
      ],
      { horizonDays: 0 }
    )
    // the full list rides where it fits the budget; a longer character clips
    // the list to first + count — either way every waiting task is accounted for
    const protectedLine = out.find((s) => s.name === 'protected mornings')!.line
    expect(protectedLine).toContain('deck and budget review wait for next week')
    const frontLine = out.find((s) => s.name === 'front-loaded')!.line
    expect(frontLine).toContain('deck +1 more wait for next week')
    for (const s of out) {
      expect(s.line.length).toBeLessThanOrEqual(90)
      expect(s.places.map((p) => p.title)).toEqual(['Emails'])
    }
  })

  it('long unplaceable titles clip to first + count — honesty inside the line budget', () => {
    const wall = [mk({ title: 'Offsite meeting', startMin: 8 * 60, endMin: 18 * 60 + 30 })]
    const out = gen(
      wall,
      [
        { title: 'Quarterly budget reconciliation review', tag: 'work', durationMin: 120 },
        { title: 'Annual compliance training modules', tag: 'work', durationMin: 90 },
        { title: 'Performance review preparation notes', tag: 'work', durationMin: 60 },
      ],
      { horizonDays: 0 }
    )
    expect(out).toHaveLength(1) // identical all-wait drafts dedupe
    expect(out[0].line).toBe('quarterly budget reconciliation review +2 more wait for next week')
    expect(out[0].line.length).toBeLessThanOrEqual(90)
    expect(out[0].places).toEqual([])
  })

  it('a single over-budget title is still named — honesty outranks the soft cap', () => {
    const wall = [mk({ title: 'Offsite meeting', startMin: 8 * 60, endMin: 18 * 60 + 30 })]
    const title =
      'Comprehensive end-of-quarter financial reconciliation and compliance review for the board'
    const out = gen(wall, [{ title, tag: 'work', durationMin: 120 }], { horizonDays: 0 })
    expect(out).toHaveLength(1)
    expect(out[0].line).toBe(`${title.toLowerCase()} waits for next week`)
  })

  it("voice pin: no scenario string ever says failed / doesn't fit / overloaded / missed", () => {
    const everything = [
      ...gen(),
      ...gen(week, tasks, { bestWindow: 'morning' }),
      ...gen(
        [mk({ title: 'Panel', startMin: 8 * 60, endMin: 18 * 60 + 30 })],
        [{ title: 'Deck', tag: 'work', durationMin: 480 }],
        { horizonDays: 0 }
      ),
    ]
    expect(everything.length).toBeGreaterThan(0)
    for (const s of everything) {
      expect(s.name).not.toMatch(BANNED)
      expect(s.line).not.toMatch(BANNED)
      expect(s.line).toBe(s.line.toLowerCase())
      expect(s.line.length).toBeLessThanOrEqual(90)
    }
  })

  it('profiles that collapse to identical placements dedupe — one scenario is legal', () => {
    const out = gen([], [{ title: 'Emails', tag: 'work', durationMin: 30 }])
    expect(out).toHaveLength(1)
    expect(out[0].places).toHaveLength(1)
  })

  it('an empty braindump yields no scenarios', () => {
    expect(gen(week, [])).toEqual([])
  })
})

describe('scenarios — validateScenario (the staleness gate)', () => {
  const s = gen()[0]

  it('passes while every place still lands in free air', () => {
    expect(validateScenario(week, s)).toBe(true)
  })

  it('flips false when a conflicting block lands on the live week', () => {
    const p = s.places[0]
    const intruder = mk({
      title: 'New interview',
      dayKey: addDaysKey(s.todayKey, p.dayOffset),
      startMin: p.startMin,
      endMin: p.startMin + p.durationMin,
      external: { calId: 'c', eventId: 'late' },
    })
    expect(validateScenario([...week, intruder], s)).toBe(false)
  })

  it('a completed block holds no time — it never stales a scenario', () => {
    const p = s.places[0]
    const done = mk({
      title: 'Old thing',
      dayKey: addDaysKey(s.todayKey, p.dayOffset),
      startMin: p.startMin,
      endMin: p.startMin + p.durationMin,
      status: 'done',
    })
    expect(validateScenario([...week, done], s)).toBe(true)
  })
})

describe('scenarios — determinism + the sweep', () => {
  it('same inputs, same scenarios — deep equal across runs', () => {
    expect(gen()).toEqual(gen())
    expect(gen(week, tasks, { bestWindow: 'evening' })).toEqual(
      gen(week, tasks, { bestWindow: 'evening' })
    )
  })

  it('property sweep: over seeded weeks, every place respects conflictsWith', () => {
    const lcg = (seed: number) => {
      let x = seed >>> 0
      return () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32
    }
    const TITLES = ['Meeting', 'Focus', 'Errand', 'Call', 'Lunch']
    const TAGS = ['work', 'work', 'private', 'health', 'rest'] as const
    const WINDOWS = ['morning', 'afternoon', 'evening'] as const
    for (let seed = 1; seed <= 25; seed++) {
      const rnd = lcg(seed)
      const int = (n: number) => Math.floor(rnd() * n)
      const blocks: Block[] = []
      for (let d = 0; d < 7; d++)
        for (let i = 0, n = int(4); i < n; i++) {
          const startMin = 8 * 60 + int(19) * 30
          const roll = rnd()
          blocks.push(
            mk({
              id: `w${seed}-${d}-${i}`,
              title: TITLES[int(TITLES.length)],
              tag: TAGS[int(TAGS.length)],
              dayKey: addDaysKey(D, d),
              startMin,
              endMin: Math.min(startMin + (1 + int(4)) * 30, 18 * 60 + 30),
              ...(roll < 0.15 ? { external: { calId: 'c', eventId: `e${d}-${i}` } } : {}),
              ...(roll >= 0.15 && roll < 0.3 ? { optional: true } : {}),
              ...(roll >= 0.3 && roll < 0.4 ? { attention: 'background' as const } : {}),
              ...(rnd() < 0.1 ? { status: 'done' as const } : {}),
            })
          )
        }
      const ts: ScenarioTask[] = []
      for (let i = 0, n = 3 + int(4); i < n; i++)
        ts.push({
          title: `task ${i}`,
          tag: TAGS[int(TAGS.length - 1)], // rest never arrives as a task
          durationMin: (1 + int(4)) * 30,
          ...(rnd() < 0.25 ? { window: WINDOWS[int(3)] } : {}),
          ...(rnd() < 0.15 ? { due: 10 * 60 + int(16) * 30 } : {}),
        })
      const out = gen(blocks, ts)
      for (const s of out) {
        expectConflictFree(blocks, s)
        expectNoSelfOverlap(s)
        expect(validateScenario(blocks, s)).toBe(true)
        expect(s.name).not.toMatch(BANNED)
        expect(s.line).not.toMatch(BANNED)
      }
      // a scenario placing fewer tasks never outranks one placing more
      for (let i = 1; i < out.length; i++)
        expect(out[i - 1].places.length).toBeGreaterThanOrEqual(out[i].places.length)
    }
  })
})
