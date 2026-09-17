/* What a chip's reply would DO (#94). A chip's reply is plain chat, spoken when
   it's picked, so its day words ("today", "tomorrow") mean the day of the PICK.
   A chip offered on Tuesday and picked after midnight would otherwise act on a
   different day than the one it showed. This resolves a reply the way the rules
   floor and the executors will — the rescue split ask, a move, a remove — into
   the block(s) it reaches and the absolute day and time it lands on, against a
   given clock. Resolving the same reply at the offer's clock and at the pick's
   clock tells whether it still means what it meant. Pure: no store, no clock of
   its own. */

import type { Block } from './types'
import { parseCommand } from './parse'
import { parseTimeValue } from './prefs'
import { parseSplitAsk } from './rescue'
import { addDaysKey, dayKey, weekdayOffset } from './time'
import * as week from './week'

export type ChipEffect =
  | { kind: 'remove'; remove: string[]; candidates: string[] }
  | {
      kind: 'move'
      /** the block the executor's resolver lands on, or its miss/ambiguity */
      target: string
      /** the absolute landing day, or null (the block keeps its own day) */
      toKey: string | null
      toStartMin: number | null
      relStartMin: number | null
    }
  | {
      kind: 'split'
      target: string
      /** the absolute day the kept tail is placed on */
      dayKey: string
      gapStartMin: number
      gapEndMin: number
      tailMin: number
    }

/** How findTarget's answer reads in an effect: the block id, or its status. */
function targetOf(r: ReturnType<typeof week.findTarget>): string {
  if (r.status === 'ok') return r.block.id
  if (r.status === 'ambiguous') return `ambiguous:${r.candidates.map((b) => b.id).join(',')}`
  return r.status
}

/** The effect of `reply` spoken at `now`, or null when it changes nothing the
    floor can read (an acknowledgment like "ok, keep both as they are"). */
export function chipReplyEffect(
  blocks: Block[],
  reply: string,
  now: Date,
  todayKey: string = dayKey(now)
): ChipEffect | null {
  /* the rules floor reads the split ask ahead of the grammar (rules.ts), and
     runSplit resolves its day word and target exactly like this */
  const split = parseSplitAsk(reply)
  if (split) {
    const dayOffset =
      split.dayWord == null
        ? 0
        : split.dayWord === 'tomorrow'
          ? 1
          : (weekdayOffset(split.dayWord, now) ?? 0)
    return {
      kind: 'split',
      target: targetOf(week.findTarget(blocks, split.query, todayKey, { includeDone: true })),
      dayKey: addDaysKey(todayKey, dayOffset),
      gapStartMin: split.gapStartMin,
      gapEndMin: split.gapEndMin,
      tailMin: split.tailMin,
    }
  }
  const ask = parseCommand(reply, now)
  if (ask.kind === 'remove') {
    /* execRemove's resolution: the day pin becomes the resolver's day */
    const pin = ask.remove ?? {}
    const r = week.resolveRemoval(
      blocks,
      ask.query ?? '',
      {
        at: pin.at,
        all: pin.all,
        day: pin.dayOffset != null ? addDaysKey(todayKey, pin.dayOffset) : undefined,
      },
      todayKey
    )
    return {
      kind: 'remove',
      remove: r.remove.map((b) => b.id),
      candidates: r.candidates.map((b) => b.id),
    }
  }
  if (ask.kind === 'move') {
    /* execMove's resolution: `at` pins the source, a numeric day offset is
       counted from today, anything else keeps the block's own day */
    const offset = ask.toDayKey != null && /^\d+$/.test(ask.toDayKey) ? Number(ask.toDayKey) : null
    return {
      kind: 'move',
      target: targetOf(
        week.findTarget(blocks, ask.query ?? '', todayKey, {
          at: ask.at ? parseTimeValue(ask.at) : null,
        })
      ),
      toKey: offset != null ? addDaysKey(todayKey, offset) : null,
      toStartMin: ask.toStartMin ?? null,
      relStartMin: ask.relStartMin ?? null,
    }
  }
  return null
}

/** Whether a chip's reply, spoken now, still does exactly what it did when the
    chip was offered: same block(s), same absolute day and time. */
export function chipStillMeans(
  blocks: Block[],
  reply: string,
  offeredAt: Date,
  pickedAt: Date
): boolean {
  const then = chipReplyEffect(blocks, reply, offeredAt)
  const now = chipReplyEffect(blocks, reply, pickedAt)
  return JSON.stringify(then) === JSON.stringify(now)
}
