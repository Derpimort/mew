import { describe, expect, it } from 'vitest'
import type { Block } from '../../../domain/types'
import { BAND, bandBaseFor, crossDaySpan, DAY_MIN, dayFill, isCommitted, LABEL_GAP, LANE_STEP, OG, isRunning, orbitColor, radiiFor, resolveLabels, visibleOrbit } from '../orbitGeometry'
import { clockDeg } from '../dialGeometry'

const D = '2026-06-09'

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'X',
    tag: 'work',
    dayKey: D,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

describe('clockDeg — the fixed 12-hour face', () => {
  it('12 at the top and never moving; 3/6/9 at right/bottom/left', () => {
    expect(clockDeg(0)).toBe(0) // 12 midnight → top
    expect(clockDeg(12)).toBe(0) // noon → same top (AM/PM share the face)
    expect(clockDeg(3)).toBe(90)
    expect(clockDeg(6)).toBe(180)
    expect(clockDeg(9)).toBe(270)
    expect(clockDeg(15)).toBe(90) // 3 PM lands on 3
    expect(clockDeg(1.5)).toBeCloseTo(45, 5) // 1:30 → 45°
  })
})

describe('visibleOrbit — today, the whole day, open and done', () => {
  it('keeps today open AND done across the whole day; drops other days', () => {
    const morning = mk({ id: 'am', startMin: 8 * 60, endMin: 9 * 60 })
    const doneEarly = mk({ id: 'done', startMin: 7 * 60, endMin: 8 * 60, status: 'done' })
    const evening = mk({ id: 'pm', startMin: 20 * 60, endMin: 21 * 60 })
    const tomorrow = mk({ id: 'tom', dayKey: '2026-06-10' })
    const out = visibleOrbit([morning, doneEarly, evening, tomorrow], D, 9.67)
    expect(out.map((b) => b.id).sort()).toEqual(['am', 'done', 'pm'])
  })

  it('no forward clip — a late-evening block shows even early in the morning', () => {
    const late = mk({ id: 'late', startMin: 20 * 60, endMin: 21 * 60 })
    expect(visibleOrbit([late], D, 8).map((b) => b.id)).toEqual(['late'])
  })
})

describe('isCommitted — held & not background / optional / rest', () => {
  it('a plain held work block is confirmed', () => {
    expect(isCommitted(mk({ tag: 'work' }))).toBe(true)
  })
  it('background, optional, and rest are NOT confirmed (the complement)', () => {
    expect(isCommitted(mk({ attention: 'background' }))).toBe(false)
    expect(isCommitted(mk({ optional: true }))).toBe(false)
    expect(isCommitted(mk({ tag: 'rest' }))).toBe(false)
  })
})

describe('bandBaseFor — four importance bands, centre → out', () => {
  it('AM-confirmed (ri−BAND) < inner ring < AM-bg (ri+BAND) < PM-confirmed (ro−BAND) < outer ring < PM-bg (ro+BAND)', () => {
    const amC = bandBaseFor(mk({ startMin: 9 * 60, tag: 'work' }))
    const amB = bandBaseFor(mk({ startMin: 9 * 60, attention: 'background' }))
    const pmC = bandBaseFor(mk({ startMin: 21 * 60, tag: 'work' }))
    const pmB = bandBaseFor(mk({ startMin: 21 * 60, attention: 'background' }))
    expect([amC, OG.ri, amB, pmC, OG.ro, pmB]).toEqual([OG.ri - BAND, OG.ri, OG.ri + BAND, OG.ro - BAND, OG.ro, OG.ro + BAND])
    // strictly increasing → the four tiers never reorder
    expect(amC).toBeLessThan(OG.ri)
    expect(OG.ri).toBeLessThan(amB)
    expect(amB).toBeLessThan(pmC)
    expect(pmC).toBeLessThan(OG.ro)
    expect(OG.ro).toBeLessThan(pmB)
  })
})

