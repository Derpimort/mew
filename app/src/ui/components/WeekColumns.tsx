/* Week — seven time-true columns over the FULL day (00→24), S1 solid material.
   Today/selected is 2.3× wider with full detail and the glowing now-line;
   other days are shapes. ‹ › pages week by week; the summary line carries the
   pending-nudge teaser. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMew, useLive } from '../../state/store'
import type { Block } from '../../domain/types'
import {
  dayKey,
  fmtDow,
  fmtShortDate,
  fmtTime,
  minOfDay,
  weekKeys,
  addDaysKey,
} from '../../domain/time'
import { blocksForDay, duration } from '../../domain/week'
import { aggregates } from '../../domain/memory'
import { findHeavyDay } from '../../domain/nudges/engine'
import { clockDeg, nxwY, rPolar, sector } from './dialGeometry'
import { sidePlacement, type Rect } from './hoverPreview'
import { layoutLanes } from './lanes'
import { useGridDrag } from './useGridDrag'
import { BlockCard } from './BlockCard'

const H = 560

/* Hover preview card box (must match .wk-preview in components.css so
   sidePlacement positions the real footprint). */
const PREVIEW_W = 196
const PREVIEW_H = 92
/* Mini focus-clock thumbnail: a ~52px face echoing the FocusOrbit dial. Local
   SVG coords — the block's single arc rides one ring at its real clock angle. */
