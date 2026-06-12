/* The loose-threads rail — "nothing is ever dropped or floating" made
   visible. Collapsed: a slim vertical pill on the stage's left edge (count +
   one dot per thread, colored by state). Click: expands in place to the
   thread box — running / slipped / paused / unplaced in that fixed order,
   each row offering one action. Rows offer; they never auto-act. Zero
   threads → no chrome at all. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMew } from '../../state/store'
import type { Block, Capture } from '../../domain/types'
import { dayKey, fmtDow, fmtTime, minOfDay } from '../../domain/time'
import { looseThreads } from '../../domain/week'

export type ThreadState = 'running' | 'slipped' | 'paused' | 'unplaced'

export const THREAD_STATES: Record<ThreadState, { glyph: string; label: string; color: string }> = {
  running: { glyph: '◐', label: 'running', color: 'var(--ice)' },
  slipped: { glyph: '↪', label: 'slipped', color: 'var(--gold)' },
  paused: { glyph: '‖', label: 'paused', color: 'var(--muted)' },
  unplaced: { glyph: '○', label: 'unplaced', color: 'var(--faint)' },
}

interface Row {
  state: ThreadState
  id: string
  title: string
  meta: string
  action: string
  run: () => void
}

export function ThreadRail({ onOpen }: { onOpen: (blockId: string) => void }) {
  const blocks = useMew((s) => s.blocks)
  const captures = useMew((s) => s.captures)
  const nowMs = useMew((s) => s.nowMs)
  const startNow = useMew((s) => s.startNow)
  const placeCapture = useMew((s) => s.placeCapture)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const todayKey = dayKey(new Date(nowMs))
  const nowMin = minOfDay(new Date(nowMs))
  const threads = useMemo(
    () => looseThreads(blocks, captures, todayKey, nowMin),
    [blocks, captures, todayKey, nowMin],
  )

  /* Esc or a click anywhere outside the box collapses it */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  const short = (t: string) => {
    const base = t.split('—')[0].trim()
    return base.length > 24 ? base.slice(0, 22) + '…' : base
  }
  const blockRow = (state: ThreadState, b: Block, meta: string, action: string, run: () => void): Row => ({
    state,
    id: b.id,
    title: short(b.title),
    meta,
    action,
    run,
  })

  const rows: Row[] = [
    ...threads.running.map((b) =>
      blockRow(
        'running',
        b,
        `→ ${fmtTime(b.endMin)}${b.due != null ? ` · due ${fmtTime(b.due)}` : ''}`,
        'open',
        () => onOpen(b.id),
      ),
    ),
    ...threads.slipped.map((b) =>
      blockRow('slipped', b, `was ${fmtTime(b.startMin)}–${fmtTime(b.endMin)}`, 'resume', () => startNow(b.id)),
    ),
    ...threads.paused.map((b) =>
      blockRow(
        'paused',
        b,
        `parked · ${b.dayKey === todayKey ? fmtTime(b.startMin) : `${fmtDow(b.dayKey)} ${fmtTime(b.startMin)}`}`,
        'resume',
        () => startNow(b.id),
      ),
    ),
    ...threads.unplaced.map(
      (c: Capture): Row => ({
        state: 'unplaced',
        id: c.id,
        title: short(c.title),
        meta: 'captured · no time yet',
        action: 'place',
        run: () => placeCapture(c.id),
      }),
    ),
  ]

  if (!rows.length) return null // no threads, no chrome

  if (!open) {
    return (
      <div
        className="frail"
        onClick={(e) => {
          e.stopPropagation() // the stage's background click clears cards — not ours
          setOpen(true)
        }}
        title="loose threads"
      >
        <span className="cnt">{rows.length}</span>
        {rows.map((r) => (
          <span key={r.id} className="dot" style={{ background: THREAD_STATES[r.state].color }} />
        ))}
        <span className="vlabel">threads</span>
      </div>
    )
  }

  return (
    <div
      ref={boxRef}
      className="tbox"
      style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', zIndex: 9 }}
    >
      <div className="tbox-h">
        <span className="t">Loose threads</span>
        <span
          className="x"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(false)
          }}
        >
          close ✕
        </span>
      </div>
      {(Object.keys(THREAD_STATES) as ThreadState[]).map((grp) => {
        const grpRows = rows.filter((r) => r.state === grp)
        if (!grpRows.length) return null
        return (
          <div key={grp}>
            <div className="tgrp">{THREAD_STATES[grp].label}</div>
            {grpRows.map((r) => (
              <div
                key={r.id}
                className="trow"
                onClick={(e) => {
                  e.stopPropagation() // open() sets a card the stage click would instantly clear
                  r.run()
                  setOpen(false)
                }}
              >
                <span className="g" style={{ color: THREAD_STATES[r.state].color }}>
                  {THREAD_STATES[r.state].glyph}
                </span>
                <span style={{ minWidth: 0 }}>
                  <div className="tt">{r.title}</div>
                  <div className="mm">{r.meta}</div>
                </span>
                <span className="pin">{r.action}</span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
