/* #250 (phase 1) — the windowed session log. The vitest suite is headless (no
   jsdom), and zustand v5 under server rendering reads the store's INITIAL
   state, so the window contract is asserted the same way SessionLog.a11y does:

   • The window/animation/isolation RULES are pure functions (sessionWindow.ts)
     — unit-tested directly.
   • The rendered shape (how many rows mount, where the sentinel sits, which
     rows animate) is a pure function of SessionWindow's props — asserted on
     static markup.
   • Stream isolation is a selector contract: a chunk-shaped update must leave
     the window source snapshot IDENTICAL (the list never re-renders) while
     `liveTail` hands the fresh object to exactly the newest row. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LogLine, SessionWindow } from '../SessionLog'
import {
  PAGE,
  chatEqualExceptLiveTail,
  historyCount,
  isFreshMessage,
  liveTail,
  makeWindowSourceSelector,
  windowStart,
} from '../sessionWindow'
import type { ChatMessage } from '../../../domain/types'

/** the session log's mount instant for these specs — history sits before it */
const MOUNT = new Date(2026, 5, 19, 12, 0).getTime()

const msg = (i: number, ts: number): ChatMessage => ({
  id: `m${String(i).padStart(4, '0')}`,
  role: i % 2 ? 'mew' : 'user',
  body: `line ${i}`,
  ts,
})

/** n history messages, one per second, all ending before MOUNT */
const historyOf = (n: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => msg(i, MOUNT - (n - i) * 1000))

const count = (html: string, needle: string) => html.split(needle).length - 1

describe('#250 — window rules (pure)', () => {
  it('a page is 50 messages', () => {
    expect(PAGE).toBe(50)
  })

  it('fresh = appended strictly after mount', () => {
    expect(isFreshMessage(MOUNT + 1, MOUNT)).toBe(true)
    expect(isFreshMessage(MOUNT, MOUNT)).toBe(false)
    expect(isFreshMessage(MOUNT - 1, MOUNT)).toBe(false)
  })

  it('historyCount is the pre-mount prefix length', () => {
    const chat = [...historyOf(3), msg(900, MOUNT + 5_000)]
    expect(historyCount(chat, MOUNT)).toBe(3)
    expect(historyCount(historyOf(3), MOUNT)).toBe(3) // nothing fresh → all history
    expect(historyCount([], MOUNT)).toBe(0)
  })

  it('windowStart pages back by PAGE and floors at zero', () => {
    expect(windowStart(200, 1)).toBe(150)
    expect(windowStart(200, 2)).toBe(100)
    expect(windowStart(200, 4)).toBe(0)
    expect(windowStart(200, 99)).toBe(0)
    expect(windowStart(30, 1)).toBe(0)
    expect(windowStart(0, 1)).toBe(0)
  })
})

describe('#250 — stream isolation is a selector contract', () => {
  const [a, b] = historyOf(2)
  const tail = msg(900, MOUNT + 1_000)

  it('a chunk-shaped update (tail body rewritten, same id) compares equal', () => {
    const grown = { ...tail, body: tail.body + ' more tokens' }
    expect(chatEqualExceptLiveTail([a, b, tail], [a, b, grown])).toBe(true)
  })

  it('appends, removals, and non-tail replacements compare unequal', () => {
    expect(chatEqualExceptLiveTail([a, b], [a, b, tail])).toBe(false)
    expect(chatEqualExceptLiveTail([a, b, tail], [a, b])).toBe(false)
    const resolved = { ...a, resolved: 'noted' }
    expect(chatEqualExceptLiveTail([a, b, tail], [resolved, b, tail])).toBe(false)
    // a DIFFERENT message in tail position is a real change, not a chunk
    expect(chatEqualExceptLiveTail([a, b, tail], [a, b, msg(901, MOUNT + 2_000)])).toBe(false)
    expect(chatEqualExceptLiveTail([], [])).toBe(true)
  })

  it('the window source snapshot holds its reference across chunk updates — the list never re-renders mid-stream', () => {
    const select = makeWindowSourceSelector()
    const first = select({ chat: [a, b, tail] })
    const second = select({ chat: [a, b, { ...tail, body: 'line 900 plus a chunk' }] })
    expect(second).toBe(first)
    // …and moves on a real append, exactly once
    const appended = select({ chat: [a, b, tail, msg(901, MOUNT + 2_000)] })
    expect(appended).not.toBe(first)
    expect(appended.length).toBe(4)
  })

  it('liveTail hands the fresh object to the newest row only', () => {
    const grown = { ...tail, body: 'line 900 plus a chunk' }
    expect(liveTail([a, b, grown], tail.id)).toBe(grown) // the streaming row
    expect(liveTail([a, b, grown], a.id)).toBe(null) // every other row: null, forever
    expect(liveTail([], tail.id)).toBe(null)
  })
})

