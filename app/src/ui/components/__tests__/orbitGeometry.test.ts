import { describe, expect, it } from 'vitest'
import type { Block } from '../../../domain/types'
import { dayFraction, LABEL_GAP, LANE_STEP, OG, isRunning, orbitColor, radiiFor, resolveLabels, visibleOrbit } from '../orbitGeometry'

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

describe('visibleOrbit — the rolling next-12h window', () => {
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

  it('clips the forward horizon so the last arc never wraps into the now pin', () => {
    const late = mk({ id: 'late', startMin: Math.round((9 + 11.5) * 60), endMin: 22 * 60 })
    expect(visibleOrbit([late], D, 9)).toHaveLength(0)
  })
})

describe('radiiFor — focus owns the outer orbit, lanes step inward', () => {
  const a = mk({ id: 'a', startMin: 9 * 60, endMin: 11 * 60 }) // running at 10
  const b = mk({ id: 'b', startMin: 9.5 * 60, endMin: 10.5 * 60 }) // running
  const c = mk({ id: 'c', startMin: 14 * 60, endMin: 15 * 60 }) // later

  it('focus at ro; others inward 14px in priority order (running first)', () => {
    const radii = radiiFor([a, b, c], 'b', 10)
    expect(radii.get('b')).toBe(OG.ro)
    expect(radii.get('a')).toBe(OG.ro - LANE_STEP) // running beats later
    expect(radii.get('c')).toBe(OG.ro - 2 * LANE_STEP)
  })

  it('distinct radii for every item — arc overlap is geometrically impossible', () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      mk({ id: `x${i}`, startMin: (9 + i * 0.25) * 60, endMin: (11 + i * 0.25) * 60 }),
    )
    const radii = radiiFor(six, 'x0', 10)
    expect(new Set(radii.values()).size).toBe(6)
  })

  it('promotion re-orbits: the new focus takes ro, the old one steps inward', () => {
    const before = radiiFor([a, b], 'a', 10)
    const after = radiiFor([a, b], 'b', 10)
    expect(before.get('a')).toBe(OG.ro)
    expect(after.get('b')).toBe(OG.ro)
    expect(after.get('a')).toBe(OG.ro - LANE_STEP)
  })
})

describe('resolveLabels — per-side callouts, never overlapping', () => {
  it('a 6-deep pileup ends with every same-side pair ≥ LABEL_GAP apart', () => {
    /* six blocks ending within minutes of each other → labels pile on one side */
    const six = Array.from({ length: 6 }, (_, i) =>
      mk({ id: `p${i}`, startMin: (9 + i * 0.05) * 60, endMin: (12 + i * 0.08) * 60 }),
    )
    const radii = radiiFor(six, 'p0', 10)
    const labels = resolveLabels(six, radii, 10)
    const all = [...labels.values()]
    for (const side of [true, false]) {
      const ys = all.filter((l) => l.right === side).map((l) => l.y).sort((x, y) => x - y)
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(LABEL_GAP)
    }
  })

  it('a lone label keeps its natural y — de-collision never displaces without cause', () => {
    const lone = mk({ id: 'solo', startMin: 10 * 60, endMin: 13 * 60 }) // ends at deg 90 → y = cy
    const labels = resolveLabels([lone], radiiFor([lone], 'solo', 10), 10)
    expect(labels.get('solo')!.y).toBeCloseTo(OG.cy, 5)
  })

  it('inner-lane dots get leader lines out to the callout ring (the radial standoff)', () => {
    const twins = [
      mk({ id: 't1', startMin: 9 * 60, endMin: 12 * 60 }),
      mk({ id: 't2', startMin: 9.1 * 60, endMin: 12.05 * 60 }),
    ]
    const labels = resolveLabels(twins, radiiFor(twins, 't1', 10), 10)
    /* t2 rides an inner lane: its dot is a full LANE_STEP inside the callout
       ring, and its label is pushed by the gap sweep — both demand a leader */
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

describe('dayFraction — day-progress ring fill', () => {
  it('0 at midnight, ½ at noon, 1 at day end; clamps out-of-range minutes', () => {
    expect(dayFraction(0)).toBe(0)
    expect(dayFraction(12 * 60)).toBeCloseTo(0.5, 5)
    expect(dayFraction(18 * 60)).toBeCloseTo(0.75, 5)
    expect(dayFraction(1440)).toBe(1)
    expect(dayFraction(-30)).toBe(0)
    expect(dayFraction(9999)).toBe(1)
  })
})
