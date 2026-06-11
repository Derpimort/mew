import { describe, expect, it } from 'vitest'
import { icsToRemoteEvents, parseIcs } from '../ics'

const WS = new Date(2026, 5, 8) // Mon Jun 8 2026 (local)
const WE = new Date(2026, 5, 29)

function ics(body: string): string {
  return ['BEGIN:VCALENDAR', 'X-WR-CALNAME:mew@example.com', body, 'END:VCALENDAR'].join('\r\n')
}

describe('ICS parsing — the shapes real Google exports use', () => {
  it('unfolds continuation lines and unescapes summaries', () => {
    const text = ics(
      [
        'BEGIN:VEVENT',
        'UID:a@x',
        'DTSTART:20260610T070000Z',
        'DTEND:20260610T073000Z',
        'SUMMARY:Standup\\, the long',
        '  one with a folded title',
        'END:VEVENT',
      ].join('\r\n'),
    )
    const out = icsToRemoteEvents(text, 'cal', WS, WE)
    expect(out.calName).toBe('mew@example.com')
    expect(out.events[0].title).toBe('Standup, the long one with a folded title')
  })

  it('converts TZID wall-clock times to the right local slot', () => {
    // 10:00 in Toronto on Jun 10 2026 = 14:00 UTC (EDT, UTC-4)
    const text = ics(
      [
        'BEGIN:VEVENT',
        'UID:tz@x',
        'DTSTART;TZID=America/Toronto:20260610T100000',
        'DTEND;TZID=America/Toronto:20260610T110000',
        'SUMMARY:NY sync',
        'END:VEVENT',
      ].join('\r\n'),
    )
    const out = icsToRemoteEvents(text, 'cal', WS, WE)
    const expected = new Date(Date.UTC(2026, 5, 10, 14, 0))
    expect(out.events[0].dayKey).toBe(
      `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`,
    )
    expect(out.events[0].startMin).toBe(expected.getHours() * 60 + expected.getMinutes())
  })

  it('skips all-day events and monthly/yearly rules, counting them honestly', () => {
    const text = ics(
      [
        'BEGIN:VEVENT',
        'UID:allday@x',
        'DTSTART;VALUE=DATE:20260610',
        'DTEND;VALUE=DATE:20260611',
        'SUMMARY:Birthday',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:yearly@x',
        'DTSTART:20260610T070000Z',
        'DTEND:20260610T080000Z',
        'RRULE:FREQ=YEARLY',
        'SUMMARY:Anniversary',
        'END:VEVENT',
      ].join('\r\n'),
    )
    const out = icsToRemoteEvents(text, 'cal', WS, WE)
    expect(out.events).toHaveLength(0)
    expect(out.skippedAllDay).toBe(1)
    expect(out.skippedRules).toBe(1)
  })

  it('expands weekly BYDAY rules inside the window, honoring UNTIL and EXDATE', () => {
    // Mon/Wed standup from May, ending Jun 24; Jun 15 (a Monday) cancelled via EXDATE
    const text = ics(
      [
        'BEGIN:VEVENT',
        'UID:weekly@x',
        'DTSTART;TZID=Asia/Kolkata:20260504T103000',
        'DTEND;TZID=Asia/Kolkata:20260504T110000',
        'RRULE:FREQ=WEEKLY;UNTIL=20260624T045959Z;BYDAY=MO,WE',
        'EXDATE;TZID=Asia/Kolkata:20260615T103000',
        'SUMMARY:Standup',
        'END:VEVENT',
      ].join('\r\n'),
    )
    const out = icsToRemoteEvents(text, 'cal', WS, WE)
    // window Jun 8–28, Mon+Wed = 8,10,15,17,22 (UNTIL 24T04:59Z ends the series
    // before the Jun 24 10:30 IST occurrence — Google's convention) minus EXDATE Jun 15 → 4
    expect(out.events).toHaveLength(4)
    expect(out.events.every((e) => e.title === 'Standup')).toBe(true)
    expect(out.events.some((e) => e.dayKey === '2026-06-15')).toBe(false)
    expect(out.events.some((e) => e.dayKey === '2026-06-10')).toBe(true)
  })

  it('RECURRENCE-ID overrides replace their occurrence (the moved instance wins)', () => {
    const text = ics(
      [
        'BEGIN:VEVENT',
        'UID:series@x',
        'DTSTART:20260608T090000Z',
        'DTEND:20260608T093000Z',
        'RRULE:FREQ=WEEKLY;BYDAY=MO',
        'SUMMARY:1:1',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:series@x',
        'RECURRENCE-ID:20260615T090000Z',
        'DTSTART:20260616T120000Z',
        'DTEND:20260616T123000Z',
        'SUMMARY:1:1 (moved)',
        'END:VEVENT',
      ].join('\r\n'),
    )
    const out = icsToRemoteEvents(text, 'cal', WS, WE)
    const mon15 = out.events.filter((e) => e.dayKey === '2026-06-15')
    expect(mon15).toHaveLength(0) // original occurrence replaced
    expect(out.events.some((e) => e.title === '1:1 (moved)' && e.dayKey === '2026-06-16')).toBe(true)
    // the other Mondays still expand
    expect(out.events.filter((e) => e.title === '1:1').length).toBeGreaterThanOrEqual(2)
  })

  it('COUNT-bound rules stop where they should', () => {
    const text = ics(
      [
        'BEGIN:VEVENT',
        'UID:count@x',
        'DTSTART:20260608T070000Z',
        'DTEND:20260608T073000Z',
        'RRULE:FREQ=DAILY;COUNT=3',
        'SUMMARY:Sprint check',
        'END:VEVENT',
      ].join('\r\n'),
    )
    const out = icsToRemoteEvents(text, 'cal', WS, WE)
    expect(out.events).toHaveLength(3)
  })

  it('cancelled events stay out', () => {
    const text = ics(
      [
        'BEGIN:VEVENT',
        'UID:c@x',
        'DTSTART:20260610T070000Z',
        'DTEND:20260610T080000Z',
        'STATUS:CANCELLED',
        'SUMMARY:Dead meeting',
        'END:VEVENT',
      ].join('\r\n'),
    )
    expect(icsToRemoteEvents(text, 'cal', WS, WE).events).toHaveLength(0)
  })

  it('parses without exploding on junk', () => {
    expect(parseIcs('not a calendar at all').events).toHaveLength(0)
  })
})
