/* Batch changes (#75, the #16 command surface): "push everything after 3pm back
   an hour", "move all of today's work to tomorrow". A selector picks blocks the
   way list_blocks shows them (one day, all-day labels aside, an optional tag,
   start window and title words); one op moves them. Pure: planBatch says exactly
   which blocks move where and which stay put and why, so the confirm MEW offers
   before a wide change lists what the pick will touch, and nothing else. The
   store (execBatch) owns the offer, the one mutation and the reply. */

import type { Block, PrefPayload, Tag } from './types'
import { blocksForDay, isAllDay, isBackground, isFixedTime, seriesOf } from './week'

export interface BatchSelector {
  dayKey: string
  /** blocks STARTING at or after this minute */
  afterMin?: number
  /** blocks starting before this minute */
  beforeMin?: number
  tag?: Tag
  /** a few title words, matched like list/targets do (case-insensitive
      substring), quotes aside */
  titleQuery?: string
}

export type BatchOp =
  | { kind: 'shift'; deltaMin: number }
  | { kind: 'moveToDay'; toDayKey: string }
  /** #75 slice 2: retag the selection in place ("tag all of tomorrow's calls as work") */
  | { kind: 'setTag'; tag: Tag }

export interface BatchMove {
  block: Block
  dayKey: string
  startMin: number
  endMin: number
  /** setTag: the tag the block takes (its time stays) */
  tag?: Tag
}

export type BatchSkipReason =
  /** a [calendar] event — never moved by MEW */
  | 'calendar'
  /** a fixed-time block — scheduled around, never moved in a sweep */
  | 'fixed'
  /** already done — a mew is history */
  | 'done'
  /** a repeating block, and no scope answered yet — the store asks which
      occurrences the change means (#343's three chips) before touching a series */
  | 'repeating'
  /** #75 slice 3: a repeating block asked to move to one day, for more than this
      occurrence — a series keeps its own days, so the whole run never collapses
      onto one of them */
  | 'series-day'
  /** the shift would run it past midnight or before 0:00 */
  | 'off-day'
  /** its new time would sit over a fixed or calendar block */
  | 'lands-on'
  /** setTag: it already has that tag */
  | 'already'

export interface BatchSkip {
  block: Block
  reason: BatchSkipReason
  /** for 'lands-on': the blocks it would sit over */
  on?: Block[]
}

/** Which occurrences of a repeating block a batch means (#75 slice 3) — the same
    three answers a single series edit asks for (#343), so a chip's re-issued ask
    carries one vocabulary across both surfaces. */
export type BatchScope = 'this' | 'following' | 'series'

export interface BatchPlan {
  /** everything the change touches, in time order: the selector's own picks, plus
      the other occurrences a scope reaches (they can fall on other days) */
  selected: Block[]
  moves: BatchMove[]
  skipped: BatchSkip[]
}

/** The blocks a selector picks: that day's time-holding blocks (all-day labels
    aside), filtered by tag, start window and title words, in time order. */
