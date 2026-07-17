/* Keyboard-first week (#303) — the key→intent rules as pure logic (the
   sessionWindow / dialGeometry precedent): what a keypress on a focused block
   MEANS (weekKeyIntent), where it would LAND (weekKeyCommand), how focus walks
   the grid (weekFocusOrder / stepWeekFocus), and what the live region SAYS
   (edge/commit announcements). Nothing here mutates — the store's dragMove
   (the exact action the drag gesture commits through) stays the only door;
   the view wires these rules to it. All pure, unit-tested without a DOM. */

import type { Block } from '../../domain/types'
import { addDaysKey, fmtDowLong, fmtTime } from '../../domain/time'
import { blocksForDay, duration } from '../../domain/week'
import { snapMin } from './dragGeometry'
import { DAY_MIN } from './orbitGeometry'

/** One Shift+arrow nudges this many minutes (the issue's 15-min step). */
export const NUDGE_STEP_MIN = 15
/** One Alt+arrow grows/shrinks the block's end by this many minutes. */
export const RESIZE_STEP_MIN = 15
/** A block never resizes below this — the same floor execEdit keeps. */
export const MIN_BLOCK_MIN = 15

/* ── the grammar: key + modifiers → intent (APG Application pattern) ────────
   Plain arrows move FOCUS between blocks (roving tabindex — #253's dial
   grammar on a grid); Shift+↑/↓ nudge the block ±15 min, Shift+←/→ hop it a
   day; Alt+↑/↓ resize its end. Alt+←/→ stay unclaimed — they are browser
   history keys and MEW never hijacks those. Shift+Alt chords, Tab, characters
   all return null so the event keeps bubbling (no keyboard trap, §2.1.2). */

export interface WeekKeyMods {
  shift?: boolean
  alt?: boolean
}

export type FocusDir = 'up' | 'down' | 'left' | 'right'

export type WeekKeyIntent =
  | { kind: 'focus-move'; dir: FocusDir }
  | { kind: 'nudge'; deltaMin: number; deltaDay: number } // one axis per press; the other is 0
  | { kind: 'resize'; deltaMin: number }
  | null

const ARROW_DIRS: Record<string, FocusDir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

export function weekKeyIntent(key: string, mods: WeekKeyMods): WeekKeyIntent {
  const dir = ARROW_DIRS[key]
  if (!dir) return null // only arrows are claimed; Enter/Space stay the open-card keys
  const shift = !!mods.shift
  const alt = !!mods.alt
  if (shift && alt) return null // an ambiguous chord is nobody's — let it bubble
  if (shift) {
    switch (dir) {
      case 'up':
        return { kind: 'nudge', deltaMin: -NUDGE_STEP_MIN, deltaDay: 0 }
      case 'down':
        return { kind: 'nudge', deltaMin: NUDGE_STEP_MIN, deltaDay: 0 }
      case 'left':
        return { kind: 'nudge', deltaMin: 0, deltaDay: -1 }
      case 'right':
        return { kind: 'nudge', deltaMin: 0, deltaDay: 1 }
    }
  }
  if (alt) {
    switch (dir) {
      case 'up':
        return { kind: 'resize', deltaMin: -RESIZE_STEP_MIN }
      case 'down':
        return { kind: 'resize', deltaMin: RESIZE_STEP_MIN }
      default:
        return null // Alt+←/→ are the browser's back/forward — never claimed
    }
  }
  return { kind: 'focus-move', dir }
}

/* ── where an intent lands: the block-derived candidate, or the edge ────────
   A nudge/resize either yields the exact arguments the view hands dragMove
   (already clamped/snapped, the same snapMin rules a drag drop obeys) or
   names the edge that stopped it — so the attempt is ALWAYS announceable and
   a keypress is never a silent no-op. */

export type MutIntent = Extract<NonNullable<WeekKeyIntent>, { kind: 'nudge' | 'resize' }>

export type WeekEdge =
  | 'day-start' // nudged up against 0:00
  | 'day-end' // nudged down against midnight
  | 'week-start' // day-hopped off the visible week's left edge
  | 'week-end' // …or its right edge
  | 'min-length' // shrunk to the 15-min floor
  | 'max-length' // grown to the end of the day

export type WeekKeyCommand =
  | { kind: 'move'; toDayKey: string; toStartMin: number }
  | { kind: 'resize'; toDurationMin: number }
  | { kind: 'edge'; edge: WeekEdge }

