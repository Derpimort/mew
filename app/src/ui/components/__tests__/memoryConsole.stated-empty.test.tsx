/* #83 follow-up markup pin (N12 from its peer review): a standing rule with no
   stated words (a brain page seeded elsewhere can carry none) shows its source
   alone, "from your brain" or "you told me", never an empty quote (`: ""`). A
   rule with words keeps quoting them, so the row reads its source either way.
   Headless renderToStaticMarkup, the memoryConsole.brain.test.tsx pattern. */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryConsole } from '../MemoryConsole'
import {
  MEMORY_CONSOLE_TITLE,
  type MemoryConsoleData,
  type StandingRuleView,
} from '../../../domain/console'

const noop = () => {}

const rule = (match: string, value: string, stated: string, fromBrain?: true): StandingRuleView => {
  const pref = { kind: 'time-default' as const, match, value, stated }
  return { match, value, stated, pref, ...(fromBrain ? { fromBrain } : {}) }
}

const render = (standingRules: StandingRuleView[]) => {
  const data: MemoryConsoleData = {
    title: MEMORY_CONSOLE_TITLE,
    taskRules: [],
    rhythm: [],
    standingRules,
    pending: [],
    dismissed: [],
    empty: false,
  }
  return renderToStaticMarkup(
    <MemoryConsole
      data={data}
      onConfirm={noop}
      onForget={noop}
      onReEnable={noop}
      onSavePref={noop}
      onForgetPref={noop}
    />
  )
}

/** each standing row's source line, the text right under its value (`.rs`) */
const sourceLines = (html: string) =>
  [...html.matchAll(/class="rs">[^<]*<\/div><div style="[^"]*">([^<]*)<\/div>/g)].map((m) => m[1])

describe('MemoryConsole — a standing rule with no stated words (#83 N12)', () => {
  it('a brain row and a local row with no words show their source alone, with no empty quote', () => {
    const html = render([
      rule('swim', 'starts 06:30', '', true),
      rule('reading', 'starts 21:00', ''),
    ])
    expect(sourceLines(html)).toEqual(['from your brain', 'you told me'])
    expect(html).not.toContain(': &quot;&quot;')
  })

  it('beside them, a rule with words still quotes them', () => {
    const html = render([
      rule('swim', 'starts 06:30', '', true),
      rule('gym', 'starts 07:00', 'gym at 7am'),
      rule('yoga', 'starts 18:00', 'yoga at 6pm', true),
    ])
    expect(sourceLines(html)).toEqual([
      'from your brain',
      'you told me: &quot;gym at 7am&quot;',
      'from your brain: &quot;yoga at 6pm&quot;',
    ])
  })
})
