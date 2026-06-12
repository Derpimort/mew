/* Callout-label decluttering — the standard pie/dial label algorithm
   (ECharts avoidLabelOverlap / Highcharts distribute): labels keep their
   angular anchor x and are only displaced vertically; labels whose x-ranges
   can never collide are left alone. Fixed entries (the now · tag) act as
   immovable obstacles the rest flow around. Deterministic, O(n²) over the
   handful of labels a day can hold. */

export interface LabelIn {
  id: string
  x: number
  y: number
  w: number
  h?: number
  anchor: 'start' | 'middle' | 'end'
  fixed?: boolean
}

const DEFAULT_H = 16

interface Item {
  id: string
  y: number
  half: number
  fixed: boolean
  x0: number
  x1: number
}

const xRange = (l: LabelIn): [number, number] => {
  if (l.anchor === 'start') return [l.x, l.x + l.w]
  if (l.anchor === 'end') return [l.x - l.w, l.x]
  return [l.x - l.w / 2, l.x + l.w / 2]
}

/* connected components over horizontal overlap — only labels that share
   x-space are forced apart vertically */
const components = (items: Item[]): Item[][] => {
  const sorted = [...items].sort((a, b) => a.x0 - b.x0)
  const out: Item[][] = []
  let cur: Item[] = []
  let reach = -Infinity
  for (const it of sorted) {
    if (cur.length && it.x0 > reach) {
      out.push(cur)
      cur = []
      reach = -Infinity
    }
    cur.push(it)
    reach = Math.max(reach, it.x1)
  }
  if (cur.length) out.push(cur)
  return out
}

/* 1D distribution: enforce pairwise gaps top→bottom, respect fixed rows,
   pull back inside [minY, maxY]. A few alternating passes converge for any
   non-overconstrained set; clamping wins when space truly runs out. */
const distribute = (col: Item[], minY: number, maxY: number, gap: number) => {
  const items = [...col].sort((a, b) => a.y - b.y || (a.fixed === b.fixed ? 0 : a.fixed ? -1 : 1))
  for (let pass = 0; pass < 4; pass++) {
    let moved = false
    for (let i = 1; i < items.length; i++) {
      const need = items[i - 1].y + items[i - 1].half + gap + items[i].half
      if (!items[i].fixed && items[i].y < need) {
        items[i].y = need
        moved = true
      } else if (items[i].fixed && items[i].y < need) {
        /* an immovable row is in the way — cascade the previous movables up */
        let ceil = items[i].y - items[i].half - gap
        for (let j = i - 1; j >= 0; j--) {
          if (items[j].fixed) break
          const top = ceil - items[j].half
          if (items[j].y > top) {
            items[j].y = top
            moved = true
          }
          ceil = items[j].y - items[j].half - gap
        }
      }
    }
    /* overflow at the bottom: walk back up */
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].fixed) continue
      const floor = i === items.length - 1 ? maxY - items[i].half : items[i + 1].y - items[i + 1].half - gap - items[i].half
      if (items[i].y > floor) {
        items[i].y = floor
        moved = true
      }
      if (items[i].y < minY + items[i].half) {
        items[i].y = minY + items[i].half
      }
    }
    if (!moved) break
  }
}

/** Resolve label positions; returns id → final y (x never changes). */
export function declutterLabels(
  labels: LabelIn[],
  opts: { minY: number; maxY: number; gap?: number },
): Map<string, number> {
  const gap = opts.gap ?? 4
  const items: Item[] = labels.map((l) => {
    const [x0, x1] = xRange(l)
    return { id: l.id, y: l.y, half: (l.h ?? DEFAULT_H) / 2, fixed: l.fixed ?? false, x0, x1 }
  })
  for (const col of components(items)) {
    if (col.length > 1) distribute(col, opts.minY, opts.maxY, gap)
  }
  const out = new Map<string, number>()
  for (const it of items) out.set(it.id, it.y)
  return out
}
