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

/* ── #282 — tool cards ride the window like any row, and settled runs fold ── */

import { FOLD_OVER, collapseToolRuns, isSettledToolCard } from '../toolSteps'
import type { ToolCardState } from '../../../domain/types'

const toolMsg = (i: number, ts: number, state: ToolCardState): ChatMessage => ({
  id: `t${String(i).padStart(4, '0')}`,
  role: 'tool',
  body: '',
  ts,
  tool: { name: 'plan', verb: 'placing blocks', target: `step ${i}`, state },
})

describe('#282 — the collapse rule (pure)', () => {
  const at = (i: number) => MOUNT - 1000 + i // any ordered ts

  it('settled means a terminal state; running never counts', () => {
    expect(isSettledToolCard(toolMsg(1, at(1), 'done'))).toBe(true)
    expect(isSettledToolCard(toolMsg(2, at(2), 'error'))).toBe(true)
    expect(isSettledToolCard(toolMsg(3, at(3), 'interrupted'))).toBe(true)
    expect(isSettledToolCard(toolMsg(4, at(4), 'running'))).toBe(false)
    expect(isSettledToolCard(msg(5, at(5)))).toBe(false) // a plain row never folds
  })

  it(`runs of more than ${FOLD_OVER} consecutive settled cards fold; shorter runs pass through`, () => {
    const two = [toolMsg(0, at(0), 'done'), toolMsg(1, at(1), 'done')]
    expect(collapseToolRuns(two).every((x) => x.kind === 'msg')).toBe(true)

    const three = [...two, toolMsg(2, at(2), 'error')]
    const folded = collapseToolRuns(three)
    expect(folded).toHaveLength(1)
    expect(folded[0]).toMatchObject({ kind: 'steps', idx: 0 })
    expect((folded[0] as { msgs: ChatMessage[] }).msgs).toHaveLength(3)
  })

  it('a running card breaks the run and stays its own row', () => {
    const items = collapseToolRuns([
      toolMsg(0, at(0), 'done'),
      toolMsg(1, at(1), 'done'),
      toolMsg(2, at(2), 'running'),
      toolMsg(3, at(3), 'done'),
    ])
    // 2 settled ≤ FOLD_OVER pass through, running passes through, trailing settled passes through
    expect(items.map((x) => x.kind)).toEqual(['msg', 'msg', 'msg', 'msg'])
  })

  it('keeps source indices so the window can address rows chat-globally', () => {
    const items = collapseToolRuns([
      msg(0, at(0)),
      toolMsg(1, at(1), 'done'),
      toolMsg(2, at(2), 'done'),
      toolMsg(3, at(3), 'done'),
      msg(4, at(4)),
    ])
    expect(items.map((x) => [x.kind, x.idx])).toEqual([
      ['msg', 0],
      ['steps', 1],
      ['msg', 4],
    ])
  })

  it('is pure: the input array is untouched', () => {
    const input = [toolMsg(0, at(0), 'done'), toolMsg(1, at(1), 'done'), toolMsg(2, at(2), 'done')]
    const before = [...input]
    collapseToolRuns(input)
    expect(input).toEqual(before)
  })
})

describe('#282 — cards in the rendered window', () => {
  it('cards page like any row: a long history with card runs still mounts exactly PAGE articles', () => {
    /* windowing is role-blind (ts-ordered prefix math) and folding keeps every
       card's article — inside the <details> — so the article count is stable */
    const chat = Array.from({ length: 200 }, (_, i) =>
      i % 10 < 3 ? toolMsg(i, MOUNT - (200 - i) * 1000, 'done') : msg(i, MOUNT - (200 - i) * 1000)
    )
    const html = renderToStaticMarkup(
      <SessionWindow chat={chat} pages={1} mountedAt={MOUNT} thinking={false} />
    )
    expect(count(html, 'role="article"')).toBe(PAGE)
    expect(html).toContain('· earlier ·')
    expect(count(html, '<details class="tool-steps">')).toBeGreaterThan(0) // runs of 3 folded
  })

  it('>2 consecutive settled history cards render as ONE expandable "n steps" fold holding its articles', () => {
    const chat = [
      msg(0, MOUNT - 5000),
      toolMsg(1, MOUNT - 4000, 'done'),
      toolMsg(2, MOUNT - 3000, 'done'),
      toolMsg(3, MOUNT - 2000, 'error'),
      msg(4, MOUNT - 1000),
    ]
    const html = renderToStaticMarkup(
      <SessionWindow chat={chat} pages={1} mountedAt={MOUNT} thinking={false} />
    )
    expect(count(html, '<details class="tool-steps">')).toBe(1)
    expect(html).toContain('<summary>3 steps</summary>')
    // the fold holds its three card articles (expandable in place)
    expect(count(html, 'role="article"')).toBe(5)
    expect(count(html, 'class="tool-card"')).toBe(3)
  })

  it('two settled + one running stay individual cards — no fold, the shimmer stays visible', () => {
    const chat = [
      toolMsg(1, MOUNT + 1000, 'done'),
      toolMsg(2, MOUNT + 2000, 'done'),
      toolMsg(3, MOUNT + 3000, 'running'),
    ]
    const html = renderToStaticMarkup(
      <SessionWindow chat={chat} pages={1} mountedAt={MOUNT} thinking={false} />
    )
    expect(html).not.toContain('tool-steps')
    expect(count(html, 'class="tool-card"')).toBe(3)
    expect(count(html, 'tool-run')).toBe(1) // exactly the running card shimmers
  })

  it('history cards sit inside the aria-live=off group and never animate or shimmer', () => {
    const chat = [toolMsg(1, MOUNT - 2000, 'interrupted')]
    const html = renderToStaticMarkup(
      <SessionWindow chat={chat} pages={1} mountedAt={MOUNT} thinking={false} />
    )
    const off = html.indexOf('aria-live="off"')
    expect(off).toBeGreaterThan(-1)
    expect(html.indexOf('tool-card')).toBeGreaterThan(off)
    expect(html).not.toContain('tool-run') // interrupted replays quiet, no shimmer
    expect(html).not.toContain('opacity:0') // no entrance for history (motion initial)
  })

  it('a fresh card is a direct child of the polite region — announced like any landed row', () => {
    const chat = [toolMsg(1, MOUNT + 1000, 'running')]
    const html = renderToStaticMarkup(
      <SessionWindow chat={chat} pages={1} mountedAt={MOUNT} thinking={false} />
    )
    // it renders, and NOT inside the silent history group (which is empty here)
    expect(html).toContain('class="tool-card"')
    const off = html.indexOf('aria-live="off"')
    const offEnd = html.indexOf('</div>', off)
    expect(html.indexOf('tool-card')).toBeGreaterThan(offEnd)
  })

  it('a card settling at the tail is a chunk-shaped update: the window holds, liveTail hands the row its settled self', () => {
    const running = toolMsg(9, MOUNT + 1000, 'running')
    const settled = { ...running, tool: { ...running.tool!, state: 'done' as const } }
    const head = msg(0, MOUNT + 500)
    const before: ChatMessage[] = [head, running]
    const after: ChatMessage[] = [head, settled]
    expect(chatEqualExceptLiveTail(before, after)).toBe(true) // the list never re-renders
    expect(liveTail(after, running.id)).toBe(settled) // the card row repaints itself
  })
})
