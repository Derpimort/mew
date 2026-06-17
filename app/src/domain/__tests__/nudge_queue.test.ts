import { describe, expect, it } from 'vitest'
import { coalesceNudges } from '../nudges/queue'
import type { NudgeInstance } from '../nudges/library'

function mk(over: Partial<NudgeInstance>): NudgeInstance {
  return {
    type: 'next-up',
    label: 'next up',
    body: 'something fits the gap',
    footnote: '',
    actions: [],
    payload: {},
    ...over,
  }
}

describe('coalesceNudges — exact duplicates collapse, distinct ones survive', () => {
  it('keeps a single nudge untouched', () => {
    const one = mk({ key: 'a' })
    expect(coalesceNudges([one])).toEqual([one])
  })

  it('collapses same type + same key to the first instance, preserving order', () => {
    const first = mk({ type: 'drift', key: 'block-1', body: 'first' })
    const dup = mk({ type: 'drift', key: 'block-1', body: 'second (dropped)' })
    const other = mk({ type: 'next-up', key: 'block-2', body: 'kept' })
    const out = coalesceNudges([first, dup, other])
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(first) // first-seen wins
    expect(out[1]).toBe(other)
  })

  it('does NOT collapse same type with different keys (distinct context)', () => {
    const mon = mk({ type: 'right-size', key: '2026-06-09' })
    const tue = mk({ type: 'right-size', key: '2026-06-10' })
    expect(coalesceNudges([mon, tue])).toHaveLength(2)
  })

  it('does NOT collapse different types that share a key', () => {
    const a = mk({ type: 'drift', key: 'block-1' })
    const b = mk({ type: 'next-up', key: 'block-1' })
    expect(coalesceNudges([a, b])).toHaveLength(2)
  })

  it('falls back to payload when no explicit key — identical payloads collapse', () => {
    const a = mk({ type: 'when-where', payload: { dayKey: '2026-06-09', startMin: 600 } })
    const b = mk({ type: 'when-where', payload: { dayKey: '2026-06-09', startMin: 600 } })
    expect(coalesceNudges([a, b])).toHaveLength(1)
  })

  it('falls back to payload when no explicit key — distinct payloads survive', () => {
    const a = mk({ type: 'when-where', payload: { dayKey: '2026-06-09', startMin: 600 } })
    const b = mk({ type: 'when-where', payload: { dayKey: '2026-06-09', startMin: 720 } })
    expect(coalesceNudges([a, b])).toHaveLength(2)
  })

  it('an empty queue stays empty', () => {
    expect(coalesceNudges([])).toEqual([])
  })
})
