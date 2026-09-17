/* #15 + #8 — what you tell MEW sticks. Pure pins for the ONE merge rule
   (domain/prefMerge.ts), the reconnect replay plan, and the memory console's
   energy rows. The store paths (a brain-on forget across refreshBrainPrefs, the
   brain-down replay) are pinned through the real store in
   state/__tests__/prefs-stick.test.ts. */
import { describe, expect, it } from 'vitest'
import type { MemoryEvent, PrefPayload, Tag } from '../types'
import type { MemoryAggregates } from '../memory'
import { PREF_CAP, mergeActivePrefs, prefKey, prefReplayPlan } from '../prefMerge'
import { energyProfile } from '../energy'
import { consoleSummary, memoryConsole } from '../console'
import { consolidate } from '../memory'
import type { Insights } from '../insights'

let seq = 0
const pref = (
  match: string,
  value: string,
  kind: PrefPayload['kind'] = 'time-default'
): PrefPayload => ({
  kind,
  match,
  value,
  stated: `${match} ${value}`,
})
const said = (p: PrefPayload): MemoryEvent => ({
  id: `m${seq++}`,
  ts: seq,
  kind: 'preference',
  dayKey: '2026-06-09',
  pref: p,
})
const forgot = (p: PrefPayload): MemoryEvent => ({
  id: `m${seq++}`,
  ts: seq,
  kind: 'forgotten_pref',
  dayKey: '2026-06-09',
  pref: { kind: p.kind, match: p.match, value: '', stated: '' },
})
const matches = (ps: PrefPayload[]) => ps.map((p) => `${p.match}=${p.value}`)

const GYM = pref('gym', 'starts 07:00')
const GYM_LATE = pref('gym', 'starts 18:00')
const DECK = pref('deck', '90m', 'duration-default')
const LUNCH = pref('lunch', 'starts 12:30')

