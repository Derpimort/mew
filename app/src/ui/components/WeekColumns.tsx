/* Week — seven time-true columns over the FULL day (00→24), S1 solid material.
   Today/selected is 2.3× wider with full detail and the glowing now-line;
   other days are shapes. ‹ › pages week by week; the summary line carries the
   pending-nudge teaser. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMew, useLive } from '../../state/store'
import type { Block } from '../../domain/types'
import { dayKey, fmtDow, fmtShortDate, fmtTime, minOfDay, weekKeys, addDaysKey } from '../../domain/time'
import { blocksForDay, duration } from '../../domain/week'
import { aggregates } from '../../domain/memory'
import { findHeavyDay } from '../../domain/nudges/engine'
import { nxwY } from './dialGeometry'
import { layoutLanes } from './lanes'
import { BlockCard } from './BlockCard'

const H = 560

export function WeekColumns() {
  const blocks = useMew((s) => s.blocks)
  const memory = useMew((s) => s.memory)
  const nowMs = useMew((s) => s.nowMs)
  const focusedDayKey = useMew((s) => s.focusedDayKey)
  const focusDay = useMew((s) => s.focusDay)
  const weekOffset = useMew((s) => s.weekOffset)
  const setWeekOffset = useMew((s) => s.setWeekOffset)
  const live = useLive()
  const wrapRef = useRef<HTMLDivElement>(null)

  const now = new Date(nowMs)
  const todayKey = dayKey(now)
  const nowH = minOfDay(now) / 60
  const anchor = new Date(nowMs)
  anchor.setDate(anchor.getDate() + weekOffset * 7)
  const keys = weekKeys(anchor)
  /* selection: explicit pick if it's in this week; else today; else Monday */
  const selectedKey =
    focusedDayKey && keys.includes(focusedDayKey)
      ? focusedDayKey
      : keys.includes(todayKey)
        ? todayKey
        : keys[0]

  const agg = useMemo(() => aggregates(memory, now), [memory, nowMs]) // eslint-disable-line react-hooks/exhaustive-deps
  const heavy = useMemo(
    () => findHeavyDay(blocks, todayKey, agg.realisticBestH),
    [blocks, todayKey, agg.realisticBestH],
  )

  /* hovered/clicked block details land in the footer dock — reserved space,
     so the card can never sit on top of other blocks and steal their hover.
     Hover swaps only after a short dwell (crossing blocks en route won't churn
     the card); a click pins the selection until × or a background click. */
  const [card, setCard] = useState<Block | null>(null)
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverCard = (b: Block) => {
    if (pinnedId) return
    if (dwellTimer.current) clearTimeout(dwellTimer.current)
    if (card && card.id !== b.id) {
      dwellTimer.current = setTimeout(() => setCard(b), 150)
    } else {
      setCard(b)
    }
  }
  useEffect(() => () => { if (dwellTimer.current) clearTimeout(dwellTimer.current) }, [])
  const [scrubY, setScrubY] = useState<number | null>(null)

  const plannedH = useMemo(() => {
    const total = keys.reduce(
      (sum, k) => sum + blocksForDay(blocks, k).reduce((s, b) => s + duration(b), 0),
      0,
    )
    return Math.round(total / 30) / 2
  }, [blocks, keys])

  const restKept = useMemo(() => {
    const floor = addDaysKey(todayKey, -7)
    let kept = 0
    let total = 0
    for (const e of memory) {
      if ((e.kind === 'rest_kept' || e.kind === 'rest_skipped') && e.dayKey >= floor && e.dayKey < todayKey) {
        total++
        if (e.kind === 'rest_kept') kept++
      }
    }
    return total ? `${kept}/${total}` : null
  }, [memory, todayKey])

  const pendingNudge = useMew((s) =>
    [...s.chat].reverse().find((m) => m.role === 'nudge' && !m.resolved && (m.actions?.length ?? 0) > 0),
  )

  const cols = '34px ' + keys.map((k) => (k === selectedKey ? '2.3fr' : '1fr')).join(' ')

  const weekLabel =
    weekOffset === 0
      ? 'this week'
      : `week of ${fmtShortDate(keys[0]).toLowerCase()}`

  return (
    <div ref={wrapRef} className="nxs1" style={{ width: 730, position: 'relative' }} onClick={() => { setPinnedId(null); setCard(null) }}>
      <div className="week-nav">
        <button type="button" onClick={(e) => { e.stopPropagation(); setWeekOffset(weekOffset - 1) }} aria-label="previous week">
          ‹
        </button>
        <button
          type="button"
          className="wk-label"
          title={weekOffset === 0 ? undefined : 'back to this week'}
          onClick={(e) => { e.stopPropagation(); setWeekOffset(0) }}
        >
          {weekLabel}
        </button>
        <button type="button" onClick={(e) => { e.stopPropagation(); setWeekOffset(weekOffset + 1) }} aria-label="next week">
          ›
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 10 }}>
        <span />
        {keys.map((k) => {
          const isToday = k === todayKey
          const isSel = k === selectedKey
          return (
            <button
              type="button"
              key={k}
              className={'nxb-dl' + (isSel ? ' today' : '')}
              onClick={(e) => {
                e.stopPropagation()
                focusDay(isToday ? null : k)
              }}
            >
              <div className="d">{fmtDow(k)}</div>
              <div className="n">
                {fmtShortDate(k).toLowerCase()}
                {heavy?.dayKey === k && <span className="heavy"> · {heavy.plannedH}h</span>}
              </div>
            </button>
          )
        })}
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, position: 'relative' }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const y = e.clientY - r.top
          if (y >= 0 && y <= H) setScrubY(y)
          else setScrubY(null)
        }}
        onMouseLeave={() => setScrubY(null)}
      >
        <div style={{ position: 'relative' }}>
          {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
            <span key={h} className="nxb-hl" style={{ position: 'absolute', top: nxwY(h, H) - 5, right: 2 }}>
              {h}:00
            </span>
          ))}
        </div>
        {keys.map((k) => {
          const isToday = k === todayKey
          const isSel = k === selectedKey
          const isPast = k < todayKey
          const day = blocksForDay(blocks, k)
          const slots = layoutLanes(day, (b) => b.startMin, (b) => b.endMin, (b) => b.id)
          return (
            <div
              key={k}
              className={'nxb-col' + (isSel ? ' today' : '') + (isPast ? ' past' : '')}
              style={{ height: H }}
              onClick={(e) => {
                if (!isSel) {
                  e.stopPropagation()
                  focusDay(isToday ? null : k)
                }
              }}
            >
              {day.map((b) => {
                const sH = b.startMin / 60
                const eH = Math.min(b.endMin / 60, 24)
                const dur = eH - sH
                const isNow = isToday && live.current?.id === b.id
                const done = b.status === 'done'
                const showT = (isSel ? dur >= 0.55 : dur >= 1.5) && (slots.get(b.id)?.lanes ?? 1) <= (isSel ? 3 : 2)
                const showM = isSel && dur >= 1.15 && (slots.get(b.id)?.lanes ?? 1) <= 2
                const { lane, lanes } = slots.get(b.id) ?? { lane: 0, lanes: 1 }
                return (
                  <div
                    key={b.id}
                    className={
                      'nxb-blk ' + b.tag + (isNow ? ' now' : '') + (done ? ' done' : '') + (b.optional ? ' optional' : '')
                    }
                    style={{
                      top: nxwY(sH, H) + 1.5,
                      height: Math.max(10, nxwY(eH, H) - nxwY(sH, H) - 4),
                      left: `calc(${(lane / lanes) * 100}% + 4px)`,
                      width: `calc(${100 / lanes}% - ${lanes > 1 ? 6 : 8}px)`,
                      right: 'auto',
                    }}
                    onMouseEnter={() => hoverCard(b)}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (dwellTimer.current) clearTimeout(dwellTimer.current)
                      setPinnedId(pinnedId === b.id ? null : b.id)
                      setCard(b)
                    }}
                  >
                    {showT && (
                      <div className={'t' + (isSel ? '' : ' small')}>
                        {done ? '✓ ' : ''}
                        {b.title}
                      </div>
                    )}
                    {showM && (
                      <div className="m">
                        {fmtTime(b.startMin)}–{fmtTime(b.endMin)}
                        {b.protected ? ' · held' : ''}
                        {isNow ? ' · now' : ''}
                      </div>
                    )}
                  </div>
                )
              })}
              {isToday && <div className="nxb-now" style={{ top: nxwY(nowH, H) }} />}
            </div>
          )
        })}
        {scrubY != null && (
          <>
            <div className="scrub-line" style={{ top: scrubY }} />
            <span className="scrub-tag" style={{ top: scrubY - 9 }}>
              {fmtTime(Math.round(((scrubY / H) * 24 * 60) / 5) * 5)}
            </span>
          </>
        )}
      </div>

      {/* the dock: details live HERE, never floating over the grid */}
      <div className="wk-dock">
        {card ? (
          <BlockCard
            variant="dock"
            block={card}
            isNow={live.current?.id === card.id}
            pinned={pinnedId === card.id}
            onClose={() => {
              setPinnedId(null)
              setCard(null)
            }}
          />
        ) : (
          <span className="wk-dock-hint">hover a block — its details and actions land here</span>
        )}
      </div>

      <div className="week-summary">
        {plannedH}h planned
        {restKept && (
          <>
            {' '}· rest kept <span className="life">{restKept}</span>
          </>
        )}
        {pendingNudge ? (
          <>
            {' '}· {heavy ? `${fmtDow(String(pendingNudge.payload?.dayKey ?? heavy.dayKey)).toLowerCase()} wants a kinder shape` : 'something is waiting'} —{' '}
            <span
              className="att"
              onClick={(e) => {
                e.stopPropagation()
                useMew.setState({ scrollToMsgId: pendingNudge.id })
              }}
            >
              nudge in chat
            </span>
          </>
        ) : (
          <> · the shape looks kind</>
        )}
      </div>

    </div>
  )
}
