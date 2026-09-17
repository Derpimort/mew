/* Keyboard-first week × all-day chips (#27): the chips join the grid's ONE
   reading order (a day's chips lead its tiles, in lane row order, each chip on
   the first visible day it covers), ←/→ leave a span from its edge days, a
   nudge or resize on a chip only SPEAKS — it never reaches the drag door — and
   a chip's accessible name reads its days, never a clock span. Pure rules, a
   recording fake for the door; no DOM, no store. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../../../domain/types'
import {
  applyWeekKey,
  blockAriaLabel,
  edgeAnnouncement,
  stepWeekFocus,
  weekFocusOrder,
  weekKeyCommand,
  type WeekKeyDeps,
} from '../weekKeys'

const WEEK = [
  '2026-09-21', // Mon
  '2026-09-22',
  '2026-09-23',
  '2026-09-24',
  '2026-09-25',
  '2026-09-26',
  '2026-09-27', // Sun
]

function tile(id: string, day: number, startMin: number): Block {
  return {
    id,
    title: id,
    tag: 'work',
    dayKey: WEEK[day],
    startMin,
    endMin: startMin + 60,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
  }
}

function chip(id: string, day: number, lastDay?: number, over: Partial<Block> = {}): Block {
  return {
    ...tile(id, day, 0),
    title: id,
    tag: 'private',
    endMin: 0,
    allDay: true,
    external: { calId: 'work@acme', eventId: id },
    ...(lastDay != null ? { endDayKey: WEEK[lastDay] } : {}),
    ...over,
  }
}

/* Mon: OOO (Mon–Wed, row 0) + Trip (row 1) lead a 9:00 tile; Wed holds a 10:00
   tile; Thu a holiday then a 14:00 tile */
const week = [
  tile('mon-9', 0, 540),
  chip('trip', 0),
  chip('ooo', 0, 2),
  tile('wed-10', 2, 600),
  tile('thu-14', 3, 840),
  chip('holiday', 3),
]

describe('weekFocusOrder — chips lead their day, in lane order', () => {
  it('day-major: each day reads its chips (row order), then its tiles', () => {
    expect(weekFocusOrder(week, WEEK)).toEqual([
      'ooo',
      'trip',
      'mon-9',
      'wed-10',
      'holiday',
      'thu-14',
    ])
  })

  it('a span that began last week leads Monday; a chip not drawn is not a stop', () => {
    const lastWeek = chip('conf', 0, 1, { dayKey: '2026-09-19' })
    expect(weekFocusOrder([tile('mon-9', 0, 540), lastWeek], WEEK)).toEqual(['conf', 'mon-9'])
    // the view passes only what it draws: a folded chip simply isn't in the list
    expect(weekFocusOrder([tile('mon-9', 0, 540)], WEEK)).toEqual(['mon-9'])
  })

  it('a week without all-day entries reads exactly as before', () => {
    const timedOnly = week.filter((b) => !b.allDay)
    expect(weekFocusOrder(timedOnly, WEEK)).toEqual(['mon-9', 'wed-10', 'thu-14'])
  })
})