/* the pre-#15 brain-off algorithm, verbatim — the reference for byte-identity */
function legacyLocal(memory: MemoryEvent[]): PrefPayload[] {
  const src = [...memory]
    .reverse()
    .filter((e) => e.kind === 'preference' && e.pref)
    .map((e) => e.pref!)
  const seen = new Set<string>()
  const out: PrefPayload[] = []
  for (const p of src) {
    const key = `${p.kind}:${p.match.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= 15) break
  }
  return out
}

describe('mergeActivePrefs — the one merge rule (#15)', () => {
  const table: {
    name: string
    memory: MemoryEvent[]
    brain: PrefPayload[] | null
    want: string[]
  }[] = [
    {
      name: 'no brain: the local rulebook',
      memory: [said(GYM), said(DECK)],
      brain: null,
      want: ['deck=90m', 'gym=starts 07:00'],
    },
    {
      name: 'brain on, told while it was away: local-only rules still apply',
      memory: [said(LUNCH)],
      brain: [GYM],
      want: ['lunch=starts 12:30', 'gym=starts 07:00'],
    },
    {
      name: 'brain-only rules join',
      memory: [],
      brain: [GYM, DECK],
      want: ['gym=starts 07:00', 'deck=90m'],
    },
    {
      name: 'the same rule on both sides: the local value wins',
      memory: [said(GYM_LATE)],
      brain: [GYM],
      want: ['gym=starts 18:00'],
    },
    {
      name: 'a forget sticks with the brain on: the tombstone beats the brain copy',
      memory: [said(GYM), forgot(GYM)],
      brain: [GYM, DECK],
      want: ['deck=90m'],
    },
    {
      name: 'a forget of a brain-only rule sticks too',
      memory: [forgot(DECK)],
      brain: [GYM, DECK],
      want: ['gym=starts 07:00'],
    },
    {
      name: 'remembering again after a forget: the newer remember wins',
      memory: [said(GYM), forgot(GYM), said(GYM_LATE)],
      brain: [GYM],
      want: ['gym=starts 18:00'],
    },
    {
      name: 'newest local statement per rule, case-insensitive match',
      memory: [said(GYM), said(pref('GYM', 'starts 06:00'))],
      brain: null,
      want: ['GYM=starts 06:00'],
    },
    {
      name: 'an empty brain list is the local rulebook',
      memory: [said(LUNCH)],
      brain: [],
      want: ['lunch=starts 12:30'],
    },
  ]
  for (const row of table)
    it(row.name, () => {
      expect(matches(mergeActivePrefs(row.memory, row.brain))).toEqual(row.want)
    })

  it('caps at the long-standing 15', () => {
    const many = Array.from({ length: 20 }, (_, i) => said(pref(`task ${i}`, 'starts 09:00')))
    expect(mergeActivePrefs(many, null)).toHaveLength(PREF_CAP)
  })

  it('brain off with no forgets: byte-identical to the pre-#15 rule', () => {
    const memory = [
      said(GYM),
      said(DECK),
      said(GYM_LATE),
      said(LUNCH),
      said(pref('deck', '60m', 'duration-default')),
    ]
    expect(mergeActivePrefs(memory, null)).toEqual(legacyLocal(memory))
  })
})

/* peer review of #68 (coderpa): the tombstone is STATE, so correctness never
   depends on the brain honoring the retire — it must outlive compaction */
describe('a forget outlives compaction (#15 review)', () => {
  it('a 70-day-old tombstone is kept by consolidate, and a stubborn brain copy still does not apply', () => {
    const today = new Date(2026, 7, 18) // 70 days after the forget, past the 56-day floor
    const tombstone = forgot(GYM)
    const oldDone: MemoryEvent = { id: 'done-old', ts: 1, kind: 'completed', dayKey: '2026-06-09' }
    let n = 0
    const { kept, removedIds, summaries } = consolidate(
      [tombstone, oldDone],
      today,
      () => `s${n++}`
    )
    expect(removedIds).toEqual(['done-old']) // compaction really ran on that week
    expect(summaries.map((e) => e.kind)).toEqual(['weekly_summary'])
    // the forget is state, not history: it survives beside the new summary
    expect(kept.map((e) => e.kind).sort()).toEqual(['forgotten_pref', 'weekly_summary'])
    const memoryAfter = kept
    expect(matches(mergeActivePrefs(memoryAfter, [GYM]))).toEqual([]) // the brain's copy stays out
    expect(prefReplayPlan(memoryAfter, [GYM]).forget.map(prefKey)).toEqual([prefKey(GYM)])
  })
})

describe('prefReplayPlan — what the brain is missing on reconnect (#15)', () => {
  it('rules told while the brain was away, and changed values, are replayed', () => {
    const plan = prefReplayPlan([said(LUNCH), said(GYM_LATE)], [GYM])
    expect(matches(plan.remember)).toEqual(['gym=starts 18:00', 'lunch=starts 12:30'])
    expect(plan.forget).toEqual([])
  })

  it('a forgotten rule the brain still lists is retired; one it no longer lists is left alone', () => {
    const plan = prefReplayPlan([said(GYM), forgot(GYM), forgot(LUNCH)], [GYM])
    expect(plan.forget.map(prefKey)).toEqual([prefKey(GYM)])
    expect(plan.remember).toEqual([])
  })

  it('in sync → nothing to replay', () => {
    expect(prefReplayPlan([said(GYM)], [GYM])).toEqual({ remember: [], forget: [] })
  })
})

describe('memory console — your rhythm by energy (#15, #8)', () => {
  const TODAY = new Date('2026-06-15T09:00:00')
  const DAYS = ['2026-06-02', '2026-06-03', '2026-06-04']
  const AGG: MemoryAggregates = {
    realisticBestH: 4,
    carryRatioByWeek: [],
    carryRatio: 0,
    restKeptRatio: null,
    restSkippedStreak: 0,
  }
  const cell = (startMin: number, tag: Tag, deep: boolean, done: number, rolled: number) => {
    const out: MemoryEvent[] = []
    let i = 0
    const base = { startMin, tag, deep, plannedMin: deep ? 90 : 30, title: 'x' }
    for (let k = 0; k < done; k++, i++)
      out.push({
        id: `c${seq++}`,
        ts: 0,
        kind: 'completed',
        dayKey: DAYS[i % 3],
        ...base,
      } as MemoryEvent)
    for (let k = 0; k < rolled; k++, i++)
      out.push({
        id: `c${seq++}`,
        ts: 0,
        kind: 'rolled',
        dayKey: DAYS[i % 3],
        ...base,
      } as MemoryEvent)
    return out
  }
  const NO_INSIGHTS = { bestBand: null, weekdayLoad: [] } as unknown as Insights

  it('shows one row per task type with a demonstrated rhythm, sourced to the energy profile', () => {
    const events = [
      ...cell(9 * 60, 'work', true, 4, 1), // mornings deep 4/5
      ...cell(20 * 60, 'work', true, 3, 3), // evenings deep 3/6
      ...cell(9 * 60, 'private', false, 3, 0), // mornings admin 3/3
    ]
    const energy = energyProfile(events, AGG, TODAY)
    expect(energy).not.toBeNull()
    const data = memoryConsole({ events, prefs: [], insights: NO_INSIGHTS, energy })
    expect(data.rhythm).toEqual([
      {
        label: 'your deep work',
        value: 'mornings 4/5 finished · evenings 3/6 finished',
        claim: 'energyProfile',
      },
      { label: 'your admin', value: 'mornings 3/3 finished', claim: 'energyProfile' },
    ])
    expect(consoleSummary(data)).toContain(
      '• your deep work: mornings 4/5 finished · evenings 3/6 finished'
    )
    expect(data.rhythm.map((r) => r.value).join(' ')).not.toMatch(/missed|failed|behind|overdue/i)
  })

  it('nothing under the data floor, and an absent profile changes nothing', () => {
    const thin = cell(9 * 60, 'work', true, 2, 0)
    expect(energyProfile(thin, AGG, TODAY)).toBeNull()
    const data = memoryConsole({ events: thin, prefs: [], insights: NO_INSIGHTS, energy: null })
    expect(data.rhythm).toEqual([])
    expect(memoryConsole({ events: thin, prefs: [], insights: NO_INSIGHTS })).toEqual(data)
  })
})
