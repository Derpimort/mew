/* #71 — pure pins for the console's brain-only rules: which applied rules come
   from the brain alone (prefMerge.brainOnlyPrefKeys), the presenter's quiet
   source mark, the keyless summary's words, and byte-identity when nothing is
   brain-only. The store and markup pins live in state/__tests__/
   console-brain-rules.test.ts and ui/components/__tests__/memoryConsole.brain.test.tsx. */
import { describe, expect, it } from 'vitest'
import type { MemoryEvent, PrefPayload } from '../types'
import { brainOnlyPrefKeys, mergeActivePrefs, prefKey } from '../prefMerge'
import { consoleSummary, memoryConsole } from '../console'
import { computeInsights } from '../insights'
import { aggregates } from '../memory'

let seq = 0
const pref = (match: string, value: string): PrefPayload => ({
  kind: 'time-default',
  match,
  value,
  stated: `${match} ${value}`,
})
const said = (p: PrefPayload): MemoryEvent => ({
  id: `s${seq++}`,
  ts: seq,
  kind: 'preference',
  dayKey: '2026-06-09',
  pref: p,
})
const forgot = (p: PrefPayload): MemoryEvent => ({
  id: `f${seq++}`,
  ts: seq,
  kind: 'forgotten_pref',
  dayKey: '2026-06-09',
  pref: { kind: p.kind, match: p.match, value: '', stated: '' },
})

const GYM = pref('gym', 'starts 07:00')
const YOGA = pref('yoga', 'starts 18:00')
const LUNCH = pref('lunch', 'starts 12:30')
const NOW = new Date(2026, 5, 9, 10, 0)

describe('brainOnlyPrefKeys — the applied rules nothing local decided (#71)', () => {
  it('a rule only the brain holds is brain-only; one both hold is local', () => {
    const memory = [said(GYM)]
    const keys = brainOnlyPrefKeys(memory, [GYM, YOGA])
    expect([...keys]).toEqual([prefKey(YOGA)])
  })

  it('a forgotten rule the brain still lists is not applied, so not listed either', () => {
    expect(brainOnlyPrefKeys([said(YOGA), forgot(YOGA)], [YOGA]).size).toBe(0)
  })

  it('no brain, or an empty one → nothing is brain-only', () => {
    expect(brainOnlyPrefKeys([said(GYM)], null).size).toBe(0)
    expect(brainOnlyPrefKeys([said(GYM)], []).size).toBe(0)
  })

  it('every brain-only key is a rule the merge actually applies', () => {
    const memory = [said(GYM), said(LUNCH)]
    const brain = [YOGA, GYM]
    const applied = new Set(mergeActivePrefs(memory, brain).map(prefKey))
    for (const k of brainOnlyPrefKeys(memory, brain)) expect(applied.has(k)).toBe(true)
  })
})

describe('the console presenter marks brain-only rules (#71)', () => {
  const base = (memory: MemoryEvent[], brain: PrefPayload[] | null) =>
    memoryConsole({
      events: memory,
      prefs: mergeActivePrefs(memory, brain),
      brainOnly: brainOnlyPrefKeys(memory, brain),
      insights: computeInsights(memory, aggregates(memory, NOW), NOW),
    })

  it('marks only the brain row, and the summary says where each rule came from', () => {
    const data = base([said(GYM)], [YOGA])
    expect(data.standingRules.map((r) => [r.match, r.fromBrain ?? false])).toEqual([
      ['gym', false],
      ['yoga', true],
    ])
    const lines = consoleSummary(data)
    expect(lines).toContain('• you told me: gym → starts 07:00')
    expect(lines).toContain('• from your brain: yoga → starts 18:00')
  })

  it('nothing brain-only → byte-identical to the presenter without the new input', () => {
    const memory = [said(GYM), said(LUNCH)]
    const insights = computeInsights(memory, aggregates(memory, NOW), NOW)
    const before = memoryConsole({
      events: memory,
      prefs: mergeActivePrefs(memory, null),
      insights,
    })
    expect(base(memory, null)).toEqual(before)
    expect(base(memory, [GYM])).toEqual(before) // the brain agrees with local: still identical
    expect(JSON.stringify(before)).not.toMatch(/fromBrain/)
  })

  it('voice: the mark is a source, never a warning', () => {
    const text = consoleSummary(base([], [YOGA])).join(' ')
    expect(text).not.toMatch(/unknown|untrusted|failed|missed|behind|overdue/i)
  })
})
