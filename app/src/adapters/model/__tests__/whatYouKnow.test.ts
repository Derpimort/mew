/* "what do you know about me?" — the keyless memory-console reply (#330).
   The rules floor answers with the SAME domain presenter the Settings console
   renders: the store threads consoleSummary(memoryConsole(local memory)) in as
   ctx.knownLines, and the reply is exactly that — one presenter, two skins,
   pinned here so the card and the reply can never drift. The executor is proven
   untouched (asking what MEW knows changes nothing), and the voice is positive. */

import { describe, expect, it } from 'vitest'
import { createRulesAdapter, runIntent } from '../rules'
import type { ConverseChunk, ToolExecutor, WeekContext } from '../types'
import { consoleSummary, memoryConsole } from '../../../domain/console'
import type { Insights } from '../../../domain/insights'
import type { LearnedRule } from '../../../domain/prefs'
import type { MemoryEvent, PrefPayload } from '../../../domain/types'

const NOW = () => new Date(2026, 6, 15, 9, 40)

const DECK: LearnedRule = {
  match: 'the deck',
  durationMin: 90,
  tag: 'work',
  window: 'morning',
  stated: 'The deck — learned from what you do',
}
const events: MemoryEvent[] = [
  { id: 'r0', ts: 1, kind: 'learned_rule', dayKey: '2026-07-01', rule: DECK },
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `d${i}`,
    ts: 100 + i,
    kind: 'completed' as const,
    dayKey: '2026-07-01',
    title: 'The deck',
    tag: 'work' as const,
    plannedMin: 90,
    startMin: 540,
  })),
]
const prefs: PrefPayload[] = [
  { kind: 'time-default', match: 'gym', value: 'starts 07:00', stated: 'gym at 7am' },
]
const insights: Insights = {
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

const knownLines = consoleSummary(memoryConsole({ events, prefs, insights }))

function ctxWith(over: Partial<WeekContext> = {}): WeekContext {
  return {
    todayKey: '2026-07-15',
    todayLabel: 'Wednesday, July 15',
    nowLabel: '9:40',
    weekSummary: [],
    realisticBestH: 2,
    mewsToday: 0,
    insightLines: [],
    recallLines: [],
    brainOn: false,
    prefLines: [],
    knownLines,
    ...over,
  }
}

const untouchable = new Proxy({} as ToolExecutor, {
  get(_t, prop) {
    throw new Error(`read-only intent touched the executor (${String(prop)})`)
  },
})

async function collect(it: AsyncIterable<ConverseChunk>): Promise<string> {
  let out = ''
  for await (const c of it) if (typeof c === 'string') out += c
  return out
}

describe('what do you know about me? — rules floor reply (#330)', () => {
  it('replies with exactly the console summary — same presenter, two skins', async () => {
    const reply = await collect(
      createRulesAdapter(NOW).converse(
        [{ role: 'user', text: 'what do you know about me?' }],
        ctxWith(),
        untouchable
      )
    )
    expect(reply).toBe(knownLines.join('\n'))
    // the console's own content, verbatim
    expect(reply).toContain('The deck')
    expect(reply).toContain('90 min of deep work, mornings')
    expect(reply).toContain('gym')
  })

  it('recognizes the phrasings that ask what MEW has learned about you', () => {
    for (const q of [
      'what do you know about me',
      'what do you know about my week',
      'what have you learned about me?',
      'what do you remember about me',
    ]) {
      const reply = runIntent({ kind: 'chat' }, untouchable, ctxWith(), q)
      expect(reply).toBe(knownLines.join('\n'))
    }
  })

  it('never touches the executor — asking what MEW knows changes nothing', () => {
    expect(runIntent({ kind: 'chat' }, untouchable, ctxWith(), 'what do you know about me?')).toBe(
      knownLines.join('\n')
    )
  })

  it('falls back to a kind line when the context carries no summary', () => {
    expect(
      runIntent(
        { kind: 'chat' },
        untouchable,
        ctxWith({ knownLines: undefined }),
        'what do you know about me?'
      )
    ).toMatch(/still getting to know you/)
  })

  it('voice pin: the reply never contains {missed, failed, behind, overdue}', () => {
    const reply = runIntent({ kind: 'chat' }, untouchable, ctxWith(), 'what do you know about me?')
    expect(reply).not.toMatch(/missed|failed|behind|overdue/i)
  })
})
