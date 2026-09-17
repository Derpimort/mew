/* Focus — a FIXED 12-hour clock face. 12 sits at the top and never moves; every
   block rides an arc at its real start→end clock angle; now is a hand that
   sweeps the face. Day progress is a quiet two-stage wash — the inner disk over
   the first 12 h, the inner→outer band over the second — ending at the now
   notch. Hierarchy is brightness, never thickness: the focus item glows on the
   outer task ring, everyone else steps inward one compact lane so same-angle
   arcs never share a radius. One click on any arc/dot/label promotes it; the
   chip under the task lets it run in background. Those clicks write `attention`
   on the block — that's the whole mechanism. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMew, useLive, clockNow } from '../../state/store'
import type { Block } from '../../domain/types'
import { dayKey, fmtDow, fmtTime, minOfDay } from '../../domain/time'
import { isAllDay, isBackground } from '../../domain/week'
import { clockDeg, dialKeyAction, rArc, rPolar, sector } from './dialGeometry'
import {
  arcAriaLabel,
  badgeAriaLabel,
  badgeRow,
  crossDaySpan,
  dayFill,
  dialBadges,
  dialFocusOrder,
  fitLabel,
  labelBudget,
  LANE_STEP,
  OG,
  isBadge,
  isRunning,
  orbitColor,
  radiiFor,
  resolveLabels,
  rovingFocusId,
  revealAnchorX,
  stepDialFocus,
  visibleOrbit,
  wrapLabel,
} from './orbitGeometry'
import { BlockCard } from './BlockCard'
import { DayPicker } from './DayPicker'
import { ThreadRail } from './ThreadRail'
import StaggeredText from '../react-bits/staggered-text'
import {
  dayLine,
  daySummary,
  daySummaryLine,
  dayTitle,
  dialAriaLabel,
  spokenDay,
  stepDay,
  washMinute,
} from './dialDay'

/** Live wall clock, parked top-centre of the stage clear of the face — the exact
    readout the clock-face approximates. Date rides above the time, both centred;
    the time is the hero, the date shares the seconds' gold-mono type.

    The date line is also the day header (#23): ‹ › step the dial to the day
    before or after, and away from today the live time gives way to a way back.
    The steps sit outside the date's flow and stay invisible until the date is
    hovered or a step is focused, so today's clock renders exactly as before.
    The date itself is the day picker's trigger (slice 2): a real button whose
    calendar glyph shows with the steps, and whose name starts with the date it
    shows (WCAG 2.5.3). "current time" names the time readout alone, so the
    trigger never borrows that tooltip. */
function NxClock({
  now,
  viewDayKey,
  todayKey,
  isToday,
  onStep,
  onToday,
  onPick,
}: {
  now: Date
  viewDayKey: string
  todayKey: string
  isToday: boolean
  onStep: (dir: 1 | -1) => void
  onToday: () => void
  onPick: (key: string) => void
}) {
  const [picking, setPicking] = useState(false)
  const pickRef = useRef<HTMLButtonElement>(null)
  /* a close hands focus back to the trigger (WCAG 2.4.3); a dismissal leaves
     it wherever the user sent it */
  const closePicker = useCallback(() => {
    setPicking(false)
    pickRef.current?.focus()
  }, [])
  const dismissPicker = useCallback(() => setPicking(false), [])
  return (
    <span className={'nx-clock' + (picking ? ' picking' : '')}>
      <span className={'nx-day' + (isToday ? '' : ' away')}>
        <button
          type="button"
          className="nx-day-step prev"
          aria-label={`previous day — ${spokenDay(stepDay(viewDayKey, -1))}`}
          onClick={(e) => {
            e.stopPropagation()
            onStep(-1)
          }}
        >
          ‹
        </button>
        <button
          ref={pickRef}
          type="button"
          className="nx-day-pick"
          aria-haspopup="dialog"
          aria-expanded={picking}
          onClick={(e) => {
            e.stopPropagation()
            if (picking) closePicker()
            else setPicking(true)
          }}
        >
          <svg
            className="nx-day-glyph"
            width="12"
            height="12"
            viewBox="0 0 16 16"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="1.75" y="3" width="12.5" height="11.25" rx="2" />
            <path d="M1.75 6.75h12.5M5.25 1.5v3M10.75 1.5v3" />
          </svg>
          <span className="dt">{dayLine(viewDayKey)}</span>
          <span className="sr-only"> — change day</span>
        </button>
        <button
          type="button"
          className="nx-day-step next"
          aria-label={`next day — ${spokenDay(stepDay(viewDayKey, 1))}`}
          onClick={(e) => {
            e.stopPropagation()
            onStep(1)
          }}
        >
          ›
        </button>
        {picking && (
          <DayPicker
            viewDayKey={viewDayKey}
            todayKey={todayKey}
            triggerRef={pickRef}
            onClose={closePicker}
            onDismiss={dismissPicker}
            onPick={(key) => {
              onPick(key)
              closePicker()
            }}
          />
        )}
      </span>
      {isToday ? (
        <span className="nx-time" title="current time">
          <span className="hm">{fmtTime(minOfDay(now))}</span>
          <span className="sc">:{String(now.getSeconds()).padStart(2, '0')}</span>
        </span>
      ) : (
        <button
          type="button"
          className="nx-day-today"
          onClick={(e) => {
            e.stopPropagation()
            onToday()
          }}
        >
          back to today
        </button>
      )}
    </span>
  )
}

