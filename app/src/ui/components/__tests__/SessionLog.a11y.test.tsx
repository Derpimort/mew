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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { SessionLog, LogLine, QueuedRow, StopButton } from '../SessionLog'
import { streamAnnouncement } from '../sessionAnnounce'
import { useMew } from '../../../state/store'
import type { ChatMessage } from '../../../domain/types'

const here = dirname(fileURLToPath(import.meta.url))

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

describe('#280 — the composer never locks; the queued state reads politely', () => {
  it('the queued row is a polite status region: queued ❯ text + a named cancel chip', () => {
    const html = renderToStaticMarkup(
      <QueuedRow text="also block friday pm for review" onCancel={() => {}} />
    )
    expect(html).toMatch(/class="prompt-queued" role="status"/)
    expect(html).toContain('queued')
    expect(html).toContain('❯')
    expect(html).toContain('also block friday pm for review')
    // the cancel chip's accessible name contains its visible label (WCAG 2.5.3)
    expect(html).toContain('aria-label="cancel queued message"')
    expect(html).toMatch(/<button[^>]*>cancel<\/button>/)
  })

  it('a long queued thought truncates in the middle — head and tail stay readable', () => {
    const long = `start of the thought ${'x'.repeat(120)} end of the thought`
    const html = renderToStaticMarkup(<QueuedRow text={long} onCancel={() => {}} />)
    expect(html).toContain('start of the thought')
    expect(html).toContain('end of the thought')
    expect(html).toContain('…')
    expect(html).not.toContain('x'.repeat(120)) // the middle is what gave way
  })

  it('the stop affordance and its accessible name flip together (stop ↔ stop & send)', () => {
    const atRest = renderToStaticMarkup(<StopButton queued={false} onStop={() => {}} />)
    expect(atRest).toContain('aria-label="stop"')
    expect(atRest).toContain('■ stop')
    expect(atRest).not.toContain('stop &amp; send')
    const withQueue = renderToStaticMarkup(<StopButton queued onStop={() => {}} />)
    expect(withQueue).toContain('aria-label="stop &amp; send"')
    expect(withQueue).toContain('■ stop &amp; send')
  })

  it('Esc shares the stop affordance gate — the keyboard twin is never dead (#117)', () => {
    // SSR can't fire keydown, so pin the structure: ONE derived gate
    // (thinking OR a message still queued) drives both the Esc handler and
    // the visible ■ stop affordance — they can never drift apart.
    const src = readFileSync(resolve(here, '../SessionLog.tsx'), 'utf8')
    expect(src).toMatch(/const turnLive = thinking \|\| queued != null/)
    expect(src).toMatch(/e\.key === 'Escape' && turnLive/)
    expect(src).toMatch(/\{turnLive \? \(/)
    // and no stray thinking-only Esc gate survives
    expect(src).not.toMatch(/Escape' && thinking/)
  })

  it('the composer textarea never carries disabled — typing lands at every phase', () => {
    // markup: the rendered textarea has no disabled attribute…
    const html = renderToStaticMarkup(<SessionLog />)
    expect(html).toMatch(/<textarea[^>]*aria-label="compose message to MEW"/)
    expect(html).not.toMatch(/<textarea[^>]*disabled/)
    // …and the lock can't quietly return: no thinking-bound disable in the
    // component source, no orphaned disabled-composer style (same readFileSync
    // pin the focus suite uses for structure that SSR can't reach).
    const src = readFileSync(resolve(here, '../SessionLog.tsx'), 'utf8')
    expect(src).not.toContain('disabled={thinking}')
    const css = readFileSync(resolve(here, '../../primitives/primitives.css'), 'utf8')
    expect(css).not.toContain('.prompt-row textarea:disabled')
    expect(css).toMatch(/\.prompt-queued\s*\{/)
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

/* ── #282 — tool activity cards: labeled articles, one polite settle ── */

import { TOOL_ERROR_NOTE, TOOL_INTERRUPTED_NOTE } from '../../../domain/toolCard'
import type { ToolCardState } from '../../../domain/types'

const count = (html: string, needle: string) => html.split(needle).length - 1

const toolMsg = (state: ToolCardState, note?: string): ChatMessage => ({
  id: `t-${state}`,
  role: 'tool',
  body: '',
  ts: at(10, 15),
  tool: {
    name: 'plan',
    verb: 'placing blocks',
    target: 'thursday 9:00–12:00',
    state,
    ...(note ? { note } : {}),
  },
})

describe('#282 — a card is an article labeled "mew action — <verb>, <state>"', () => {
  it('running: labeled, data-msg kept, shimmer class on the text', () => {
    const html = renderToStaticMarkup(<LogLine msg={toolMsg('running')} />)
    expect(html).toMatch(/class="tool-card" data-msg="t-running" role="article"/)
    expect(html).toContain('aria-label="mew action — placing blocks, running"')
    expect(html).toContain('class="tool-run"')
    expect(html).toContain('placing blocks — thursday 9:00–12:00…')
  })

  it('done: ✓ in the confirmation color class, no shimmer, label carries the settled state', () => {
    const html = renderToStaticMarkup(<LogLine msg={toolMsg('done')} />)
    expect(html).toContain('aria-label="mew action — placing blocks, done"')
    expect(html).toContain('<span class="ok">✓ </span>')
    expect(html).not.toContain('tool-run')
  })

  it('error: a quiet MEW-voiced line, never a raw error (the note the wrapper set)', () => {
    const html = renderToStaticMarkup(<LogLine msg={toolMsg('error', TOOL_ERROR_NOTE)} />)
    expect(html).toContain('aria-label="mew action — placing blocks, error"')
    /* the note renders HTML-escaped; pin the class + an apostrophe-free slice */
    expect(html).toContain('class="cm tool-note"')
    expect(html).toContain('nothing changed')
    expect(html).not.toContain('tool-run')
    expect(html).not.toContain('✓')
  })

  it('interrupted (hydrated history): the quiet default line, no shimmer ever', () => {
    const html = renderToStaticMarkup(<LogLine msg={toolMsg('interrupted')} />)
    expect(html).toContain('aria-label="mew action — placing blocks, interrupted"')
    expect(html).toContain(`# ${TOOL_INTERRUPTED_NOTE}`) // no apostrophe — renders verbatim
    expect(html).not.toContain('tool-run')
  })

  it('degrades to verb-only when a card has no target', () => {
    const bare: ChatMessage = {
      id: 't-bare',
      role: 'tool',
      body: '',
      ts: at(10, 16),
      tool: { name: 'undoLast', verb: 'putting it back', state: 'done' },
    }
    const html = renderToStaticMarkup(<LogLine msg={bare} />)
    expect(html).toContain('aria-label="mew action — putting it back, done"')
    expect(html).toContain('<span>putting it back</span>') // no target joiner on the visible line
  })

  it('the settle transition is one content change: running and done markup differ only in glyph/shimmer/ellipsis', () => {
    /* the shimmer itself is CSS animation on a stable text node — settling
       swaps the text once, so the polite log announces once per settle and
       never per shimmer frame */
    const running = renderToStaticMarkup(<LogLine msg={toolMsg('running')} />)
    const done = renderToStaticMarkup(<LogLine msg={toolMsg('done')} />)
    expect(running).not.toBe(done)
    expect(count(running, 'aria-live')).toBe(0) // the card adds no live region of its own
    expect(count(done, 'aria-live')).toBe(0)
  })
})