describe('stepWeekFocus — arrows walk chips and tiles as one grid', () => {
  it('↑/↓ walk the flat order through chips and tiles (wrapping)', () => {
    expect(stepWeekFocus(week, WEEK, 'ooo', 'down')).toBe('trip')
    expect(stepWeekFocus(week, WEEK, 'trip', 'down')).toBe('mon-9')
    expect(stepWeekFocus(week, WEEK, 'ooo', 'up')).toBe('thu-14')
  })

  it('→ leaves a span from its LAST day; ← from its first', () => {
    // OOO covers Mon–Wed: → hops to Thursday, where the holiday sits on top
    expect(stepWeekFocus(week, WEEK, 'ooo', 'right')).toBe('holiday')
    // ← from Monday wraps to the last day with anything drawn (Thursday), and a
    // chip at the top of a day lands on the chip at the top of that day
    expect(stepWeekFocus(week, WEEK, 'ooo', 'left')).toBe('holiday')
  })

  it('a chip reads as the top of its day: from a tile, the nearest start wins', () => {
    // from Thursday 14:00 ← to Wednesday: only the 10:00 tile starts there
    expect(stepWeekFocus(week, WEEK, 'thu-14', 'left')).toBe('wed-10')
    // from Wednesday 10:00 → to Thursday: the 14:00 tile (240 min away) beats the
    // holiday at the top (601 away)
    expect(stepWeekFocus(week, WEEK, 'wed-10', 'right')).toBe('thu-14')
    // from the holiday ← to Wednesday: Wednesday's only item is its tile
    expect(stepWeekFocus(week, WEEK, 'holiday', 'left')).toBe('wed-10')
  })

  it('a span covering the whole week never lands on itself', () => {
    const all = [chip('sabbatical', 0, 6), tile('tue-9', 1, 540)]
    expect(stepWeekFocus(all, WEEK, 'sabbatical', 'right')).toBe('tue-9')
    expect(stepWeekFocus([chip('sabbatical', 0, 6)], WEEK, 'sabbatical', 'right')).toBe(
      'sabbatical'
    )
  })
})

describe('a nudge or resize on a chip speaks — the door never opens', () => {
  const recording = () => {
    const calls: string[] = []
    const spoken: string[] = []
    const deps: WeekKeyDeps = {
      dragMove: (id) => {
        calls.push(id)
        return 'moved'
      },
      moveFocus: () => {},
      announce: (line) => spoken.push(line),
    }
    return { calls, spoken, deps }
  }

  it('every nudge and resize on an all-day entry is the all-day edge', () => {
    for (const intent of [
      { kind: 'nudge', deltaMin: 15, deltaDay: 0 },
      { kind: 'nudge', deltaMin: 0, deltaDay: 1 },
      { kind: 'resize', deltaMin: 15 },
      { kind: 'resize', deltaMin: -15 },
    ] as const) {
      expect(weekKeyCommand(chip('holiday', 3), intent, WEEK)).toEqual({
        kind: 'edge',
        edge: 'all-day',
      })
    }
  })

  it('applyWeekKey announces and never calls dragMove — even for a label MEW owns', () => {
    const { calls, spoken, deps } = recording()
    const native = chip('ooo', 0, 2, { external: undefined })
    applyWeekKey([native], WEEK, native, { kind: 'nudge', deltaMin: 0, deltaDay: 1 }, deps)
    applyWeekKey([native], WEEK, native, { kind: 'resize', deltaMin: 15 }, deps)
    expect(calls).toEqual([])
    expect(spoken).toEqual([
      'ooo covers monday to wednesday — it stays',
      'ooo covers monday to wednesday — it stays',
    ])
  })

  it('the spoken line is positive-only: a single day stays, it never "can\'t"', () => {
    const line = edgeAnnouncement(
      chip('Civic Holiday', 3, undefined, { title: 'Civic Holiday' }),
      'all-day'
    )
    expect(line).toBe('Civic Holiday covers the whole day — it stays')
    expect(line).not.toMatch(/can't|cannot|fail|error|blocked/i)
  })
})

describe('blockAriaLabel — a chip names its days, never a clock span', () => {
  it('single day, a span, done, and a label MEW owns', () => {
    expect(blockAriaLabel(chip('Civic Holiday', 3, undefined, { title: 'Civic Holiday' }))).toBe(
      'Civic Holiday, all day, from your calendar'
    )
    expect(blockAriaLabel(chip('OOO', 0, 2, { title: 'OOO' }))).toBe(
      'OOO, all day, monday to wednesday, from your calendar'
    )
    expect(
      blockAriaLabel(
        chip('Birthday', 4, undefined, { title: 'Birthday', status: 'done', external: undefined })
      )
    ).toBe('Birthday, all day, done')
  })

  it('timed tiles keep their exact names', () => {
    expect(blockAriaLabel(tile('Standup', 1, 570))).toBe('Standup, 9:30 to 10:30')
  })
})