describe('#250 — the window renders only the newest page of history', () => {
  it('200 messages → exactly PAGE articles plus the sentinel', () => {
    const html = renderToStaticMarkup(
      <SessionWindow chat={historyOf(200)} pages={1} mountedAt={MOUNT} thinking={false} />
    )
    expect(count(html, 'role="article"')).toBe(PAGE)
    expect(html).toContain('· earlier ·')
    expect(html).toContain('aria-label="show 50 earlier messages"')
    // the page is the NEWEST 50: m0150 is the window's first row, m0149 is not mounted
    expect(html).toContain('data-msg="m0150"')
    expect(html).toContain('data-msg="m0199"')
    expect(html).not.toContain('data-msg="m0149"')
  })

  it('≤ PAGE messages → everything renders, no sentinel', () => {
    const html = renderToStaticMarkup(
      <SessionWindow chat={historyOf(50)} pages={1} mountedAt={MOUNT} thinking={false} />
    )
    expect(count(html, 'role="article"')).toBe(50)
    expect(html).not.toContain('· earlier ·')
    expect(html).not.toContain('beginning of session')
  })

  it('each page widens the window by PAGE; the sentinel names the remainder', () => {
    const html = renderToStaticMarkup(
      <SessionWindow chat={historyOf(120)} pages={2} mountedAt={MOUNT} thinking={false} />
    )
    expect(count(html, 'role="article"')).toBe(100)
    expect(html).toContain('aria-label="show 20 earlier messages"')
  })

  it('exhausted history → the sentinel yields to the beginning endstop', () => {
    const html = renderToStaticMarkup(
      <SessionWindow chat={historyOf(120)} pages={3} mountedAt={MOUNT} thinking={false} />
    )
    expect(count(html, 'role="article"')).toBe(120)
    expect(html).not.toContain('· earlier ·')
    expect(html).toContain('· beginning of session ·')
  })

  it('the sentinel is a real button — keyboard-reachable by construction', () => {
    const html = renderToStaticMarkup(
      <SessionWindow chat={historyOf(60)} pages={1} mountedAt={MOUNT} thinking={false} />
    )
    expect(html).toMatch(/<button type="button"[^>]*class="log-earlier"/)
  })
})

describe('#250 — history is static and silent; only post-mount rows animate', () => {
  it('fresh rows always render (outside the window) and carry the entrance initial; history rows are plain', () => {
    const chat = [...historyOf(200), msg(900, MOUNT + 5_000), msg(901, MOUNT + 6_000)]
    const html = renderToStaticMarkup(
      <SessionWindow chat={chat} pages={1} mountedAt={MOUNT} thinking={false} />
    )
    expect(count(html, 'role="article"')).toBe(PAGE + 2)
    // the blur-up initial style appears exactly once per fresh row
    expect(count(html, 'opacity:0')).toBe(2)
    expect(count(html, 'blur(3px)')).toBe(2)
  })

  it('paged-in history sits inside an aria-live=off group, so paging never floods a reader', () => {
    const html = renderToStaticMarkup(
      <SessionWindow chat={historyOf(200)} pages={1} mountedAt={MOUNT} thinking={false} />
    )
    expect(html).toContain('aria-live="off"')
    // the log container itself keeps the #173 contract
    expect(html).toMatch(/class="log" role="log"/)
    expect(html).toMatch(/class="log"[^>]*aria-live="polite"/)
    expect(html).toMatch(/class="log"[^>]*aria-atomic="false"/)
  })
})

describe('#250 — rows are memoized', () => {
  it('LogLine is a React.memo component (sound: messages are append-only, replaced immutably)', () => {
    expect((LogLine as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
  })
})

describe('#250 phase 2 — the sentinel reaches past memory into storage', () => {
  it('in-memory history exhausted but storage holds more → the sentinel stays, promising a stored page', () => {
    const html = renderToStaticMarkup(
      <SessionWindow
        chat={historyOf(40)}
        pages={1}
        mountedAt={MOUNT}
        thinking={false}
        hasEarlierStored
      />
    )
    expect(count(html, 'role="article"')).toBe(40) // everything loaded renders
    expect(html).toContain('· earlier ·')
    expect(html).toContain(`aria-label="show ${PAGE} earlier messages"`)
    expect(html).not.toContain('beginning of session') // storage isn't done yet
  })

  it('the endstop waits for BOTH tiers: paged-in memory + an exhausted store', () => {
    const stored = renderToStaticMarkup(
      <SessionWindow
        chat={historyOf(120)}
        pages={3}
        mountedAt={MOUNT}
        thinking={false}
        hasEarlierStored
      />
    )
    expect(stored).toContain('· earlier ·')
    expect(stored).not.toContain('· beginning of session ·')
    const done = renderToStaticMarkup(
      <SessionWindow
        chat={historyOf(120)}
        pages={3}
        mountedAt={MOUNT}
        thinking={false}
        hasEarlierStored={false}
      />
    )
    expect(done).not.toContain('· earlier ·')
    expect(done).toContain('· beginning of session ·')
  })

  it('with in-memory pages still ahead, the sentinel names the in-memory remainder as before', () => {
    const html = renderToStaticMarkup(
      <SessionWindow
        chat={historyOf(120)}
        pages={2}
        mountedAt={MOUNT}
        thinking={false}
        hasEarlierStored
      />
    )
    expect(html).toContain('aria-label="show 20 earlier messages"')
  })
})
