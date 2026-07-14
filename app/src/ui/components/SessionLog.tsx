/* The session — `mew session — tty1` (DESIGN_LANGUAGE §4). The chat thread as
   a terminal log: you ❯ / mew ❯ lines, ★ mews, ✓ confirmations, nudges as
   steel cards with machined buttons, a composer that follows your typing.
   Same store, same nudge engine — only the skin changed.

   #250 (phase 1): the log renders a WINDOW, not the whole history. Only the
   newest page of pre-mount messages mounts; a "· earlier ·" sentinel above the
   list pages older rows in on scroll or click (position preserved). Rows are
   memoized, only post-mount rows animate, and a streaming turn re-renders the
   live row alone — see sessionWindow.ts for the pure rules. */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useMew, useLive, clockNow } from '../../state/store'
import { Button } from '../primitives/Button'
import { Markdown } from './Markdown'
import type { ChatMessage } from '../../domain/types'
import { choicePicked, lastUserIndex } from '../../domain/choices'
import { dayKey, fmtDowLong, fmtTime, minOfDay } from '../../domain/time'
import { blocksForDay } from '../../domain/week'
import { streamAnnouncement } from './sessionAnnounce'
import {
  PAGE,
  historyCount,
  isFreshMessage,
  liveTail,
  makeWindowSourceSelector,
  windowStart,
} from './sessionWindow'

/** How close to the bottom (px) still counts as "stuck to the bottom" — within
    this band new output auto-scrolls; scroll up past it and MEW stops yanking. */
const STICK_THRESHOLD = 80

/** id the prompt's aria-describedby points at, so a screen reader reads the
    ⌘K / shift+↵ hint line after the textarea's own label. */
const PROMPT_HINTS_ID = 'prompt-hints'

export function SessionLog() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /* sticky-bottom state: are we pinned to the latest line, or has the user
     scrolled up to read history? `atBottom` drives both the auto-scroll and
     the "↓ new" affordance. A ref mirrors it so the growth observer reads
     the live value without re-subscribing. */
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(true)

  const isNearBottom = (el: HTMLDivElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD

  const stickToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    atBottomRef.current = true
    setAtBottom(true)
  }, [])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const near = isNearBottom(el)
    atBottomRef.current = near
    setAtBottom(near)
  }, [])

  /* follow the log as it grows — by watching the DOM, not the store. New rows,
     streamed tokens, the thinking row: anything that makes the log taller
     re-sticks the view while we're pinned; scrolled up, nothing yanks. (This
     shell subscribes to no per-turn state at all, so a streaming turn never
     re-renders it — the ResizeObserver is what keeps the follow behavior.)
     Firing on observe() also handles the initial jump-to-latest at mount.
     Paging older rows in resizes the log too, but paging only happens while
     scrolled up (not at bottom), so the two never fight. */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    /* by ROLE, not class: the day header is `.log cm` too and sits first in the
       scroller — observing it would watch a node that never grows */
    const logEl = el.querySelector('[role="log"]')
    if (!logEl) return
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(logEl)
    return () => ro.disconnect()
  }, [])

  /* ⌘K / Ctrl+K focuses the prompt */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <div className="trm-bar">
        <span className="dots">
          <span />
          <span />
          <span />
        </span>
        <span>mew session — tty1</span>
        <span style={{ marginLeft: 'auto' }}>
          <kbd>⌘K</kbd>
        </span>
      </div>
      <div className="session-wrap">
        <div className="session-scroll" ref={scrollRef} onScroll={onScroll}>
          <DayHeader />
          <LogList />
        </div>
        <TurnAnnouncer />
        {!atBottom && (
          <button
            type="button"
            className="scroll-new"
            role="status"
            aria-live="polite"
            aria-label="new messages available"
            onClick={() => stickToBottom('smooth')}
          >
            ↓ new
          </button>
        )}
      </div>
      <div className="session-compose">
        <Prompt inputRef={inputRef} />
      </div>
    </>
  )
}

