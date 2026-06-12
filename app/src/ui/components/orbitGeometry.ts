/* Orbit-lanes geometry (DESIGN_LANGUAGE §3, FINAL). A rolling next-12h face:
   now pinned at top, deg = (h − nowH)/12 × 360. The focus item owns the outer
   orbit; everything else steps inward one lane in priority order, so arc
   overlap is geometrically impossible. Labels are instrument callouts outside
   the dial with per-side greedy de-collision. All pure — tested like the
   week model is. */

import type { Block } from '../../domain/types'
import { isBackground } from '../../domain/week'
import { rPolar, spDeg } from './dialGeometry'

export const OG = { cx: 300, cy: 300, ro: 252, w: 760, h: 600, ox: 110 }
export const LANE_STEP = 14
export const LABEL_R = OG.ro + 18
export const LABEL_GAP = 17

/** Visible set: today's open blocks whose window intersects [now, now+12h).
    11.2h forward keeps the last arc clear of the now pin instead of wrapping
    into it. Done blocks leave the orbit — they're mews, not obligations. */
export function visibleOrbit(blocks: Block[], todayKey: string, nowH: number): Block[] {
  return blocks
    .filter(
      (b) =>
        b.dayKey === todayKey &&
        b.status === 'open' &&
        b.endMin / 60 > nowH &&
        b.startMin / 60 < nowH + 11.2,
    )
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
}

export function isRunning(b: Block, nowH: number): boolean {
  return b.startMin / 60 <= nowH && nowH < b.endMin / 60
}

/** Lane radii: focus owns ro; everyone else steps inward LANE_STEP px in
    priority order — running first, then by start. Promotion visibly
    re-orbits the item outward because its radius IS its priority. */
export function radiiFor(vis: Block[], focusId: string | null, nowH: number): Map<string, number> {
  const order = [...vis].sort((a, b) => {
    if (a.id === focusId) return -1
    if (b.id === focusId) return 1
    const runA = isRunning(a, nowH) ? 0 : 1
    const runB = isRunning(b, nowH) ? 0 : 1
    return runA - runB || a.startMin - b.startMin || a.endMin - b.endMin
  })
  const out = new Map<string, number>()
  order.forEach((b, k) => out.set(b.id, OG.ro - k * LANE_STEP))
  return out
}

export interface OrbitLabel {
  id: string
  x: number
  y: number
  right: boolean
  /** the arc's end-dot the label belongs to (leader line anchor) */
  ex: number
  ey: number
  /** true when de-collision displaced the label enough to need a leader */
  moved: boolean
}

/** Callout labels at LABEL_R along each item's END angle, then a per-side
    greedy sweep (top→bottom, LABEL_GAP minimum) — the same de-collision
    discipline the old dial's labelLayout proved, shaped for callouts. */
export function resolveLabels(
  vis: Block[],
  radii: Map<string, number>,
  nowH: number,
): Map<string, OrbitLabel> {
  const raw = vis.map((b) => {
    const deg = spDeg(b.endMin / 60, nowH)
    const [ex, ey] = rPolar(OG.cx, OG.cy, radii.get(b.id) ?? OG.ro, deg)
    const [lx, ly] = rPolar(OG.cx, OG.cy, LABEL_R, deg)
    const right = lx >= OG.cx
    return { id: b.id, x: lx + (right ? 9 : -9), y: ly, right, ex, ey, baseY: ly }
  })
  for (const side of [true, false]) {
    const grp = raw.filter((l) => l.right === side).sort((a, b) => a.y - b.y)
    for (let i = 1; i < grp.length; i++) {
      if (grp[i].y - grp[i - 1].y < LABEL_GAP) grp[i].y = grp[i - 1].y + LABEL_GAP
    }
  }
  const out = new Map<string, OrbitLabel>()
  for (const l of raw) {
    const moved = Math.abs(l.y - l.ey) > 7 || Math.abs(l.x - (l.ex + (l.right ? 9 : -9))) > 12
    out.set(l.id, { id: l.id, x: l.x, y: l.y, right: l.right, ex: l.ex, ey: l.ey, moved })
  }
  return out
}

/** Arc color per §3: deadline-background gold, work ice, everything else teal. */
export function orbitColor(b: Block, isFocus: boolean): string {
  if (isBackground(b) && b.due != null && !isFocus) return 'var(--gold)'
  return b.tag === 'work' ? 'var(--ice)' : 'var(--teal)'
}
