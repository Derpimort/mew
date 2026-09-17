/* Google Calendar event → RemoteEvent, pure (#27). The network shell
   (google.ts) is an I/O edge with no unit seam, so the mapping rules live here
   where they are tested: cancelled events drop, a date-only event arrives as
   an all-day entry (never skipped), a local midnight→midnight span is all-day
   too, and only the remaining multi-day timed spans clamp to their first day. */

import { addDaysKey, dayKey, minOfDay } from '../../domain/time'
import { allDaySpan, midnightSpan, type LocalPoint } from './allDay'
import type { RemoteEvent } from './types'

/** The slice of a Google Calendar v3 event MEW reads. */
export interface GEvent {
  id: string
  status?: string
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  extendedProperties?: { private?: Record<string, string> }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** An RFC3339 instant → the local day and minute it lands on. */
function fromISO(iso: string): LocalPoint {
  const d = new Date(iso)
  return { dayKey: dayKey(d), min: minOfDay(d) }
}

export function mapGoogleEvent(e: GEvent, calId: string): RemoteEvent | null {
  if (e.status === 'cancelled') return null
  const base = {
    eventId: e.id,
    calId,
    title: e.summary ?? '(untitled)',
    mewBlockId: e.extendedProperties?.private?.mewBlockId,
  }

  /* date-only: start.date is a calendar DATE, never an instant — parsed as ISO
     it is UTC midnight, which lands on the PREVIOUS day west of UTC. The key is
     the string itself. end.date is exclusive: the last covered day is the one
     before it (a missing or non-later end covers the start day alone). */
  if (!e.start?.dateTime && e.start?.date) {
    const first = e.start.date
    if (!DATE_ONLY.test(first)) return null
    const end = e.end?.date
    const last = end && DATE_ONLY.test(end) && end > first ? addDaysKey(end, -1) : first
    return { ...base, ...allDaySpan(first, last) }
  }

  if (!e.start?.dateTime || !e.end?.dateTime) return null
  const start = fromISO(e.start.dateTime)
  const end = fromISO(e.end.dateTime)
  const midnight = midnightSpan(start, end)
  if (midnight) return { ...base, ...allDaySpan(midnight.firstKey, midnight.lastKey) }
  return {
    ...base,
    dayKey: start.dayKey,
    startMin: start.min,
    // other multi-day spans clamp to their first day
    endMin: end.dayKey === start.dayKey ? end.min : 23 * 60 + 59,
  }
}