describe('radiiFor — four tiers: confirmed inside the ring, background outside', () => {
  const amC = mk({ id: 'amC', startMin: 9 * 60, endMin: 11 * 60, tag: 'work' }) // AM confirmed
  const amB = mk({ id: 'amB', startMin: 9 * 60, endMin: 11 * 60, attention: 'background' }) // AM bg, same angle
  const pmC = mk({ id: 'pmC', startMin: 21 * 60, endMin: 22 * 60, tag: 'work' }) // PM confirmed
  const pmB = mk({ id: 'pmB', startMin: 21 * 60, endMin: 22 * 60, tag: 'rest' }) // PM rest → bg tier

  it('each block lands on its tier base: AM-confirmed inside ri, AM-bg outside, PM-confirmed inside ro, PM-bg outside', () => {
    const radii = radiiFor([amC, amB, pmC, pmB], null, 10)
    expect(radii.get('amC')).toBe(OG.ri - BAND)
    expect(radii.get('amB')).toBe(OG.ri + BAND)
    expect(radii.get('pmC')).toBe(OG.ro - BAND)
    expect(radii.get('pmB')).toBe(OG.ro + BAND)
  })

  it('the four tiers stay ordered centre → out (confirmed nearer centre than bg in each half; AM inside PM)', () => {
    const radii = radiiFor([amC, amB, pmC, pmB], null, 10)
    expect(radii.get('amC')!).toBeLessThan(radii.get('amB')!)
    expect(radii.get('amB')!).toBeLessThan(radii.get('pmC')!)
    expect(radii.get('pmC')!).toBeLessThan(radii.get('pmB')!)
  })

  it('confirmed steps INWARD, background steps OUTWARD when same-tier blocks time-overlap', () => {
    // two overlapping AM-confirmed → second lane is closer to centre
    const amC2 = mk({ id: 'amC2', startMin: 9.5 * 60, endMin: 10.5 * 60, tag: 'work' })
    // two overlapping PM-bg → second lane is further out
    const pmB2 = mk({ id: 'pmB2', startMin: 21.2 * 60, endMin: 21.8 * 60, tag: 'rest' })
    const radii = radiiFor([amC, amC2, pmB, pmB2], 'amC', 10)
    expect(radii.get('amC')).toBe(OG.ri - BAND) // focus keeps its band base
    expect(radii.get('amC2')).toBe(OG.ri - BAND - LANE_STEP) // inward
    expect(radii.get('pmB2')).toBe(OG.ro + BAND + LANE_STEP) // outward
  })

  it('focus keeps its band base lane; it never relocates to another tier', () => {
    const radii = radiiFor([amC, amB], 'amC', 10)
    expect(radii.get('amC')).toBe(OG.ri - BAND) // still AM-confirmed base, not pulled out to focus
  })

  it('disjoint same-tier blocks all ride the tier base — compact', () => {
    const spread = Array.from({ length: 4 }, (_, i) =>
      mk({ id: `s${i}`, startMin: (8 + i) * 60, endMin: (8 + i) * 60 + 30, tag: 'work' }), // AM confirmed, disjoint
    )
    const radii = radiiFor(spread, 's0', 9)
    expect(new Set(radii.values())).toEqual(new Set([OG.ri - BAND]))
  })

  it('a 9 AM and a 9 PM event share an angle but never a band/radius', () => {
    const radii = radiiFor([amC, pmC], null, 10)
    expect(radii.get('amC')).not.toBe(radii.get('pmC'))
  })

  it('the AM-bg band and PM-confirmed band do not cross at realistic density (≤3 lanes each)', () => {
    // 3 overlapping AM-bg climb outward; 3 overlapping PM-confirmed climb inward —
    // the deepest of each must still respect AM-bg < PM-confirmed (the mid seam).
    const amBg = Array.from({ length: 3 }, (_, i) =>
      mk({ id: `ab${i}`, startMin: (9 + i * 0.1) * 60, endMin: (11 + i * 0.1) * 60, attention: 'background' }),
    )
    const pmCf = Array.from({ length: 3 }, (_, i) =>
      mk({ id: `pc${i}`, startMin: (20 + i * 0.1) * 60, endMin: (22 + i * 0.1) * 60, tag: 'work' }),
    )
    const radii = radiiFor([...amBg, ...pmCf], null, 10)
    const maxAmBg = Math.max(...amBg.map((b) => radii.get(b.id)!))
    const minPmCf = Math.min(...pmCf.map((b) => radii.get(b.id)!))
    expect(maxAmBg).toBeLessThan(OG.mid)
    expect(minPmCf).toBeGreaterThanOrEqual(OG.mid)
    expect(maxAmBg).toBeLessThan(minPmCf)
  })
})

describe('resolveLabels — per-side callouts at the END clock angle, never overlapping', () => {
  it('a 6-deep pileup ends with every same-side pair ≥ LABEL_GAP apart', () => {
    /* six blocks ending within minutes of each other → labels pile on one side */
    const six = Array.from({ length: 6 }, (_, i) =>
      mk({ id: `p${i}`, startMin: (9 + i * 0.05) * 60, endMin: (14 + i * 0.1) * 60 }),
    )
    const radii = radiiFor(six, 'p0', 10)
    const labels = resolveLabels(six, radii)
    const all = [...labels.values()]
    for (const side of [true, false]) {
      const ys = all.filter((l) => l.right === side).map((l) => l.y).sort((x, y) => x - y)
      // the sweep guarantees ≥ LABEL_GAP; (x+GAP)-x carries float noise, so allow ε
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(LABEL_GAP - 1e-6)
    }
  })

  it('a lone label sits at its end angle — de-collision never displaces without cause', () => {
    const lone = mk({ id: 'solo', startMin: 13 * 60, endMin: 15 * 60 }) // ends 3 PM → 90° → y = cy, right
    const labels = resolveLabels([lone], radiiFor([lone], 'solo', 14))
    expect(labels.get('solo')!.y).toBeCloseTo(OG.cy, 5)
    expect(labels.get('solo')!.right).toBe(true)
  })

  it('inner-lane dots get leader lines out to the callout ring (the radial standoff)', () => {
    const twins = [
      mk({ id: 't1', startMin: 9 * 60, endMin: 14 * 60 }),
      mk({ id: 't2', startMin: 9.1 * 60, endMin: 14.05 * 60 }),
    ]
    const labels = resolveLabels(twins, radiiFor(twins, 't1', 10))
    expect(labels.get('t2')!.moved).toBe(true)
  })
})