export function weekKeyCommand(
  b: Block,
  intent: MutIntent,
  weekDayKeys: readonly string[]
): WeekKeyCommand {
  if (intent.kind === 'resize') {
    const dur = duration(b)
    if (intent.deltaMin < 0) {
      if (dur <= MIN_BLOCK_MIN) return { kind: 'edge', edge: 'min-length' }
      return { kind: 'resize', toDurationMin: Math.max(MIN_BLOCK_MIN, dur + intent.deltaMin) }
    }
    const ceiling = DAY_MIN - b.startMin // the end never runs past midnight (same as drag)
    if (dur >= ceiling) return { kind: 'edge', edge: 'max-length' }
    return { kind: 'resize', toDurationMin: Math.min(ceiling, dur + intent.deltaMin) }
  }
  if (intent.deltaDay !== 0) {
    /* day hops stay inside the visible week — exactly the reach a drag has
       (its column hit-test only sees rendered columns); the week's ‹ › pager
       is the way to a different week. */
    const i = weekDayKeys.indexOf(b.dayKey)
    if (i === -1) {
      // not in the rendered week (defensive) — hop by calendar day, unclamped
      return {
        kind: 'move',
        toDayKey: addDaysKey(b.dayKey, intent.deltaDay),
        toStartMin: b.startMin,
      }
    }
    const j = i + intent.deltaDay
    if (j < 0) return { kind: 'edge', edge: 'week-start' }
    if (j >= weekDayKeys.length) return { kind: 'edge', edge: 'week-end' }
    return { kind: 'move', toDayKey: weekDayKeys[j], toStartMin: b.startMin }
  }
  /* ±15 min inside the day, snapped/clamped by the very rule a drag drop uses
     (snapMin) — an off-grid block's first nudge tidies onto the 5-min grid the
     way any drag would. A press that clamps back onto the current start is the
     day's edge, not a mutation. */
  const next = snapMin(b.startMin + intent.deltaMin, duration(b))
  if (next === b.startMin)
    return { kind: 'edge', edge: intent.deltaMin < 0 ? 'day-start' : 'day-end' }
  return { kind: 'move', toDayKey: b.dayKey, toStartMin: next }
}

/* ── focus traversal: one tab stop, arrows walk the visual order ────────────
   The grid's reading order is day-major (columns left→right) then time-minor
   (top→bottom) — the exact order blocksForDay renders. ↑/↓ walk that flat
   order (wrapping, so a keyboard user never dead-ends); ←/→ hop to the
   nearest-by-start block of an adjacent day with blocks, mirroring the dial's
   two-axis grammar (#253). rovingFocusId (orbitGeometry) picks the single
   tab stop from this order. */

export function weekFocusOrder(blocks: Block[], weekDayKeys: readonly string[]): string[] {
  return weekDayKeys.flatMap((k) => blocksForDay(blocks, k).map((b) => b.id))
}

export function stepWeekFocus(
  blocks: Block[],
  weekDayKeys: readonly string[],
  currentId: string | null,
  dir: FocusDir
): string | null {
  const order = weekFocusOrder(blocks, weekDayKeys)
  if (order.length === 0) return currentId
  // no anchor yet → land on the first/last block so the first arrow always works
  if (currentId == null || !order.includes(currentId))
    return dir === 'down' || dir === 'right' ? order[0] : order[order.length - 1]

  if (dir === 'up' || dir === 'down') {
    const i = order.indexOf(currentId)
    const step = dir === 'down' ? 1 : -1
    return order[(i + step + order.length) % order.length]
  }

  // ←/→: the adjacent day (skipping empty columns, wrapping) — nearest start
  const cur = blocks.find((b) => b.id === currentId)!
  const di = weekDayKeys.indexOf(cur.dayKey)
  if (di === -1) return currentId
  const step = dir === 'right' ? 1 : -1
  for (let hop = 1; hop < weekDayKeys.length; hop++) {
    // |step·hop| < length, so one added length keeps the modulo in range
    const day = blocksForDay(
      blocks,
      weekDayKeys[(di + step * hop + weekDayKeys.length) % weekDayKeys.length]
    )
    if (day.length === 0) continue
    let best = day[0]
    for (const cand of day) {
      if (Math.abs(cand.startMin - cur.startMin) < Math.abs(best.startMin - cur.startMin))
        best = cand
    }
    return best.id
  }
  return currentId // the only day with blocks — stay put
}

/* ── the spoken side (§1.1.1/§4.1.2 + the live region's grammar) ───────────
   The tile's accessible name reads like the dial's arcs; commit/edge copy is
   positive-only (things "stay", nothing "fails") and rides an aria-live
   region, so the ATTEMPT on an immovable block is announced, never silent. */

/** The tile's accessible name: title, times, then its nature (done / calendar /
    held) — so a screen reader knows an immovable block before trying it. */
