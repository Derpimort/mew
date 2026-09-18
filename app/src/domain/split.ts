/* Split one block into two around a gap (#73, the #16 command surface). The
   first piece keeps the block's start and ends where the gap opens; the second
   starts where the gap closes. Pure geometry, shared by every door that splits:
   the typed "split the deck around the 1pm call", the keyed split_block tool,
   and the rescue chip's "split the deck around 13:00-13:45, keep 45m after".
   The executor (store.ts execSplit) owns targeting, the laws (a calendar block
   is never split, a series asks its scope, part 2 lands only in free time) and
   the one mutation, so the three doors can never drift apart. */

import type { Block } from './types'

/** The shortest piece a split may leave: MEW's quarter-hour grain. A split
    that would leave less asks instead of guessing. */
export const SPLIT_MIN_PIECE = 15

export type SplitSpan = { startMin: number; endMin: number }

export type SplitGeometry =
  | { ok: true; head: SplitSpan; tail: SplitSpan }
  | { ok: false; reason: 'outside' | 'short-head' | 'short-tail' | 'past-midnight' }

/** Where `block` splits around [gapStartMin, gapEndMin). The gap must open
    strictly inside the block (it may close past the block's end). The second
    piece runs `tailMin` when given (the rescue chip's explicit "keep Nm after"),
    otherwise the rest of the block's length, so the two pieces together keep
    the block's whole length. Splitting across days is out of scope: a second
    piece that would run past midnight is refused. */
export function splitGeometry(
  block: Pick<Block, 'startMin' | 'endMin'>,
  gapStartMin: number,
  gapEndMin: number,
  tailMin?: number
): SplitGeometry {
  if (gapEndMin <= gapStartMin || gapStartMin <= block.startMin || gapStartMin >= block.endMin)
    return { ok: false, reason: 'outside' }
  const headMin = gapStartMin - block.startMin
  if (headMin < SPLIT_MIN_PIECE) return { ok: false, reason: 'short-head' }
  const restMin = tailMin ?? block.endMin - block.startMin - headMin
  if (restMin < SPLIT_MIN_PIECE) return { ok: false, reason: 'short-tail' }
  if (gapEndMin + restMin > 24 * 60) return { ok: false, reason: 'past-midnight' }
  return {
    ok: true,
    head: { startMin: block.startMin, endMin: gapStartMin },
    tail: { startMin: gapEndMin, endMin: gapEndMin + restMin },
  }
}

/** The second piece's title: "Deck polish" → "Deck polish (part 2)", and a
    piece split again counts on ("Deck polish (part 2)" → "Deck polish (part 3)"). */
export function nextPartTitle(base: string): string {
  const m = base.match(/^(.*\S)\s+\(part (\d+)\)$/)
  return m ? `${m[1]} (part ${Number(m[2]) + 1})` : `${base} (part 2)`
}

/** A clock range as typed: "13:00-13:45", "1-1:45pm", "12:30pm to 1:15pm",
    "11am-1pm". A bare hour with no am/pm on either end stays out, unless it
    is unambiguous 24h (13 or later), because "1-2" is 1am or 1pm. When only
    the end carries am/pm the start takes it too, unless that would put the
    start after the end ("11-1pm" is 11am to 1pm). */
export function parseClockRange(text: string): SplitSpan | null {
  const m = text
    .trim()
    .toLowerCase()
    .match(
      /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/
    )
  if (!m) return null
  const [, h1s, m1s, ap1, h2s, m2s, ap2] = m
  const clock = (h: number, min: number, ap: string | undefined): number | null => {
    if (min > 59) return null
    if (ap) {
      if (h < 1 || h > 12) return null
      return ((h % 12) + (ap === 'pm' ? 12 : 0)) * 60 + min
    }
    return h <= 23 ? h * 60 + min : null
  }
  const h1 = Number(h1s)
  const h2 = Number(h2s)
  const min1 = m1s ? Number(m1s) : 0
  const min2 = m2s ? Number(m2s) : 0
  if (!ap1 && !ap2 && (!m1s || !m2s) && (h1 < 13 || h2 < 13)) return null // "1-2": ambiguous
  const end = clock(h2, min2, ap2)
  if (end == null) return null
  let start = clock(h1, min1, ap1 ?? ap2)
  if (start == null) return null
  if (!ap1 && ap2 && start >= end) start = clock(h1, min1, ap2 === 'pm' ? 'am' : 'pm')
  if (start == null || end <= start) return null
  return { startMin: start, endMin: end }
}
