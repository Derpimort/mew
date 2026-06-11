/* Focus — the bezel dial. A true 12-hour clock face (360° = 12h, 12 at top):
   the OUTER ring is the PM half of today, the INNER ring is the AM half, so
   the whole day reads at a glance. Color carries meaning (pet primary = work,
   secondary = life, dashed = rest); done blocks dim but stay — they're mews.
   Hover reveals marks, labels and telemetry; hover/click opens the detail
   card (fat invisible hit-targets + a grace delay keep it steady). */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMew, useLive } from '../../state/store'
import type { Block } from '../../domain/types'
import { dayKey, fmtTime, minOfDay } from '../../domain/time'
import { blocksForDay } from '../../domain/week'
import { interruptionsLastHour } from '../../domain/memory'
import { NXG, clkDeg, rArc, rPolar, ringOf } from './dialGeometry'
import { layoutLanes } from './lanes'
import { BlockCard } from './BlockCard'

const CARD_W = 260
const CARD_H = 170

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

  const now = new Date(nowMs)
  const todayKey = dayKey(now)
  const nowH = minOfDay(now) / 60

  /* a 1s clock just for the giant countdown — the dial itself moves on store ticks */
  const [, forceSecond] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceSecond((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

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

  /* steady hover: grace delay before clearing, and the card itself holds it */
  const [hover, setHoverRaw] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [scrub, setScrub] = useState<{ x: number; y: number; label: string } | null>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdHover = () => {
    if (clearTimer.current) clearTimeout(clearTimer.current)
  }
  const setHover = (id: string | null) => {
    holdHover()
    if (id === null) clearTimer.current = setTimeout(() => setHoverRaw(null), 300)
    else setHoverRaw(id)
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

  const selId = hover ?? pinned
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

  const switches = interruptionsLastHour(memory, nowMs)
  const guardOn = guardDayKey === todayKey && guardUntilMin != null && minOfDay(now) < guardUntilMin

  /* detail card, clamped inside the stage */
  let card = null
  if (sel) {
    const mid = (sel.sH + sel.eH) / 2
    const [sx, sy] = rPolar(g.cx, g.cy, sel.r + 30, clkDeg(mid))
    const onRight = sx > g.cx
    let left = onRight ? sx + g.ox + 12 : sx + g.ox - 12 - CARD_W
    let top = sy - CARD_H / 2
    left = Math.min(Math.max(left, 8), g.w - CARD_W - 8)
    top = Math.min(Math.max(top, 8), g.h - CARD_H - 8)
    card = (
      <div onMouseEnter={holdHover} onMouseLeave={() => setHover(null)}>
        <BlockCard
          block={sel.block}
          isNow={sel.isNow}
          onClose={() => {
            setPinned(null)
            setHoverRaw(null)
          }}
          style={{ left, top }}
        />
      </div>
    )
  }

  const arcInteractions = (id: string) => ({
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover(null),
    onClick: (ev: React.MouseEvent) => {
      ev.stopPropagation()
      setPinned(pinned === id ? null : id)
    },
  })

  const nowRing = ringOf(nowH, g)
  const nowDeg = clkDeg(nowH)
  const current = segs.find((s) => s.isNow && nowH >= s.sH && nowH <= s.eH)

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

        {/* faint wedge: now → current block end (on now's ring) */}
        {current && (() => {
          const endDeg = clkDeg(Math.min(current.eH, Math.floor(nowH / 12) * 12 + 12))
          const [x0, y0] = rPolar(g.cx, g.cy, nowRing + 14, nowDeg)
          const [x1, y1] = rPolar(g.cx, g.cy, nowRing + 14, endDeg)
          const sweep = (endDeg - nowDeg + 360) % 360 > 180 ? 1 : 0
          return (
            <path
              className="nx-wedge"
              d={`M ${g.cx} ${g.cy} L ${x0} ${y0} A ${nowRing + 14} ${nowRing + 14} 0 ${sweep} 1 ${x1} ${y1} Z`}
              fill="var(--ice)"
            />
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

        {/* labels at their hour — revealed on approach, clamped inside the canvas */}
        <g className="nx-fade">
          {segs
            .filter((s, idx, all) => !s.done && all.findIndex((o) => o.block.id === s.block.id) === idx)
            .map((s, i) => {
              const title = s.block.title.split('—')[0].trim()
              const short = title.length > 13 ? title.slice(0, 11) + '…' : title
              const timeStr = fmtTime(s.block.startMin)
              const mid = (s.sH + Math.max(s.eH, s.block.endMin / 60)) / 2
              const stag = 40 + (i % 2) * 18
              let [lx, ly] = rPolar(g.cx, g.cy, g.ro + stag, clkDeg(mid))
              const anchor = lx > g.cx + 14 ? 'start' : lx < g.cx - 14 ? 'end' : 'middle'
              /* keep the rendered text box on-canvas whatever the name length */
              const estW = short.length * 7.4 + 8 + timeStr.length * 6.8
              if (anchor === 'start') lx = Math.min(lx, g.w - 10 - estW)
              else if (anchor === 'end') lx = Math.max(lx, 10 + estW)
              else lx = Math.min(Math.max(lx, estW / 2 + 10), g.w - 10 - estW / 2)
              ly = Math.min(Math.max(ly, 14), g.h - 14)
              return (
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
              )
            })}
        </g>

        {/* now — at its clock position, on its ring */}
        {(() => {
          const [x, y] = rPolar(g.cx, g.cy, nowRing, nowDeg)
          const [tx, ty] = rPolar(g.cx, g.cy, g.ro + 50, nowDeg)
          return (
            <g>
              <circle cx={x} cy={y} r="7" fill="var(--ice)" style={{ filter: 'drop-shadow(0 0 12px var(--glowc))' }} />
              <text x={tx} y={ty} textAnchor="middle" className="mono" style={{ fill: 'var(--ice)', fontSize: 12, fontWeight: 700 }}>
                now · {fmtTime(minOfDay(now))}
              </text>
            </g>
          )
        })()}
      </svg>

      {/* center: countdown → meta → task → telemetry */}
      <div className="clk-center">
        <div className="nx-count" style={{ fontSize: count.length > 6 ? 64 : 92 }}>{count}</div>
        <div className="nx-meta">{meta}</div>
        <div className="nx-task" style={{ fontSize: 27 }}>{live.headline}</div>
        <div className="nx-fade mono" style={{ marginTop: 12, fontSize: 11.5 }}>
          <span style={{ color: 'var(--gold)', fontWeight: 700 }}>★ {live.mewsToday} mew{live.mewsToday === 1 ? '' : 's'}</span>
          <span style={{ color: 'var(--muted)' }}>
            {' '}· guard {guardOn ? 'on' : 'off'} · {switches} switch{switches === 1 ? '' : 'es'}
          </span>
        </div>
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