export function blockAriaLabel(b: Block): string {
  const done = b.status === 'done' ? ', done' : ''
  const nature = b.external ? ', from your calendar' : b.protected ? ', held' : ''
  return `${b.title}, ${fmtTime(b.startMin)} to ${fmtTime(b.endMin)}${done}${nature}`
}

const spokenTitle = (b: Block): string => b.title.split('—')[0].trim()

/** What the live region says when an intent stopped at an edge. */
export function edgeAnnouncement(b: Block, edge: WeekEdge): string {
  const t = spokenTitle(b)
  switch (edge) {
    case 'day-start':
      return `${t} is already at the start of the day`
    case 'day-end':
      return `${t} is already at the end of the day`
    case 'week-start':
      return `that's the start of this week — ${t} stays on ${fmtDowLong(b.dayKey).toLowerCase()}`
    case 'week-end':
      return `that's the edge of this week — ${t} stays on ${fmtDowLong(b.dayKey).toLowerCase()}`
    case 'min-length':
      return `${t} is already at its smallest — ${MIN_BLOCK_MIN} minutes`
    case 'max-length':
      return `${t} already runs to the end of the day`
  }
}

/** What the live region says after the executor ruled on a commit attempt.
    `b` is the block BEFORE the commit, `cmd` what was attempted, `outcome`
    dragMove's verdict — so the copy never claims more than the store did. */
export function commitAnnouncement(
  b: Block,
  cmd: Exclude<WeekKeyCommand, { kind: 'edge' }>,
  outcome: 'moved' | 'resized' | 'external' | 'conflict' | 'noop'
): string {
  const t = spokenTitle(b)
  const span = `${fmtTime(b.startMin)} to ${fmtTime(b.endMin)}`
  switch (outcome) {
    case 'moved': {
      const to = cmd.kind === 'move' ? cmd : { toDayKey: b.dayKey, toStartMin: b.startMin }
      const where =
        to.toDayKey === b.dayKey
          ? fmtTime(to.toStartMin)
          : `${fmtDowLong(to.toDayKey).toLowerCase()} at ${fmtTime(to.toStartMin)}`
      return `${t}, ${span}, moved to ${where}`
    }
    case 'resized': {
      const dur = cmd.kind === 'resize' ? cmd.toDurationMin : duration(b)
      return `${t}, now ${fmtTime(b.startMin)} to ${fmtTime(b.startMin + dur)}`
    }
    case 'external':
      return `${t}, this one's from your calendar — it stays`
    case 'conflict':
      return cmd.kind === 'move'
        ? `${t} stays at ${fmtTime(b.startMin)} — that slot is taken`
        : `${t} stays ${span} — the room past ${fmtTime(b.endMin)} is taken`
    case 'noop':
      return `${t} is already there`
  }
}

/* ── the dispatcher: one claimed keypress → focus step, or ONE door call ────
   The seams are injected so the contract is pinned with a recording fake and
   the real store action alike: `dragMove` IS the store's drag door — keyboard
   never gets a second mutation path. */

export interface WeekKeyDeps {
  /** the store's dragMove — the exact action a drag drop commits through */
  dragMove: (
    id: string,
    toDayKey: string,
    toStartMin: number,
    durationMin?: number
  ) => 'moved' | 'resized' | 'external' | 'conflict' | 'noop'
  /** move the roving focus (the view's rAF-refocus lives behind this) */
  moveFocus: (id: string | null) => void
  /** feed the polite live region — every attempt speaks, never a silent no-op */
  announce: (line: string) => void
}

export function applyWeekKey(
  blocks: Block[],
  weekDayKeys: readonly string[],
  b: Block,
  intent: NonNullable<WeekKeyIntent>,
  deps: WeekKeyDeps
): void {
  if (intent.kind === 'focus-move') {
    deps.moveFocus(stepWeekFocus(blocks, weekDayKeys, b.id, intent.dir))
    return
  }
  const cmd = weekKeyCommand(b, intent, weekDayKeys)
  if (cmd.kind === 'edge') {
    deps.announce(edgeAnnouncement(b, cmd.edge))
    return
  }
  const outcome =
    cmd.kind === 'move'
      ? deps.dragMove(b.id, cmd.toDayKey, cmd.toStartMin)
      : deps.dragMove(b.id, b.dayKey, b.startMin, cmd.toDurationMin)
  deps.announce(commitAnnouncement(b, cmd, outcome))
  // a committed day hop remounts the tile in its new column — focus follows it
  if (outcome === 'moved' || outcome === 'resized') deps.moveFocus(b.id)
}
