/* The session — `mew session — tty1` (DESIGN_LANGUAGE §4). The chat thread as
   a terminal log: you ❯ / mew ❯ lines, ★ mews, ✓ confirmations, nudges as
   steel cards with machined buttons, a composer that follows your typing.
   Same store, same nudge engine — only the skin changed. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useMew, useLive } from '../../state/store'
import { Button } from '../primitives/Button'
import { Markdown } from './Markdown'
import type { ChatMessage } from '../../domain/types'
import { dayKey, fmtDowLong, fmtTime, minOfDay } from '../../domain/time'
import { blocksForDay } from '../../domain/week'

/** How close to the bottom (px) still counts as "stuck to the bottom" — within
    this band new output auto-scrolls; scroll up past it and MEW stops yanking. */
const STICK_THRESHOLD = 80

/** id the prompt's aria-describedby points at, so a screen reader reads the
    ⌘K / shift+↵ hint line after the textarea's own label. */
const PROMPT_HINTS_ID = 'prompt-hints'

/** The assertive-region copy for a turn, as a pure edge function: a rising edge
    of `thinking` announces the start, a falling edge announces completion, and a
    same-value tick stays quiet (returns the prior message so nothing re-fires).
    Kept pure + exported so the announce contract is unit-tested without a DOM. */
export function streamAnnouncement(prev: string, was: boolean, now: boolean): string {
  if (now && !was) return 'mew is responding…'
  if (!now && was) return 'response complete'
  return prev
}

export function SessionLog() {
  const chat = useMew((s) => s.chat)
  const thinking = useMew((s) => s.thinking)
  const workingStatus = useMew((s) => s.workingStatus)
  const scrollToMsgId = useMew((s) => s.scrollToMsgId)
  const clearScroll = useMew((s) => s.clearScroll)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /* sticky-bottom state: are we pinned to the latest line, or has the user
     scrolled up to read history? `atBottom` drives both the auto-scroll and
     the "↓ new" affordance. A ref mirrors it so the chat-growth effect reads
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

  /* an explicit jump (a nudge clicked elsewhere) always wins; otherwise new
     output only follows when we're already at the bottom — reading history
     mid-stream is never interrupted. */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (scrollToMsgId) {
      el.querySelector(`[data-msg="${scrollToMsgId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      clearScroll()
    } else if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [chat, thinking, workingStatus, scrollToMsgId, clearScroll])

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

  /* one assertive announcement per turn: a screen reader hears "mew is
     responding…" the moment the turn starts, then "response complete" once it
     settles. The visible thinking row is `aria-hidden` (its dots/label would
     read as noise), so this hidden region is the single spoken signal — driven
     off `thinking` alone, so it fires within a frame of thinking=true. */
  const [streamMsg, setStreamMsg] = useState('')
  const wasThinking = useRef(false)
  useEffect(() => {
    setStreamMsg((prev) => streamAnnouncement(prev, wasThinking.current, thinking))
    wasThinking.current = thinking
  }, [thinking])

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
          {/* the chat thread as a live log: new lines are announced politely and
              one at a time (aria-atomic=false), each LogLine is its own article
              so a reader can step message-to-message; aria-busy parks those
              announcements while a turn is mid-stream. */}
          <div
            className="log"
            role="log"
            aria-live="polite"
            aria-atomic="false"
            aria-busy={thinking}
            aria-label="chat session"
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            {chat.map((m) => (
              /* each line lands like terminal output: blur-up entrance, once */
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 6, filter: 'blur(3px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <LogLine msg={m} />
              </motion.div>
            ))}
            {thinking && <ThinkingRow status={workingStatus} />}
          </div>
        </div>
        {/* the single spoken signal for a turn — visually hidden, off-screen,
            assertive so it interrupts to confirm start/finish. */}
        <div
          aria-live="assertive"
          aria-atomic="true"
          style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}
        >
          {streamMsg}
        </div>
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

export function LogLine({ msg }: { msg: ChatMessage }) {
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
      <div data-msg={msg.id} role="article" aria-label={articleLabel} className={isAside ? 'cm' : ''}>
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
          <div className="cm" style={{ paddingLeft: 34 }}># {msg.observation}</div>
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
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !composing.current) {
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