describe('orbit semantics', () => {
  it('isRunning is window membership, not startedAt', () => {
    expect(isRunning(mk({ startMin: 9 * 60, endMin: 11 * 60 }), 10)).toBe(true)
    expect(isRunning(mk({ startMin: 11 * 60, endMin: 12 * 60 }), 10)).toBe(false)
  })

  it('deadline-background is gold unless focused; tags color the rest', () => {
    const dueBg = mk({ attention: 'background', due: 13 * 60 })
    expect(orbitColor(dueBg, false)).toBe('var(--gold)')
    expect(orbitColor(dueBg, true)).toBe('var(--ice)')
    expect(orbitColor(mk({ tag: 'private' }), false)).toBe('var(--teal)')
  })
})

describe('dayFill — two-stage day progress (inner disk, then outer band)', () => {
  it('midnight: nothing filled', () => {
    expect(dayFill(0)).toEqual({ inner: 0, outer: 0 })
  })
  it('first 12 h fill the inner disk only; outer stays empty', () => {
    expect(dayFill(6 * 60)).toEqual({ inner: 180, outer: 0 }) // 6 AM → inner half-swept
    expect(dayFill(9 * 60)).toEqual({ inner: 270, outer: 0 })
  })
  it('noon: inner full, outer just starting', () => {
    expect(dayFill(12 * 60)).toEqual({ inner: 360, outer: 0 })
  })
  it('second 12 h: inner stays full, outer band sweeps', () => {
    expect(dayFill(18 * 60)).toEqual({ inner: 360, outer: 180 }) // 6 PM
    expect(dayFill(21 * 60)).toEqual({ inner: 360, outer: 270 })
  })
  it('day end: both zones full; out-of-range clamps', () => {
    expect(dayFill(1440)).toEqual({ inner: 360, outer: 360 })
    expect(dayFill(-30)).toEqual({ inner: 0, outer: 0 })
    expect(dayFill(9999)).toEqual({ inner: 360, outer: 360 })
  })
})

describe('crossDaySpan — clip a multi-day block to today, mark the carry', () => {
  it('22:00→06:00 stored UNFOLDED (endMin 1800) clips to [1320,1440] and flags continues', () => {
    const s = crossDaySpan(22 * 60, 30 * 60) // 1320 → 1800
    expect(s.drawStart).toBe(22 * 60)
    expect(s.drawEnd).toBe(DAY_MIN) // arc ends at midnight/top, not 240° around the dial
    expect(s.continuesAfter).toBe(true)
    expect(s.continuesFrom).toBe(false)
    expect(s.endLabelMin).toBe(6 * 60) // the "→ 6:00" cue reads the real end
  })

  it('22:00→06:00 stored FOLDED (endMin 360 ≤ startMin) clips identically — both shapes handled', () => {
    const s = crossDaySpan(22 * 60, 6 * 60) // 1320, 360 (wrapped)
    expect(s.drawStart).toBe(22 * 60)
    expect(s.drawEnd).toBe(DAY_MIN)
    expect(s.continuesAfter).toBe(true)
    expect(s.endLabelMin).toBe(6 * 60)
  })

  it('a block that began yesterday (startMin < 0) draws its today head [0, endMin] with a from-yesterday cue', () => {
    const s = crossDaySpan(-2 * 60, 6 * 60) // started 22:00 yesterday, ends 06:00 today
    expect(s.drawStart).toBe(0)
    expect(s.drawEnd).toBe(6 * 60)
    expect(s.continuesFrom).toBe(true)
    expect(s.continuesAfter).toBe(false)
  })

  it('a same-day block passes through unclipped with no carry (no regression)', () => {
    const s = crossDaySpan(9 * 60, 11 * 60)
    expect(s).toEqual({ drawStart: 9 * 60, drawEnd: 11 * 60, continuesAfter: false, continuesFrom: false, endLabelMin: 11 * 60 })
  })

  it('a block ending exactly at 24:00 is same-day, not a cross-day wrap (boundary)', () => {
    const s = crossDaySpan(22 * 60, DAY_MIN) // ends at midnight, no next-day portion
    expect(s.drawEnd).toBe(DAY_MIN)
    expect(s.continuesAfter).toBe(false)
    expect(s.endLabelMin).toBe(0) // 24:00 folds to 0:00
  })
})
