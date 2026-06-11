import { describe, expect, it } from 'vitest'
import { dayShape } from '../dayShape'
import type { Block } from '../types'

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

describe('dayShape — the x-ray behind "optimize my day"', () => {
  it('names an unbroken stretch past the ~90-minute ceiling', () => {
    const blocks = [
      mk({ title: 'Focus', startMin: 16 * 60 + 45, endMin: 18 * 60 + 15 }),
      mk({ title: 'Robin review', startMin: 18 * 60 + 20, endMin: 19 * 60 }),
      mk({ title: 'Aditya review', startMin: 19 * 60, endMin: 19 * 60 + 30 }),
    ]
    const shape = dayShape(blocks, D)
    expect(shape.longestStreak).toMatchObject({ startMin: 16 * 60 + 45, endMin: 19 * 60 + 30 })
    expect(shape.lines.join(' ')).toMatch(/unbroken stretch 16:45–19:30 \(165 min\)/)
  })

  it('a real rest block breaks the streak', () => {
    const blocks = [
      mk({ title: 'Focus', startMin: 16 * 60, endMin: 18 * 60 }),
      mk({ title: 'Micro-break', tag: 'rest', startMin: 18 * 60, endMin: 18 * 60 + 15 }),
      mk({ title: 'Review', startMin: 18 * 60 + 15, endMin: 19 * 60 }),
    ]
    const shape = dayShape(blocks, D)
    expect(shape.longestStreak).toMatchObject({ startMin: 16 * 60, endMin: 18 * 60 })
  })

  it('finds dead air and missing post-meeting buffers', () => {
    const blocks = [
      mk({ title: 'Interview — Mira', startMin: 13 * 60 + 30, endMin: 14 * 60 + 30 }),
      mk({ title: 'Deep work', startMin: 15 * 60 + 30, endMin: 16 * 60 + 30 }),
    ]
    const shape = dayShape(blocks, D)
    expect(shape.gaps).toEqual([{ startMin: 14 * 60 + 30, endMin: 15 * 60 + 30 }])
    expect(shape.missingBuffers.map((b) => b.title)).toEqual(['Interview — Mira'])
  })

  it('a review block right after the meeting counts as its buffer', () => {
    const blocks = [
      mk({ title: 'Interview — Mira', startMin: 13 * 60 + 30, endMin: 14 * 60 + 30 }),
      mk({ title: 'Interview review & notes', startMin: 14 * 60 + 30, endMin: 14 * 60 + 45 }),
    ]
    expect(dayShape(blocks, D).missingBuffers).toHaveLength(0)
  })

  it('a clean day says so', () => {
    const blocks = [mk({ startMin: 9 * 60, endMin: 10 * 60 })]
    expect(dayShape(blocks, D).lines[0]).toMatch(/reads well/)
  })
})
