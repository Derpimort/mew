/* Focus — a FIXED 12-hour clock face. 12 sits at the top and never moves; every
   block rides an arc at its real start→end clock angle; now is a hand that
   sweeps the face. Day progress is a quiet two-stage wash — the inner disk over
   the first 12 h, the inner→outer band over the second — ending at the now
   notch. Hierarchy is brightness, never thickness: the focus item glows on the
   outer task ring, everyone else steps inward one compact lane so same-angle
   arcs never share a radius. One click on any arc/dot/label promotes it; the
   chip under the task lets it run in background. Those clicks write `attention`
   on the block — that's the whole mechanism. */

import { useEffect, useMemo, useState } from 'react'
import { useMew, useLive, clockNow } from '../../state/store'
import { dayKey, fmtDow, fmtTime, minOfDay } from '../../domain/time'
import { isBackground } from '../../domain/week'
import { clockDeg, rArc, rPolar, sector } from './dialGeometry'
import { crossDaySpan, dayFill, LANE_STEP, OG, isRunning, orbitColor, radiiFor, resolveLabels, visibleOrbit } from './orbitGeometry'
import { BlockCard } from './BlockCard'
import { ThreadRail } from './ThreadRail'
import StaggeredText from '../react-bits/staggered-text'

/** Live wall clock, parked top-centre of the stage clear of the face — the exact
    readout the clock-face approximates. Date rides above the time, both centred;
    the time is the hero, the date shares the seconds' gold-mono type. */
