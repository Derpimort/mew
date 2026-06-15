import { describe, expect, it } from 'vitest'
import type { Block } from '../../../domain/types'
import { dayFill, LABEL_GAP, LANE_STEP, OG, isRunning, orbitColor, radiiFor, resolveLabels, visibleOrbit } from '../orbitGeometry'
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

describe('visibleOrbit — today, open, ahead', () => {
  it('keeps what intersects [now, now+12h) today; drops done, past, and far-future', () => {
    const nowH = 9.67
    const live = mk({ id: 'live', startMin: 9 * 60, endMin: 11 * 60 })
    const past = mk({ id: 'past', startMin: 7 * 60, endMin: 9 * 60 })
    const done = mk({ id: 'done', startMin: 10 * 60, endMin: 11 * 60, status: 'done' })
    const evening = mk({ id: 'eve', startMin: 20 * 60, endMin: 21 * 60 })
    const tomorrow = mk({ id: 'tom', dayKey: '2026-06-10' })
    const out = visibleOrbit([live, past, done, evening, tomorrow], D, nowH)
    expect(out.map((b) => b.id)).toEqual(['live', 'eve'])
  })

  it('clips the forward horizon so a block and its 12-h-later twin never share an angle', () => {
    const late = mk({ id: 'late', startMin: Math.round((9 + 11.5) * 60), endMin: 22 * 60 })
    expect(visibleOrbit([late], D, 9)).toHaveLength(0)
  })
})

describe('radiiFor — tasks share the outer ring; only time-overlap steps inward', () => {
  const a = mk({ id: 'a', startMin: 9 * 60, endMin: 11 * 60 })
  const b = mk({ id: 'b', startMin: 9.5 * 60, endMin: 10.5 * 60 }) // overlaps a
  const c = mk({ id: 'c', startMin: 14 * 60, endMin: 15 * 60 }) // disjoint

  it('focus at OG.task; an overlapping sibling steps inward; a disjoint block keeps the ring', () => {
    const radii = radiiFor([a, b, c], 'b', 10)
    expect(radii.get('b')).toBe(OG.task) // focus keeps the outer ring
    expect(radii.get('a')).toBe(OG.task - LANE_STEP) // overlaps the focus → one lane in
    expect(radii.get('c')).toBe(OG.task) // different time → different angle → same ring
  })

  it('disjoint blocks all ride the base ring — compact, hugging the time layers', () => {
    const spread = Array.from({ length: 6 }, (_, i) =>
      mk({ id: `s${i}`, startMin: (9 + i) * 60, endMin: (9 + i) * 60 + 30 }),
    )
    const radii = radiiFor(spread, 's0', 9)
    expect(new Set(radii.values())).toEqual(new Set([OG.task]))
  })

  it('a mutually-overlapping pileup gets distinct radii — no two arcs share a lane at one angle', () => {
    const pile = Array.from({ length: 4 }, (_, i) =>
      mk({ id: `o${i}`, startMin: (9 + i * 0.1) * 60, endMin: (12 + i * 0.1) * 60 }),
    )
    const radii = radiiFor(pile, 'o0', 10)
    expect(new Set(radii.values()).size).toBe(4)
  })

  it('promotion re-orbits within a cluster: the new focus takes OG.task, the old steps inward', () => {
    const before = radiiFor([a, b], 'a', 10)
    const after = radiiFor([a, b], 'b', 10)
    expect(before.get('a')).toBe(OG.task)
    expect(after.get('b')).toBe(OG.task)
    expect(after.get('a')).toBe(OG.task - LANE_STEP)
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
