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
import { Button } from '../primitives'
import { THREAD_STATES, type ThreadState } from './threadStates'

interface RowAction {
  label: string
  run: () => void
}

interface Row {
  state: ThreadState
  id: string
  title: string
  meta: string
  actions: RowAction[]
}

export function ThreadRail({ onOpen }: { onOpen: (blockId: string) => void }) {
  const blocks = useMew((s) => s.blocks)
  const captures = useMew((s) => s.captures)
  const nowMs = useMew((s) => s.nowMs)
  const startNow = useMew((s) => s.startNow)
  const placeCapture = useMew((s) => s.placeCapture)
  const toggleComplete = useMew((s) => s.toggleComplete)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const todayKey = dayKey(new Date(nowMs))
  const nowMin = minOfDay(new Date(nowMs))
  const threads = useMemo(
    () => looseThreads(blocks, captures, todayKey, nowMin),
    [blocks, captures, todayKey, nowMin]
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
  const blockRow = (state: ThreadState, b: Block, meta: string, actions: RowAction[]): Row => ({
    state,
    id: b.id,
    title: short(b.title),
    meta,
    actions,
  })
  /* done = complete in place (the slot is right, it just wasn't marked); resume
     = move it to now. A just-ended or parked item needs the first, not the
     second — offering both stops "resume then done" creating a wrong slot. */
  const done = (b: Block): RowAction => ({ label: 'done', run: () => toggleComplete(b.id) })
  const resume = (b: Block): RowAction => ({ label: 'resume', run: () => startNow(b.id) })

  const rows: Row[] = [
    ...threads.running.map((b) =>
      blockRow(
        'running',
        b,
        `→ ${fmtTime(b.endMin)}${b.due != null ? ` · due ${fmtTime(b.due)}` : ''}`,
        [{ label: 'open', run: () => onOpen(b.id) }, done(b)]
      )
    ),
    ...threads.slipped.map((b) =>
      blockRow('slipped', b, `was ${fmtTime(b.startMin)}–${fmtTime(b.endMin)}`, [
        done(b),
        resume(b),
      ])
    ),
    ...threads.paused.map((b) =>
      blockRow(
        'paused',
        b,
        `parked · ${b.dayKey === todayKey ? fmtTime(b.startMin) : `${fmtDow(b.dayKey)} ${fmtTime(b.startMin)}`}`,
        [done(b), resume(b)]
      )
    ),
    ...threads.unplaced.map((c: Capture): Row => ({
      state: 'unplaced',
      id: c.id,
      title: short(c.title),
      meta: 'captured · no time yet',
      actions: [{ label: 'place', run: () => placeCapture(c.id) }],
    })),
  ]

  /* When the last thread clears, the box unmounts (below) but `open` lingers.
     Reset it here — in an effect, never during render — so a later thread
     appears collapsed and still honors the click-to-expand invariant. */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate reset when the thread list empties; must not run during render
    if (!rows.length) setOpen(false)
  }, [rows.length])

  if (!rows.length) return null // no threads, no chrome

  if (!open) {
    return (
      <button
        type="button"
        className="frail"
        onClick={(e) => {
          e.stopPropagation() // the stage's background click clears cards — not ours
          setOpen(true)
        }}
        aria-expanded={false}
        aria-label={`loose threads — ${rows.length} open`}
        title="loose threads"
      >
        <span className="cnt">{rows.length}</span>
        {rows.map((r) => (
          <span key={r.id} className="dot" style={{ background: THREAD_STATES[r.state].color }} />
        ))}
        <span className="vlabel">threads</span>
      </button>
    )
  }

  return (
    <div
      ref={boxRef}
      className="tbox"
      style={{
        position: 'absolute',
        left: '50%',
        top: 'calc(100% + 8px)',
        transform: 'translateX(-50%)',
        zIndex: 9,
      }}
    >
      <div className="tbox-h">
        <span className="t">Loose threads</span>
        <button
          type="button"
          className="x"
          aria-label="close loose threads"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(false)
          }}
        >
          close ✕
        </button>
      </div>
      {(Object.keys(THREAD_STATES) as ThreadState[]).map((grp) => {
        const grpRows = rows.filter((r) => r.state === grp)
        if (!grpRows.length) return null
        return (
          <div key={grp}>
            <div className="tgrp">{THREAD_STATES[grp].label}</div>
            {grpRows.map((r) => (
              <div key={r.id} className="trow">
                <span className="g" style={{ color: THREAD_STATES[r.state].color }}>
                  {THREAD_STATES[r.state].glyph}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <div className="tt">{r.title}</div>
                  <div className="mm">{r.meta}</div>
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flex: 'none' }}>
                  {r.actions.map((a) => (
                    <Button
                      key={a.label}
                      variant="chip"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation() // some actions set a card the stage click would clear
                        a.run()
                      }}
                    >
                      {a.label}
                    </Button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
