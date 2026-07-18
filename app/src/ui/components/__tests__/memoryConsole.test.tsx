/* Markup pin for the memory console (#330). Headless (no jsdom), same pattern
   as noticedCard.test.tsx: renderToStaticMarkup and assert the contract — the
   heading, one data-claim per row (the traceability pin in the DOM), the
   presenter values verbatim, the edit/forget/re-enable affordances, and the
   kind empty state. Voice is pinned positive. The skin is fed a hand-built
   MemoryConsoleData so this test never depends on the presenter's math. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryConsole } from '../MemoryConsole'
import { MEMORY_CONSOLE_TITLE, type MemoryConsoleData } from '../../../domain/console'

const noop = () => {}

const DATA: MemoryConsoleData = {
  title: MEMORY_CONSOLE_TITLE,
  taskRules: [
    {
      match: 'the deck',
      title: 'The deck',
      label: '90 min of deep work, mornings',
      support: 5,
      claim: 'learned from 5 times you did it',
      rule: { match: 'the deck', durationMin: 90, tag: 'work', window: 'morning' },
    },
  ],
  rhythm: [
    { label: 'your best hours', value: 'mornings hold — 8/10 finished there', claim: 'bestBand' },
    {
      label: 'your kindest day',
      value: 'tuesdays run lightest — about 3h, room to breathe',
      claim: 'weekdayLoad',
    },
  ],
  standingRules: [
    {
      match: 'gym',
      value: 'starts 07:00',
      stated: 'gym at 7am',
      pref: { kind: 'time-default', match: 'gym', value: 'starts 07:00', stated: 'gym at 7am' },
    },
  ],
  pending: [
    {
      match: 'standup',
      offer: 'block standup as 15 min of work in the morning?',
      support: 4,
      rule: { match: 'standup', durationMin: 15, tag: 'work', window: 'morning' },
    },
  ],
  dismissed: ['email'],
  empty: false,
}

describe('MemoryConsole — populated (#330)', () => {
  const html = renderToStaticMarkup(
    <MemoryConsole
      data={DATA}
      onConfirm={noop}
      onForget={noop}
      onReEnable={noop}
      onSavePref={noop}
      onForgetPref={noop}
    />
  )

  it('renders the heading and one data-claim per row (the traceability pin)', () => {
    expect(html).toMatch(/what i.{0,6}ve picked up about you/)
    for (const c of ['support', 'bestBand', 'weekdayLoad', 'stated', 'declined'])
      expect(html).toContain(`data-claim="${c}"`)
    // task(1) + rhythm(2) + standing(1) + pending(1) + dismissed(1) = 6 traceable rows
    expect(html.match(/data-claim=/g)).toHaveLength(6)
  })

  it('renders the presenter values verbatim — the console is a skin, not an author', () => {
    expect(html).toContain('90 min of deep work, mornings')
    expect(html).toContain('learned from 5 times you did it')
    expect(html).toContain('8/10 finished there')
    expect(html).toContain('tuesdays run lightest')
    expect(html).toContain('gym')
  })

  it('offers edit, forget, and re-enable affordances', () => {
    expect(html).toContain('>edit<')
    expect(html).toContain('>forget<')
    expect(html).toContain('>yes, always<') // confirm a pending offer
    expect(html).toContain('>let me learn it<') // re-enable a dismissed pattern
  })

  it('voice pin: no {missed, failed, behind, overdue} in the rendered console', () => {
    expect(html).not.toMatch(/missed|failed|behind|overdue/i)
  })
})

describe('MemoryConsole — empty (#330)', () => {
  const html = renderToStaticMarkup(
    <MemoryConsole
      data={{
        title: MEMORY_CONSOLE_TITLE,
        taskRules: [],
        rhythm: [],
        standingRules: [],
        pending: [],
        dismissed: [],
        empty: true,
      }}
      onConfirm={noop}
      onForget={noop}
      onReEnable={noop}
      onSavePref={noop}
      onForgetPref={noop}
    />
  )

  it('keeps the heading and shows the kind empty state, with zero claims', () => {
    expect(html).toMatch(/what i.{0,6}ve picked up about you/)
    expect(html).toContain('still getting to know you')
    expect(html).not.toContain('data-claim')
  })
})