export function selectBatch(blocks: Block[], sel: BatchSelector): Block[] {
  /* quotes aside, so title words survive a re-ask that can't carry them */
  const unquoted = (s: string) => s.replace(/["“”]/g, '').toLowerCase()
  const q = sel.titleQuery ? unquoted(sel.titleQuery).trim() : undefined
  const pick = (words: string | undefined) =>
    blocksForDay(blocks, sel.dayKey).filter(
      (b) =>
        !isAllDay(b) &&
        (sel.tag == null || b.tag === sel.tag) &&
        (sel.afterMin == null || b.startMin >= sel.afterMin) &&
        (sel.beforeMin == null || b.startMin < sel.beforeMin) &&
        (!words || unquoted(b.title).includes(words))
    )
  const picked = pick(q)
  /* "tomorrow's calls" names Client call: a plural that matches nothing that day
     tries its singular (#75 slice 2), never widening a selection that matched */
  return !picked.length && q && q.length > 3 && q.endsWith('s') ? pick(q.slice(0, -1)) : picked
}

/** The occurrences a scope adds to a selection (#75 slice 3): "just this one"
    adds nothing, "this and the ones after" adds the later open occurrences of
    each picked series, "the whole series" adds all of them. Later is read on the
    day first and the clock second, so an occurrence earlier the same day is not
    "after" — and since seriesOf is open-only, a done occurrence never joins.
    Time order, by day: the plan's own list crosses days once a scope widens it. */
function withScope(blocks: Block[], selected: Block[], scope: BatchScope): Block[] {
  if (scope === 'this') return selected
  const out = [...selected]
  const seen = new Set(selected.map((b) => b.id))
  for (const b of selected) {
    if (!b.recurringBlockId) continue
    for (const o of seriesOf(blocks, b)) {
      if (seen.has(o.id)) continue
      const after = o.dayKey > b.dayKey || (o.dayKey === b.dayKey && o.startMin > b.startMin)
      if (scope === 'following' && !after) continue
      seen.add(o.id)
      out.push(o)
    }
  }
  return out.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.startMin - b.startMin)
}

/** Plan a batch: which selected blocks move where, which stay put and why.
    `scope` answers the series question (#75 slice 3): without it a repeating
    block stays put and is named, so the store can ask; with it the change
    reaches exactly the occurrences that answer names. */
export function planBatch(
  blocks: Block[],
  sel: BatchSelector,
  op: BatchOp,
  prefs: PrefPayload[] = [],
  scope?: BatchScope
): BatchPlan {
  const selected = scope
    ? withScope(blocks, selectBatch(blocks, sel), scope)
    : selectBatch(blocks, sel)
  const skipped: BatchSkip[] = []
  const candidates: BatchMove[] = []
  const moves: BatchMove[] = []
  for (const b of selected) {
    if (b.external) skipped.push({ block: b, reason: 'calendar' })
    else if (b.status === 'done') skipped.push({ block: b, reason: 'done' })
    /* fixed-time is about time: a retag moves nothing, so an own fixed block
       ("Client call") takes the tag (#75 slice 2); a move still never touches it */
    else if (op.kind !== 'setTag' && isFixedTime(b, prefs))
      skipped.push({ block: b, reason: 'fixed' })
    /* a series without an answer stays whole and is named; with an answer, only
       a move onto one day is refused — that would stack every occurrence the
       scope reaches on the same day, which is never what "move them" means */
    else if (b.recurringBlockId && !scope) skipped.push({ block: b, reason: 'repeating' })
    else if (b.recurringBlockId && op.kind === 'moveToDay' && scope !== 'this')
      skipped.push({ block: b, reason: 'series-day' })
    else if (b.status !== 'open') continue
    else if (op.kind === 'setTag') {
      /* a retag keeps every block where it is: nothing to land on, no day to leave */
      if (b.tag === op.tag) skipped.push({ block: b, reason: 'already' })
      else
        moves.push({
          block: b,
          dayKey: b.dayKey,
          startMin: b.startMin,
          endMin: b.endMin,
          tag: op.tag,
        })
    } else {
      const target =
        op.kind === 'shift'
          ? { dayKey: b.dayKey, startMin: b.startMin + op.deltaMin, endMin: b.endMin + op.deltaMin }
          : { dayKey: op.toDayKey, startMin: b.startMin, endMin: b.endMin }
      if (target.startMin < 0 || target.endMin > 24 * 60)
        skipped.push({ block: b, reason: 'off-day' })
      else candidates.push({ block: b, ...target })
    }
  }
  /* a moved block never lands on a fixed or calendar block that stays where it
     is (fixed-time is scheduled around, never over): that one stays put, named */
  const moving = new Set(candidates.map((m) => m.block.id))
  for (const m of candidates) {
    const on = blocksForDay(blocks, m.dayKey).filter(
      (b) =>
        !moving.has(b.id) &&
        b.status === 'open' &&
        !isAllDay(b) &&
        !isBackground(b) &&
        (b.external || isFixedTime(b, prefs)) &&
        b.startMin < m.endMin &&
        b.endMin > m.startMin
    )
    if (on.length) skipped.push({ block: m.block, reason: 'lands-on', on })
    else moves.push(m)
  }
  return { selected, moves, skipped }
}

/** The list a confirm names, as a short token (#75 review): a hash of exactly
    which blocks move where, so a yes acts only while its plan still moves that
    same list. A block dragged in or out of the window, a capture placed into it,
    or a selector the other floor reads differently changes the token, and MEW
    offers again instead of moving blocks the offer never showed. */
export function batchToken(plan: BatchPlan): string {
  const list = plan.moves
    .map((m) => `${m.block.id}@${m.dayKey}/${m.startMin}-${m.endMin}${m.tag ? `#${m.tag}` : ''}`)
    .sort()
    .join('|')
  let h = 0x811c9dc5 // FNV-1a, 32-bit
  for (let i = 0; i < list.length; i++) {
    h ^= list.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}
