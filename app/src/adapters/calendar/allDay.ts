/* All-day ingest rules (#27), shared by every calendar adapter so Google and
   ICS classify an entry the same way. An all-day entry is a fact about the
   day, not a claim on time: it rides the wire as dayKey (+ an inclusive
   endDayKey for a multi-day span) with a zero clock span. Exactly two shapes
   qualify — a date-only event, and a timed span from local midnight to a
   LATER day's local midnight (the corporate/imported OOO shape the old
   first-day clamp minted into 0:00–23:59). Any other timed multi-day span
   keeps the clamp. */

import { addDaysKey } from '../../domain/time'

/** The wire fields for an all-day entry covering firstKey … lastKey (inclusive). */
export function allDaySpan(
  firstKey: string,
  lastKey: string
): { dayKey: string; startMin: number; endMin: number; allDay: true; endDayKey?: string } {
  return {
    dayKey: firstKey,
    startMin: 0,
    endMin: 0,
    allDay: true,
    ...(lastKey > firstKey ? { endDayKey: lastKey } : {}),
  }
}

/** A local wall-clock point: the day it falls on and its minute of that day. */
export interface LocalPoint {
  dayKey: string
  min: number
}

/** The covered days of a timed span that runs from local midnight to a later
    day's local midnight — the end is exclusive, so the last covered day is the
    one before it. Null for every other span. */
export function midnightSpan(
  start: LocalPoint,
  end: LocalPoint
): { firstKey: string; lastKey: string } | null {
  if (start.min !== 0 || end.min !== 0 || end.dayKey <= start.dayKey) return null
  return { firstKey: start.dayKey, lastKey: addDaysKey(end.dayKey, -1) }
}