const MC = { size: 52, cx: 26, cy: 26, r: 19, band: 5 }

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
    [blocks, todayKey, agg.realisticBestH]
  )

  /* Clicking a block pins its interactive details in the footer dock — reserved
     space, so the pinned card never sits on top of other blocks. */
  const [card, setCard] = useState<Block | null>(null)
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  /* Hover pops a read-only preview BESIDE the block (a tiny block can't show its
     name+time inline). It's pointer-events:none and floats above the grid, so it
     never steals hover from the blocks underneath. Swaps only after a short dwell
     (crossing blocks en route won't churn it); a pin freezes hover. */
  const [preview, setPreview] = useState<{ block: Block; rect: Rect } | null>(null)
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverPreview = (b: Block, el: HTMLElement) => {
    if (pinnedId) return
    if (dwellTimer.current) clearTimeout(dwellTimer.current)
    const wrap = wrapRef.current
    if (!wrap) return
    const wr = wrap.getBoundingClientRect()
    const br = el.getBoundingClientRect()
    const rect: Rect = {
      left: br.left - wr.left,
      top: br.top - wr.top,
      width: br.width,
      height: br.height,
    }
    const next = { block: b, rect }
    if (preview && preview.block.id !== b.id) {
      dwellTimer.current = setTimeout(() => setPreview(next), 150)
    } else {
      setPreview(next)
    }
  }
  const clearPreview = () => {
    if (dwellTimer.current) clearTimeout(dwellTimer.current)
    setPreview(null)
  }
  useEffect(
    () => () => {
      if (dwellTimer.current) clearTimeout(dwellTimer.current)
    },
    []
  )
  /* a scroll moves the blocks but not the captured rect — clear so the preview
     never strands away from its block. (A pin already clears at the click site,
     and hover early-returns while pinned, so no preview survives a pin.) */
  useEffect(() => {
    if (!preview) return
    const onScroll = () => setPreview(null)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () =>
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions)
  }, [preview])
  const [scrubY, setScrubY] = useState<number | null>(null)

  /* drag-to-reschedule (#158): grab a block, slide it across the time-true grid,
     drop it. All gesture/geometry lives in useGridDrag; the store's dragMove is
     the only mutation path. The view just wires the handlers/refs and renders the
     ghost + conflict glow — staying a thin skin. */
  const { drag, ghostBox, dragClash, bouncedId, gridRef, beginPress, consumeSuppressedClick } =
    useGridDrag(H, clearPreview)

  const plannedH = useMemo(() => {
    const total = keys.reduce(
      (sum, k) => sum + blocksForDay(blocks, k).reduce((s, b) => s + duration(b), 0),
      0
    )
    return Math.round(total / 30) / 2
  }, [blocks, keys])

  const restKept = useMemo(() => {
    const floor = addDaysKey(todayKey, -7)
    let kept = 0
    let total = 0
    for (const e of memory) {
      if (
        (e.kind === 'rest_kept' || e.kind === 'rest_skipped') &&
        e.dayKey >= floor &&
        e.dayKey < todayKey
      ) {
        total++
        if (e.kind === 'rest_kept') kept++
      }
    }
    return total ? `${kept}/${total}` : null
  }, [memory, todayKey])

  const pendingNudge = useMew((s) =>
    [...s.chat]
      .reverse()
      .find((m) => m.role === 'nudge' && !m.resolved && (m.actions?.length ?? 0) > 0)
  )

  const cols = '34px ' + keys.map((k) => (k === selectedKey ? '2.3fr' : '1fr')).join(' ')

  const weekLabel =
    weekOffset === 0 ? 'this week' : `week of ${fmtShortDate(keys[0]).toLowerCase()}`

  return (
    <div
      ref={wrapRef}
      className="nxs1"
      style={{ width: 730, position: 'relative' }}
      onClick={() => {
        setPinnedId(null)
        setCard(null)
      }}
    >
      <div className="week-nav">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setWeekOffset(weekOffset - 1)
          }}
          aria-label="previous week"
        >
          ‹
        </button>
        <button
          type="button"
          className="wk-label"
          title={weekOffset === 0 ? undefined : 'back to this week'}
          onClick={(e) => {
            e.stopPropagation()
            setWeekOffset(0)
          }}
        >
          {weekLabel}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setWeekOffset(weekOffset + 1)
          }}
          aria-label="next week"
        >
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
        ref={gridRef}
        className={drag ? 'wk-grid dragging' : 'wk-grid'}
        style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, position: 'relative' }}
        onMouseMove={(e) => {
          if (drag) return // a live drag owns the pointer; the scrubber steps aside
          const r = e.currentTarget.getBoundingClientRect()
          const y = e.clientY - r.top
          if (y >= 0 && y <= H) setScrubY(y)
          else setScrubY(null)
        }}
        onMouseLeave={() => {
          setScrubY(null)
          clearPreview()
        }}
      >
        <div style={{ position: 'relative' }}>
          {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
            <span
              key={h}
              className="nxb-hl"
              style={{ position: 'absolute', top: nxwY(h, H) - 5, right: 2 }}
            >
              {h}:00
            </span>
          ))}
        </div>
        {keys.map((k) => {
          const isToday = k === todayKey
          const isSel = k === selectedKey
          const isPast = k < todayKey
          const day = blocksForDay(blocks, k)
          const slots = layoutLanes(
            day,
            (b) => b.startMin,
            (b) => b.endMin,
            (b) => b.id
          )
          return (
            <div
              key={k}
              data-daykey={k}
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
                const isNow = isToday && live.current?.id === b.id
                const done = b.status === 'done'
                const { lane, lanes } = slots.get(b.id) ?? { lane: 0, lanes: 1 }
                // px height drives what fits, like Google: every block shows its title
                // (clipped to its box), centred; the time gets its own line once two lines
                // fit, else rides inline ahead of the title when a wide single line has room.
                const blkH = Math.max(10, nxwY(eH, H) - nxwY(sH, H) - 4)
                const twoLine = blkH >= 24
                const tiny = blkH < 15
                const inlineTime = !twoLine && !tiny && lanes === 1
                const isDragSrc = drag?.id === b.id
                const isClash = dragClash.has(b.id)
                const isBounced = bouncedId === b.id
                const openBlock = () => {
                  clearPreview()
                  setPinnedId(pinnedId === b.id ? null : b.id)
                  setCard(b)
                }
                return (
                  <div
                    key={b.id}
                    className={
                      'nxb-blk ' +
                      b.tag +
                      (isNow ? ' now' : '') +
                      (done ? ' done' : '') +
                      (b.optional ? ' optional' : '') +
                      (twoLine ? '' : ' thin') +
                      (isDragSrc ? ' drag-src' : '') +
                      (isClash ? ' clash' : '') +
                      (isBounced ? ' bounced' : '')
                    }
                    style={{
                      top: nxwY(sH, H) + 1.5,
                      height: blkH,
                      left: `calc(${(lane / lanes) * 100}% + 4px)`,
                      width: `calc(${100 / lanes}% - ${lanes > 1 ? 6 : 8}px)`,
                      right: 'auto',
                    }}
                    /* a keyboard-reachable block: Tab lands on it (DOM order is
                       day-column then start-time, so the order reads left-to-right,
                       top-to-bottom), Enter/Space opens its detail card — the same
                       thing a click does. aria-label speaks the title + time so a
                       screen reader gets what the visual block shows. */
                    role="button"
                    tabIndex={0}
                    aria-label={`${b.title}, ${fmtTime(b.startMin)} to ${fmtTime(b.endMin)}${done ? ', done' : ''}`}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return // left button only
                      beginPress(b, e)
                    }}
                    onMouseEnter={(e) => {
                      if (!drag) hoverPreview(b, e.currentTarget)
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (consumeSuppressedClick()) return // this click trailed a drag — swallow it
                      openBlock()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        e.stopPropagation()
                        openBlock()
                      }
                    }}
                  >
                    <div className={'t' + (isSel ? '' : ' small') + (tiny ? ' tiny' : '')}>
                      {done ? '✓ ' : ''}
                      {inlineTime && <span className="ti">{fmtTime(b.startMin)} </span>}
                      {b.title}
                    </div>
                    {twoLine && (
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
        {/* drag ghost — a 50%-opacity dashed echo of the block at its candidate
            drop, spanning the full target column so a multi-lane landing reads
            honestly. A conflicting drop glows red (it will bounce); a protected
            block carries a 'held' cue so its fixed nature stays visible (#158). */}
        {drag &&
          ghostBox &&
          (() => {
            const b = blocks.find((x) => x.id === drag.id)
            if (!b) return null
            const conflict = dragClash.size > 0
            const top = nxwY(drag.toStartMin / 60, H) + 1.5
            const height = Math.max(
              10,
              nxwY(Math.min((drag.toStartMin + drag.durationMin) / 60, 24), H) -
                nxwY(drag.toStartMin / 60, H) -
                4
            )
            return (
              <div
                className={
                  'wk-ghost ' + b.tag + (conflict ? ' clash' : '') + (b.external ? ' external' : '')
                }
                style={{ top, height, left: ghostBox.left, width: ghostBox.width }}
                role="status"
                aria-label={`Moving ${b.title} to ${fmtTime(drag.toStartMin)}${conflict ? ', conflicts here' : ''}`}
              >
                <div className="wk-ghost-t">{b.title}</div>
                <div className="wk-ghost-m">
                  {fmtTime(drag.toStartMin)}–{fmtTime(drag.toStartMin + drag.durationMin)}
                  {b.external ? ' · calendar — not mine to move' : b.protected ? ' · held' : ''}
                  {conflict ? ' · conflict' : ''}
                </div>
              </div>
            )
          })()}
      </div>

      {/* hover preview — read-only, beside the block, never over it. pointer-events
          none keeps every block underneath hoverable (preserves the dock's old
          invariant for a now-safe floating card). */}
      {preview &&
        (() => {
          const b = preview.block
          const place = sidePlacement(
            preview.rect,
            { width: PREVIEW_W, height: PREVIEW_H },
            { width: 730, height: H }
          )
          const life = b.tag !== 'work'
          const stroke = life ? 'var(--teal)' : 'var(--ice)'
          const isNow = todayKey === b.dayKey && live.current?.id === b.id
          // single-block arc at its real clock angle (clockDeg); a thin annular
          // wedge (sector) between two mini-rings — no new geometry.
          const d0 = clockDeg(b.startMin / 60)
          const d1 = clockDeg(Math.min(b.endMin, 24 * 60) / 60)
          const arc = sector(MC.cx, MC.cy, MC.r - MC.band, MC.r, d0, d1 <= d0 ? d0 + 2 : d1)
          const [tx, ty] = rPolar(MC.cx, MC.cy, MC.r + 1, 0) // 12-o'clock tick
          const state = b.protected
            ? ' · held'
            : isNow
              ? ' · now'
              : b.due != null
                ? ` · due ${fmtTime(b.due)}`
                : b.optional
                  ? ' · optional'
                  : ''
          return (
            <div
              className={'wk-preview' + (life ? ' life' : '')}
              style={{ left: place.x, top: place.y, width: PREVIEW_W }}
            >
              <svg
                className="wk-preview-clock"
                width={MC.size}
                height={MC.size}
                viewBox={`0 0 ${MC.size} ${MC.size}`}
              >
                <circle
                  cx={MC.cx}
                  cy={MC.cy}
                  r={MC.r}
                  fill="none"
                  stroke="var(--line)"
                  strokeWidth="1.2"
                />
                <circle
                  cx={MC.cx}
                  cy={MC.cy}
                  r={MC.r - MC.band}
                  fill="none"
                  stroke="var(--line2)"
                  strokeWidth="1"
                />
                <line x1={tx} y1={ty} x2={tx} y2={ty - 3} stroke="var(--faint)" strokeWidth="1.4" />
                <path d={arc} fill={stroke} opacity={0.9} />
              </svg>
              <div className="wk-preview-body">
                <div className="wk-preview-t">
                  {b.status === 'done' ? '✓ ' : ''}
                  {b.title}
                </div>
                <div className="wk-preview-m">
                  {fmtTime(b.startMin)}–{fmtTime(b.endMin)}
                  {state}
                </div>
              </div>
            </div>
          )
        })()}

      {/* the dock: pinned details live HERE on click, never floating over the grid */}
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
          <span className="wk-dock-hint">click a block — its details and actions land here</span>
        )}
      </div>

      <div className="week-summary">
        {plannedH}h planned
        {restKept && (
          <>
            {' '}
            · rest kept <span className="life">{restKept}</span>
          </>
        )}
        {pendingNudge ? (
          <>
            {' '}
            ·{' '}
            {heavy
              ? `${fmtDow(String(pendingNudge.payload?.dayKey ?? heavy.dayKey)).toLowerCase()} wants a kinder shape`
              : 'something is waiting'}{' '}
            —{' '}
            <button
              type="button"
              className="att"
              onClick={(e) => {
                e.stopPropagation()
                useMew.setState({ scrollToMsgId: pendingNudge.id })
              }}
            >
              nudge in chat
            </button>
          </>
        ) : (
          <> · the shape looks kind</>
        )}
      </div>
    </div>
  )
}