function NxClock({ now }: { now: Date }) {
  return (
    <span className="nx-clock" title="current time">
      <span className="dt">
        {fmtDow(dayKey(now))} · {now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </span>
      <span className="nx-time">
        <span className="hm">{fmtTime(minOfDay(now))}</span>
        <span className="sc">:{String(now.getSeconds()).padStart(2, '0')}</span>
      </span>
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
  const live = useLive()

  /* 1s clock: countdown + the rolling mapping both stay fresh between store ticks */
  const [, forceSecond] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceSecond((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const now = new Date(Math.max(nowMs, clockNow()))
  const todayKey = dayKey(now)
  const nowH = minOfDay(now) / 60

  const vis = useMemo(() => visibleOrbit(blocks, todayKey, nowH), [blocks, todayKey, nowH])
  const focusId = live.current?.id ?? null
  const radii = useMemo(() => radiiFor(vis, focusId, nowH), [vis, focusId, nowH])
  /* only open blocks carry a persistent callout — done ones are quiet markers
     (title shows in the hover hint), keeping a full day's face uncluttered */
  const labels = useMemo(() => resolveLabels(vis.filter((b) => b.status === 'open'), radii), [vis, radii])

  const [hover, setHover] = useState<string | null>(null)
  const [cardId, setCardId] = useState<string | null>(null)
  /* declutter: at rest the face shows only arcs + now-hand + the centre. Hovering
     the dial reveals the labels, leader pointers, and the chip — details on
     demand, not always-on. */
  const [dialHover, setDialHover] = useState(false)

  /* a click on any item opens its detail card (centred, with actions —
     Start now / Done / Interrupt / Move). The card is where the week changes. */
  const openCard = (id: string) => setCardId((v) => (v === id ? null : id))
  const demote = () => {
    if (focusId) setAttention(focusId, 'background')
    setCardId(null)
  }

  /* countdown to the FOCUS item's end, ticking seconds */
  const secOfDay = minOfDay(now) * 60 + now.getSeconds()
  const current = live.current
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
      onClick={() => setCardId(null)}
      onMouseEnter={() => setDialHover(true)}
      onMouseLeave={() => setDialHover(false)}
    >
      {/* top-center: the live clock and the loose-threads pill, side by side */}
      <div className="nx-topbar">
        <NxClock now={now} />
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
          const f = dayFill(minOfDay(now))
          return (
            <g pointerEvents="none">
              {f.inner > 0.3 && <path d={sector(OG.cx, OG.cy, OG.disk, OG.ri, 0, f.inner)} fill="var(--ice)" opacity={0.18} />}
              {f.outer > 0.3 && <path d={sector(OG.cx, OG.cy, OG.ri, OG.pm, 0, f.outer)} fill="var(--ice)" opacity={0.12} />}
              <circle cx={OG.cx} cy={OG.cy} r={OG.ri} fill="none" stroke="var(--line2)" strokeWidth="1.6" opacity={0.7} />
              <circle cx={OG.cx} cy={OG.cy} r={OG.pm} fill="none" stroke="var(--line2)" strokeWidth="1.6" opacity={0.7} />
            </g>
          )
        })()}

        {/* fixed bezel: hour ticks at all 12 (12/3/6/9 major), 12 pinned at top */}
        <g pointerEvents="none">
          {Array.from({ length: 12 }, (_, i) => {
            const deg = i * 30
            const major = i % 3 === 0
            const [x0, y0] = rPolar(OG.cx, OG.cy, OG.tick, deg)
            const [x1, y1] = rPolar(OG.cx, OG.cy, OG.tick - (major ? 12 : 6), deg)
            return (
              <line key={`tk-${i}`} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--line2)" strokeWidth={major ? 2 : 1} opacity={major ? 0.85 : 0.45} />
            )
          })}
          {NUMERALS.map(([n, deg]) => {
            const [x, y] = rPolar(OG.cx, OG.cy, OG.num, deg)
            return (
              <text key={`nm-${n}`} className="nx-num" x={x} y={y} textAnchor="middle" dominantBaseline="central">
                {n}
              </text>
            )
          })}
        </g>

        {vis.map((b) => {
          const isF = b.id === focusId
          const isDone = b.status === 'done'
          const r = radii.get(b.id) ?? OG.ro
          const isH = hover === b.id
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
                : isRunning(b, nowH)
                  ? `→ ${fmtTime(b.endMin)}`
                  : `@ ${fmtTime(b.startMin)}`
          return (
            <g key={b.id}>
              <path
                className="pri-arc"
                d={rArc(OG.cx, OG.cy, r, d0, d1)}
                fill="none"
                stroke={col}
                strokeWidth={isDone ? 2.5 : isF ? 5 : isH ? 5 : 3.5}
                strokeLinecap="round"
                strokeDasharray={isDone ? 'none' : dueBg ? '1 5' : b.tag === 'rest' ? '2 7' : 'none'}
                opacity={op}
                style={isF && !isDone ? { filter: 'drop-shadow(0 0 9px var(--glowc))' } : undefined}
                {...handlers}
              />
              {/* fat invisible hit-target — the visible arc is thin; this makes
                  hover + click forgiving so an item is easy to grab */}
              <path
                d={rArc(OG.cx, OG.cy, r, d0, d1)}
                fill="none"
                stroke="transparent"
                strokeWidth={18}
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
                style={isF && !isDone ? { filter: 'drop-shadow(0 0 8px var(--glowc))' } : dueBg ? { filter: 'drop-shadow(0 0 8px var(--glowc))' } : undefined}
                className="pri-arc"
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
                  const edgeDeg = clockDeg((span.continuesAfter ? span.drawEnd : span.drawStart) / 60)
                  const fwd = span.continuesAfter // forward = clockwise into tomorrow
                  const [cxp, cyp] = rPolar(OG.cx, OG.cy, r, edgeDeg + (fwd ? 5 : -5))
                  const [txp, typ] = rPolar(OG.cx, OG.cy, r + 13, edgeDeg + (fwd ? 7 : -7))
                  return (
                    <g pointerEvents="none">
                      <text
                        x={cxp}
                        y={cyp}
                        textAnchor="middle"
                        dominantBaseline="central"
                        style={{ fill: col, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700 }}
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
                        style={{ fill: 'var(--muted)', fontFamily: "'JetBrains Mono',monospace", fontSize: 9 }}
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
                  }}
                  {...handlers}
                >
                  {/* truncated at rest (a tidy preview); the full title shows on
                      hover/focus so a long meeting name is always readable */}
                  {isH || isF || title.length <= 20 ? title : title.slice(0, 18) + '…'}{' '}
                  <tspan style={{ fill: 'var(--muted)', fontFamily: "'JetBrains Mono',monospace", fontSize: 9 }}>
                    {timeNote}
                  </tspan>
                </text>
              )}
            </g>
          )
        })}

        {/* now — a hand that sweeps the fixed face to the current clock angle,
            crossing all four bands from the clear disk out to the rim notch where
            the day wash ends */}
        {(() => {
          const deg = clockDeg(minOfDay(now) / 60)
          const [hx, hy] = rPolar(OG.cx, OG.cy, OG.tick, deg)
          const [tx, ty] = rPolar(OG.cx, OG.cy, OG.disk - 6, deg)
          return (
            <g pointerEvents="none">
              <line x1={tx} y1={ty} x2={hx} y2={hy} stroke="var(--ice)" strokeWidth="2" opacity={0.85} style={{ filter: 'drop-shadow(0 0 6px var(--glowc))' }} />
              <circle cx={hx} cy={hy} r="5.5" fill="var(--ice)" style={{ filter: 'drop-shadow(0 0 12px var(--glowc))' }} />
            </g>
          )
        })()}
      </svg>

      {/* center: countdown → meta → task → demote chip; or "Nothing holds you." */}
      {current ? (
        <div className="clk-center" style={cardId ? { opacity: 0, pointerEvents: 'none' } : undefined}>
          <div className="nx-count" style={{ fontSize: count.length > 5 ? 48 : 64 }}>{count}</div>
          <div className="nx-meta">{meta}</div>
          <div
            className="nx-task"
            style={{ fontSize: 25, cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation()
              setCardId((v) => (v === current!.id ? null : current!.id))
            }}
          >
            <StaggeredText key={live.headline} text={live.headline} as="span" segmentBy="words" delay={55} duration={0.5} />
          </div>
          <span
            className="pri-demote"
            style={{ opacity: dialHover ? 1 : 0, pointerEvents: dialHover ? 'auto' : 'none' }}
            onClick={(e) => {
              e.stopPropagation()
              demote()
            }}
          >
            ↓ let it run in background
          </span>
        </div>
      ) : (
        <div className="clk-center" style={{ width: 280 }}>
          <div className="nx-task" style={{ fontSize: 24, color: 'var(--muted)' }}>
            <StaggeredText key={live.headline} text={live.headline} as="span" segmentBy="words" delay={55} duration={0.5} />
          </div>
          <div className="nx-meta" style={{ marginTop: 10 }}>{meta}</div>
        </div>
      )}

      {(() => {
        const cardBlock = cardId ? blocks.find((b) => b.id === cardId) : null
        if (!cardBlock) return null
        return (
          <BlockCard
            variant="center"
            block={cardBlock}
            isNow={cardBlock.id === focusId}
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
        className="pri-readout dial-reveal"
        style={{
          left: OG.cx + OG.ox,
          top: OG.h - 42,
          opacity: dialHover ? 1 : 0,
          pointerEvents: 'none',
        }}
      >
        {(() => {
          const hb = hover ? vis.find((b) => b.id === hover) : null
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
                      {fmtTime(hb.startMin)}<span className="dash">–</span>{fmtTime(hSpan.endLabelMin)}
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
      </div>
    </div>
  )
}

/* the lane step is part of the public design contract; re-export keeps the
   geometry module the single source of truth */
export { LANE_STEP }
