/* sector() — the day wash and the whole-day light (#23, #27). A full turn used
   to be clamped to 359.999°, which rounds onto its own start point at 2
   decimals: an SVG arc whose ends coincide is omitted, so the path drew
   NOTHING — the AM disk wash vanished at noon, a lived day's full wash never
   showed, the whole-ring light lost its fill. These pin that every arc in a
   full turn really travels, and that partial sectors are byte-for-byte what
   they were. */

import { describe, expect, it } from 'vitest'
import { sector } from '../dialGeometry'

/** Walk a path's M/L/A/Z commands; return each arc's start and end point. */
function arcs(d: string): { from: string; to: string }[] {
  const tokens = d.trim().split(/\s+/)
  const out: { from: string; to: string }[] = []
  let cur = ''
  let start = ''
  for (let i = 0; i < tokens.length;) {
    const cmd = tokens[i++]
    if (cmd === 'M' || cmd === 'L') {
      cur = `${tokens[i]} ${tokens[i + 1]}`
      if (cmd === 'M') start = cur
      i += 2
    } else if (cmd === 'A') {
      const to = `${tokens[i + 5]} ${tokens[i + 6]}`
      out.push({ from: cur, to })
      cur = to
      i += 7
    } else if (cmd === 'Z') {
      cur = start
    } else {
      throw new Error(`unexpected path token ${cmd}`)
    }
  }
  return out
}

describe('sector — a full turn is drawn, never omitted', () => {
  it('a full annulus (the AM disk wash at noon): every arc has distinct ends', () => {
    const d = sector(300, 354, 90, 170, 0, 360)
    const segs = arcs(d)
    expect(segs.length).toBe(4) // two half-arcs outside, two inside
    expect(segs.every((s) => s.from !== s.to)).toBe(true)
  })

  it('the old clamp is exactly the bug: 359.999° lands on its own start at 2 decimals', () => {
    const a = (deg: number) => {
      const rad = ((deg - 90) * Math.PI) / 180
      return `${(300 + 170 * Math.cos(rad)).toFixed(2)} ${(354 + 170 * Math.sin(rad)).toFixed(2)}`
    }
    expect(a(359.999)).toBe(a(0))
  })

  it('more than a turn, and a full pie (rIn 0), draw too', () => {
    expect(arcs(sector(300, 354, 90, 258, 0, 720)).every((s) => s.from !== s.to)).toBe(true)
    const pie = arcs(sector(300, 354, 0, 170, 0, 360))
    expect(pie.length).toBe(2)
    expect(pie.every((s) => s.from !== s.to)).toBe(true)
  })

  it('the inner ring runs counter to the outer (nonzero fill cuts the hole)', () => {
    const d = sector(300, 354, 90, 170, 0, 360)
    const sweeps = [...d.matchAll(/A \d+ \d+ 0 1 ([01])/g)].map((m) => m[1])
    expect(sweeps).toEqual(['1', '1', '0', '0'])
  })

  it('partial sectors are unchanged, byte for byte (strings taken from the pre-fix sector)', () => {
    expect(sector(300, 354, 90, 170, 0, 290)).toBe(
      'M 300.00 184.00 A 170 170 0 1 1 140.25 295.86 L 215.43 323.22 A 90 90 0 1 0 300.00 264.00 Z'
    )
    expect(sector(300, 354, 0, 170, 30, 60)).toBe(
      'M 300.00 354.00 L 385.00 206.78 A 170 170 0 0 1 447.22 269.00 Z'
    )
    expect(sector(300, 354, 170, 258, 0, 145)).toBe(
      'M 300.00 96.00 A 258 258 0 0 1 447.98 565.34 L 397.51 493.26 A 170 170 0 0 0 300.00 184.00 Z'
    )
    // a wedge across 12 o'clock (the week preview's mini clock)
    expect(sector(26, 26, 14, 19, 300, 30)).toBe(
      'M 9.55 16.50 A 19 19 0 0 1 35.50 9.55 L 33.00 13.88 A 14 14 0 0 0 13.88 19.00 Z'
    )
  })
})
