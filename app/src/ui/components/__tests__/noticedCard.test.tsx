/* Markup pin for the "what mew's noticed" card (#287). Headless (no jsdom),
   same pattern as focus.test.tsx: renderToStaticMarkup and assert the
   contract — the heading, one data-claim per row (the traceability pin in
   the DOM), the presenter's values verbatim, and the kind empty state under
   the data floor. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NoticedCard } from '../NoticedCard'
import { computeInsights, insightsCard } from '../../../domain/insights'
import { aggregates } from '../../../domain/memory'
import { addDaysKey, dayKey } from '../../../domain/time'
import type { MemoryEvent } from '../../../domain/types'

const TODAY = new Date(2026, 5, 10) // Wednesday, June 10
const todayKey = dayKey(TODAY)

function history(): MemoryEvent[] {
  const events: MemoryEvent[] = []
  let n = 0
  for (let i = 1; i <= 21; i++) {
    const day = addDaysKey(todayKey, -i)
    const dow = (new Date(day + 'T12:00:00').getDay() + 6) % 7
    if (dow >= 5) continue
    const doneAt = new Date(day + 'T00:00:00')
    doneAt.setMinutes(11 * 60 + 20)
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
const card = insightsCard(insights)!

describe('NoticedCard — populated (#287)', () => {
  const html = renderToStaticMarkup(<NoticedCard card={card} />)

  it('renders the heading and one data-claim per presenter row', () => {
    expect(html).toMatch(/what mew.{0,6}s noticed/) // apostrophe is entity-escaped
    for (const r of card.rows) expect(html).toContain(`data-claim="${r.claim}"`)
    expect(html.match(/data-claim=/g)).toHaveLength(card.rows.length)
  })

  it('renders the presenter values verbatim — the card is a skin, not an author', () => {
    /* markup-safe slice: the follow-through counts and the band label */
    expect(html).toContain(`${insights.bestBand!.completed}/${insights.bestBand!.attempted}`)
    expect(html).toContain(insights.bestBand!.label)
  })

  it('voice pin: no {missed, failed, behind, overdue} in the rendered card', () => {
    expect(html).not.toMatch(/missed|failed|behind|overdue/i)
  })
})

describe('NoticedCard — under the data floor', () => {
  const html = renderToStaticMarkup(<NoticedCard card={null} />)

  it('keeps the heading and shows the kind empty state, with zero claims', () => {
    expect(html).toMatch(/what mew.{0,6}s noticed/)
    expect(html).toContain('still learning your week — check back friday')
    expect(html).not.toContain('data-claim')
  })
})
