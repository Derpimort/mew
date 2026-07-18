/* The memory console presenter (#330, gbrain Pillar 4). Pure over LOCAL
   memory — pins the sections (confirmed task rules with their support count,
   rhythm tracing to insights fields, standing rules, pending offers, the
   won't-learn list), the traceable claims, the kind empty state, and the
   positive voice. consoleSummary is pinned as the SAME data the card shows,
   so the keyless reply and the console can never drift. */

import { describe, expect, it } from 'vitest'
import { CONSOLE_EMPTY_LINE, MEMORY_CONSOLE_TITLE, consoleSummary, memoryConsole } from '../console'
import { ruleLabel } from '../learn'
import type { Insights } from '../insights'
import type { LearnedRule } from '../prefs'
import type { MemoryEvent, PrefPayload } from '../types'

const DECK: LearnedRule = {
  match: 'the deck',
  durationMin: 90,
  tag: 'work',
  window: 'morning',
  stated: 'The deck — learned from what you do',
}

function events(): MemoryEvent[] {
  const evs: MemoryEvent[] = []
  let n = 0
  // the confirmed rule itself
  evs.push({ id: `r${n++}`, ts: 1, kind: 'learned_rule', dayKey: '2026-07-01', rule: DECK })
  // five completions behind it — the support the claim cites
  for (let i = 0; i < 5; i++)
    evs.push({
      id: `d${n++}`,
      ts: 100 + i,
      kind: 'completed',
      dayKey: '2026-07-0' + (i + 1),
      title: 'The deck',
      tag: 'work',
      plannedMin: 90,
      startMin: 9 * 60,
    })
  // four consistent standups — an uncovered, undismissed candidate → pending
  for (let i = 0; i < 4; i++)
    evs.push({
      id: `s${n++}`,
      ts: 200 + i,
      kind: 'completed',
      dayKey: '2026-07-0' + (i + 1),
      title: 'Standup',
      tag: 'work',
      plannedMin: 15,
      startMin: 9 * 60,
    })
  // a pattern the user told MEW not to learn
  evs.push({
    id: 'xd',
    ts: 300,
    kind: 'dismissed_rule',
    dayKey: '2026-07-01',
    rule: { match: 'email' },
  })
  return evs
}

const PREFS: PrefPayload[] = [
  { kind: 'time-default', match: 'gym', value: 'starts 07:00', stated: 'gym at 7am' },
]

const INSIGHTS: Insights = {
  weekdayLoad: [
    { dow: 0, name: 'mondays', avgPlannedH: 6 },
    { dow: 1, name: 'tuesdays', avgPlannedH: 3 },
    { dow: 2, name: 'wednesdays', avgPlannedH: 5 },
  ],
  heaviestDow: null,
  bands: [],
  bestBand: { band: 'morning', label: 'mornings', completed: 8, attempted: 10, rate: 0.8 },
  worstBand: null,
  chronicRollers: [],
  latenessMin: null,
  estimateFactor: null,
  driftBand: null,
  lines: [],
}

const THIN: Insights = {
  weekdayLoad: [],
  heaviestDow: null,
  bands: [],
  bestBand: null,
  worstBand: null,
  chronicRollers: [],
  latenessMin: null,
  estimateFactor: null,
  driftBand: null,
  lines: [],
}

describe('memoryConsole — populated (#330)', () => {
  const data = memoryConsole({ events: events(), prefs: PREFS, insights: INSIGHTS })

  it('lists the confirmed task rule with its support count as the claim', () => {
    expect(data.title).toBe(MEMORY_CONSOLE_TITLE)
    expect(data.taskRules).toHaveLength(1)
    const r = data.taskRules[0]
    expect(r.match).toBe('the deck')
    expect(r.title).toBe('The deck')
    expect(r.label).toBe('90 min of deep work, mornings')
    expect(r.label).toBe(ruleLabel(DECK)) // one label vocabulary, shared with the offer
    expect(r.support).toBe(5)
    expect(r.claim).toContain('5 times')
  })

  it('renders rhythm rows that each trace to an insights field', () => {
    const claims = data.rhythm.map((r) => r.claim)
    expect(claims).toContain('bestBand')
    expect(claims).toContain('weekdayLoad')
    // the kind reading of weekdayLoad is the lightest day
    expect(data.rhythm.find((r) => r.claim === 'weekdayLoad')!.value).toContain('tuesdays')
    expect(data.rhythm.find((r) => r.claim === 'bestBand')!.value).toContain('8/10')
  })

  it("lists standing rules, the pending offer, and the won't-learn list", () => {
    expect(data.standingRules.map((s) => s.match)).toEqual(['gym'])
    expect(data.pending).toHaveLength(1)
    expect(data.pending[0].match).toBe('standup')
    expect(data.pending[0].support).toBe(4)
    expect(data.dismissed).toEqual(['email'])
    expect(data.empty).toBe(false)
  })

  it('the deck is covered, so it is never re-offered as pending', () => {
    expect(data.pending.some((p) => p.match === 'the deck')).toBe(false)
  })

  it('voice pin: nothing framed as a failure in any user-facing string', () => {
    /* the STRINGS shown/spoken — not field names like `dismissed` (which
       carries the substring "missed" but is never read aloud) */
    const visible = [
      data.title,
      ...data.taskRules.flatMap((r) => [r.title, r.label, r.claim]),
      ...data.rhythm.flatMap((r) => [r.label, r.value]),
      ...data.standingRules.flatMap((r) => [r.match, r.value, r.stated]),
      ...data.pending.map((p) => p.offer),
      ...data.dismissed,
      ...consoleSummary(data),
    ].join('\n')
    expect(visible).not.toMatch(/missed|failed|behind|overdue/i)
  })
})

describe('consoleSummary — the keyless reply is the same data (#330)', () => {
  const data = memoryConsole({ events: events(), prefs: PREFS, insights: INSIGHTS })
  const lines = consoleSummary(data)

  it('leads with the title and speaks each section the card shows', () => {
    expect(lines[0]).toBe(MEMORY_CONSOLE_TITLE)
    const text = lines.join('\n')
    expect(text).toContain('The deck')
    expect(text).toContain('90 min of deep work, mornings')
    expect(text).toContain('gym')
    expect(text).toContain('standup')
    expect(text).toContain('email')
  })
})

describe('memoryConsole — under the floor (#330)', () => {
  const data = memoryConsole({ events: [], prefs: [], insights: THIN })

  it('is empty and answers with one kind line', () => {
    expect(data.empty).toBe(true)
    expect(data.taskRules).toHaveLength(0)
    expect(data.rhythm).toHaveLength(0)
    expect(consoleSummary(data)).toEqual([CONSOLE_EMPTY_LINE])
  })
})
