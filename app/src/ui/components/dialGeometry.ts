/* Focus-dial geometry. Product decision (supersedes the handoff's rolling
   next-12h): the dial is a true 12-hour clock face — one full 360° = 12 hours,
   12 at top. Two day rings: OUTER = PM, INNER = AM. */

/* Canvas is sized so the full label ring (ro + stagger + text) fits INSIDE —
   the handoff's 824×620 clipped labels at 12/3/6/9 o'clock with real-world
   meeting names. Symmetric: cx/cy at center, no viewBox offset. */
export const NXG = { cx: 412, cy: 380, ro: 268, ri: 222, w: 824, h: 760, ox: 0 }

/** Clock angle for an hour-of-day (12 pinned at top, like a wall clock). */
export const clkDeg = (h: number): number => ((h % 12) / 12) * 360

/** The ring an hour lives on: AM inner, PM outer. */
export const ringOf = (h: number, g = NXG): number => (h % 24 < 12 ? g.ri : g.ro)

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

export const spDeg = (h: number, nowH: number): number => ((h - nowH) / 12) * 360

/** Time-true week columns: hour → y over the full 00:00–24:00 day, so early
    and late blocks (imported calendars cross timezones) sit where they belong. */
export const nxwY = (h: number, H: number): number => (h / 24) * H
