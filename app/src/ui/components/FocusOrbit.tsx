/* Focus — orbit lanes (FINAL, supersedes the bezel dial). A rolling next-12h
   face: now pinned at top, every visible item the same thin labeled arc.
   Hierarchy is brightness, never thickness: the focus item owns the outer
   orbit at 100% + glow, everything else steps inward one lane at 40%
   (85% on hover). One click on any arc/dot/label promotes it; the chip under
   the task lets it run in background. Those clicks write `attention` on the
   block — that's the whole mechanism. */

import { useEffect, useMemo, useState } from 'react'
import { useMew, useLive, clockNow } from '../../state/store'
import { dayKey, fmtDow, fmtTime, minOfDay } from '../../domain/time'
import { isBackground, overlappingFocus } from '../../domain/week'
import { rArc, rPolar, spDeg } from './dialGeometry'
import { DAY_RING_R, dayFraction, LANE_STEP, OG, isRunning, orbitColor, radiiFor, resolveLabels, visibleOrbit } from './orbitGeometry'
import { BlockCard } from './BlockCard'
import { ThreadRail } from './ThreadRail'
import StaggeredText from '../react-bits/staggered-text'

/** Live wall clock — distinct from the center countdown (it's labeled). */
function NxClock({ now }: { now: Date }) {
  return (
    <span className="nx-clock" title="current time">
      <span className="nx-time">
        <span className="hm">{fmtTime(minOfDay(now))}</span>
        <span className="sc">:{String(now.getSeconds()).padStart(2, '0')}</span>
      </span>
      <span className="dt">
        {fmtDow(dayKey(now))} · {now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </span>
    </span>
  )
}

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
  const labels = useMemo(() => resolveLabels(vis, radii, nowH), [vis, radii, nowH])

  const [hover, setHover] = useState<string | null>(null)
  const [cardId, setCardId] = useState<string | null>(null)

  /* promote: the clicked block holds the user now; if something else held
     them, it keeps running — in background, one lane in. Both are attention
     writes; the center swap falls out of liveNow. */
  const promote = (id: string) => {
    if (id === focusId) {
      setCardId((v) => (v === id ? null : id)) // the focus item's click opens its detail card
      return
    }
    const target = blocks.find((b) => b.id === id)
    if (!target) return
    setAttention(id, 'focus')
    /* exactly one focus inside any overlapping cluster — demoting only
       live.current left siblings to win the center by sort order */
    for (const o of overlappingFocus(blocks, target)) setAttention(o.id, 'background')
    setCardId(null)
  }
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
    <div className="nx-stage" style={{ width: OG.w, height: OG.h, position: 'relative' }} onClick={() => setCardId(null)}>
      <NxClock now={now} />
      <svg width={OG.w} height={OG.h} viewBox={`-${OG.ox} 0 ${OG.w} ${OG.h}`}>
        {/* one guide circle — the outer orbit the focus item rides */}
        <circle cx={OG.cx} cy={OG.cy} r={OG.ro} fill="none" stroke="var(--line)" strokeWidth="1.2" />

        {/* day-progress rings: how much of today is done (00:00 → now), behind
            the items — a quiet inner + outer gauge that fills clockwise from top */}
        {(() => {
          const frac = dayFraction(minOfDay(now))
          const sweep = frac * 359.999
          return [DAY_RING_R.inner, DAY_RING_R.outer].map((r) => (
            <g key={`dayring-${r}`} pointerEvents="none">
              <circle cx={OG.cx} cy={OG.cy} r={r} fill="none" stroke="var(--line)" strokeWidth="2" opacity={0.4} />
              {frac > 0 && (
                <path
                  d={rArc(OG.cx, OG.cy, r, 0, sweep)}
                  fill="none"
                  stroke="var(--ice)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  opacity={0.5}
                />
              )}
            </g>
          ))
        })()}

        {vis.map((b) => {
          const isF = b.id === focusId
          const r = radii.get(b.id) ?? OG.ro
          const col = orbitColor(b, isF)
          const isH = hover === b.id
          const op = isF ? 1 : isH ? 0.95 : 0.4
          const d0 = spDeg(Math.max(b.startMin / 60, nowH), nowH)
          /* a background block's runway runs to its DUE tick (the deadline is
             the visual end); everything clamps at now+12h so nothing wraps
             back through the pin */
          const dueBgEnd = isBackground(b) && b.due != null ? b.due / 60 : b.endMin / 60
          const d1 = spDeg(Math.min(dueBgEnd, nowH + 12), nowH)
          const [ex, ey] = rPolar(OG.cx, OG.cy, r, d1)
          const lbl = labels.get(b.id)!
          const dueBg = isBackground(b) && b.due != null
          const handlers = {
            onMouseEnter: () => setHover(b.id),
            onMouseLeave: () => setHover(null),
            onClick: (ev: React.MouseEvent) => {
              ev.stopPropagation()
              promote(b.id)
            },
          }
          const title = b.title.split('—')[0].trim()
          const timeNote = dueBg
            ? `due ${fmtTime(b.due!)}`
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
                strokeWidth={isF ? 5 : isH ? 5 : 3.5}
                strokeLinecap="round"
                strokeDasharray={dueBg ? '1 5' : b.tag === 'rest' ? '2 7' : 'none'}
                opacity={op}
                style={isF ? { filter: 'drop-shadow(0 0 9px var(--glowc))' } : undefined}
                {...handlers}
              />
              {/* due tick: the deadline itself glows at the arc's end */}
              <circle
                cx={ex}
                cy={ey}
                r={isF ? 5 : isH ? 5 : dueBg ? 4.5 : 3.5}
                fill={col}
                opacity={Math.min(op + 0.15, 1)}
                style={isF || dueBg ? { filter: 'drop-shadow(0 0 8px var(--glowc))' } : undefined}
                className="pri-arc"
                {...handlers}
              />
              {lbl.moved && (
                <line
                  x1={ex}
                  y1={ey}
                  x2={lbl.x + (lbl.right ? -4 : 4)}
                  y2={lbl.y}
                  stroke={col}
                  strokeWidth="1"
                  opacity={op * 0.5}
                />
              )}
              <text
                className="pri-lbl"
                x={lbl.x}
                y={lbl.y}
                textAnchor={lbl.right ? 'start' : 'end'}
                dominantBaseline="central"
                opacity={isF ? 1 : isH ? 0.95 : 0.55}
                style={{
                  fill: isF ? 'var(--ink)' : col,
                  fontFamily: "'Hanken Grotesk',sans-serif",
                  fontSize: isH ? 13 : 11.5,
                  fontWeight: isH ? 760 : 650,
                }}
                {...handlers}
              >
                {title.length > 22 ? title.slice(0, 20) + '…' : title}{' '}
                <tspan style={{ fill: 'var(--muted)', fontFamily: "'JetBrains Mono',monospace", fontSize: 9 }}>
                  {timeNote}
                </tspan>
              </text>
            </g>
          )
        })}

        {/* now — the ice dot pins the top of the rolling face; the wall clock
            above is the single time readout (no duplicate label here) */}
        {(() => {
          const [x, y] = rPolar(OG.cx, OG.cy, OG.ro, 0)
          return <circle cx={x} cy={y} r="6.5" fill="var(--ice)" style={{ filter: 'drop-shadow(0 0 12px var(--glowc))' }} />
        })()}
      </svg>

      {/* center: countdown → meta → task → demote chip; or "Nothing holds you." */}
      {current ? (
        <div className="clk-center" style={cardId ? { opacity: 0, pointerEvents: 'none' } : undefined}>
          <div className="nx-count" style={{ fontSize: count.length > 6 ? 62 : 84 }}>{count}</div>
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
            onClick={(e) => {
              e.stopPropagation()
              demote()
            }}
          >
            ↓ let it run in background
          </span>
        </div>
      ) : (
        <div className="clk-center" style={{ width: 310 }}>
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

      <ThreadRail onOpen={(id) => setCardId(id)} />

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 18, textAlign: 'center' }}>
        {(() => {
          const hb = hover ? vis.find((b) => b.id === hover) : null
          if (hb) {
            const t = hb.title.split('—')[0].trim()
            const when =
              isBackground(hb) && hb.due != null
                ? `due ${fmtTime(hb.due)}`
                : `${fmtTime(hb.startMin)}–${fmtTime(hb.endMin)}`
            return (
              <span className="pri-hint" style={{ color: 'var(--muted)' }}>
                {t} · {when}
              </span>
            )
          }
          return <span className="pri-hint">click any item to focus it · click the chip to let it run</span>
        })()}
      </div>
    </div>
  )
}

/* the lane step is part of the public design contract; re-export keeps the
   geometry module the single source of truth */
export { LANE_STEP }
