/* The weekly review (#346) — a calm end-of-week ritual, computed PURELY from the
   local week + memory. Celebrate the week's mews (completions), surface the
   owner's OWN flexible unfinished blocks so they can be rolled forward, and tally
   the week by tag. Zero I/O; the store hands the locals in, this only shapes them.

   Product law, encoded here:
   - Positive voice: mews are celebrated; unfinished work is "carried", never a
     failure or a broken streak — there is no shame vocabulary in this file.
   - A mew = completion only: mews are the week's done blocks, real completions;
     the review never fabricates one and never un-completes anything. Mews are
     history, so they are NEVER roll candidates.
   - External events never move: only the owner's own flexible blocks can be
     carried; external (calendar) and fixed-time blocks are excluded.
   - Human-in-the-loop: this is a read-only presenter. It offers the carried set;
     the owner decides. Nothing here mutates or rolls anything. */

import type { Block, MemoryEvent, PrefPayload, Tag } from './types'
import { isFixedTime } from './week'
import { addDaysKey } from './time'

/** Per-tag counts: how many mews to celebrate, how many blocks carried. */
export interface TagTally {
  mews: number
  carried: number
}

export interface WeeklyReview {
  /** The Monday dayKey (weekKey) of the Mon–Sun window this review covers. */
  weekKey: string
  /** Completions to celebrate — the week's done blocks (real mews). NOT roll
      candidates: a mew is history. */
  mews: Block[]
  /** The owner's OWN, FLEXIBLE, still-open blocks — the only blocks eligible to
      roll forward. External/fixed/done are excluded (see isRollCandidate). */
  carried: Block[]
  /** Tally by tag over mews + carried, for a calm at-a-glance week shape. */
  byTag: Partial<Record<Tag, TagTally>>
  /** True when there is nothing to celebrate and nothing to carry — the data
      floor. The UI shows one kind line instead of empty rows. */
  empty: boolean
}

/** The single authority for "can this block roll forward?" — the owner's OWN
    (not external), FLEXIBLE (not fixed-time), still-OPEN work. A mew (done) is
    history, an external event isn't ours to move, a fixed-time block owns its
    slot: none of them qualify. Both the review's `carried` list and the store's
    rollForward filter read THIS, so the UI can only offer — and the executor can
    only move — what this predicate admits. Guards the human-in-the-loop law from
    both ends: even a stray id handed to rollForward can never roll a mew or an
    external event past this gate. Pure and keyless. */
export function isRollCandidate(b: Block, prefs: PrefPayload[] = []): boolean {
  return b.status === 'open' && !b.external && !isFixedTime(b, prefs)
}

/** The 7 Mon–Sun day-keys of the week `weekKey` (its Monday) opens. */
function weekDayKeys(weekKey: string): Set<string> {
  return new Set(Array.from({ length: 7 }, (_, i) => addDaysKey(weekKey, i)))
}

/** Shape one week into { mews, carried, byTag }. `week` is the live blocks (the
    fn scopes to `weekKey`'s Mon–Sun window itself, so the caller can hand the
    whole week array in). `_memory` rides the signature for local-first parity
    with the rest of the review family (insights.weekReview reads the ledger) and
    is reserved for a future consolidation-aware floor — the mews to celebrate
    and the blocks to roll are block-derived, since only the live blocks carry the
    ids a roll needs and the objects a celebration renders. Rolled blocks are
    excluded everywhere (they already moved on). */
export function weeklyReview(
  week: Block[],
  _memory: readonly MemoryEvent[],
  weekKey: string,
  prefs: PrefPayload[] = []
): WeeklyReview {
  const days = weekDayKeys(weekKey)
  const inWeek = week.filter((b) => days.has(b.dayKey) && b.status !== 'rolled')
  const mews = inWeek.filter((b) => b.status === 'done')
  const carried = inWeek.filter((b) => isRollCandidate(b, prefs))

  const byTag: Partial<Record<Tag, TagTally>> = {}
  const bump = (tag: Tag, key: keyof TagTally) => {
    const slot = (byTag[tag] ??= { mews: 0, carried: 0 })
    slot[key]++
  }
  for (const b of mews) bump(b.tag, 'mews')
  for (const b of carried) bump(b.tag, 'carried')

  return { weekKey, mews, carried, byTag, empty: mews.length === 0 && carried.length === 0 }
}
