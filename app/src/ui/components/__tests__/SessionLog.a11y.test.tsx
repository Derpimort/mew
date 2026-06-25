/* #173 — semantic structure & aria-live for the chat stream. The app's vitest
   is headless (no jsdom). Two render seams carry the ARIA contract:

   • The store-independent chrome (log container, day landmark, composer, the
     off-screen announcer region) renders deterministically from SessionLog, so
     we assert it on the static markup.
   • Each message's article wrapper is a pure function of its `msg` prop, so we
     render LogLine directly — the store snapshot doesn't reflect setState under
     server rendering, but a prop always does.
   • The assertive start/finish copy is the pure `streamAnnouncement` edge
     function, unit-tested without a DOM. */

import { describe, expect, it, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionLog, LogLine } from '../SessionLog'
import { streamAnnouncement } from '../sessionAnnounce'
import { useMew } from '../../../state/store'
import type { ChatMessage } from '../../../domain/types'

const at = (h: number, m: number) => new Date(2026, 5, 19, h, m).getTime()

const USER: ChatMessage = { id: 'u1', role: 'user', body: 'block thursday morning', ts: at(9, 5) }
const MEW: ChatMessage = {
  id: 'm1',
  role: 'mew',
  body: 'done — thursday 9–11 is yours.',
  ts: at(14, 6),
}
const NUDGE: ChatMessage = {
  id: 'n1',
  role: 'nudge',
  body: 'a gentle check-in',
  ts: at(16, 7),
  nudgeType: 'drift',
  actions: [{ id: 'ok', label: 'Thanks', kind: 'primary' }],
}

describe('#173 — the chat container is a polite live log', () => {
  beforeEach(() => useMew.setState({ chat: [], thinking: false, workingStatus: null }))

  it('marks .log as role=log, aria-live=polite, non-atomic, labelled', () => {
    const html = renderToStaticMarkup(<SessionLog />)
    // class is first in source order, so role/live/atomic/label follow on it
    expect(html).toMatch(/class="log" role="log"/)
    expect(html).toMatch(/class="log"[^>]*aria-live="polite"/)
    expect(html).toMatch(/class="log"[^>]*aria-atomic="false"/)
    expect(html).toMatch(/class="log"[^>]*aria-label="chat session"/)
  })

  it('the log carries aria-busy, bound to the turn-in-flight flag', () => {
    // at rest the binding reads false — the announcements aren't parked
    expect(renderToStaticMarkup(<SessionLog />)).toMatch(/class="log"[^>]*aria-busy="false"/)
  })

  it('ships the off-screen assertive announcer region', () => {
    const html = renderToStaticMarkup(<SessionLog />)
    expect(html).toMatch(/aria-live="assertive"[^>]*aria-atomic="true"/)
    expect(html).toContain('left:-9999px')
  })
})

describe('#173 — every message is its own article', () => {
  it('a user line is role=article labelled "message from you at {time}"', () => {
    const html = renderToStaticMarkup(<LogLine msg={USER} />)
    expect(html).toMatch(/data-msg="u1"[^>]*role="article"/)
    expect(html).toContain('aria-label="message from you at 9:05"')
  })

  it('a mew line is role=article labelled "message from mew at {time}"', () => {
    const html = renderToStaticMarkup(<LogLine msg={MEW} />)
    expect(html).toMatch(/data-msg="m1"[^>]*role="article"/)
    expect(html).toContain('aria-label="message from mew at 14:06"')
  })

  it('a nudge card is the article itself (role on the card, no extra wrapper)', () => {
    const html = renderToStaticMarkup(<LogLine msg={NUDGE} />)
    expect(html).toMatch(/class="tui-nudge"[^>]*role="article"/)
    expect(html).toContain('aria-label="message from nudge at 16:07"')
  })

  it('keeps data-msg on the article so scroll-to-message still resolves it', () => {
    // the store's scrollIntoView targets [data-msg="…"]; the role must not
    // displace it onto a wrapper or that lookup breaks.
    const html = renderToStaticMarkup(<LogLine msg={USER} />)
    expect(html).toMatch(/<div data-msg="u1" role="article"/)
  })
})

describe('#173 — the day header is a skippable landmark', () => {
  beforeEach(() => useMew.setState({ chat: [] }))

  it('renders as a <section> labelled "{day} summary" with labelled count spans', () => {
    const html = renderToStaticMarkup(<SessionLog />)
    expect(html).toMatch(/<section class="log cm" aria-label="[a-z]+ summary"/)
    expect(html).toMatch(/<span aria-label="\d+ blocks?">/)
    expect(html).toMatch(/<span aria-label="\d+ mews? today">/)
  })
})

describe('#173 — the composer is named and described', () => {
  beforeEach(() => useMew.setState({ chat: [], thinking: false }))

  it('labels the textarea and points aria-describedby at the existing hint row', () => {
    const html = renderToStaticMarkup(<SessionLog />)
    expect(html).toContain('aria-label="compose message to MEW"')
    expect(html).toContain('aria-describedby="prompt-hints"')
    expect(html).toContain('class="prompt-hints" id="prompt-hints"')
  })
})

describe('#173 — "↓ new" does not announce at rest', () => {
  it('pinned to the bottom, the status pill is absent (no false announcement)', () => {
    // SSR can't trip the scroll gate, so we lock the at-rest invariant: the
    // role=status pill only mounts once the user scrolls off the bottom, so a
    // fresh log never speaks "new messages available".
    useMew.setState({ chat: [USER, MEW], thinking: false })
    expect(renderToStaticMarkup(<SessionLog />)).not.toContain('new messages available')
  })
})

describe('#173 — assertive announcement is one edge per turn', () => {
  it('rising edge of thinking announces the start', () => {
    expect(streamAnnouncement('', false, true)).toBe('mew is responding…')
  })
  it('falling edge announces completion', () => {
    expect(streamAnnouncement('mew is responding…', true, false)).toBe('response complete')
  })
  it('a steady tick re-fires nothing (returns the prior message verbatim)', () => {
    expect(streamAnnouncement('mew is responding…', true, true)).toBe('mew is responding…')
    expect(streamAnnouncement('response complete', false, false)).toBe('response complete')
  })
})
