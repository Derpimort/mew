import { describe, it, expect } from 'vitest'
import { declutterLabels, type LabelIn } from '../labelLayout'

const bounds = { minY: 14, maxY: 746, gap: 4 }
const H = 16

const collide = (a: { y: number }, b: { y: number }) => Math.abs(a.y - b.y) < H

describe('declutterLabels', () => {
  it('leaves non-colliding labels untouched', () => {
    const labels: LabelIn[] = [
      { id: 'a', x: 700, y: 100, w: 120, anchor: 'start' },
      { id: 'b', x: 700, y: 300, w: 120, anchor: 'start' },
    ]
    const out = declutterLabels(labels, bounds)
    expect(out.get('a')).toBe(100)
    expect(out.get('b')).toBe(300)
  })

  it('separates two same-spot labels (overlapping events) and keeps order', () => {
    const labels: LabelIn[] = [
      { id: 'first', x: 700, y: 200, w: 140, anchor: 'start' },
      { id: 'second', x: 706, y: 204, w: 140, anchor: 'start' },
    ]
    const out = declutterLabels(labels, bounds)
    const a = out.get('first')!
    const b = out.get('second')!
    expect(b - a).toBeGreaterThanOrEqual(H + 4)
    expect(a).toBeLessThan(b)
  })

  it('separates a three-deep pileup with full gaps', () => {
    const labels: LabelIn[] = ['a', 'b', 'c'].map((id, i) => ({
      id,
      x: 690 + i * 4,
      y: 250 + i,
      w: 150,
      anchor: 'start' as const,
    }))
    const out = declutterLabels(labels, bounds)
    const ys = ['a', 'b', 'c'].map((id) => out.get(id)!).sort((x, y) => x - y)
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(H + 4)
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(H + 4)
  })

  it('pushes a bottom-edge cluster up instead of past maxY', () => {
    const labels: LabelIn[] = ['a', 'b', 'c'].map((id, i) => ({
      id,
      x: 700,
      y: 744 - i, // all hugging the bottom bound
      w: 120,
      anchor: 'start' as const,
    }))
    const out = declutterLabels(labels, bounds)
    const ys = ['a', 'b', 'c'].map((id) => out.get(id)!)
    for (const y of ys) expect(y + H / 2).toBeLessThanOrEqual(bounds.maxY + 0.001)
    const sorted = [...ys].sort((x, y) => x - y)
    expect(sorted[1] - sorted[0]).toBeGreaterThanOrEqual(H + 4)
    expect(sorted[2] - sorted[1]).toBeGreaterThanOrEqual(H + 4)
  })

  it('flows movable labels around a fixed obstacle (the now tag)', () => {
    const labels: LabelIn[] = [
      { id: 'now', x: 700, y: 220, w: 90, anchor: 'middle', fixed: true },
      { id: 'evt', x: 700, y: 222, w: 130, anchor: 'middle' },
    ]
    const out = declutterLabels(labels, bounds)
    expect(out.get('now')).toBe(220) // never moves
    expect(Math.abs(out.get('evt')! - 220)).toBeGreaterThanOrEqual(H + 4)
  })

  it('ignores vertical closeness when x-ranges cannot collide (left vs right)', () => {
    const labels: LabelIn[] = [
      { id: 'left', x: 110, y: 380, w: 100, anchor: 'end' }, // box [10, 110]
      { id: 'right', x: 714, y: 380, w: 100, anchor: 'start' }, // box [714, 814]
    ]
    const out = declutterLabels(labels, bounds)
    expect(out.get('left')).toBe(380)
    expect(out.get('right')).toBe(380)
  })

  it('is deterministic regardless of input order', () => {
    const mk = (ids: string[]): LabelIn[] =>
      ids.map((id, i) => ({ id, x: 700, y: 300 + (i % 2), w: 140, anchor: 'start' as const }))
    const a = declutterLabels(mk(['x', 'y', 'z']), bounds)
    const b = declutterLabels(mk(['x', 'y', 'z']), bounds)
    expect([...a.entries()]).toEqual([...b.entries()])
    const all = [...a.values()]
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(collide({ y: all[i] }, { y: all[j] })).toBe(false)
  })
})
