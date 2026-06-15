/* The session — `mew session — tty1` (DESIGN_LANGUAGE §4). The chat thread as
   a terminal log: you ❯ / mew ❯ lines, ★ mews, ✓ confirmations, nudges as
   steel cards with machined buttons, a prompt with a blinking cursor.
   Same store, same nudge engine — only the skin changed. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useMew, useLive } from '../../state/store'
import type { ChatMessage } from '../../domain/types'
import { dayKey, fmtDowLong, fmtTime, minOfDay } from '../../domain/time'
import { blocksForDay } from '../../domain/week'

export function SessionLog() {
  const chat = useMew((s) => s.chat)
  const thinking = useMew((s) => s.thinking)
  const scrollToMsgId = useMew((s) => s.scrollToMsgId)
  const clearScroll = useMew((s) => s.clearScroll)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (scrollToMsgId) {
      el.querySelector(`[data-msg="${scrollToMsgId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      clearScroll()
    } else {
      el.scrollTop = el.scrollHeight
    }
  }, [chat.length, thinking, scrollToMsgId, clearScroll])

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
      <div className="session-scroll" ref={scrollRef}>
        <DayHeader />
        <div className="log" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
          {thinking && (
            <div>
              <span className="p-mew">mew</span> <span className="p-arr">❯</span> <span className="blink" style={{ height: 11, width: 6 }} />
            </div>
          )}
        </div>
      </div>
      <div className="session-compose">
        <Prompt inputRef={inputRef} />
      </div>
    </>
  )
}

function DayHeader() {
  const blocks = useMew((s) => s.blocks)
  const nowMs = useMew((s) => s.nowMs)
  const live = useLive()
  const todayKey = dayKey(new Date(nowMs))
  const count = blocksForDay(blocks, todayKey).length
  return (
    <div className="log cm" style={{ flex: 'none' }}>
      # {fmtDowLong(todayKey).toLowerCase()} · {count} block{count === 1 ? '' : 's'} · {live.mewsToday} mew
      {live.mewsToday === 1 ? '' : 's'}
    </div>
  )
}

function LogLine({ msg }: { msg: ChatMessage }) {
  const showScience = useMew((s) => s.settings.showScience)
  const nudgeAction = useMew((s) => s.nudgeAction)

  if (msg.role === 'user') {
    return (
      <div data-msg={msg.id}>
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
      <div data-msg={msg.id} className={isAside ? 'cm' : ''}>
        <span className="p-mew">mew</span> <span className="p-arr">❯</span>{' '}
        {isMew && <span className="mw">★ </span>}
        {isOk && <span className="ok">✓ </span>}
        <span style={{ color: isAside ? undefined : 'var(--muted)', whiteSpace: 'pre-wrap' }}>{msg.body}</span>
        {msg.observation && (
          <div className="cm" style={{ paddingLeft: 34 }}># {msg.observation}</div>
        )}
      </div>
    )
  }

  /* nudge — a steel card in the stream */
  const time = fmtTime(minOfDay(new Date(msg.ts)))
  return (
    <div className="tui-nudge" data-msg={msg.id} style={{ margin: '6px 0' }}>
      <div className="h">
        ▸ nudge/{msg.nudgeType} — {time}
      </div>
      {msg.body.toLowerCase()}
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
  const thinking = useMew((s) => s.thinking)
  /* draft lives in the store so a Focus/Week/Settings switch doesn't drop it */
  const text = useMew((s) => s.promptDraft)
  const setText = useMew((s) => s.setPromptDraft)
  const [focused, setFocused] = useState(false)

  /* auto-grow: the box follows the content up to ~6 comfortable rows, then
     scrolls internally — multi-line asks stop fighting a single-line slit */
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
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          aria-label="talk to MEW"
          placeholder={focused || text ? '' : undefined}
        />
        {!focused && !text && <span className="blink" />}
      </div>
      <div className="prompt-hints">
        <span className="hint">
          <span className="k">shift+↵</span> newline
        </span>
        <span className="hint dim">"block thursday morning for the deck"</span>
        <span className="spacer" />
        {thinking ? (
          <span className="hint mewing">mewing…</span>
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
