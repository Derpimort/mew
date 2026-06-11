/* Focus — the bezel dial. A true 12-hour clock face (360° = 12h, 12 at top):
   the OUTER ring is the PM half of today, the INNER ring is the AM half, so
   the whole day reads at a glance. Color carries meaning (pet primary = work,
   secondary = life, dashed = rest); done blocks dim but stay — they're mews.
   Hover reveals marks, labels and telemetry; hover/click opens the detail
   card (fat invisible hit-targets + a grace delay keep it steady). */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMew, useLive, clockNow } from '../../state/store'
import type { Block } from '../../domain/types'
import { dayKey, fmtTime, minOfDay } from '../../domain/time'
import { blocksForDay } from '../../domain/week'
import { interruptionsLastHour } from '../../domain/memory'
import { NXG, clkDeg, rArc, rPolar, ringOf } from './dialGeometry'
import { layoutLanes } from './lanes'
import { declutterLabels } from './labelLayout'
import { BlockCard } from './BlockCard'
import StaggeredText from '../react-bits/staggered-text'


interface Seg {
  block: Block
  sH: number
  eH: number
  r: number // ring radius (AM inner / PM outer)
  isNow: boolean
  done: boolean
}

export function FocusDial() {
  const blocks = useMew((s) => s.blocks)
  const nowMs = useMew((s) => s.nowMs)
  const memory = useMew((s) => s.memory)
  const guardDayKey = useMew((s) => s.guardDayKey)
  const guardUntilMin = useMew((s) => s.guardUntilMin)
  const live = useLive()
  const g = NXG

  /* the dial reads the live app clock, not the store tick: a 1s interval
     re-renders, and clockNow() makes each render actually one second fresher —
     otherwise the countdown repaints the same store-stale value and jumps
     once per tick. nowMs (store) stays for memory/engine-derived bits. */
  const [, forceSecond] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceSecond((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const now = new Date(Math.max(nowMs, clockNow()))
  const todayKey = dayKey(now)
  const nowH = minOfDay(now) / 60

  /* today's blocks, split at the noon boundary onto their rings */
  const segs: Seg[] = useMemo(() => {
    const out: Seg[] = []
    for (const b of blocksForDay(blocks, todayKey)) {
      const sH = b.startMin / 60
      const eH = b.endMin / 60
      const isNow = live.current?.id === b.id
      const done = b.status === 'done'
      const push = (s: number, e: number) => {
        if (e - s < 0.02) return
        out.push({ block: b, sH: s, eH: e, r: ringOf(s, g), isNow, done })
      }
      if (sH < 12 && eH > 12) {
        push(sH, 12)
        push(12, eH)
      } else {
        push(sH, eH)
      }
    }
    return out
  }, [blocks, todayKey, live.current?.id, g])

  /* steady hover: grace delay before clearing, and the card itself holds it.
     While a card is open, switching to a DIFFERENT arc commits only after a
     short dwell — so the pointer can travel across rings to the center card
     without the selection flickering through everything it crosses. */
  const [hover, setHoverRaw] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [scrub, setScrub] = useState<{ x: number; y: number; label: string } | null>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverRef = useRef<string | null>(null)
  hoverRef.current = hover
  const holdHover = () => {
    if (clearTimer.current) clearTimeout(clearTimer.current)
    if (commitTimer.current) clearTimeout(commitTimer.current)
  }
  const pinnedRef = useRef<string | null>(null)
  const setHover = (id: string | null) => {
    if (pinnedRef.current) return // a clicked selection holds — hover is muted
    holdHover()
    if (id === null) {
      /* long grace: enough time to leave the arc and travel back to the card */
      clearTimer.current = setTimeout(() => setHoverRaw(null), 650)
    } else if (hoverRef.current && hoverRef.current !== id) {
      commitTimer.current = setTimeout(() => setHoverRaw(id), 160)
    } else {
      setHoverRaw(id)
    }
  }
  useEffect(() => () => holdHover(), [])

  /* overlapping events on the same ring step inward one lane each, so an
     optional invite sits beside the committed block instead of underneath it */
  const laneOf = useMemo(() => {
    const out = new Map<string, number>()
    for (const ring of [g.ro, g.ri]) {
      const group = segs
        .map((s, idx) => ({ s, idx }))
        .filter(({ s }) => s.r === ring)
      const slots = layoutLanes(group, ({ s }) => s.sH, ({ s }) => s.eH, ({ idx }) => String(idx))
      for (const { idx } of group) {
        const slot = slots.get(String(idx))
        out.set(String(idx), Math.min(slot?.lane ?? 0, 2) * 17)
      }
    }
    return out
  }, [segs, g.ro, g.ri])

  /* label placement: blocks that overlap in time step outward one ring each
     (the arcs' lane logic, pointed the other way), then a callout-declutter
     pass — the standard pie-label algorithm — guarantees no label ever shares
     pixels with another label or the now tag, whatever the day looks like.
     optional invites and sub-half-hour slivers stay quiet (hover tells their story) */
  const labels = useMemo(() => {
    const uniq = segs
      .filter((s, idx, all) => !s.done && all.findIndex((o) => o.block.id === s.block.id) === idx)
      .filter((s) => !s.block.optional && s.block.endMin - s.block.startMin >= 30)
    const lanes = layoutLanes(uniq, (s) => s.sH, (s) => Math.max(s.eH, s.block.endMin / 60), (s) => s.block.id)
    const cand = uniq.map((s) => {
      const title = s.block.title.split('—')[0].trim()
      const short = title.length > 13 ? title.slice(0, 11) + '…' : title
      const timeStr = fmtTime(s.block.startMin)
      const mid = (s.sH + Math.max(s.eH, s.block.endMin / 60)) / 2
      const lane = Math.min(lanes.get(s.block.id)?.lane ?? 0, 2)
      const stag = 40 + lane * 19
      let [lx, ly] = rPolar(g.cx, g.cy, g.ro + stag, clkDeg(mid))
      const anchor: 'start' | 'middle' | 'end' = lx > g.cx + 14 ? 'start' : lx < g.cx - 14 ? 'end' : 'middle'
      /* keep the rendered text box on-canvas whatever the name length */
      const estW = short.length * 7.4 + 8 + timeStr.length * 6.8
      if (anchor === 'start') lx = Math.min(lx, g.w - 10 - estW)
      else if (anchor === 'end') lx = Math.max(lx, 10 + estW)
      else lx = Math.min(Math.max(lx, estW / 2 + 10), g.w - 10 - estW / 2)
      ly = Math.min(Math.max(ly, 14), g.h - 14)
      return { s, short, lx, ly, anchor, estW }
    })
    const nowText = `now · ${fmtTime(Math.round(nowH * 60))}`
    const [nx, ny] = rPolar(g.cx, g.cy, g.ro + 50, clkDeg(nowH))
    const resolved = declutterLabels(
      [
        ...cand.map((c) => ({ id: c.s.block.id, x: c.lx, y: c.ly, w: c.estW, anchor: c.anchor })),
        { id: '__now', x: nx, y: ny, w: nowText.length * 7.2 + 6, anchor: 'middle' as const, fixed: true },
      ],
      { minY: 14, maxY: g.h - 14, gap: 4 },
    )
    return cand.map((c) => ({ ...c, ly: resolved.get(c.s.block.id) ?? c.ly }))
  }, [segs, g, nowH])

  pinnedRef.current = pinned
  const selId = pinned ?? hover // a click owns the card; hover only fills the gaps
  const selSegs = segs.filter((s) => s.block.id === selId)
  const sel = selSegs[0] ?? null

  /* countdown + meta from live truth */
  const secOfDay = minOfDay(now) * 60 + now.getSeconds()
  let count = '—'
  let meta = 'nothing on the clock'
  if (live.current) {
    const left = Math.max(0, live.current.endMin * 60 - secOfDay)
    count = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
    meta = `remaining · ${live.current.protected ? 'held until' : 'until'} ${fmtTime(live.current.endMin)}`
  } else if (live.next) {
    const until = Math.max(0, live.next.startMin * 60 - secOfDay)
    count = `${Math.floor(until / 60)}:${String(until % 60).padStart(2, '0')}`
    meta = `until it starts · ${fmtTime(live.next.startMin)}`
  } else if (live.resting) {
    count = '✓'
    meta = "day's items done"
  }

  /* everything holding this exact minute — the always-on "what is live" strip */
  const nowMin = minOfDay(now)
  const liveItems = blocksForDay(blocks, todayKey).filter(
    (b) => b.status === 'open' && b.startMin <= nowMin && nowMin < b.endMin,
  )

  const switches = interruptionsLastHour(memory, nowMs)
  const guardOn = guardDayKey === todayKey && guardUntilMin != null && minOfDay(now) < guardUntilMin

  /* detail card docked in the dial face — the center is the one spot that can
     never cover an arc or a label, so every block stays hoverable while it's open */
  let card = null
  if (sel) {
    card = (
      <div onMouseEnter={holdHover} onMouseLeave={() => setHover(null)}>
        <BlockCard
          variant="center"
          block={sel.block}
          isNow={sel.isNow}
          pinned={pinned === sel.block.id}
          onClose={() => {
            setPinned(null)
            setHoverRaw(null)
          }}
          style={{ left: g.cx + g.ox, top: g.cy }}
        />
      </div>
    )
  }

  const arcInteractions = (id: string) => ({
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover(null),
    onClick: (ev: React.MouseEvent) => {
      ev.stopPropagation()
      holdHover()
      setPinned(pinned === id ? null : id)
      setHoverRaw(id)
    },
  })

  const nowRing = ringOf(nowH, g)
  const nowDeg = clkDeg(nowH)

  return (
    <div
      className="nx-stage"
      style={{ width: g.w, height: g.h }}
      onClick={() => setPinned(null)}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const dx = x - g.cx
        const dy = y - g.cy
        const r = Math.hypot(dx, dy)
        if (r < g.ri - 48 || r > g.ro + 40) {
          if (scrub) setScrub(null)
          return
        }
        const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90
        const h12 = ((deg + 360) % 360) / 30 // 30° per hour
        const pm = r >= (g.ri + g.ro) / 2
        const min = Math.round(((pm ? 12 : 0) * 60 + h12 * 60) / 5) * 5
        setScrub({ x, y, label: fmtTime(min % (24 * 60)) })
      }}
      onMouseLeave={() => setScrub(null)}
    >
      <svg width={g.w} height={g.h} viewBox={`-${g.ox} 0 ${g.w} ${g.h}`}>
        {/* the two day rings — outer PM, inner AM */}
        <circle cx={g.cx} cy={g.cy} r={g.ro} fill="none" stroke="var(--line)" strokeWidth="1.2" />
        <circle cx={g.cx} cy={g.cy} r={g.ri} fill="none" stroke="var(--line)" strokeWidth="1.2" opacity=".7" />

        {/* the day already lived, as translucent fill: the inner (AM) face
            sweeps from midnight to now; once afternoon starts it stays full
            and the outer (PM) ring fills in behind the arcs */}
        {(() => {
          const amDeg = (Math.min(nowH, 12) / 12) * 360
          const pmDeg = nowH > 12 ? ((nowH - 12) / 12) * 360 : 0
          const rAm = g.ri + 14 // AM face: a pie out to just past the inner track
          const rPmIn = g.ri + 20 // PM: an annulus between the tracks
          const rPmOut = g.ro + 14
          const pie = (r: number, deg: number) => {
            const [x0, y0] = rPolar(g.cx, g.cy, r, 0)
            const [x1, y1] = rPolar(g.cx, g.cy, r, deg)
            return `M ${g.cx} ${g.cy} L ${x0} ${y0} A ${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${x1} ${y1} Z`
          }
          const annulus = (deg: number) => {
            const lg = deg > 180 ? 1 : 0
            const [ox0, oy0] = rPolar(g.cx, g.cy, rPmOut, 0)
            const [ox1, oy1] = rPolar(g.cx, g.cy, rPmOut, deg)
            const [ix1, iy1] = rPolar(g.cx, g.cy, rPmIn, deg)
            const [ix0, iy0] = rPolar(g.cx, g.cy, rPmIn, 0)
            return `M ${ox0} ${oy0} A ${rPmOut} ${rPmOut} 0 ${lg} 1 ${ox1} ${oy1} L ${ix1} ${iy1} A ${rPmIn} ${rPmIn} 0 ${lg} 0 ${ix0} ${iy0} Z`
          }
          return (
            <g>
              {amDeg >= 359.5 ? (
                <circle className="nx-wedge" cx={g.cx} cy={g.cy} r={rAm} fill="var(--ice)" />
              ) : amDeg > 0.5 ? (
                <path className="nx-wedge" d={pie(rAm, amDeg)} fill="var(--ice)" />
              ) : null}
              {pmDeg > 0.5 && <path className="nx-wedge" d={annulus(pmDeg)} fill="var(--ice)" />}
            </g>
          )
        })()}

        {/* clock numerals — 12 / 3 / 6 / 9, revealed on approach */}
        <g className="nx-fade">
          {[12, 3, 6, 9].map((n) => {
            const [x, y] = rPolar(g.cx, g.cy, g.ro + 28, (n / 12) * 360)
            return (
              <text key={n} x={x} y={y} textAnchor="middle" dominantBaseline="central" className="mono" style={{ fill: 'var(--faint)', fontSize: 11.5, fontWeight: 600 }}>
                {n}
              </text>
            )
          })}
          {/* ring legend */}
          <text x={g.cx} y={g.cy - g.ro + 18} textAnchor="middle" className="mono" style={{ fill: 'var(--faint)', fontSize: 9 }}>
            pm
          </text>
          <text x={g.cx} y={g.cy - g.ri + 18} textAnchor="middle" className="mono" style={{ fill: 'var(--faint)', fontSize: 9 }}>
            am
          </text>
        </g>

        {/* the arcs — thick, solid, full day */}
        <g>
          {segs.map((s, idx) => {
            const work = s.block.tag === 'work'
            const big = s.isNow || selId === s.block.id
            const rEff = s.r - (laneOf.get(String(idx)) ?? 0)
            const opt = s.block.optional
            return (
              <g key={s.block.id + ':' + idx}>
                <path
                  className="nx-arc"
                  d={rArc(g.cx, g.cy, rEff, clkDeg(s.sH), clkDeg(s.eH))}
                  fill="none"
                  stroke={work ? 'var(--ice)' : 'var(--teal)'}
                  strokeWidth={s.isNow ? 26 : big ? (opt ? 9 : 22) : opt ? 3.5 : 14}
                  strokeLinecap="round"
                  strokeDasharray={s.block.tag === 'rest' ? '2 7' : 'none'}
                  opacity={s.done ? 0.35 : opt ? 0.8 : 1}
                  style={s.isNow ? { filter: 'drop-shadow(0 0 10px var(--glowc))' } : { pointerEvents: 'none' }}
                />
                {/* fat invisible hit-target so hover is steady */}
                <path
                  d={rArc(g.cx, g.cy, rEff, clkDeg(s.sH), clkDeg(s.eH))}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={opt ? 24 : 38}
                  strokeLinecap="round"
                  style={{ cursor: 'pointer' }}
                  {...arcInteractions(s.block.id)}
                />
              </g>
            )
          })}
        </g>

        {/* labels at their hour — revealed on approach, declutter-placed so
            overlapping events never overlap text (see labels memo above) */}
        <g className="nx-fade">
          {labels.map(({ s, short, lx, ly, anchor }) => (
            <text
              key={s.block.id}
              x={lx}
              y={ly}
              textAnchor={anchor}
              dominantBaseline="central"
              style={{
                fill: s.block.tag === 'work' ? 'var(--ice)' : 'var(--teal)',
                fontFamily: "'Hanken Grotesk',sans-serif",
                fontSize: 14,
                fontWeight: 650,
                cursor: 'pointer',
              }}
              {...arcInteractions(s.block.id)}
            >
              {short}{' '}
              <tspan style={{ fill: 'var(--muted)', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                {fmtTime(s.block.startMin)}
              </tspan>
            </text>
          ))}
        </g>

        {/* now — a carbon-cased hand across both rings: the dark casing cuts
            a visible notch through whatever arc it crosses, the bright core
            reads over empty face, and the dot marks which ring is live */}
        {(() => {
          const [x, y] = rPolar(g.cx, g.cy, nowRing, nowDeg)
          /* a short tick from the now-dot outward — clean, no spoke into the face */
          const [hx0, hy0] = rPolar(g.cx, g.cy, nowRing + 10, nowDeg)
          const [hx1, hy1] = rPolar(g.cx, g.cy, nowRing + 36, nowDeg)
          const [tx, ty] = rPolar(g.cx, g.cy, g.ro + 50, nowDeg)
          return (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={hx0} y1={hy0} x2={hx1} y2={hy1} stroke="var(--bg)" strokeWidth={5.5} strokeLinecap="round" opacity={0.9} />
              <line
                x1={hx0}
                y1={hy0}
                x2={hx1}
                y2={hy1}
                stroke="var(--ice)"
                strokeWidth={2.5}
                strokeLinecap="round"
                style={{ filter: 'drop-shadow(0 0 8px var(--glowc))' }}
              />
              <circle cx={x} cy={y} r="8" fill="var(--ice)" stroke="var(--bg)" strokeWidth={2.5} style={{ filter: 'drop-shadow(0 0 12px var(--glowc))' }} />
              <text x={tx} y={ty} textAnchor="middle" className="mono" style={{ fill: 'var(--ice)', fontSize: 12, fontWeight: 700 }}>
                now · {fmtTime(minOfDay(now))}
              </text>
            </g>
          )
        })()}
      </svg>

      {/* center: countdown → meta → task → telemetry (the card borrows this spot) */}
      <div className="clk-center" style={sel ? { opacity: 0, pointerEvents: 'none' } : undefined}>
        <div className="nx-count" style={{ fontSize: count.length > 6 ? 64 : 92 }}>{count}</div>
        <div className="nx-meta">{meta}</div>
        <div className="nx-task" style={{ fontSize: 27 }}>
          {/* re-keyed per headline so each new task staggers in word by word */}
          <StaggeredText key={live.headline} text={live.headline} as="span" segmentBy="words" delay={55} duration={0.5} />
        </div>
        <div className="nx-fade mono" style={{ marginTop: 12, fontSize: 11.5 }}>
          <span style={{ color: 'var(--gold)', fontWeight: 700 }}>★ {live.mewsToday} mew{live.mewsToday === 1 ? '' : 's'}</span>
          <span style={{ color: 'var(--muted)' }}>
            {' '}· guard {guardOn ? 'on' : 'off'} · {switches} switch{switches === 1 ? '' : 'es'}
          </span>
        </div>
      </div>
      {/* fixed clock chip: wherever the cursor is, the current time has one
          predictable home — brighter while the dial is being explored */}
      <div className="nx-clock mono">now {fmtTime(nowMin)}</div>
      {/* the live strip: what's running this minute (and what's next) — always
          on, brighter on hover; click pins the block's card */}
      <div className="nx-live mono">
        {liveItems.length ? (
          liveItems.map((b) => (
            <span
              key={b.id}
              className={'it' + (b.tag !== 'work' ? ' life' : '')}
              onClick={(e) => {
                e.stopPropagation()
                holdHover()
                setPinned(b.id)
                setHoverRaw(b.id)
              }}
            >
              <span className="dot">●</span> {b.title.split('—')[0].trim()}
              {b.optional ? '?' : ''} <span className="tm">{fmtTime(b.startMin)}–{fmtTime(b.endMin)}</span>
            </span>
          ))
        ) : (
          <span className="idle">nothing live</span>
        )}
        {live.next && (
          <span className="nx-next">→ {live.next.title.split('—')[0].trim()} {fmtTime(live.next.startMin)}</span>
        )}
      </div>
      {scrub && !sel && (
        <span className="dial-scrub" style={{ left: scrub.x + 14, top: scrub.y - 8 }}>
          {scrub.label}
        </span>
      )}
      {card}
    </div>
  )
}