/* one assertive announcement per turn: a screen reader hears "mew is
   responding…" the moment the turn starts, then "response complete" once it
   settles. The visible thinking row is `aria-hidden` (its dots/label would
   read as noise), so this hidden region is the single spoken signal — driven
   off `thinking` alone, so it fires within a frame of thinking=true. Its own
   component so the shell above stays free of turn state. */
function TurnAnnouncer() {
  const thinking = useMew((s) => s.thinking)
  const [streamMsg, setStreamMsg] = useState('')
  const wasThinking = useRef(false)
  useEffect(() => {
    setStreamMsg((prev) => streamAnnouncement(prev, wasThinking.current, thinking))
    wasThinking.current = thinking
  }, [thinking])
  return (
    <div
      aria-live="assertive"
      aria-atomic="true"
      style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}
    >
      {streamMsg}
    </div>
  )
}

/* The store-connected side of the window: owns how many pages are revealed,
   keeps the reader's place when a page prepends, pages automatically when the
   sentinel scrolls into view, and widens the window when a jump (scrollToMsgId)
   targets a row above it. Subscribes to chat through the memoizing window
   selector, so per-chunk stream updates never reach it (sessionWindow.ts). */
const LogList = memo(function LogList() {
  const chat = useMew(useMemo(() => makeWindowSourceSelector(), []))
  const thinking = useMew((s) => s.thinking)
  const scrollToMsgId = useMew((s) => s.scrollToMsgId)
  const clearScroll = useMew((s) => s.clearScroll)
  /* the stored tier of "earlier" (#250 phase 2): boot hydrates only the newest
     page of chat, so once the in-memory head is exhausted the sentinel keeps
     going — each trigger pulls the previous page out of Dexie and prepends it,
     with the same scroll-restore the in-memory path uses. */
  const chatHasEarlier = useMew((s) => s.chatHasEarlier)
  const loadEarlierChat = useMew((s) => s.loadEarlierChat)
  /* the one boundary (#250): captured once at mount — rows at or before it are
     history (windowed, static, silent), rows after it are fresh (always shown,
     animated, announced). On the store's clock, which ?t= may offset. */
  const [mountedAt] = useState(() => clockNow())
  const [pages, setPages] = useState(1)
  const logRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLButtonElement>(null)
  /* scroll metrics captured when a page-in is REQUESTED — the prepend lands a
     render later, and the delta between these and the post-render metrics is
     exactly what the scroll position must absorb. start/headId pin WHICH
     change to absorb: a stored page is a whole roundtrip away, and an append
     that lands meanwhile must not consume the restore (it added height BELOW
     the reader, not above). */
  const pendingRestore = useRef<{
    top: number
    height: number
    refocus: boolean
    start: number
    headId: string | null
  } | null>(null)
  const storeLoadPending = useRef(false)

  const boundary = historyCount(chat, mountedAt)
  const start = windowStart(boundary, pages)

  const loadEarlier = useCallback(() => {
    const el = logRef.current?.closest<HTMLElement>('.session-scroll')
    const restore = {
      top: el?.scrollTop ?? 0,
      height: el?.scrollHeight ?? 0,
      /* a keyboard reader on the button loses it if this page-in exhausts
         history (the button unmounts) — hand focus to the beginning marker */
      refocus: typeof document !== 'undefined' && document.activeElement === sentinelRef.current,
      start,
      headId: chat[0]?.id ?? null,
    }
    if (start > 0) {
      /* rows already in memory — reveal the next page of them */
      pendingRestore.current = restore
      setPages((p) => p + 1)
      return
    }
    if (!chatHasEarlier || storeLoadPending.current) return
    /* in-memory head exhausted — page the previous slice out of storage; the
       prepend lands async, so the restore parks until those rows render */
    storeLoadPending.current = true
    pendingRestore.current = restore
    void loadEarlierChat().then((added) => {
      storeLoadPending.current = false
      if (added > 0) setPages((p) => p + Math.ceil(added / PAGE))
      else pendingRestore.current = null // nothing arrived — nothing to absorb
    })
  }, [start, chat, chatHasEarlier, loadEarlierChat])

  /* keep the reader's place while an older page prepends: same content point,
     shifted by exactly the height the new rows added above it. (The scroller
     carries `overflow-anchor: none`, so this restore is the single authority —
     the browser's own anchoring never double-compensates.) A stored page-in
     keeps start at 0 while chat itself grows, so the effect keys on both —
     and consumes the restore only once the change it was armed for landed
     (start narrowed, or a new head prepended), letting appends pass through. */
  useLayoutEffect(() => {
    const pending = pendingRestore.current
    if (!pending) return
    const el = logRef.current?.closest<HTMLElement>('.session-scroll')
    if (start >= pending.start && (chat[0]?.id ?? null) === pending.headId) {
      /* an append passed through while the stored page was in flight — its
         height sits BELOW the reader, so re-base the captured metrics and
         keep waiting; the eventual prepend delta stays exact */
      if (el) {
        pending.top = el.scrollTop
        pending.height = el.scrollHeight
      }
      return
    }
    pendingRestore.current = null
    if (!el) return
    if (pending.refocus && start === 0 && !chatHasEarlier)
      logRef.current?.querySelector<HTMLElement>('.log-beginning')?.focus({ preventScroll: true })
    el.scrollTop = pending.top + (el.scrollHeight - pending.height)
  }, [start, chat, chatHasEarlier])

  /* scrolling the sentinel into view pages history in hands-free; the click
     path stays for keyboards and short logs. Only while the reader has left
     the live bottom — a log that fits its viewport must not page itself. */
  const hasEarlier = start > 0 || chatHasEarlier
  useEffect(() => {
    if (!hasEarlier) return
    const btn = sentinelRef.current
    if (!btn || typeof IntersectionObserver === 'undefined') return
    const el = btn.closest<HTMLElement>('.session-scroll')
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          if (el && el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD) continue
          loadEarlier()
        }
      },
      /* pre-fetch a beat before the reader hits the top edge */
      { root: el ?? null, rootMargin: '120px 0px 0px 0px' }
    )
    io.observe(btn)
    return () => io.disconnect()
  }, [hasEarlier, loadEarlier])

  /* an explicit jump (a nudge clicked elsewhere) always wins — and if the
     target sits above the window, widen the window first; this effect re-runs
     once the rows exist, then scrolls. */
  useEffect(() => {
    if (!scrollToMsgId) return
    const idx = chat.findIndex((m) => m.id === scrollToMsgId)
    if (idx !== -1 && idx < start) {
      /* widening is imperative sequencing (reveal → wait for rows → scroll),
         not derived state — deferred a frame so it never cascades a render */
      const raf = requestAnimationFrame(() => setPages(Math.ceil((boundary - idx) / PAGE)))
      return () => cancelAnimationFrame(raf)
    }
    logRef.current
      ?.querySelector(`[data-msg="${scrollToMsgId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    clearScroll()
  }, [scrollToMsgId, chat, start, boundary, clearScroll])

  return (
    <SessionWindow
      chat={chat}
      pages={pages}
      mountedAt={mountedAt}
      thinking={thinking}
      hasEarlierStored={chatHasEarlier}
      onEarlier={loadEarlier}
      logRef={logRef}
      sentinelRef={sentinelRef}
    />
  )
})

/* The windowed log itself — a pure function of its props (chat, pages,
   mountedAt), so the whole window contract is assertable from static markup
   (the vitest suite is headless; store setState is invisible to SSR, props
   never are). LogList feeds it live; tests feed it directly. */
export function SessionWindow({
  chat,
  pages,
  mountedAt,
  thinking,
  hasEarlierStored = false,
  onEarlier,
  logRef,
  sentinelRef,
}: {
  chat: ChatMessage[]
  pages: number
  mountedAt: number
  thinking: boolean
  /** Storage holds chat older than this array's head (#250 phase 2): keep the
      sentinel alive past the in-memory rows, and hold the beginning endstop
      until the stored tier is exhausted too. */
  hasEarlierStored?: boolean
  onEarlier?: () => void
  logRef?: React.Ref<HTMLDivElement>
  sentinelRef?: React.Ref<HTMLButtonElement>
}) {
  const reduceMotion = useReducedMotion()
  const boundary = historyCount(chat, mountedAt)
  const start = windowStart(boundary, pages)
  const history = chat.slice(start, boundary)
  const fresh = chat.slice(boundary)
  /* option-chip liveness (#254) against the WHOLE chat, not the window slice:
     a chips row is superseded once any newer user message exists — even one
     the window hasn't paged in / has scrolled past. One O(n) pass per render;
     rows are addressed by their chat-global index (start+j / boundary+j).
     Only choice-carrying rows receive the flags (plain rows get constant
     false), so a user turn moving lastUser — or the per-turn thinking flip —
     never busts the memo of the thousand rows that don't care. */
  const lastUser = lastUserIndex(chat)
  const hasChoices = (m: ChatMessage) => (m.choices?.length ?? 0) > 0
  const supersededAt = (m: ChatMessage, globalIdx: number) => hasChoices(m) && globalIdx < lastUser
  /* the chat thread as a live log: new lines are announced politely and
     one at a time (aria-atomic=false), each row is its own article so a
     reader can step message-to-message; aria-busy parks those announcements
     while a turn is mid-stream. */
  return (
    <div
      ref={logRef}
      className="log"
      role="log"
      aria-live="polite"
      aria-atomic="false"
      aria-busy={thinking}
      aria-label="chat session"
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      {(start > 0 || hasEarlierStored) && (
        <button
          type="button"
          ref={sentinelRef}
          className="log-earlier"
          onClick={onEarlier}
          aria-label={`show ${start > 0 ? Math.min(PAGE, start) : PAGE} earlier messages`}
        >
          · earlier ·
        </button>
      )}
      {start === 0 && !hasEarlierStored && pages > 1 && boundary > 0 && (
        /* history fully paged in — memory AND storage — a quiet endstop;
           focusable so the reader who exhausted the sentinel hears where
           they landed */
        <div className="cm log-beginning" tabIndex={-1}>
          · beginning of session ·
        </div>
      )}
      {/* pre-mount history: windowed, and silent under aria-live so paging in
          fifty old rows never floods a screen reader — each row is still an
          article, so step-through (#173) walks them like any other. */}
      <div aria-live="off" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {history.map((m, j) => (
          <SessionRow
            key={m.id}
            msg={m}
            animate={false}
            superseded={supersededAt(m, start + j)}
            thinking={hasChoices(m) && thinking}
          />
        ))}
      </div>
      {/* rows appended after mount: direct children of the polite region
          (announced), each landing like terminal output — blur-up entrance,
          once, unless the reader asked for reduced motion. */}
      {fresh.map((m, j) => (
        <SessionRow
          key={m.id}
          msg={m}
          animate={!reduceMotion && isFreshMessage(m.ts, mountedAt)}
          superseded={supersededAt(m, boundary + j)}
          thinking={hasChoices(m) && thinking}
        />
      ))}
      {thinking && <LiveThinkingRow />}
    </div>
  )
}

/* One row of the window. React.memo is SOUND here (and on LogLine below)
   because chat is append-only and message objects are never mutated in place —
   the store replaces an object immutably when a message changes, so reference
   equality on `msg` is a complete change detector.

   The narrow `liveTail` subscription is the stream isolation (#250): while
   this message is the newest in the store — the one a live turn's flush()
   rewrites per chunk — the row reads it fresh itself. Every other row selects
   `null` forever, so a chunk re-renders exactly one row, and the list around
   it (whose window selector ignores live-tail churn) doesn't re-render at all. */
const SessionRow = memo(function SessionRow({
  msg,
  animate,
  superseded = false,
  thinking = false,
}: {
  msg: ChatMessage
  animate: boolean
  /** #254: a newer user message landed after this row — its option chips are
      inert. Kept in the default shallow memo comparison (no custom comparator)
      so the flip re-renders exactly the chips row it concerns; SessionWindow
      feeds plain rows a constant false, so their memo never notices. */
  superseded?: boolean
  /** #254: a turn is mewing — chips park exactly like the composer
      (disabled={thinking}); pickChoice would swallow a mid-turn click anyway.
      Same memo discipline as `superseded`: significant under the default
      shallow comparison, constant false for rows without choices. */
  thinking?: boolean
}) {
  const live = useMew((s) => liveTail(s.chat, msg.id))
  const m = live ?? msg
  if (!animate) {
    /* history and paged-in rows: plain div — no motion instance for rows whose
       entrance moment is long past */
    return (
      <div>
        <LogLine msg={m} superseded={superseded} thinking={thinking} />
      </div>
    )
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, filter: 'blur(3px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <LogLine msg={m} superseded={superseded} thinking={thinking} />
    </motion.div>
  )
})

/* MEW's turn-in-flight line. Until tokens stream, a tasteful 3-dot pulse is the
   "typing" signal; a short working-status label (set by the executors) rides
   alongside it. It's `aria-hidden` — pulsing dots and a churning status label
   are visual noise to a reader; the turn's start/finish is spoken once by the
   assertive region in SessionLog instead. Once tokens land the reply text takes
   over and this row disappears. */
function ThinkingRow({ status }: { status: string | null }) {
  return (
    <div className="mew-thinking" aria-hidden="true">
      <span className="p-mew">mew</span> <span className="p-arr">❯</span>{' '}
      <span className="typing">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </span>
      {status && <span className="working">{status}</span>}
    </div>
  )
}

/* the working label churns as executors run — its own narrow subscription so
   each change repaints this leaf, never the list above it */
function LiveThinkingRow() {
  const status = useMew((s) => s.workingStatus)
  return <ThinkingRow status={status} />
}

function DayHeader() {
  const blocks = useMew((s) => s.blocks)
  const nowMs = useMew((s) => s.nowMs)
  const live = useLive()
  const todayKey = dayKey(new Date(nowMs))
  const count = blocksForDay(blocks, todayKey).length
  const day = fmtDowLong(todayKey).toLowerCase()
  const mews = live.mewsToday
  /* a landmark a reader can skip past (or jump to) — the day's name labels the
     region, the counts ride in spans whose aria-label spells out the glyphs the
     terminal `·` separators leave implicit. */
  return (
    <section className="log cm" aria-label={`${day} summary`} style={{ flex: 'none' }}>
      # {day} ·{' '}
      <span aria-label={`${count} block${count === 1 ? '' : 's'}`}>
        {count} block{count === 1 ? '' : 's'}
      </span>{' '}
      ·{' '}
      <span aria-label={`${mews} mew${mews === 1 ? '' : 's'} today`}>
        {mews} mew{mews === 1 ? '' : 's'}
      </span>
    </section>
  )
}

/** what a reader hears as the role on a message article — the UI's own words,
    not the raw enum, so a `user` line is announced "message from you …". */
const ROLE_WORD: Record<ChatMessage['role'], string> = { user: 'you', mew: 'mew', nudge: 'nudge' }

/* Memoized (see SessionRow's note): messages are append-only and replaced
   immutably, never mutated — so `msg` reference equality is a sound bail-out
   and a list re-render touches O(changed) rows, not O(history). The #254 flag
   below rides the same default shallow comparison, so it stays significant. */
export const LogLine = memo(function LogLine({
  msg,
  superseded = false,
  thinking = false,
}: {
  msg: ChatMessage
  /** List-level context from the window (#254): a newer user message landed
      after this row, so any option chips on it are inert. Rendering stays a
      pure function of props — the store's pickChoice re-derives the same law
      from the live chat, so a stale click can never act. */
  superseded?: boolean
  /** Turn-level context from the window (#254): a turn is mewing, so chips
      park exactly like the composer (disabled={thinking}) — what looks
      clickable must be clickable. Same pure-props seam as `superseded`. */
  thinking?: boolean
}) {
  const showScience = useMew((s) => s.settings.showScience)
  const showReasoning = useMew((s) => s.settings.showReasoning)
  const nudgeAction = useMew((s) => s.nudgeAction)

  /* every line is its own article so a reader can walk message-to-message; the
     label carries who said it and when, which the terminal `you ❯` / timestamps
     only show visually. */
  const time = fmtTime(minOfDay(new Date(msg.ts)))
  const articleLabel = `message from ${ROLE_WORD[msg.role]} at ${time}`

  if (msg.role === 'user') {
    return (
      <div data-msg={msg.id} role="article" aria-label={articleLabel}>
        <span className="p-you">you</span> <span className="p-arr">❯</span>{' '}
        <b style={{ whiteSpace: 'pre-wrap' }}>{msg.body}</b>
      </div>
    )
  }

  if (msg.role === 'mew') {
    const isMew = /^that's a mew/i.test(msg.body)
    const isOk = /^(done|moved|held|released|kept|placed|started|right-sized) —/i.test(msg.body)
    const isAside = msg.body.startsWith('(')
    return (
      <div
        data-msg={msg.id}
        role="article"
        aria-label={articleLabel}
        className={isAside ? 'cm' : ''}
      >
        <span className="p-mew">mew</span> <span className="p-arr">❯</span>{' '}
        {isMew && <span className="mw">★ </span>}
        {isOk && <span className="ok">✓ </span>}
        <Markdown source={msg.body} />
        {/* the pre-tool reasoning snapshot — collapsed by default so the reply
            stays clean; open it to see what the model planned before it acted
            (#166). Native <details>: real DOM, React-escaped, no markup smuggled. */}
        {showReasoning && msg.reasoning && (
          <details className="reasoning">
            <summary>planned before acting</summary>
            <div className="reasoning-body">{msg.reasoning}</div>
          </details>
        )}
        {msg.observation && (
          <div className="cm" style={{ paddingLeft: 34 }}>
            # {msg.observation}
          </div>
        )}
        {(msg.choices?.length ?? 0) > 0 && (
          <ChoiceChips msg={msg} superseded={superseded} thinking={thinking} />
        )}
      </div>
    )
  }

  /* nudge — a steel card in the stream */
  return (
    <div
      className="tui-nudge"
      data-msg={msg.id}
      role="article"
      aria-label={articleLabel}
      style={{ margin: '6px 0' }}
    >
      <div className="h">
        ▸ nudge/{msg.nudgeType} — {time}
      </div>
      <Markdown source={msg.body.toLowerCase()} />
      {showScience && msg.footnote && (
        <div className="research"># {msg.footnote.toLowerCase()}</div>
      )}
      {(msg.actions?.length ?? 0) > 0 && !msg.resolved && (
        <div className="tui-acts">
          {msg.actions!.map((a) => (
            <button
              key={a.id}
              type="button"
              className={'tui-btn' + (a.kind === 'primary' ? ' pri' : '')}
              onClick={() => nudgeAction(msg.id, a.id)}
            >
              {a.label.toLowerCase()}
            </button>
          ))}
        </div>
      )}
      {msg.resolved && <div className="ok">✓ {msg.resolved.toLowerCase()}</div>}
    </div>
  )
})

/* Clickable option chips under a mew question or offer (#254 · offer_choices).
   The shared chip primitive (#68) keeps them real, keyboard-focusable buttons
   with the tokens focus ring; they ride the message row itself so they announce
   politely in the log's aria-live flow and survive windowing (#250 — the row
   carries them wherever the window puts it). Inert (native disabled) after a
   pick, once any newer user message lands, or while a turn is mewing — the
   same disabled={thinking} the composer wears, so a chip never looks tappable
   while pickChoice would swallow the click. Rendering is a pure function of
   props (the SSR-testable seam the window suite uses), while the store's
   pickChoice re-derives the same liveness from the live chat, so a stale click
   can never act. The picked chip keeps a ✓. */
function ChoiceChips({
  msg,
  superseded,
  thinking,
}: {
  msg: ChatMessage
  superseded: boolean
  thinking: boolean
}) {
  const pickChoice = useMew((s) => s.pickChoice)
  const active = !superseded && !thinking && !choicePicked(msg)
  return (
    <div className="chip-choices" role="group" aria-label="choices">
      {msg.choices!.map((c) => (
        <Button
          key={c.id}
          variant="chip"
          size="sm"
          disabled={!active}
          aria-label={c.picked ? `${c.label} — picked` : `choose ${c.label}`}
          onClick={() => void pickChoice(msg.id, c.id)}
        >
          {c.picked && <span className="ok">✓ </span>}
          {c.label.toLowerCase()}
        </Button>
      ))}
    </div>
  )
}

function Prompt({ inputRef }: { inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const speak = useMew((s) => s.speak)
  const stopSpeaking = useMew((s) => s.stopSpeaking)
  const thinking = useMew((s) => s.thinking)
  /* draft lives in the store so a Focus/Week/Settings switch doesn't drop it */
  const text = useMew((s) => s.promptDraft)
  const setText = useMew((s) => s.setPromptDraft)
  /* mid-composition (IME / dead keys): Enter is committing a character, not
     sending — never submit while a composition is open. */
  const composing = useRef(false)

  /* auto-grow: the box follows the content up to ~6 comfortable rows, then
     scrolls internally — multi-line asks (and pastes) stop fighting a
     single-line slit. Runs after every value change, paste included. */
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`
  }, [text, inputRef])

  const submit = () => {
    if (!text.trim() || thinking) return
    void speak(text)
    setText('')
  }

  return (
    <div className="prompt-card" onClick={() => inputRef.current?.focus()}>
      <div className="prompt-row">
        <span className="p-you">you</span> <span className="p-arr">❯</span>
        <textarea
          ref={inputRef}
          value={text}
          rows={1}
          disabled={thinking}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onKeyDown={(e) => {
            /* Enter sends; Shift+Enter keeps the newline. `isComposing` (plus
               our own ref, for engines that fire keydown before the flag) guards
               the IME path so committing a glyph never fires the turn. */
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              !composing.current
            ) {
              e.preventDefault()
              submit()
            }
            /* Esc while mewing stops the turn — the keyboard twin of the ■ button (#117) */
            if (e.key === 'Escape' && thinking) {
              e.preventDefault()
              stopSpeaking()
            }
          }}
          aria-label="compose message to MEW"
          aria-describedby={PROMPT_HINTS_ID}
          placeholder="talk to MEW…"
        />
      </div>
      <div className="prompt-hints" id={PROMPT_HINTS_ID}>
        <span className="hint">
          <span className="k">shift+↵</span> newline
        </span>
        <span className="hint dim">"block thursday morning for the deck"</span>
        <span className="spacer" />
        {thinking ? (
          <span className="mewing-row">
            <span className="hint mewing">mewing…</span>
            {/* the kill switch while a turn runs; Esc does the same (#117) */}
            <Button variant="chip" size="sm" onClick={stopSpeaking} aria-label="stop">
              ■ stop
            </Button>
          </span>
        ) : (
          <button
            type="button"
            className="send"
            disabled={!text.trim()}
            onClick={(e) => {
              e.stopPropagation()
              submit()
            }}
            aria-label="send"
          >
            ↵ send
          </button>
        )}
      </div>
    </div>
  )
}
