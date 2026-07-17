/* Keyboard-first week (#303) — the pure rules, pinned the way dialNav pins the
   dial: the key grammar (what a press means), the command geometry (where it
   lands, or which edge stopped it), the focus walk (one roving order over the
   grid), the spoken copy (labels + live-region lines), and the dispatcher's
   executor contract — keyboard commits go through the injected dragMove door
   and nowhere else (a recording fake, no DOM, no store). */

import { describe, expect, it } from 'vitest'
import type { Block } from '../../../domain/types'
import { rovingFocusId } from '../orbitGeometry'
import {
  applyWeekKey,
  blockAriaLabel,
  commitAnnouncement,
  edgeAnnouncement,
  MIN_BLOCK_MIN,
  stepWeekFocus,
  weekFocusOrder,
  weekKeyCommand,
  weekKeyIntent,
  type MutIntent,
  type WeekKeyDeps,
} from '../weekKeys'

const WEEK = [
  '2026-06-08',
  '2026-06-09',
  '2026-06-10',
  '2026-06-11',
  '2026-06-12',
  '2026-06-13',
  '2026-06-14',
]
const TUE = WEEK[1]

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'X',
    tag: 'work',
    dayKey: TUE,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/* ── the grammar: key + modifiers → intent ── */

describe('weekKeyIntent — keys map to week intents (the dial grammar on a grid)', () => {
  it('plain arrows move focus along the two grid axes', () => {
    expect(weekKeyIntent('ArrowUp', {})).toEqual({ kind: 'focus-move', dir: 'up' })
    expect(weekKeyIntent('ArrowDown', {})).toEqual({ kind: 'focus-move', dir: 'down' })
    expect(weekKeyIntent('ArrowLeft', {})).toEqual({ kind: 'focus-move', dir: 'left' })
    expect(weekKeyIntent('ArrowRight', {})).toEqual({ kind: 'focus-move', dir: 'right' })
  })

  it('Shift+↑/↓ nudge ±15 minutes; Shift+←/→ hop a day', () => {
    expect(weekKeyIntent('ArrowUp', { shift: true })).toEqual({
      kind: 'nudge',
      deltaMin: -15,
      deltaDay: 0,
    })
    expect(weekKeyIntent('ArrowDown', { shift: true })).toEqual({
      kind: 'nudge',
      deltaMin: 15,
      deltaDay: 0,
    })
    expect(weekKeyIntent('ArrowLeft', { shift: true })).toEqual({
      kind: 'nudge',
      deltaMin: 0,
      deltaDay: -1,
    })
    expect(weekKeyIntent('ArrowRight', { shift: true })).toEqual({
      kind: 'nudge',
      deltaMin: 0,
      deltaDay: 1,
    })
  })

  it('Alt+↑/↓ resize the end ±15 minutes', () => {
    expect(weekKeyIntent('ArrowUp', { alt: true })).toEqual({ kind: 'resize', deltaMin: -15 })
    expect(weekKeyIntent('ArrowDown', { alt: true })).toEqual({ kind: 'resize', deltaMin: 15 })
  })

  it('Alt+←/→ are the browser history keys — never claimed', () => {
    expect(weekKeyIntent('ArrowLeft', { alt: true })).toBeNull()
    expect(weekKeyIntent('ArrowRight', { alt: true })).toBeNull()
  })

  it('a Shift+Alt chord is ambiguous — unclaimed, on every arrow', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      expect(weekKeyIntent(key, { shift: true, alt: true })).toBeNull()
    }
  })

  it('Tab, Enter, Space, characters keep bubbling (no keyboard trap, §2.1.2)', () => {
    for (const key of ['Tab', 'Enter', ' ', 'Escape', 'a', 'Home', 'PageDown']) {
      expect(weekKeyIntent(key, {})).toBeNull()
      expect(weekKeyIntent(key, { shift: true })).toBeNull()
      expect(weekKeyIntent(key, { alt: true })).toBeNull()
    }
  })
})

/* ── the geometry: where a nudge/resize lands, or the edge that stopped it ── */

const nudge = (deltaMin: number, deltaDay = 0): MutIntent => ({
  kind: 'nudge',
  deltaMin,
  deltaDay,
})
const resize = (deltaMin: number): MutIntent => ({ kind: 'resize', deltaMin })

