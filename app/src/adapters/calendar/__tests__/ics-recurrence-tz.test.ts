/* RRULE expansion across timezones. A rule's days belong to the EVENT's own
   zone (its TZID, or UTC for a Z start), never to the device running MEW:
   "every Monday 09:00 Kiritimati" is a Sunday evening in UTC, and a device
   that walked its own calendar used to mint the wrong weekday. Each case
   states its expectation as instants, converted to the local day and minute
   the importer emits, so the suite holds in any TZ, and the first three cases
   fail on the old walk even under UTC. The last two need a zone west of UTC
   or with a DST change to show; the 5-TZ sweep in the PR runs them there. */

import { describe, expect, it } from 'vitest'
import { icsToRemoteEvents } from '../ics'
import { dayKey, minOfDay } from '../../../domain/time'

/** Windows wide enough, in instants, to hold every case in any zone (UTC−12 … UTC+14). */
const WS = new Date(Date.UTC(2026, 5, 1))
const WE = new Date(Date.UTC(2026, 6, 6))

const ics = (lines: string[]) =>
  ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')

/** An instant as the importer reports it: the device-local day and minute. */
const local = (ms: number) => {
  const d = new Date(ms)
  return { dayKey: dayKey(d), startMin: minOfDay(d) }
}

const slots = (events: { dayKey: string; startMin: number }[]) =>
  events.map((e) => ({ dayKey: e.dayKey, startMin: e.startMin }))

describe("RRULE days live in the event's own zone", () => {
  it('a weekly rule without BYDAY keeps its own weekday (Kiritimati Monday = UTC Sunday)', () => {
    const out = icsToRemoteEvents(
      ics([
        'UID:kiri@x',
        'DTSTART;TZID=Pacific/Kiritimati:20260608T090000',
        'DTEND;TZID=Pacific/Kiritimati:20260608T093000',
        'RRULE:FREQ=WEEKLY;COUNT=3',
        'SUMMARY:Island sync',
      ]),
      'cal',
      WS,
      WE
    )
    // Mondays 09:00 at UTC+14 are Sundays 19:00 UTC
    expect(slots(out.events)).toEqual(
      [Date.UTC(2026, 5, 7, 19), Date.UTC(2026, 5, 14, 19), Date.UTC(2026, 5, 21, 19)].map(local)
    )
  })

  it("INTERVAL weeks and BYDAY align to the event's own week (LA Sunday evening)", () => {
    const out = icsToRemoteEvents(
      ics([
        'UID:la@x',
        'DTSTART;TZID=America/Los_Angeles:20260607T200000',
        'DTEND;TZID=America/Los_Angeles:20260607T210000',
        'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,TU;COUNT=4',
        'SUMMARY:Fortnightly',
      ]),
      'cal',
      WS,
      WE
    )
    // week of Mon Jun 1 (Sun 7), skip a week, week of Jun 15 (Tue 16, Sun 21),
    // skip, week of Jun 29 (Tue 30) — 20:00 PDT is 03:00 UTC the next day
    expect(slots(out.events)).toEqual(
      [
        Date.UTC(2026, 5, 8, 3),
        Date.UTC(2026, 5, 17, 3),
        Date.UTC(2026, 5, 22, 3),
        Date.UTC(2026, 6, 1, 3),
      ].map(local)
    )
  })

  it('a date-only UNTIL includes its last day (it is not UTC midnight)', () => {
    const out = icsToRemoteEvents(
      ics([
        'UID:until@x',
        'DTSTART;TZID=America/Los_Angeles:20260615T100000',
        'DTEND;TZID=America/Los_Angeles:20260615T103000',
        'RRULE:FREQ=DAILY;UNTIL=20260617',
        'SUMMARY:Standup',
      ]),
      'cal',
      WS,
      WE
    )
    expect(slots(out.events)).toEqual(
      [Date.UTC(2026, 5, 15, 17), Date.UTC(2026, 5, 16, 17), Date.UTC(2026, 5, 17, 17)].map(local)
    )
  })

  it('an all-day daily series keeps the day its date-only UNTIL names, in every zone', () => {
    const out = icsToRemoteEvents(
      ics([
        'UID:allday-until@x',
        'DTSTART;VALUE=DATE:20260615',
        'DTEND;VALUE=DATE:20260616',
        'RRULE:FREQ=DAILY;UNTIL=20260617',
        'SUMMARY:Conference',
      ]),
      'cal',
      WS,
      WE
    )
    expect(out.events.map((e) => [e.dayKey, e.allDay])).toEqual([
      ['2026-06-15', true],
      ['2026-06-16', true],
      ['2026-06-17', true],
    ])
  })

  it('a daily series across a DST night never repeats or skips a date', () => {
    const out = icsToRemoteEvents(
      ics([
        'UID:dst@x',
        'DTSTART;TZID=America/Los_Angeles:20261030T090000',
        'DTEND;TZID=America/Los_Angeles:20261030T093000',
        'RRULE:FREQ=DAILY;COUNT=5',
        'SUMMARY:Morning check',
      ]),
      'cal',
      new Date(Date.UTC(2026, 9, 25)),
      new Date(Date.UTC(2026, 10, 10))
    )
    // 09:00 PDT (UTC−7) until the clocks fall back on Nov 1, then 09:00 PST (UTC−8)
    expect(slots(out.events)).toEqual(
      [
        Date.UTC(2026, 9, 30, 16),
        Date.UTC(2026, 9, 31, 16),
        Date.UTC(2026, 10, 1, 17),
        Date.UTC(2026, 10, 2, 17),
        Date.UTC(2026, 10, 3, 17),
      ].map(local)
    )
    expect(new Set(out.events.map((e) => e.eventId)).size).toBe(5)
  })
})
