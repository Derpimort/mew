/* #293 — plan-mode scenario cards in the session log. The picker is a pure
   function of its props — the message plus the list-level `superseded` and
   turn-level `thinking` flags SessionLog derives — so it renders deterministically
   under renderToStaticMarkup (no jsdom) and the markup is string-pinned. Liveness
   pins mirror SessionLog.choices.test.tsx line for line: the cards obey the exact
   chips grammar (#254). Strips draw from STORED places/dayLoad only — render never
   re-validates (staleness is pick-time truth, pinned in the store suite).

   The picker is lazy-mounted inside LogLine (#340 — off the entry chunk), so under
   the headless SYNC renderer a LogLine tree renders the picker's Suspense fallback
   (null), not the cards. The cards' own contract is therefore pinned by rendering
   the exported ScenarioCards directly with the exact props LogLine feeds it (LogLine
   mounts a single ScenarioCards carrying every scenario on the message, so the
   counts map 1:1); LogLine's wiring — the picker rides inside the message article,
   and a plain mew line mounts none — is pinned on the LogLine render itself. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LogLine } from '../SessionLog'
import { ScenarioCards } from '../ScenarioPicker'
import { loadClass, stripSummary } from '../scenarioStrip'
import type { ChatMessage, StoredScenario } from '../../../domain/types'

const at = (h: number, m: number) => new Date(2026, 5, 19, h, m).getTime()

/** Friday 2026-06-19 as day zero — the strip's seven columns run fri → thu. */
const SCN = (over: Partial<StoredScenario> = {}): StoredScenario => ({
  id: 's1',
  name: 'protected mornings',
  line: 'deep work lands in the morning — all 3 fit',
  todayKey: '2026-06-19',
  places: [
    { title: 'deck', tag: 'work', dayOffset: 0, startMin: 540, durationMin: 120 },
    { title: 'gym', tag: 'private', dayOffset: 1, startMin: 1080, durationMin: 60 },
    { title: 'breather', tag: 'rest', dayOffset: 2, startMin: 780, durationMin: 30 },
  ],
  dayLoad: { '2026-06-19': 120, '2026-06-20': 60, '2026-06-21': 30 },
  ...over,
})

const PICKER: ChatMessage = {
  id: 'p1',
  role: 'mew',
  body: 'two ways this week could hold it — pick the one that feels right.',
  ts: at(9, 5),
  scenarios: [
    SCN(),
    SCN({ id: 's2', name: 'spread even', line: 'every block gets breathing room — all 3 fit' }),
  ],
}

describe('#293 — scenario cards render as articles with a mini-week strip', () => {
  it('each scenario is an article "plan option — <name>" inside one labeled group', () => {
    const html = renderToStaticMarkup(<ScenarioCards msg={PICKER} />)
    expect(html).toContain('<div class="scn-cards" role="group" aria-label="plan options">')
    expect(html).toContain('aria-label="plan option — protected mornings"')
    expect(html).toContain('aria-label="plan option — spread even"')
    // the rationale line rides each card, comment-voiced
    expect(html).toContain('# deep work lands in the morning — all 3 fit')
  })

  it('the strip renders exactly seven day columns per card, density as a class', () => {
    const html = renderToStaticMarkup(<ScenarioCards msg={PICKER} />)
    expect(html.match(/class="scn-day /g)).toHaveLength(14) // 7 columns × 2 cards
    // the tint is a discrete, pinnable class from the STORED dayLoad
    expect(html).toContain('scn-day l2') // 120m friday
    expect(html).toContain('scn-day l1') // 60m saturday
    expect(html.match(/scn-day l0/g)!.length).toBe(8) // 4 empty days × 2 cards
    // slivers carry the week's tag colors and their clock-time geometry
    expect(html).toContain('scn-slv work')
    expect(html).toContain('scn-slv private')
    expect(html).toContain('scn-slv rest')
  })

  it('the strip speaks its summary — "fri 2h, sat 1h, sun 0.5h"', () => {
    const html = renderToStaticMarkup(<ScenarioCards msg={PICKER} />)
    expect(html.match(/aria-label="fri 2h, sat 1h, sun 0\.5h"/g)).toHaveLength(2)
    expect(stripSummary(SCN())).toBe('fri 2h, sat 1h, sun 0.5h')
    expect(stripSummary(SCN({ places: [], dayLoad: {} }))).toBe('nothing placed this week')
  })

  it('pick buttons are real chip-primitive buttons with accessible names, enabled while live', () => {
    const html = renderToStaticMarkup(<ScenarioCards msg={PICKER} />)
    expect(html).toContain('aria-label="pick protected mornings"')
    expect(html).toContain('aria-label="pick spread even"')
    expect(html.match(/class="btn btn-chip btn-sm"/g)).toHaveLength(2)
    expect(html).not.toContain('disabled')
  })

  it('a scenarios message renders as its own article row, the picker mounted inside it (#250, #340)', () => {
    /* #250: the scenarios ride the message itself (msg.scenarios), so LogLine
       renders the picker INSIDE the mew line's article — the row carries them
       wherever windowing puts it. #340: that picker is lazy, so under the headless
       sync renderer its Suspense fallback (null) stands in for the cards; the row —
       the observable LogLine behavior — is what's pinned here, while the cards'
       markup is pinned by the direct ScenarioCards renders above. */
    const html = renderToStaticMarkup(<LogLine msg={PICKER} />)
    expect(html).toMatch(/data-msg="p1" role="article"/)
    expect(html).toContain('pick the one that feels right.')
  })

  it('a mew line without scenarios renders no picker at all', () => {
    const plain: ChatMessage = { id: 'm1', role: 'mew', body: 'done — held.', ts: at(9, 7) }
    expect(renderToStaticMarkup(<LogLine msg={plain} />)).not.toContain('scn-cards')
  })
})

describe('#293 — cards go inert (native disabled) exactly per the chips grammar', () => {
  it('after a pick: every button disabled, the picked card keeps its ✓', () => {
    const picked: ChatMessage = {
      ...PICKER,
      scenarios: PICKER.scenarios!.map((s) => (s.id === 's2' ? { ...s, picked: true } : s)),
    }
    const html = renderToStaticMarkup(<ScenarioCards msg={picked} />)
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('aria-label="spread even — picked"')
    expect(html).toContain('✓')
  })

  it('superseded by a newer user message: disabled, even with nothing picked', () => {
    const html = renderToStaticMarkup(<ScenarioCards msg={PICKER} superseded />)
    expect(html.match(/disabled=""/g)).toHaveLength(2)
  })

  it('while a turn is mewing: disabled, re-enabled the moment it settles', () => {
    const mewing = renderToStaticMarkup(<ScenarioCards msg={PICKER} thinking />)
    expect(mewing.match(/disabled=""/g)).toHaveLength(2)
    const settled = renderToStaticMarkup(<ScenarioCards msg={PICKER} thinking={false} />)
    expect(settled).not.toContain('disabled')
  })
})

describe('#293 — the density steps are data, pinned', () => {
  it('loadClass buckets: empty, light (≤90m), solid (≤180m), heavy', () => {
    expect(loadClass(0)).toBe('l0')
    expect(loadClass(45)).toBe('l1')
    expect(loadClass(90)).toBe('l1')
    expect(loadClass(180)).toBe('l2')
    expect(loadClass(300)).toBe('l3')
  })
})