describe('weekKeyCommand — nudges land on the drag grid, edges are named', () => {
  it('±15 minutes inside the day, day and length untouched', () => {
    const b = mk({ startMin: 9 * 60, endMin: 10 * 60 })
    expect(weekKeyCommand(b, nudge(15), WEEK)).toEqual({
      kind: 'move',
      toDayKey: TUE,
      toStartMin: 9 * 60 + 15,
    })
    expect(weekKeyCommand(b, nudge(-15), WEEK)).toEqual({
      kind: 'move',
      toDayKey: TUE,
      toStartMin: 8 * 60 + 45,
    })
  })

  it('an off-grid block snaps onto the 5-min grid, exactly as a drag drop would', () => {
    const b = mk({ startMin: 9 * 60 + 7, endMin: 10 * 60 + 7 })
    expect(weekKeyCommand(b, nudge(15), WEEK)).toEqual({
      kind: 'move',
      toDayKey: TUE,
      toStartMin: 9 * 60 + 20, // 9:07+15 → 9:22, snapped to 9:20
    })
  })

  it('a nudge against 0:00 clamps, then names the day-start edge', () => {
    const near = mk({ startMin: 5, endMin: 65 })
    expect(weekKeyCommand(near, nudge(-15), WEEK)).toEqual({
      kind: 'move',
      toDayKey: TUE,
      toStartMin: 0,
    })
    const at = mk({ startMin: 0, endMin: 60 })
    expect(weekKeyCommand(at, nudge(-15), WEEK)).toEqual({ kind: 'edge', edge: 'day-start' })
  })

  it('a nudge against midnight reserves the block length, then names the day-end edge', () => {
    const near = mk({ startMin: 23 * 60 + 5, endMin: 23 * 60 + 35 }) // last start = 23:30
    expect(weekKeyCommand(near, nudge(15), WEEK)).toEqual({
      kind: 'move',
      toDayKey: TUE,
      toStartMin: 23 * 60 + 20,
    })
    const at = mk({ startMin: 23 * 60 + 30, endMin: 24 * 60 })
    expect(weekKeyCommand(at, nudge(15), WEEK)).toEqual({ kind: 'edge', edge: 'day-end' })
  })

  it('day hops keep the start time and stay inside the visible week', () => {
    const b = mk({ dayKey: TUE, startMin: 14 * 60, endMin: 15 * 60 })
    expect(weekKeyCommand(b, nudge(0, 1), WEEK)).toEqual({
      kind: 'move',
      toDayKey: WEEK[2],
      toStartMin: 14 * 60,
    })
    expect(weekKeyCommand(b, nudge(0, -1), WEEK)).toEqual({
      kind: 'move',
      toDayKey: WEEK[0],
      toStartMin: 14 * 60,
    })
    expect(weekKeyCommand(mk({ dayKey: WEEK[0] }), nudge(0, -1), WEEK)).toEqual({
      kind: 'edge',
      edge: 'week-start',
    })
    expect(weekKeyCommand(mk({ dayKey: WEEK[6] }), nudge(0, 1), WEEK)).toEqual({
      kind: 'edge',
      edge: 'week-end',
    })
  })

  it('a block outside the rendered week still hops by calendar day (defensive total)', () => {
    const b = mk({ dayKey: '2026-07-01' })
    expect(weekKeyCommand(b, nudge(0, 1), WEEK)).toEqual({
      kind: 'move',
      toDayKey: '2026-07-02',
      toStartMin: b.startMin,
    })
  })

  it('resize grows and shrinks the end in 15-min steps', () => {
    const b = mk({ startMin: 9 * 60, endMin: 10 * 60 })
    expect(weekKeyCommand(b, resize(15), WEEK)).toEqual({ kind: 'resize', toDurationMin: 75 })
    expect(weekKeyCommand(b, resize(-15), WEEK)).toEqual({ kind: 'resize', toDurationMin: 45 })
  })

  it('shrinking stops at the 15-minute floor and names it', () => {
    const near = mk({ startMin: 9 * 60, endMin: 9 * 60 + 20 })
    expect(weekKeyCommand(near, resize(-15), WEEK)).toEqual({
      kind: 'resize',
      toDurationMin: MIN_BLOCK_MIN,
    })
    const at = mk({ startMin: 9 * 60, endMin: 9 * 60 + 15 })
    expect(weekKeyCommand(at, resize(-15), WEEK)).toEqual({ kind: 'edge', edge: 'min-length' })
    // a sub-floor block never "shrinks" upward to the floor — the edge speaks instead
    const tiny = mk({ startMin: 9 * 60, endMin: 9 * 60 + 10 })
    expect(weekKeyCommand(tiny, resize(-15), WEEK)).toEqual({ kind: 'edge', edge: 'min-length' })
  })

  it('growing stops at midnight (partial step first), and names max-length', () => {
    const near = mk({ startMin: 23 * 60, endMin: 23 * 60 + 50 })
    expect(weekKeyCommand(near, resize(15), WEEK)).toEqual({ kind: 'resize', toDurationMin: 60 })
    const at = mk({ startMin: 23 * 60, endMin: 24 * 60 })
    expect(weekKeyCommand(at, resize(15), WEEK)).toEqual({ kind: 'edge', edge: 'max-length' })
  })
})

