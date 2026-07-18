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
import {
  dayLoadAria,
  dayLoadAssessment,
  dayLoadLevel,
  dayThroughputMin,
} from '../../domain/insights'
import { findHeavyDay } from '../../domain/nudges/engine'
import { clockDeg, nxwY, rPolar, sector } from './dialGeometry'
import { sidePlacement, type Rect } from './hoverPreview'
import { layoutLanes } from './lanes'
import { useGridDrag } from './useGridDrag'
import { rovingFocusId } from './orbitGeometry'
import { applyWeekKey, blockAriaLabel, weekFocusOrder, weekKeyIntent } from './weekKeys'
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
  const noteReferent = useMew((s) => s.noteReferent)
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

  /* the day-load density tint (#301): each day still being planned, against
     the user's demonstrated throughput — renders from local memory alone.
     Under the data floor the map stays empty: no tint, no claims from noise.
     The a11y label carries the hours the wash only hints at. */
  const dayLoads = useMemo(() => {
    const out = new Map<string, { level: 1 | 2 | 3; aria: string }>()
    const throughput = dayThroughputMin(memory, agg, todayKey)
    if (throughput == null) return out
    for (const k of keys) {
      if (k < todayKey) continue // lived days aren't being planned
      const a = dayLoadAssessment(blocks, k, throughput)
      if (!a) continue
      const level = dayLoadLevel(a.plannedMin, a.throughputMin)
      if (level) out.set(k, { level, aria: dayLoadAria(a) })
    }
    return out
  }, [blocks, memory, agg, todayKey, keys])

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
  const {
    drag,
    ghostBox,
    dragClash,
    bouncedId,
    gridRef,
    beginPress,
    beginResize,
    consumeSuppressedClick,
  } = useGridDrag(H, clearPreview)

  /* keyboard-first week (#303 — the dial's #253 grammar on the grid): one
     roving tab stop for all tiles, arrows walk them in visual order, Shift/Alt
     chords nudge/resize through the SAME dragMove door the drop above uses.
     All rules are pure (weekKeys.ts); this is just the wiring. */
  const dragMove = useMew((s) => s.dragMove)
  const [kbFocus, setKbFocus] = useState<string | null>(null)
  /* what the polite live region reads after an attempt — a moved block says
     where it landed; an immovable one says why it stays (never a silent no-op) */
  const [announce, setAnnounce] = useState('')
  const focusOrder = useMemo(() => weekFocusOrder(blocks, keys), [blocks, keys])
  const rovingId = rovingFocusId(focusOrder, kbFocus, live.current?.id ?? null)
  const blockRefs = useRef(new Map<string, HTMLDivElement>())
  const focusBlock = (id: string | null) => {
    if (!id) return
    setKbFocus(id)
    // next frame: a day-hopped tile remounts in its new column before rAF fires
    requestAnimationFrame(() => {
      const el = blockRefs.current.get(id)
      if (el?.isConnected) el.focus()
    })
  }
  const onBlockKeyDown = (b: Block) => (e: React.KeyboardEvent) => {
    const intent = weekKeyIntent(e.key, { shift: e.shiftKey, alt: e.altKey })
    if (!intent) return // unclaimed (Tab, characters, Alt+←/→…) — keep bubbling
    e.preventDefault()
    e.stopPropagation()
    applyWeekKey(blocks, keys, b, intent, {
      dragMove, // the store's drag door — keyboard commits get no second path
      moveFocus: focusBlock,
      announce: setAnnounce,
    })
  }

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
          const load = dayLoads.get(k)
          return (
            <button
              type="button"
              key={k}
              className={'nxb-dl' + (isSel ? ' today' : '')}
              /* the tint's meaning, spoken: day + the hours (#301). Absent
                 when the column carries no tint — the visible text speaks. */
              aria-label={load ? `${fmtDow(k)} ${fmtShortDate(k)} — ${load.aria}` : undefined}
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
        className={
          drag ? 'wk-grid dragging' + (drag.mode === 'resize' ? ' resizing' : '') : 'wk-grid'
        }
        /* role=application, like the dial (#253): a 2-D widget with its own
           arrow-key model, so AT hands keystrokes to the grid instead of the
           virtual cursor. The hint teaches the grammar once, on entry. */
        role="application"
        aria-label="week grid: the week's blocks, by day and hour"
        aria-describedby="wk-hint"
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
          const loadLevel = dayLoads.get(k)?.level
          return (
            <div
              key={k}
              data-daykey={k}
              className={
                'nxb-col' +
                (isSel ? ' today' : '') +
                (isPast ? ' past' : '') +
                (loadLevel ? ` wk-load${loadLevel}` : '')
              }
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
                /* edge handles ride owned, open blocks with room to grab (a
                   sliver would swallow its own body); external blocks aren't
                   ours to resize, and a resize past the keyboard floor is the
                   Alt+arrow alternative. */
                const resizable = !b.external && !done && blkH >= 24
                const openBlock = () => {
                  clearPreview()
                  setPinnedId(pinnedId === b.id ? null : b.id)
                  setCard(b)
                  noteReferent(b.id) // tapping a block makes it the conversational "it" (#320)
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
                    /* a keyboard-reachable block (#303): ONE roving tab stop for
                       the whole grid — Tab lands on the live block (else the
                       first in visual order), arrows walk the rest, Shift/Alt
                       chords nudge/resize through the drag door. Enter/Space
                       opens its detail card — the same thing a click does.
                       aria-label speaks title, time, and nature (calendar/held)
                       so a screen reader knows a fixed block before trying it. */
                    role="button"
                    tabIndex={rovingId === b.id ? 0 : -1}
                    aria-label={blockAriaLabel(b)}
                    ref={(el) => {
                      // never let a day-hop's unmount(null) erase the remounted tile
                      if (el) blockRefs.current.set(b.id, el)
                      else if (!blockRefs.current.get(b.id)?.isConnected)
                        blockRefs.current.delete(b.id)
                    }}
                    onFocus={() => setKbFocus(b.id)}
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
                        return
                      }
                      onBlockKeyDown(b)(e)
                    }}
                  >
                    {/* resize grips (#347): drag an edge to change duration. The
                        top edge moves the start, the bottom the end; both commit
                        through the SAME dragMove door the move gesture and the
                        keyboard Alt+arrows use. Pointer-only + aria-hidden — the
                        keyboard alternative owns a11y, so these add no tab stop
                        and no text for the overlap gate to see. */}
                    {resizable && (
                      <>
                        <div
                          className="nxb-resize top"
                          aria-hidden="true"
                          onMouseDown={(e) => beginResize(b, 'top', e)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div
                          className="nxb-resize bottom"
                          aria-hidden="true"
                          onMouseDown={(e) => beginResize(b, 'bottom', e)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </>
                    )}
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
                aria-label={`${drag.mode === 'resize' ? 'Resizing' : 'Moving'} ${b.title} to ${fmtTime(drag.toStartMin)}–${fmtTime(drag.toStartMin + drag.durationMin)}${conflict ? ', conflicts here' : ''}`}
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

      {/* the keyboard grammar, spoken once on grid entry (aria-describedby) */}
      <span id="wk-hint" className="sr-only">
        arrows move between blocks. shift with an arrow nudges a block 15 minutes, or a day left and
        right. alt with up or down resizes it. enter opens its card.
      </span>
      {/* what a keyboard attempt did — where a block landed, or why it stays
          (a calendar block announces itself; nothing is ever a silent no-op) */}
      <span className="sr-only" role="status" aria-live="polite" data-wk-live>
        {announce}
      </span>

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
