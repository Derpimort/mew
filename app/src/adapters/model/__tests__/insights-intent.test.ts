/* `show insights` — the keyless read-only intent (#287). The rules floor
   replies with the SAME presenter rows the Settings card renders: one
   presenter, two skins, identical numbers — pinned here by rendering the
   reply against an independently-computed insightsCard(). The executor is
   proven untouched (showing the science changes nothing), and the data
   floor answers with the kind empty state. */

import { describe, expect, it } from 'vitest'
import { createRulesAdapter, runIntent } from '../rules'
import type { ConverseChunk, ToolExecutor, WeekContext } from '../types'
import { computeInsights, insightsCard } from '../../../domain/insights'
import { aggregates } from '../../../domain/memory'
import { addDaysKey, dayKey } from '../../../domain/time'
import type { MemoryEvent } from '../../../domain/types'

const TODAY = new Date(2026, 5, 10, 9, 40) // Wednesday, June 10
const NOW = () => TODAY
const todayKey = dayKey(TODAY)

/** Three weeks of texture: mornings hold, late slips, +20min lateness —
    enough coverage to clear the presenter's data floor. */
function history(): MemoryEvent[] {
  const events: MemoryEvent[] = []
  let n = 0
  for (let i = 1; i <= 21; i++) {
    const day = addDaysKey(todayKey, -i)
    const dow = (new Date(day + 'T12:00:00').getDay() + 6) % 7
    if (dow >= 5) continue
    const doneAt = new Date(day + 'T00:00:00')
    doneAt.setMinutes(11 * 60 + 20) // ends 11:00 planned, done 11:20
    events.push({
      id: `d${n++}`,
      ts: doneAt.getTime(),
      kind: 'completed',
      dayKey: day,
      title: 'Deep work',
      plannedMin: 120,
      startMin: 9 * 60,
      endMin: 11 * 60,
      deep: true,
    })
    events.push({
      id: `s${n++}`,
      ts: new Date(day + 'T16:30:00').getTime(),
      kind: dow <= 1 ? 'completed' : 'rolled',
      dayKey: day,
      title: 'Inbox sweep',
      plannedMin: 45,
      startMin: 15 * 60 + 30,
    })
  }
  return events
}

const events = history()
const insights = computeInsights(events, aggregates(events, TODAY), TODAY)

function ctxWith(over: Partial<WeekContext> = {}): WeekContext {
  return {
    todayKey,
    todayLabel: 'Wednesday, June 10',
    nowLabel: '9:40',
    weekSummary: [],
    realisticBestH: 2,
    mewsToday: 0,
    insightLines: insights.lines,
    recallLines: [],
    brainOn: false,
    prefLines: [],
    insights,
    ...over,
  }
}

/** Any executor touch fails the test — a read-only intent must never act. */
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

describe('show insights — rules floor reply (#287)', () => {
  it('replies with exactly the presenter rows: same title, same numbers, two skins', async () => {
    const reply = await collect(
      createRulesAdapter(NOW).converse(
        [{ role: 'user', text: 'show insights' }],
        ctxWith(),
        untouchable
      )
    )
    const card = insightsCard(insights)!
    expect(reply).toBe([card.title, ...card.rows.map((r) => `${r.label}: ${r.value}`)].join('\n'))
    /* the numbers are the card's numbers, verbatim */
    expect(reply).toContain(`${insights.bestBand!.completed}/${insights.bestBand!.attempted}`)
    expect(reply).toContain(insights.lines[0])
  })

  it('never touches the executor — showing the science changes nothing', () => {
    expect(runIntent({ kind: 'insights' }, untouchable, ctxWith(), 'show insights')).toContain(
      "what mew's noticed"
    )
  })

  it('under the data floor the reply is the kind empty state', () => {
    /* no insights in context (hand-built / degraded) */
    expect(runIntent({ kind: 'insights' }, untouchable, ctxWith({ insights: undefined }), '')).toBe(
      'still learning your week — check back friday'
    )
    /* insights present but below the floor */
    const thin = computeInsights([], aggregates([], TODAY), TODAY)
    expect(runIntent({ kind: 'insights' }, untouchable, ctxWith({ insights: thin }), '')).toBe(
      'still learning your week — check back friday'
    )
  })

  it('voice pin: the reply never contains {missed, failed, behind, overdue}', () => {
    const reply = runIntent({ kind: 'insights' }, untouchable, ctxWith(), 'show insights')
    expect(reply).not.toMatch(/missed|failed|behind|overdue/i)
  })
})