/* ── the focus walk: one order, two axes, no dead ends ── */

describe('weekFocusOrder / stepWeekFocus — arrows traverse the grid in visual order', () => {
  const mon9 = mk({ id: 'mon9', dayKey: WEEK[0], startMin: 9 * 60, endMin: 10 * 60 })
  const tue9 = mk({ id: 'tue9', dayKey: TUE, startMin: 9 * 60, endMin: 10 * 60 })
  const tue14 = mk({ id: 'tue14', dayKey: TUE, startMin: 14 * 60, endMin: 15 * 60 })
  const thu13 = mk({ id: 'thu13', dayKey: WEEK[3], startMin: 13 * 60, endMin: 14 * 60 })
  const grid = [thu13, tue14, mon9, tue9] // deliberately shuffled

  it('orders day-major (columns left→right) then time-minor (top→bottom)', () => {
    expect(weekFocusOrder(grid, WEEK)).toEqual(['mon9', 'tue9', 'tue14', 'thu13'])
  })

  it('rolled blocks are not rendered, so they are not focusable', () => {
    const rolled = mk({ id: 'gone', dayKey: TUE, status: 'rolled' })
    expect(weekFocusOrder([...grid, rolled], WEEK)).not.toContain('gone')
  })

  it('↓/↑ walk the flat order and wrap, so a keyboard user never dead-ends', () => {
    expect(stepWeekFocus(grid, WEEK, 'mon9', 'down')).toBe('tue9')
    expect(stepWeekFocus(grid, WEEK, 'tue14', 'down')).toBe('thu13')
    expect(stepWeekFocus(grid, WEEK, 'thu13', 'down')).toBe('mon9') // wrap
    expect(stepWeekFocus(grid, WEEK, 'mon9', 'up')).toBe('thu13') // wrap back
  })

  it('←/→ hop to the adjacent day with blocks, landing nearest by start time', () => {
    expect(stepWeekFocus(grid, WEEK, 'mon9', 'right')).toBe('tue9') // 9:00 ≈ 9:00, not 14:00
    expect(stepWeekFocus(grid, WEEK, 'tue14', 'right')).toBe('thu13') // Wed empty — skipped
    expect(stepWeekFocus(grid, WEEK, 'thu13', 'left')).toBe('tue14') // 13:00 nearer 14:00
    expect(stepWeekFocus(grid, WEEK, 'mon9', 'left')).toBe('thu13') // wraps the week
  })

  it('no anchor yet → the first arrow lands on the grid (first or last by direction)', () => {
    expect(stepWeekFocus(grid, WEEK, null, 'down')).toBe('mon9')
    expect(stepWeekFocus(grid, WEEK, null, 'up')).toBe('thu13')
  })

  it('a single-day grid keeps ←/→ useful by staying put, never throwing', () => {
    expect(stepWeekFocus([tue9], WEEK, 'tue9', 'right')).toBe('tue9')
    expect(stepWeekFocus([], WEEK, null, 'down')).toBeNull()
  })

  it('rovingFocusId (shared with the dial) prefers keyboard anchor, then the live block', () => {
    const order = weekFocusOrder(grid, WEEK)
    expect(rovingFocusId(order, 'tue14', 'tue9')).toBe('tue14')
    expect(rovingFocusId(order, null, 'tue9')).toBe('tue9')
    expect(rovingFocusId(order, null, null)).toBe('mon9')
  })
})

