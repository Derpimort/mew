/* Shared polar/time geometry. The Focus view is the orbit-lanes face
   (orbitGeometry.ts) — a rolling next-12h mapping with now pinned at top;
   the AM/PM clock-face dial this file once centered on is retired. */

export const rPolar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

export const rArc = (cx: number, cy: number, r: number, d0: number, d1: number): string => {
  if (d1 < d0) d1 += 360
  const [x0, y0] = rPolar(cx, cy, r, d0)
  const [x1, y1] = rPolar(cx, cy, r, d1)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/** Rolling face: degrees from "now at top", 12 hours per full turn. */
export const spDeg = (h: number, nowH: number): number => ((h - nowH) / 12) * 360

/** Time-true week columns: hour → y over the full 00:00–24:00 day, so early
    and late blocks (imported calendars cross timezones) sit where they belong. */
export const nxwY = (h: number, H: number): number => (h / 24) * H
