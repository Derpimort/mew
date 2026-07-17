/* Tray shapes (#283) — the tooltip lines and dot states the shell shows are
   decided here, not in Rust, so this suite IS the tray's spec: the three
   tooltip shapes, the ~40-char title clip, and the presence-not-taxonomy
   dot mapping. Driven through the real liveNow so block-title conventions
   (the em-dash annotation cut) ride the same path production does. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { liveNow } from '../liveNow'
import { trayShape } from '../tray'

const DAY = '2026-07-16'

function blk(over: Partial<Block> = {}): Block {
  return {
    id: 'b1',
    title: 'Deep work',
    tag: 'work',
    dayKey: DAY,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

const shapeAt = (blocks: Block[], nowMin: number) => trayShape(liveNow(blocks, DAY, nowMin))

describe('trayShape — the three tooltip shapes', () => {
  it('a live work block: focus dot, title + minutes left', () => {
    expect(shapeAt([blk()], 9 * 60 + 20)).toEqual({
      state: 'focus',
      tooltip: 'Deep work — 40 min left',
    })
  })

  it('between blocks: idle dot, the next block and its start time', () => {
    const lunch = blk({
      id: 'b2',
      title: 'Lunch, away from screen',
      startMin: 780,
      endMin: 825,
      tag: 'private',
    })
    expect(shapeAt([blk(), lunch], 12 * 60 + 10)).toEqual({
      state: 'idle',
      tooltip: 'next: Lunch, away from screen at 13:00',
    })
  })

  it('nothing scheduled: idle dot, and the free stretch is YOURS (positive voice)', () => {
    expect(shapeAt([], 12 * 60)).toEqual({
      state: 'idle',
      tooltip: 'nothing scheduled — all yours',
    })
  })
})

describe('trayShape — the dot is presence, not taxonomy', () => {
  it('a live rest block wears the rest dot', () => {
    const rest = blk({ title: 'Rest — earned', tag: 'rest', protected: true })
    expect(shapeAt([rest], 9 * 60 + 15)).toEqual({
      state: 'rest',
      tooltip: 'Rest — 45 min left',
    })
  })

  it('a live private block still holds the user — focus dot', () => {
    const walk = blk({ title: 'Walk', tag: 'private' })
    expect(shapeAt([walk], 9 * 60 + 30).state).toBe('focus')
  })

  it('a background-only stretch is idle: it holds the clock, not the user', () => {
    const laundry = blk({ title: 'Laundry cycle', attention: 'background' })
    const s = shapeAt([laundry], 9 * 60 + 30)
    expect(s.state).toBe('idle')
    expect(s.tooltip).toBe('nothing scheduled — all yours')
  })

  it('a completed block no longer drives the dot', () => {
    expect(shapeAt([blk({ status: 'done' })], 9 * 60 + 20).state).toBe('idle')
  })
})

describe('trayShape — titles stay one calm line', () => {
  it('cuts the em-dash annotation, same as the dial and the nudges', () => {
    const deck = blk({ title: 'Q3 deck — deep work' })
    expect(shapeAt([deck], 9 * 60 + 48).tooltip).toBe('Q3 deck — 12 min left')
  })

  it('clips a long title to ~40 chars with an ellipsis', () => {
    const long = blk({
      title: 'Rewrite the entire onboarding flow for the enterprise pilot cohort',
    })
    const { tooltip } = shapeAt([long], 9 * 60 + 30)
    const title = tooltip.replace(/ — 30 min left$/, '')
    expect(tooltip.endsWith(' — 30 min left')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(40)
    expect(title.endsWith('…')).toBe(true)
  })

  it('clips the next-block title too', () => {
    const next = blk({
      title: 'A ridiculously overlong meeting title that would swallow the tray',
      startMin: 840,
      endMin: 900,
    })
    const { tooltip } = shapeAt([next], 12 * 60)
    expect(tooltip.startsWith('next: ')).toBe(true)
    expect(tooltip.endsWith(' at 14:00')).toBe(true)
    expect(tooltip.length).toBeLessThanOrEqual('next: '.length + 40 + ' at 14:00'.length)
  })
})