/* ── the spoken side: labels + live-region copy, positive-only ── */

describe('blockAriaLabel — a tile names its title, times, and nature', () => {
  it('reads "title, start to end"', () => {
    expect(blockAriaLabel(mk({ title: 'Deck', startMin: 9 * 60, endMin: 11 * 60 }))).toBe(
      'Deck, 9:00 to 11:00'
    )
  })
  it('a done block says so', () => {
    expect(blockAriaLabel(mk({ title: 'Deck', status: 'done' }))).toBe('Deck, 9:00 to 10:00, done')
  })
  it('a calendar block announces its origin BEFORE any attempt to move it', () => {
    expect(blockAriaLabel(mk({ title: 'Sync', external: { calId: 'c', eventId: 'e' } }))).toBe(
      'Sync, 9:00 to 10:00, from your calendar'
    )
  })
  it('a held block says held', () => {
    expect(blockAriaLabel(mk({ title: 'Walk', protected: true }))).toBe('Walk, 9:00 to 10:00, held')
  })
})

describe('announcement copy — every attempt speaks, nothing "fails"', () => {
  const deck = mk({ title: 'Q3 deck — deep work', startMin: 9 * 60, endMin: 11 * 60 })

  it('a same-day move reads the issue grammar: "Deck, 9:00 to 11:00, moved to 9:15"', () => {
    const cmd = { kind: 'move', toDayKey: TUE, toStartMin: 9 * 60 + 15 } as const
    expect(commitAnnouncement(deck, cmd, 'moved')).toBe('Q3 deck, 9:00 to 11:00, moved to 9:15')
  })

  it('a day hop names the day it landed on', () => {
    const cmd = { kind: 'move', toDayKey: WEEK[2], toStartMin: 9 * 60 } as const
    expect(commitAnnouncement(deck, cmd, 'moved')).toBe(
      'Q3 deck, 9:00 to 11:00, moved to wednesday at 9:00'
    )
  })

  it('a resize reads the new span', () => {
    const cmd = { kind: 'resize', toDurationMin: 135 } as const
    expect(commitAnnouncement(deck, cmd, 'resized')).toBe('Q3 deck, now 9:00 to 11:15')
  })

  it('a calendar block explains kindly — the issue copy', () => {
    const cmd = { kind: 'move', toDayKey: TUE, toStartMin: 9 * 60 + 15 } as const
    expect(commitAnnouncement(deck, cmd, 'external')).toBe(
      "Q3 deck, this one's from your calendar — it stays"
    )
  })

  it('a conflict says the block stays and why, without blame words', () => {
    const move = { kind: 'move', toDayKey: TUE, toStartMin: 10 * 60 } as const
    expect(commitAnnouncement(deck, move, 'conflict')).toBe(
      'Q3 deck stays at 9:00 — that slot is taken'
    )
    const grow = { kind: 'resize', toDurationMin: 135 } as const
    expect(commitAnnouncement(deck, grow, 'conflict')).toBe(
      'Q3 deck stays 9:00 to 11:00 — the room past 11:00 is taken'
    )
  })

  it('edges are spoken, never silent', () => {
    expect(edgeAnnouncement(deck, 'day-start')).toBe('Q3 deck is already at the start of the day')
    expect(edgeAnnouncement(deck, 'day-end')).toBe('Q3 deck is already at the end of the day')
    expect(edgeAnnouncement(deck, 'week-start')).toBe(
      "that's the start of this week — Q3 deck stays on tuesday"
    )
    expect(edgeAnnouncement(deck, 'week-end')).toBe(
      "that's the edge of this week — Q3 deck stays on tuesday"
    )
    expect(edgeAnnouncement(deck, 'min-length')).toBe(
      'Q3 deck is already at its smallest — 15 minutes'
    )
    expect(edgeAnnouncement(deck, 'max-length')).toBe('Q3 deck already runs to the end of the day')
  })

  it('never uses failure words (positive-only product law)', () => {
    const lines = [
      commitAnnouncement(deck, { kind: 'move', toDayKey: TUE, toStartMin: 600 }, 'conflict'),
      commitAnnouncement(deck, { kind: 'move', toDayKey: TUE, toStartMin: 600 }, 'external'),
      ...(
        ['day-start', 'day-end', 'week-start', 'week-end', 'min-length', 'max-length'] as const
      ).map((e) => edgeAnnouncement(deck, e)),
    ]
    for (const line of lines) expect(line).not.toMatch(/fail|missed|can.?t|error|invalid/i)
  })
})

