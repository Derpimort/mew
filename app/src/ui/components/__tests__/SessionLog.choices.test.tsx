/* #254 — option chips in the session log. Same headless render seams as the
   a11y suite (no jsdom): a chip row is a pure function of its props — the
   message plus the list-level `superseded` and turn-level `thinking` flags
   SessionLog derives — so LogLine renders deterministically under
   renderToStaticMarkup and the markup is string-pinned. The polite
   announcement flow needs no new test: chips live inside the message article,
   and the a11y suite already locks articles inside the aria-live="polite"
   log container. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LogLine } from '../SessionLog'
import { lastUserIndex } from '../../../domain/choices'
import type { ChatMessage } from '../../../domain/types'

const at = (h: number, m: number) => new Date(2026, 5, 19, h, m).getTime()

const OFFER: ChatMessage = {
  id: 'o1',
  role: 'mew',
  body: 'which gym block?',
  ts: at(9, 5),
  choices: [
    { id: 'c1', label: 'the 7:00', reply: 'remove gym 7:00' },
    { id: 'c2', label: 'the 18:30', reply: 'remove gym 18:30' },
    { id: 'c3', label: 'both', reply: 'remove all gym' },
  ],
}

describe('#254 — chips render as real buttons on the message row', () => {
  it('each option is a shared chip-primitive <button> with an accessible name, enabled while live', () => {
    const html = renderToStaticMarkup(<LogLine msg={OFFER} />)
    expect(html).toContain('<div class="chip-choices" role="group" aria-label="choices">')
    for (const label of ['the 7:00', 'the 18:30', 'both']) {
      expect(html).toContain(`aria-label="choose ${label}"`)
      expect(html).toContain(`>${label}</button>`)
    }
    expect(html.match(/class="btn btn-chip btn-sm"/g)).toHaveLength(3)
    expect(html).not.toContain('disabled')
  })

  it('the chips ride INSIDE the message article, so a windowed log carries them per-row (#250)', () => {
    const html = renderToStaticMarkup(<LogLine msg={OFFER} />)
    // one article wraps question and chips — no sibling structure a
    // row-windowing rewrite could orphan
    expect(html).toMatch(/data-msg="o1" role="article"[\s\S]*chip-choices/)
    expect(html).toMatch(/which gym block\?[\s\S]*chip-choices/)
  })

  it('a mew line without choices renders no chip row at all', () => {
    const plain: ChatMessage = { id: 'm1', role: 'mew', body: 'done — held.', ts: at(9, 7) }
    expect(renderToStaticMarkup(<LogLine msg={plain} />)).not.toContain('chip-choices')
  })
})

describe('#254 — chips go inert (native disabled) when the question is no longer live', () => {
  it('after a pick: every chip disabled, the picked one keeps its ✓', () => {
    const picked: ChatMessage = {
      ...OFFER,
      choices: OFFER.choices!.map((c) => (c.id === 'c2' ? { ...c, picked: true } : c)),
    }
    const html = renderToStaticMarkup(<LogLine msg={picked} />)
    expect(html.match(/disabled=""/g)).toHaveLength(3)
    expect(html).toContain('aria-label="the 18:30 — picked"')
    expect(html).toContain('✓')
  })

  it('superseded by a newer user message: disabled, even with nothing picked', () => {
    const html = renderToStaticMarkup(<LogLine msg={OFFER} superseded />)
    expect(html.match(/disabled=""/g)).toHaveLength(3)
  })

  it('while a turn is mewing: disabled, matching the composer — what looks clickable is clickable', () => {
    // pickChoice swallows a mid-turn click (no concurrent turns), so the chips
    // must wear the same disabled={thinking} the composer does; they re-enable
    // the moment the turn settles (thinking flips false).
    const mewing = renderToStaticMarkup(<LogLine msg={OFFER} thinking />)
    expect(mewing.match(/disabled=""/g)).toHaveLength(3)
    const settled = renderToStaticMarkup(<LogLine msg={OFFER} thinking={false} />)
    expect(settled).not.toContain('disabled')
  })
})

describe('#254 — SessionLog derives superseded from the one list-level number', () => {
  it('lastUserIndex marks exactly the rows older than the newest user message', () => {
    const user = (id: string, min: number): ChatMessage => ({
      id,
      role: 'user',
      body: 'x',
      ts: at(9, min),
    })
    const chat = [OFFER, user('u1', 6), { ...OFFER, id: 'o2' }]
    const last = lastUserIndex(chat)
    expect(last).toBe(1)
    // the map in SessionLog passes `i < last`: the first offer is superseded,
    // the one after the user's message is not
    expect(0 < last).toBe(true)
    expect(2 < last).toBe(false)
    expect(lastUserIndex([OFFER])).toBe(-1) // no user yet — nothing superseded
  })
})
