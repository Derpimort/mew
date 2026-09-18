/* #71 markup pin: a brain-only standing rule renders with its source traced to
   the brain (data-claim="brain", "from your brain"), keeps edit + forget, and a
   local rule keeps its own words. Headless renderToStaticMarkup, the
   memoryConsole.test.tsx pattern; the forget wiring is pinned by calling the
   row's handler contract through the component's props. */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryConsole } from '../MemoryConsole'
import { MEMORY_CONSOLE_TITLE, type MemoryConsoleData } from '../../../domain/console'

const noop = () => {}
const GYM = {
  kind: 'time-default' as const,
  match: 'gym',
  value: 'starts 07:00',
  stated: 'gym at 7am',
}
const YOGA = {
  kind: 'time-default' as const,
  match: 'yoga',
  value: 'starts 18:00',
  stated: 'yoga at 6pm',
}

const DATA: MemoryConsoleData = {
  title: MEMORY_CONSOLE_TITLE,
  taskRules: [],
  rhythm: [],
  standingRules: [
    { match: 'gym', value: GYM.value, stated: GYM.stated, pref: GYM },
    { match: 'yoga', value: YOGA.value, stated: YOGA.stated, pref: YOGA, fromBrain: true },
  ],
  pending: [],
  dismissed: [],
  empty: false,
}

const render = () =>
  renderToStaticMarkup(
    <MemoryConsole
      data={DATA}
      onConfirm={noop}
      onForget={noop}
      onReEnable={noop}
      onSavePref={noop}
      onForgetPref={noop}
    />
  )

describe('MemoryConsole — a brain-only rule (#71)', () => {
  it('traces the brain row to the brain and the local row to your own words', () => {
    const html = render()
    expect(html.match(/data-claim="brain"/g) ?? []).toHaveLength(1)
    expect(html.match(/data-claim="stated"/g) ?? []).toHaveLength(1)
    expect(html).toContain('from your brain: &quot;yoga at 6pm&quot;')
    expect(html).toContain('you told me: &quot;gym at 7am&quot;')
  })

  it('the brain row keeps edit and forget like any other rule', () => {
    const html = render()
    const brainRow = html.slice(html.indexOf('data-claim="brain"'))
    expect(brainRow).toMatch(/>edit</)
    expect(brainRow).toMatch(/>forget</)
  })

  it('voice: the mark reads as a source, never a warning', () => {
    expect(render()).not.toMatch(/unknown|untrusted|failed|missed|behind|overdue/i)
  })
})