/* ── the dispatcher: keyboard commits go through the ONE injected door ── */

describe('applyWeekKey — the executor-path pin (a recording fake, no second door)', () => {
  function fakeDeps(outcome: ReturnType<WeekKeyDeps['dragMove']> = 'moved') {
    const calls: unknown[][] = []
    const focused: (string | null)[] = []
    const spoken: string[] = []
    const deps: WeekKeyDeps = {
      dragMove: (...a) => {
        calls.push(a)
        return outcome
      },
      moveFocus: (id) => focused.push(id),
      announce: (line) => spoken.push(line),
    }
    return { calls, focused, spoken, deps }
  }

  const b = mk({ id: 'blk', title: 'Deck', startMin: 9 * 60, endMin: 10 * 60 })

  it('a nudge calls dragMove with (id, day, newStart) — nothing else mutates', () => {
    const { calls, spoken, deps } = fakeDeps('moved')
    applyWeekKey([b], WEEK, b, { kind: 'nudge', deltaMin: 15, deltaDay: 0 }, deps)
    expect(calls).toEqual([['blk', TUE, 9 * 60 + 15]])
    expect(spoken).toEqual(['Deck, 9:00 to 10:00, moved to 9:15'])
  })

  it('a day hop calls dragMove with the neighbouring day, same start', () => {
    const { calls, deps } = fakeDeps('moved')
    applyWeekKey([b], WEEK, b, { kind: 'nudge', deltaMin: 0, deltaDay: 1 }, deps)
    expect(calls).toEqual([['blk', WEEK[2], 9 * 60]])
  })

  it('a resize calls dragMove with the SAME slot and the new duration (4th arg)', () => {
    const { calls, spoken, deps } = fakeDeps('resized')
    applyWeekKey([b], WEEK, b, { kind: 'resize', deltaMin: 15 }, deps)
    expect(calls).toEqual([['blk', TUE, 9 * 60, 75]])
    expect(spoken).toEqual(['Deck, now 9:00 to 10:15'])
  })

  it('focus follows a committed move; a refused one keeps focus where it was', () => {
    const moved = fakeDeps('moved')
    applyWeekKey([b], WEEK, b, { kind: 'nudge', deltaMin: 15, deltaDay: 0 }, moved.deps)
    expect(moved.focused).toEqual(['blk'])
    const refused = fakeDeps('external')
    applyWeekKey([b], WEEK, b, { kind: 'nudge', deltaMin: 15, deltaDay: 0 }, refused.deps)
    expect(refused.focused).toEqual([])
    expect(refused.spoken).toEqual(["Deck, this one's from your calendar — it stays"])
  })

  it('an edge press never reaches the door — it only speaks', () => {
    const atTop = mk({ id: 'top', startMin: 0, endMin: 60, title: 'Early' })
    const { calls, spoken, deps } = fakeDeps()
    applyWeekKey([atTop], WEEK, atTop, { kind: 'nudge', deltaMin: -15, deltaDay: 0 }, deps)
    expect(calls).toEqual([])
    expect(spoken).toEqual(['Early is already at the start of the day'])
  })

  it('a focus-move only moves focus — the door is never touched', () => {
    const other = mk({ id: 'later', dayKey: TUE, startMin: 14 * 60, endMin: 15 * 60 })
    const { calls, focused, deps } = fakeDeps()
    applyWeekKey([b, other], WEEK, b, { kind: 'focus-move', dir: 'down' }, deps)
    expect(calls).toEqual([])
    expect(focused).toEqual(['later'])
  })
})
