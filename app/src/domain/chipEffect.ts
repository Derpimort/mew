/* What a chip's reply would DO (#94). A chip's reply is plain chat, spoken when
   it's picked, so its day words ("today", "tomorrow") — and every target lookup,
   which searches from today on — mean the day of the PICK. A chip offered on
   Tuesday and picked after midnight would otherwise act on a different day, or
   a different block, than the one it showed. This resolves a reply the way the
   rules floor and the executors will into the block(s) it reaches and the
   absolute day and time it lands on, against a given clock. Resolving the same
   reply at the offer's clock and at the pick's clock tells whether it still
   means what it meant. Pure: no store, no clock of its own.

   Every kind that acts is modelled; a reply that acts in a way not modelled here
   carries its day, so it never "still means" across one (fail closed). Only the
   kinds that change nothing day-bound — conversation, a capture, a stated
   preference, read-only views, the room offer's own pad — resolve to null. */

import type { Block, ScheduleIntent } from './types'
import { parseCommand } from './parse'
import { parseTimeValue } from './prefs'
import { parseSplitAsk } from './rescue'
import { addDaysKey, dayKey, weekdayOffset, weekKey } from './time'
import * as week from './week'

/** "plan my week" / "plan the week" — the weekly ritual's ask (#304). The rules
    floor routes it ahead of the grammar; one home so the two can't drift. */
export const RITUAL_ASK = /^\s*plan\s+(?:my|the)\s+week\b/i

/** A reply's effect: its kind plus every detail that decides what it touches —
    target block(s), absolute day(s), times, scope. Compared as a whole. */
export type ChipEffect = { kind: string; [detail: string]: unknown }

/** How findTarget's answer reads in an effect: the block id, or its status. */
function targetOf(r: ReturnType<typeof week.findTarget>): string {
  if (r.status === 'ok') return r.block.id
  if (r.status === 'ambiguous') return `ambiguous:${r.candidates.map((b) => b.id).join(',')}`
  return r.status
}

/** A day the floor writes as a numeric offset ("1"), made absolute; anything
    else (a real day key, or nothing) is kept as it is. */
const absDay = (todayKey: string, d: string | number | undefined): string | undefined =>
  d == null ? undefined : /^\d+$/.test(String(d)) ? addDaysKey(todayKey, Number(d)) : String(d)

/** The kinds that change nothing bound to a day: null at every clock. */
const INERT: ScheduleIntent['kind'][] = [
  'chat',
  'capture',
  'remember',
  'insights',
  'list',
  'giveRoom',
]

/** The effect of `reply` spoken at `now`, or null when it changes nothing
    day-bound (an acknowledgment like "ok, keep both as they are"). */
export function chipReplyEffect(
  blocks: Block[],
  reply: string,
  now: Date,
  todayKey: string = dayKey(now)
): ChipEffect | null {
  /* the rules floor reads the split ask and the ritual ahead of the grammar
     (rules.ts); runSplit resolves its day word and target exactly like this */
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
  if (RITUAL_ASK.test(reply)) return { kind: 'ritual', week: weekKey(now) }

  const ask = parseCommand(reply, now)
  if (INERT.includes(ask.kind)) return null
  /* the target the executor resolves: `at` pins which of same-named blocks; a
     done block is reachable where the executor allows it (complete, edit,
     resize and duplicate do; move and a relative nudge don't) */
  const target = (includeDone: boolean) =>
    targetOf(
      week.findTarget(blocks, ask.query ?? '', todayKey, {
        at: ask.at ? parseTimeValue(ask.at) : null,
        includeDone,
      })
    )
  switch (ask.kind) {
    case 'remove': {
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
        ...(ask.seriesScope ? { seriesScope: ask.seriesScope } : {}),
      }
    }
    case 'move':
      return {
        kind: 'move',
        target: target(false),
        toKey: absDay(todayKey, ask.toDayKey) ?? null,
        toStartMin: ask.toStartMin ?? null,
        relStartMin: ask.relStartMin ?? null,
      }
    case 'complete':
      return { kind: 'complete', target: target(true) }
    case 'edit':
      return { kind: 'edit', target: target(true), edit: ask.edit, seriesScope: ask.seriesScope }
    case 'resize':
      return {
        kind: 'resize',
        target: target(true),
        resize: ask.resize,
        seriesScope: ask.seriesScope,
      }
    case 'duplicate':
      return {
        kind: 'duplicate',
        target: target(true),
        toKey: absDay(todayKey, ask.duplicate?.toDayOffset),
        toStartMin: ask.duplicate?.toStartMin,
        rrule: ask.duplicate?.rrule,
      }
    case 'relmove':
      return {
        kind: 'relmove',
        target: target(false),
        relmove: ask.relmove,
        /* "the next free slot" searches from now; the other nudges are relative
           to the block's own day and start */
        from: ask.relmove?.direction === 'next_free' ? todayKey : null,
      }
    case 'plan':
      return {
        kind: 'plan',
        /* a place with no day lands from today, so its day is today's */
        places: (ask.places ?? []).map(({ dayOffset, dayKey: key, ...p }) => ({
          ...p,
          dayKey: key != null ? absDay(todayKey, key) : addDaysKey(todayKey, dayOffset ?? 0),
        })),
        frees: (ask.frees ?? []).map((f) => ({ ...f, dayKey: absDay(todayKey, f.dayKey) })),
      }
    default:
      /* clear ('today' / 'upcoming' count from today) and any kind that acts in
         a way not modelled above: bound to the day it's spoken — fail closed */
      return { kind: ask.kind, scope: ask.scope, day: todayKey }
  }
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
