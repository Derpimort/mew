/* Batch changes (#75, the #16 command surface): "push everything after 3pm back
   an hour", "move all of today's work to tomorrow". A selector picks blocks the
   way list_blocks shows them (one day, all-day labels aside, an optional tag,
   start window and title words); one op moves them. Pure: planBatch says exactly
   which blocks move where and which stay put and why, so the confirm MEW offers
   before a wide change lists what the pick will touch, and nothing else. The
   store (execBatch) owns the offer, the one mutation and the reply. */

import type { Block, PrefPayload, Tag } from './types'
import { blocksForDay, isAllDay, isBackground, isFixedTime } from './week'

export interface BatchSelector {
  dayKey: string
  /** blocks STARTING at or after this minute */
  afterMin?: number
  /** blocks starting before this minute */
  beforeMin?: number
  tag?: Tag
  /** a few title words, matched like list/targets do (case-insensitive substring) */
  titleQuery?: string
}

export type BatchOp = { kind: 'shift'; deltaMin: number } | { kind: 'moveToDay'; toDayKey: string }

export interface BatchMove {
  block: Block
  dayKey: string
  startMin: number
  endMin: number
}

export type BatchSkipReason =
  /** a [calendar] event — never moved by MEW */
  | 'calendar'
  /** a fixed-time block — scheduled around, never moved in a sweep */
  | 'fixed'
  /** already done — a mew is history */
  | 'done'
  /** a repeating block — series edits ask their scope first (#343), out of a batch */
  | 'repeating'
  /** the shift would run it past midnight or before 0:00 */
  | 'off-day'
  /** its new time would sit over a fixed or calendar block */
  | 'lands-on'

export interface BatchSkip {
  block: Block
  reason: BatchSkipReason
  /** for 'lands-on': the blocks it would sit over */
  on?: Block[]
}

export interface BatchPlan {
  /** everything the selector picked, in time order */
  selected: Block[]
  moves: BatchMove[]
  skipped: BatchSkip[]
}

/** The blocks a selector picks: that day's time-holding blocks (all-day labels
    aside), filtered by tag, start window and title words, in time order. */
export function selectBatch(blocks: Block[], sel: BatchSelector): Block[] {
  const q = sel.titleQuery?.trim().toLowerCase()
  return blocksForDay(blocks, sel.dayKey).filter(
    (b) =>
      !isAllDay(b) &&
      (sel.tag == null || b.tag === sel.tag) &&
      (sel.afterMin == null || b.startMin >= sel.afterMin) &&
      (sel.beforeMin == null || b.startMin < sel.beforeMin) &&
      (!q || b.title.toLowerCase().includes(q))
  )
}

/** Plan a batch: which selected blocks move where, which stay put and why. */
export function planBatch(
  blocks: Block[],
  sel: BatchSelector,
  op: BatchOp,
  prefs: PrefPayload[] = []
): BatchPlan {
  const selected = selectBatch(blocks, sel)
  const skipped: BatchSkip[] = []
  const candidates: BatchMove[] = []
  for (const b of selected) {
    if (b.external) skipped.push({ block: b, reason: 'calendar' })
    else if (b.status === 'done') skipped.push({ block: b, reason: 'done' })
    else if (isFixedTime(b, prefs)) skipped.push({ block: b, reason: 'fixed' })
    else if (b.recurringBlockId) skipped.push({ block: b, reason: 'repeating' })
    else if (b.status !== 'open') continue
    else {
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
  const moves: BatchMove[] = []
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
    .map((m) => `${m.block.id}@${m.dayKey}/${m.startMin}-${m.endMin}`)
    .sort()
    .join('|')
  let h = 0x811c9dc5 // FNV-1a, 32-bit
  for (let i = 0; i < list.length; i++) {
    h ^= list.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}