const NUMERALS: ReadonlyArray<readonly [string, number]> = [
  ['12', 0],
  ['3', 90],
  ['6', 180],
  ['9', 270],
]

export function FocusOrbit() {
  const blocks = useMew((s) => s.blocks)
  const nowMs = useMew((s) => s.nowMs)
  const setAttention = useMew((s) => s.setAttention)
  const noteReferent = useMew((s) => s.noteReferent)
  const focusedDayKey = useMew((s) => s.focusedDayKey)
  const focusDay = useMew((s) => s.focusDay)
  const live = useLive()

  const [, forceSecond] = useState(0)
  const now = new Date(Math.max(nowMs, clockNow()))
  const todayKey = dayKey(now)
  const nowH = minOfDay(now) / 60
  /* the shown day (#23): the day picked in Week or with the header steps, else
     today — one key, so Focus → Week → Focus keeps it. Everything keyed to NOW
     (the tick, the hand, running, the countdown) belongs to today alone. */
  const viewDayKey = focusedDayKey ?? todayKey
  const isToday = viewDayKey === todayKey
  /* 1s clock: countdown + the rolling mapping both stay fresh between store
     ticks — today only; another day has no now to keep fresh */
  useEffect(() => {
    if (!isToday) return
    const id = setInterval(() => forceSecond((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [isToday])

  // `nowH`/`viewDayKey` derive from clockNow() each render, so the React Compiler
  // can't prove this memo's inputs are stable and bails out. The manual deps are
  // correct and intended (recompute only when blocks/day/hour change); keep them.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- deps derive from a non-reactive clock read; manual memo is intentional
  const vis = useMemo(() => visibleOrbit(blocks, viewDayKey, nowH), [blocks, viewDayKey, nowH])
  /* useLive() is today's live state — another day has no current item */
  const focusId = isToday ? (live.current?.id ?? null) : null
  const radii = useMemo(() => radiiFor(vis, focusId, nowH), [vis, focusId, nowH])
  /* only open blocks carry a persistent callout — done ones are quiet markers
     (title shows in the hover hint), keeping a full day's face uncluttered */
  const labels = useMemo(
    () =>
      resolveLabels(
        vis.filter((b) => b.status === 'open'),
        radii
      ),
    [vis, radii]
  )

  /* today's all-day entries (#27): pill badges above the centre, never wedges.
     A crowded day shows BADGE_MAX and "+N more" until opened (per day). */
  const badges = dialBadges(blocks, viewDayKey)
  const [badgesOpenDay, setBadgesOpenDay] = useState<string | null>(null)
  const badgeView = badgeRow(badges, badgesOpenDay === viewDayKey)
  const badgeIds = badgeView.shown.map((b) => b.id)

  const [hover, setHover] = useState<string | null>(null)
  const [cardId, setCardId] = useState<string | null>(null)
  /* declutter: at rest the face shows only arcs + now-hand + the centre. Hovering
     the dial reveals the labels, leader pointers, and the chip — details on
     demand, not always-on. */
  const [dialHover, setDialHover] = useState(false)

  /* a click on any item opens its detail card (centred, with actions —
     Start now / Done / Interrupt / Move). The card is where the week changes. */
  const openCard = (id: string) => {
    setCardId((v) => (v === id ? null : id))
    noteReferent(id) // tapping a block makes it the conversational "it" (#320)
  }
  const demote = () => {
    if (focusId) setAttention(focusId, 'background')
    setCardId(null)
  }

  /* ── keyboard access (WCAG 2.2 §2.1.1 · APG Application pattern) ────────────
     A roving tabindex: exactly one arc sits in the tab order (the live focus item,
     else the first by time), so native Tab reaches the dial then the demote chip
     then leaves (no keyboard trap, §2.1.2), while arrow keys move focus among ALL
     arcs across the two clock axes. `kbFocus` is the roving anchor; `arcRefs` lets
     us imperatively move DOM focus to the next arc so a screen reader announces
     it. The interaction reads from the same pure geometry the dial draws with. */
  const arcOrder = useMemo(() => dialFocusOrder(vis), [vis])
  /* badges lead the reading order: they sit above the centre and cover the day */
  const order = [...badgeIds, ...arcOrder]
  const [kbFocus, setKbFocus] = useState<string | null>(null)
  const [chipFocused, setChipFocused] = useState(false) // keyboard focus on the demote chip reveals it
  // the single roving tab stop (one tabindex=0): last keyboard arc, else the live
  // focus item, else the first by time — so Tab always reaches the dial.
  const rovingId = rovingFocusId(order, kbFocus, focusId)
  const arcRefs = useRef(new Map<string, SVGElement | HTMLElement | null>())
  const focusArc = (id: string | null) => {
    if (!id) return
    setKbFocus(id)
    // move DOM focus on the next frame so the freshly-rendered tabindex=0 takes
    requestAnimationFrame(() => arcRefs.current.get(id)?.focus())
  }
  const promote = (id: string) => {
    setAttention(id, 'focus') // the inverse of the demote chip — id becomes the centre
    setKbFocus(id)
  }
  /* one keydown handler for every arc. The pressed arc's id is the anchor, so the
     handler is the same function for all of them — it just reads which arc fired.
     Tab/Shift+Tab fall through unclaimed, keeping native focus traversal. */
  const onArcKeyDown = (id: string) => (e: React.KeyboardEvent) => {
    const action = dialKeyAction(e.key)
    if (!action) return
    switch (action.kind) {
      case 'step':
        e.preventDefault()
        focusArc(stepDialFocus(vis, radii, id, action.axis, action.dir, badgeIds))
        break
      case 'promote':
        e.preventDefault()
        promote(id)
        break
      case 'open':
        e.preventDefault()
        openCard(id) // Space activates like a click — the detail card
        break
      case 'demote':
        e.preventDefault()
        demote()
        break
    }
  }

  /* a badge carries an arc's grammar with one difference: a day label has no
     centre to take, so Enter opens its card like Space; Escape closes it */
  const [badgeFocus, setBadgeFocus] = useState<string | null>(null)
  const onBadgeKeyDown = (id: string) => (e: React.KeyboardEvent) => {
    const action = dialKeyAction(e.key)
    if (!action) return
    e.preventDefault()
    switch (action.kind) {
      case 'step':
        focusArc(stepDialFocus(vis, radii, id, action.axis, action.dir, badgeIds))
        break
      case 'promote':
      case 'open':
        openCard(id)
        break
      case 'demote':
        setCardId(null)
        break
    }
  }
  /* hover, keyboard focus or an open card on a badge lights the WHOLE ring */
  const wholeDay = isBadge(badges, hover) || isBadge(badges, badgeFocus) || isBadge(badges, cardId)
  const badgeRowEl =
    badges.length > 0 ? (
      <DialBadges
        view={badgeView}
        todayKey={todayKey}
        rovingId={rovingId}
        litId={hover ?? cardId}
        hidden={cardId != null}
        badgeRef={(id) => (el) => {
          arcRefs.current.set(id, el)
        }}
        onHover={setHover}
        onFocusBadge={(id) => {
          setKbFocus(id)
          setBadgeFocus(id)
        }}
        onBlurBadge={(id) => setBadgeFocus((f) => (f === id ? null : f))}
        onOpen={openCard}
        onBadgeKey={(id, e) => onBadgeKeyDown(id)(e)}
        onMore={() => setBadgesOpenDay(viewDayKey)}
      />
    ) : null

  /* countdown to the FOCUS item's end, ticking seconds */
  const secOfDay = minOfDay(now) * 60 + now.getSeconds()
  const current = isToday ? live.current : undefined
  const left = current ? Math.max(0, current.endMin * 60 - secOfDay) : 0
  const count = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  const meta = current
    ? `remaining · ${
        current.due != null
          ? `due ${fmtTime(current.due)}`
          : current.protected
            ? `held until ${fmtTime(current.endMin)}`
            : `until ${fmtTime(current.endMin)}`
      }`
    : (live.meta[0] ?? '')

  return (
    <div
      className="nx-stage"
      style={{ width: OG.w, height: OG.h, position: 'relative' }}
      /* role=application: this is a custom 2-D widget with its own arrow-key model,
         not a document region, so AT hands keystrokes straight to it (APG). The
         label names what it is; the hint line describes how to read it. */
      role="application"
      aria-label={dialAriaLabel(viewDayKey, todayKey)}
      aria-describedby="dial-hint"
      onClick={() => setCardId(null)}
      onMouseEnter={() => setDialHover(true)}
      onMouseLeave={() => setDialHover(false)}
    >
      {/* announced first on load so a screen-reader user has context before the
          arcs (visually hidden — the clock face IS the visible heading) */}
      <h2 id="dial-title" className="sr-only">
        Focus dial
      </h2>
      {/* top-center: the live clock and the loose-threads pill, side by side */}
      <div className="nx-topbar">
        <NxClock
          now={now}
          viewDayKey={viewDayKey}
          todayKey={todayKey}
          isToday={isToday}
          onStep={(dir) => {
            const next = stepDay(viewDayKey, dir)
            focusDay(next === todayKey ? null : next) // today stays the canonical null
            setCardId(null)
          }}
          onToday={() => {
            focusDay(null)
            setCardId(null)
          }}
          onPick={(key) => {
            focusDay(key === todayKey ? null : key) // the picker's day, the same one key
            setCardId(null)
          }}
        />
        <ThreadRail onOpen={(id) => setCardId(id)} />
      </div>
      <svg width={OG.w} height={OG.h} viewBox={`-${OG.ox} 0 ${OG.w} ${OG.h}`}>
        {/* day progress + framing: the fill aligns to the two rings — the AM zone
            fills the inner disk up to the inner ring (disk→ri) over the first 12 h,
            then the PM zone fills the gap between the inner and outer rings (ri→pm)
            over the second — a quiet accent ending at the now notch. The disk
            (r<disk) stays clear for the countdown. TWO rings
            are drawn: the inner ring (ri) splits the AM half, and the outer ring
            (pm) is the bezel that carries the ticks + numerals. The PM commitment
            divider (ro) is geometry only — never a line — so the face reads as two
            clean rings, not three. */}
        {(() => {
          /* a lived day is full, a day ahead empty; today fills to the now notch */
          const f = dayFill(washMinute(viewDayKey, todayKey, minOfDay(now)))
          return (
            <g pointerEvents="none" aria-hidden="true">
              {f.inner > 0.3 && (
                <path
                  d={sector(OG.cx, OG.cy, OG.disk, OG.ri, 0, f.inner)}
                  fill="var(--ice)"
                  opacity={0.18}
                />
              )}
              {f.outer > 0.3 && (
                <path
                  d={sector(OG.cx, OG.cy, OG.ri, OG.pm, 0, f.outer)}
                  fill="var(--ice)"
                  opacity={0.12}
                />
              )}
              <circle
                cx={OG.cx}
                cy={OG.cy}
                r={OG.ri}
                fill="none"
                stroke="var(--line2)"
                strokeWidth="1.6"
                opacity={0.7}
              />
              <circle
                cx={OG.cx}
                cy={OG.cy}
                r={OG.pm}
                fill="none"
                stroke="var(--line2)"
                strokeWidth="1.6"
                opacity={0.7}
              />
            </g>
          )
        })()}

        {/* whole-day light (#27): a badge hovered, focused or open covers the
            day, so the entire face glows — a full-turn annulus (sector clamps a
            complete turn just shy of 360°) and a lit bezel */}
        {wholeDay && (
          <g className="dial-wholeday" pointerEvents="none" aria-hidden="true">
            <path
              d={sector(OG.cx, OG.cy, OG.disk, OG.pm, 0, 360)}
              fill="var(--ice)"
              opacity={0.1}
            />
            <circle
              cx={OG.cx}
              cy={OG.cy}
              r={OG.pm}
              fill="none"
              stroke="var(--ice)"
              strokeWidth="2.4"
              opacity={0.9}
              style={{ filter: 'drop-shadow(0 0 8px var(--glowc))' }}
            />
          </g>
        )}

        {/* fixed bezel: hour ticks at all 12 (12/3/6/9 major), 12 pinned at top */}
        <g pointerEvents="none" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => {
            const deg = i * 30
            const major = i % 3 === 0
            const [x0, y0] = rPolar(OG.cx, OG.cy, OG.tick, deg)
            const [x1, y1] = rPolar(OG.cx, OG.cy, OG.tick - (major ? 12 : 6), deg)
            return (
              <line
                key={`tk-${i}`}
                x1={x0}
                y1={y0}
                x2={x1}
                y2={y1}
                stroke="var(--line2)"
                strokeWidth={major ? 2 : 1}
                opacity={major ? 0.85 : 0.45}
              />
            )
          })}
          {NUMERALS.map(([n, deg]) => {
            const [x, y] = rPolar(OG.cx, OG.cy, OG.num, deg)
            return (
              <text
                key={`nm-${n}`}
                className="nx-num"
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {n}
              </text>
            )
          })}
        </g>

        {vis.map((b) => {
          const isF = b.id === focusId
          const isDone = b.status === 'done'
          const r = radii.get(b.id) ?? OG.ro
          const isKb = kbFocus === b.id // keyboard focus reveals the same detail hover does
          const isH = hover === b.id || isKb
          const col = isDone ? 'var(--faint)' : orbitColor(b, isF)
          const op = isDone ? 0.34 : isF ? 1 : isH ? 0.95 : 0.42
          const dueBg = isBackground(b) && b.due != null
          /* the arc spans the block's REAL clock angles, but a block that runs
             past midnight is clipped to today's segment — a 12-h face has no
             angle for tomorrow, so we draw start→day-end and mark the carry
             rather than sweeping a giant wrap-around arc. A deadline-background
             block runs to its same-day due tick (the deadline is its end), so it
             never clips or carries — only the real duration end can cross days. */
          const span = crossDaySpan(b.startMin, b.endMin)
          const carry = !dueBg && (span.continuesAfter || span.continuesFrom)
          const d0 = clockDeg(span.drawStart / 60)
          const d1 = clockDeg((dueBg ? b.due! : span.drawEnd) / 60)
          const [ex, ey] = rPolar(OG.cx, OG.cy, r, d1)
          const lbl = labels.get(b.id) // open blocks only; done are quiet markers
          const handlers = {
            onMouseEnter: () => setHover(b.id),
            onMouseLeave: () => setHover(null),
            onClick: (ev: React.MouseEvent) => {
              ev.stopPropagation()
              openCard(b.id) // every item opens its centred card with actions
            },
          }
          const title = b.title.split('—')[0].trim()
          const timeNote = dueBg
            ? `due ${fmtTime(b.due!)}`
            : span.continuesAfter
              ? `→ ${fmtTime(span.endLabelMin)}` // runs into tomorrow; show its real end
              : span.continuesFrom
                ? `ends ${fmtTime(span.endLabelMin)}` // tail of a block that began yesterday
                : isToday && isRunning(b, nowH)
                  ? `→ ${fmtTime(b.endMin)}`
                  : `@ ${fmtTime(b.startMin)}`
          const arcPath = rArc(OG.cx, OG.cy, r, d0, d1)
          return (
            <g key={b.id}>
              {/* keyboard focus ring: drawn (not a CSS box-outline, which reads
                  oddly on a thin SVG arc) in the full-saturation accent so it
                  clears 3:1 over both the stage and a same-coloured arc, with a
                  4px standoff halo — the §1.4.11/§2.4.7 indicator. Only on
                  keyboard focus; a mouse promote never shows it. */}
              {isKb && (
                <path
                  d={arcPath}
                  fill="none"
                  stroke="var(--ice)"
                  strokeWidth={9}
                  strokeLinecap="round"
                  opacity={0.9}
                  pointerEvents="none"
                  aria-hidden="true"
                  style={{
                    filter: 'drop-shadow(0 0 0 4px var(--bg)) drop-shadow(0 0 7px var(--ice))',
                  }}
                />
              )}
              <path
                className="pri-arc"
                aria-hidden="true"
                d={arcPath}
                fill="none"
                stroke={col}
                strokeWidth={isDone ? 2.5 : isF ? 5 : isH ? 5 : 3.5}
                strokeLinecap="round"
                strokeDasharray={
                  isDone ? 'none' : dueBg ? '1 5' : b.tag === 'rest' ? '2 7' : 'none'
                }
                opacity={op}
                style={isF && !isDone ? { filter: 'drop-shadow(0 0 9px var(--glowc))' } : undefined}
                {...handlers}
              />
              {/* fat invisible hit-target — also the keyboard button: a thin arc
                  is a tiny mouse + focus target, so this forgiving overlay carries
                  the role, the name, and the roving tabindex (APG button). */}
              <path
                className="pri-arc"
                d={arcPath}
                fill="none"
                stroke="transparent"
                strokeWidth={18}
                role="button"
                aria-label={arcAriaLabel(b)}
                tabIndex={rovingId === b.id ? 0 : -1}
                ref={(el) => {
                  arcRefs.current.set(b.id, el)
                }}
                onKeyDown={onArcKeyDown(b.id)}
                onFocus={() => setKbFocus(b.id)}
                style={{ cursor: 'pointer' }}
                {...handlers}
              />
              {/* end marker: a glowing tick for open work, a quiet dot for done */}
              <circle
                cx={ex}
                cy={ey}
                r={isDone ? 3 : isF ? 5 : isH ? 5 : dueBg ? 4.5 : 3.5}
                fill={col}
                opacity={Math.min(op + 0.15, 1)}
                style={
                  isF && !isDone
                    ? { filter: 'drop-shadow(0 0 8px var(--glowc))' }
                    : dueBg
                      ? { filter: 'drop-shadow(0 0 8px var(--glowc))' }
                      : undefined
                }
                className="pri-arc"
                aria-hidden="true"
                {...handlers}
              />
              {/* continuation cue: a multi-day block is clipped to today, so the
                  clipped edge wears a small chevron in the sweep direction —
                  forward (›) when it carries into tomorrow, back (‹) when it
                  arrived from yesterday — so the wedge reads "continues", never
                  "ends at midnight". The "→ H:MM" follows the same hover-reveal
                  discipline as labels; the chevron itself stays quietly on. */}
              {carry &&
                (() => {
                  const edgeDeg = clockDeg(
                    (span.continuesAfter ? span.drawEnd : span.drawStart) / 60
                  )
                  const fwd = span.continuesAfter // forward = clockwise into tomorrow
                  const [cxp, cyp] = rPolar(OG.cx, OG.cy, r, edgeDeg + (fwd ? 5 : -5))
                  const [txp, typ] = rPolar(OG.cx, OG.cy, r + 13, edgeDeg + (fwd ? 7 : -7))
                  return (
                    <g pointerEvents="none" aria-hidden="true">
                      <text
                        x={cxp}
                        y={cyp}
                        textAnchor="middle"
                        dominantBaseline="central"
                        style={{
                          fill: col,
                          fontFamily: "'JetBrains Mono',monospace",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                        opacity={Math.min(op + 0.2, 1)}
                      >
                        {fwd ? '›' : '‹'}
                      </text>
                      <text
                        className="dial-reveal"
                        x={txp}
                        y={typ}
                        textAnchor="middle"
                        dominantBaseline="central"
                        style={{
                          fill: 'var(--muted)',
                          fontFamily: "'JetBrains Mono',monospace",
                          fontSize: 9,
                        }}
                        opacity={dialHover || isH || isF ? 0.85 : 0}
                      >
                        {fwd ? `→ ${fmtTime(span.endLabelMin)}` : `${fmtTime(span.endLabelMin)} →`}
                      </text>
                    </g>
                  )
                })()}
              {lbl && lbl.moved && (
                <line
                  className="dial-reveal"
                  aria-hidden="true"
                  x1={ex}
                  y1={ey}
                  x2={lbl.x + (lbl.right ? -4 : 4)}
                  y2={lbl.y}
                  stroke={col}
                  strokeWidth="1"
                  opacity={dialHover || isH || isF ? op * 0.5 : 0}
                  pointerEvents="none"
                />
              )}
              {lbl && (
                <text
                  className="pri-lbl"
                  aria-hidden="true"
                  x={lbl.x}
                  y={lbl.y}
                  textAnchor={lbl.right ? 'start' : 'end'}
                  dominantBaseline="central"
                  opacity={dialHover || isH || isF ? (isF ? 1 : isH ? 0.95 : 0.6) : 0}
                  pointerEvents={dialHover || isH || isF ? undefined : 'none'}
                  style={{
                    fill: isF ? 'var(--ink)' : col,
                    fontFamily: "'Hanken Grotesk',sans-serif",
                    fontSize: isH ? 13 : 11.5,
                    fontWeight: isH ? 760 : 650,
                    /* the reveal states halo in the stage colour so wrapped
                       lines stay legible over numerals or a neighbour label */
                    ...(isH || isF
                      ? { paintOrder: 'stroke', stroke: 'var(--bg)', strokeWidth: 3.5 }
                      : {}),
                  }}
                  {...handlers}
                >
                  {/* at rest: a tidy one-line preview, ellipsized into the room
                      left to the svg edge (labels near 3/9 o'clock used to run
                      off the viewBox and clip mid-glyph). On hover/focus the
                      FULL title wraps into stacked lines instead — the reveal
                      exists to read the task, so no characters are eaten. */}
                  {(() => {
                    const font = isH ? 13 : 11.5
                    if (isH || isF) {
                      /* an edge-hugging anchor is nudged inward until a line
                         can hold ~14 chars — wrapped words, not broken ones */
                      const ax = revealAnchorX(lbl.x, lbl.right, font)
                      const lines = wrapLabel(title, labelBudget(ax, lbl.right, font))
                      const lineH = 15
                      return (
                        <>
                          {lines.map((ln, i) => (
                            <tspan
                              key={i}
                              x={ax}
                              dy={i === 0 ? (-(lines.length - 1) * lineH) / 2 : lineH}
                            >
                              {ln}
                            </tspan>
                          ))}
                          <tspan
                            x={ax}
                            dy={lineH}
                            style={{
                              fill: 'var(--muted)',
                              fontFamily: "'JetBrains Mono',monospace",
                              fontSize: 9,
                            }}
                          >
                            {timeNote}
                          </tspan>
                        </>
                      )
                    }
                    const budget = labelBudget(lbl.x, lbl.right, font, timeNote.length * 5.6 + 6)
                    return (
                      <>
                        {fitLabel(title, Math.min(budget, 19))}{' '}
                        <tspan
                          style={{
                            fill: 'var(--muted)',
                            fontFamily: "'JetBrains Mono',monospace",
                            fontSize: 9,
                          }}
                        >
                          {timeNote}
                        </tspan>
                      </>
                    )
                  })()}
                </text>
              )}
            </g>
          )
        })}

        {/* now — a hand that sweeps the fixed face to the current clock angle,
            crossing all four bands from the clear disk out to the rim notch where
            the day wash ends. Today only: another day has no now (#23). */}
        {isToday &&
          (() => {
            const deg = clockDeg(minOfDay(now) / 60)
            const [hx, hy] = rPolar(OG.cx, OG.cy, OG.tick, deg)
            const [tx, ty] = rPolar(OG.cx, OG.cy, OG.disk - 6, deg)
            return (
              <g pointerEvents="none" aria-hidden="true">
                <line
                  x1={tx}
                  y1={ty}
                  x2={hx}
                  y2={hy}
                  stroke="var(--ice)"
                  strokeWidth="2"
                  opacity={0.85}
                  style={{ filter: 'drop-shadow(0 0 6px var(--glowc))' }}
                />
                <circle
                  cx={hx}
                  cy={hy}
                  r="5.5"
                  fill="var(--ice)"
                  style={{ filter: 'drop-shadow(0 0 12px var(--glowc))' }}
                />
              </g>
            )
          })()}
      </svg>

      {/* center: countdown → meta → task → demote chip; or "Nothing holds you.";
          or, on another day, that day itself — never a fabricated current (#23) */}
      {current ? (
        <div
          className="clk-center"
          style={cardId ? { opacity: 0, pointerEvents: 'none' } : undefined}
        >
          {badgeRowEl}
          <div className="nx-count" style={{ fontSize: count.length > 5 ? 48 : 64 }}>
            {count}
          </div>
          <div className="nx-meta">{meta}</div>
          <button
            type="button"
            className="nx-task"
            style={{ fontSize: 25, cursor: 'pointer' }}
            aria-label={`${live.headline} — open details`}
            onClick={(e) => {
              e.stopPropagation()
              setCardId((v) => (v === current!.id ? null : current!.id))
            }}
          >
            <StaggeredText
              key={live.headline}
              text={live.headline}
              as="span"
              segmentBy="words"
              delay={55}
              duration={0.5}
            />
          </button>
          {/* "run in background" is the one dial action with no other route, so it
              must be keyboard-reachable: it reveals on focus as well as hover, and
              its own focus keeps it visible (pointer-events on once revealed). */}
          <button
            type="button"
            className="pri-demote"
            role="button"
            tabIndex={0}
            aria-label={`let ${current.title.split('—')[0].trim()} run in background`}
            /* visible on hover OR keyboard focus, so a keyboard-only user reaches
               it in the tab order and sees it appear (never a hidden control) */
            style={{ opacity: dialHover || chipFocused ? 1 : 0, pointerEvents: 'auto' }}
            onClick={(e) => {
              e.stopPropagation()
              demote()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault()
                demote()
              }
            }}
            onFocus={() => setChipFocused(true)}
            onBlur={() => setChipFocused(false)}
          >
            ↓ let it run in background
          </button>
        </div>
      ) : isToday ? (
        <div className="clk-center" style={{ width: 280 }}>
          {badgeRowEl}
          <div className="nx-task" style={{ fontSize: 24, color: 'var(--muted)' }}>
            <StaggeredText
              key={live.headline}
              text={live.headline}
              as="span"
              segmentBy="words"
              delay={55}
              duration={0.5}
            />
          </div>
          <div className="nx-meta" style={{ marginTop: 10 }}>
            {meta}
          </div>
        </div>
      ) : (
        <div className="clk-center" style={{ width: 280 }}>
          {badgeRowEl}
          <div className="nx-task" style={{ fontSize: 24, color: 'var(--muted)' }}>
            <StaggeredText
              key={viewDayKey}
              text={dayTitle(viewDayKey)}
              as="span"
              segmentBy="words"
              delay={55}
              duration={0.5}
            />
          </div>
          <div className="nx-meta" style={{ marginTop: 10 }}>
            {daySummaryLine(daySummary(blocks, viewDayKey))}
          </div>
        </div>
      )}

      {/* the shown day, spoken when a step changes it (a live region announces
          changes, not its first content) */}
      <span className="sr-only" aria-live="polite">
        {isToday ? 'showing today' : `showing ${spokenDay(viewDayKey)}`}
      </span>

      {(() => {
        const cardBlock = cardId ? blocks.find((b) => b.id === cardId) : null
        if (!cardBlock) return null
        return (
          <BlockCard
            variant="center"
            block={cardBlock}
            isNow={cardBlock.id === focusId}
            offDay={!isToday}
            pinned
            onClose={() => setCardId(null)}
            style={{ left: OG.cx + OG.ox, top: OG.cy }}
          />
        )
      })()}

      {/* Hover readout — a glanceable timeslot, parked in the stage's bottom strip
          (its original home), in the clear band below the 6 o'clock numeral so it
          never sits under an arc. Calendar-tooltip hierarchy: the TIME RANGE is the
          hero (mono, full-contrast --ink, ~14px); the title is the quiet second
          line. When nothing's hovered the same slot carries a faint affordance, so
          there's never a separate strip crossing the arcs. */}
      <div
        id="dial-hint"
        className="pri-readout dial-reveal"
        style={{
          left: OG.cx + OG.ox,
          top: OG.h - 42,
          opacity: dialHover ? 1 : 0,
          pointerEvents: 'none',
        }}
      >
        {(() => {
          const hb = hover
            ? (vis.find((b) => b.id === hover) ?? badges.find((b) => b.id === hover))
            : null
          if (hb && isAllDay(hb)) {
            /* a badge's readout: the whole day, never a clock span */
            return (
              <>
                <span className="pri-range">
                  all day
                  {hb.endDayKey && hb.endDayKey > todayKey && (
                    <span className="xd">→ {fmtDow(hb.endDayKey).toLowerCase()}</span>
                  )}
                </span>
                <span className="pri-sub">{hb.title.split('—')[0].trim()}</span>
              </>
            )
          }
          if (hb) {
            const t = hb.title.split('—')[0].trim()
            const dueOnly = isBackground(hb) && hb.due != null
            /* crossDaySpan is the single source of truth for "spills into
               tomorrow": continuesAfter covers BOTH stored shapes (unfolded
               endMin>1440 and folded endMin<=startMin), and endLabelMin is the
               true end folded into [0,24h) — so the +1d cue and the end time
               agree no matter how the block was stored. */
            const hSpan = crossDaySpan(hb.startMin, hb.endMin)
            return (
              <>
                <span className="pri-range">
                  {dueOnly ? (
                    <>due {fmtTime(hb.due!)}</>
                  ) : (
                    <>
                      {fmtTime(hb.startMin)}
                      <span className="dash">–</span>
                      {fmtTime(hSpan.endLabelMin)}
                      {hSpan.continuesAfter && <span className="xd">+1d</span>}
                    </>
                  )}
                </span>
                <span className="pri-sub">{t}</span>
              </>
            )
          }
          return <span className="pri-idle">hover any item for its time · click to open</span>
        })()}
        {/* keyboard guidance, always present so aria-describedby is stable; the
            visual line above stays mouse-worded by design — this is for AT only */}
        <span className="sr-only">
          Use arrow keys to move between tasks, Enter to bring a task to the centre, Space to open
          its details, Escape to let the centre task run in the background.
        </span>
      </div>
    </div>
  )
}

/** The dial's all-day badges (#27): today's day labels as pills above the
    centre stack — never ring wedges. Props in, markup out: FocusOrbit owns the
    state; a badge joins the dial's roving tab stop and opens the same card. */
export function DialBadges({
  view,
  todayKey,
  rovingId,
  litId,
  hidden,
  badgeRef,
  onHover,
  onFocusBadge,
  onBlurBadge,
  onOpen,
  onBadgeKey,
  onMore,
}: {
  view: { shown: Block[]; more: number }
  todayKey: string
  /** the dial's single tab stop — a badge holds it when it's the keyboard anchor */
  rovingId: string | null
  /** the badge hovered or open, drawn lit */
  litId: string | null
  /** an open card owns the centre: the row steps back with the stack */
  hidden?: boolean
  badgeRef?: (id: string) => (el: HTMLElement | null) => void
  onHover?: (id: string | null) => void
  onFocusBadge?: (id: string) => void
  onBlurBadge?: (id: string) => void
  onOpen?: (id: string) => void
  onBadgeKey?: (id: string, e: React.KeyboardEvent) => void
  onMore?: () => void
}) {
  return (
    <div
      className="dial-badges"
      role="group"
      aria-label="today's all-day labels"
      style={hidden ? { opacity: 0, pointerEvents: 'none' } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      {view.shown.map((b) => (
        <div
          key={b.id}
          className={
            'dial-badge' + (litId === b.id ? ' on' : '') + (b.status === 'done' ? ' done' : '')
          }
          role="button"
          tabIndex={rovingId === b.id ? 0 : -1}
          aria-label={badgeAriaLabel(b, todayKey)}
          title={b.title}
          ref={badgeRef?.(b.id)}
          onMouseEnter={() => onHover?.(b.id)}
          onMouseLeave={() => onHover?.(null)}
          onFocus={() => onFocusBadge?.(b.id)}
          onBlur={() => onBlurBadge?.(b.id)}
          onClick={() => onOpen?.(b.id)}
          onKeyDown={(e) => onBadgeKey?.(b.id, e)}
        >
          <span className="t">{b.title.split('—')[0].trim()}</span>
        </div>
      ))}
      {view.more > 0 && (
        <button
          type="button"
          className="dial-badge more"
          aria-expanded={false}
          aria-label={`${view.more} more all-day labels today — show them all`}
          onClick={() => onMore?.()}
        >
          +{view.more} more
        </button>
      )}
    </div>
  )
}

/* the lane step is part of the public design contract; re-export keeps the
   geometry module the single source of truth */
export { LANE_STEP }
