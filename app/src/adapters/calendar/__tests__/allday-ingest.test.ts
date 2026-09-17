/* All-day ingest (#27): an all-day entry ARRIVES — Google date-only events are
   no longer dropped, midnight→midnight spans are no longer clamped into a
   0:00–23:59 block, a Mon–Wed OOO keeps Tuesday and Wednesday — and it lands
   on the week as a tag-neutral label that is never pushed back out. The old
   stored shape heals on load, once. Every timed instant below is built from a
   LOCAL wall-clock Date, so the suite holds in any TZ; date-only strings stay
   strings, which is the point (parsed as ISO they are UTC midnight — the
   previous day anywhere west of UTC). */

import { describe, expect, it } from 'vitest'
import { mapGoogleEvent, type GEvent } from '../googleEvent'
import { allDaySpan, midnightSpan } from '../allDay'
import { icsToRemoteEvents } from '../ics'
import { adoptOrphanedExternals, healAllDayBlocks, mergePull, planPush } from '../sync'
import type { RemoteEvent, SyncEntry } from '../types'
import type { Block, ConnectedCalendar, RoutingMatrix } from '../../../domain/types'

const CAL: ConnectedCalendar = {
  id: 'work@acme',
  name: 'Google · Work',
  who: 'live · two-way',
  provider: 'google',
  kind: 'live',
  defaultTag: 'work',
}
const W = { startKey: '2026-09-21', endKey: '2026-10-12' } // Mon + 21d
const FULL_DAY = 23 * 60 + 59
const local = (d: number, h = 0, m = 0) => new Date(2026, 8, d, h, m).toISOString() // Sep 2026

function gev(over: Partial<GEvent>): GEvent {
  return { id: 'g1', summary: 'Civic Holiday', ...over }
}

function remote(over: Partial<RemoteEvent>): RemoteEvent {
  return {
    eventId: 'civic',
    calId: CAL.id,
    title: 'Civic Holiday',
    dayKey: '2026-09-21',
    startMin: 0,
    endMin: 0,
    allDay: true,
    ...over,
  }
}

function mk(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Civic Holiday',
    tag: 'work',
    dayKey: '2026-09-21',
    startMin: 0,
    endMin: FULL_DAY,
    protected: false,
    status: 'open',
    calendarRefs: [CAL.id],
    estimateSource: 'user',
    external: { calId: CAL.id, eventId: 'civic' },
    ...over,
  }
}

describe('the shared rules', () => {
  it('allDaySpan: a zero clock span, endDayKey only for a real multi-day span', () => {
    expect(allDaySpan('2026-09-21', '2026-09-21')).toEqual({
      dayKey: '2026-09-21',
      startMin: 0,
      endMin: 0,
      allDay: true,
    })
    expect(allDaySpan('2026-09-21', '2026-09-23').endDayKey).toBe('2026-09-23')
  })

  it('midnightSpan: only local midnight → a LATER midnight qualifies; the end is exclusive', () => {
    expect(
      midnightSpan({ dayKey: '2026-09-21', min: 0 }, { dayKey: '2026-09-22', min: 0 })
    ).toEqual({ firstKey: '2026-09-21', lastKey: '2026-09-21' })
    expect(
      midnightSpan({ dayKey: '2026-09-21', min: 0 }, { dayKey: '2026-09-24', min: 0 })
    ).toEqual({ firstKey: '2026-09-21', lastKey: '2026-09-23' })
    expect(
      midnightSpan({ dayKey: '2026-09-21', min: 0 }, { dayKey: '2026-09-21', min: 0 })
    ).toBeNull()
    expect(
      midnightSpan({ dayKey: '2026-09-21', min: 0 }, { dayKey: '2026-09-22', min: 720 })
    ).toBeNull()
    expect(
      midnightSpan({ dayKey: '2026-09-21', min: 60 }, { dayKey: '2026-09-22', min: 0 })
    ).toBeNull()
  })
})

describe('Google: all-day events arrive (no longer dropped, no longer clamped)', () => {
  it('a date-only holiday arrives as an all-day entry keyed by its DATE string', () => {
    const ev = mapGoogleEvent(
      gev({ start: { date: '2026-09-21' }, end: { date: '2026-09-22' } }),
      CAL.id
    )
    expect(ev).toEqual({
      eventId: 'g1',
      calId: CAL.id,
      title: 'Civic Holiday',
      mewBlockId: undefined,
      dayKey: '2026-09-21',
      startMin: 0,
      endMin: 0,
      allDay: true,
    })
  })

  it('a date-only OOO keeps every day: end.date is exclusive (Mon–Thu ⇒ last day Wed)', () => {
    const ev = mapGoogleEvent(
      gev({ start: { date: '2026-09-21' }, end: { date: '2026-09-24' } }),
      CAL.id
    )
    expect(ev).toMatchObject({ dayKey: '2026-09-21', endDayKey: '2026-09-23', allDay: true })
  })

  it('a missing, malformed or non-later end.date covers the start day alone', () => {
    for (const end of [undefined, { date: 'soon' }, { date: '2026-09-21' }]) {
      const ev = mapGoogleEvent(gev({ start: { date: '2026-09-21' }, end }), CAL.id)
      expect(ev).toMatchObject({ dayKey: '2026-09-21', allDay: true })
      expect(ev?.endDayKey).toBeUndefined()
    }
  })

  it('month and year boundaries walk by calendar date', () => {
    expect(
      mapGoogleEvent(gev({ start: { date: '2026-12-31' }, end: { date: '2027-01-02' } }), CAL.id)
    ).toMatchObject({ dayKey: '2026-12-31', endDayKey: '2027-01-01' })
  })

  it('a malformed start date, a cancelled event, or no start at all is skipped', () => {
    expect(mapGoogleEvent(gev({ start: { date: 'Sept 21' } }), CAL.id)).toBeNull()
    expect(
      mapGoogleEvent(gev({ status: 'cancelled', start: { date: '2026-09-21' } }), CAL.id)
    ).toBeNull()
    expect(mapGoogleEvent(gev({}), CAL.id)).toBeNull()
    expect(mapGoogleEvent(gev({ start: { dateTime: local(21, 9) } }), CAL.id)).toBeNull()
  })

  it("a timed T00:00 → next-day T00:00 event is all-day — the owner's Civic Holiday shape", () => {
    const ev = mapGoogleEvent(
      gev({ start: { dateTime: local(21) }, end: { dateTime: local(22) } }),
      CAL.id
    )
    expect(ev).toMatchObject({ dayKey: '2026-09-21', startMin: 0, endMin: 0, allDay: true })
    expect(ev?.endDayKey).toBeUndefined()
  })

  it('a timed midnight Mon → midnight Thu OOO is one all-day span through Wednesday', () => {
    const ev = mapGoogleEvent(
      gev({ summary: 'OOO', start: { dateTime: local(21) }, end: { dateTime: local(24) } }),
      CAL.id
    )
    expect(ev).toMatchObject({ dayKey: '2026-09-21', endDayKey: '2026-09-23', allDay: true })
  })

  it("timed events keep today's behaviour: exact same-day span, other multi-day spans clamp", () => {
    expect(
      mapGoogleEvent(
        gev({ start: { dateTime: local(21, 9, 30) }, end: { dateTime: local(21, 10) } }),
        CAL.id
      )
    ).toMatchObject({ dayKey: '2026-09-21', startMin: 570, endMin: 600 })
    const overnight = mapGoogleEvent(
      gev({ start: { dateTime: local(21, 22) }, end: { dateTime: local(22, 2) } }),
      CAL.id
    )
    expect(overnight).toMatchObject({ dayKey: '2026-09-21', startMin: 1320, endMin: FULL_DAY })
    expect(overnight?.allDay).toBeUndefined()
  })

  it("MEW's own pushed event keeps its marker (loop prevention still sees it)", () => {
    const ev = mapGoogleEvent(
      gev({
        start: { dateTime: local(21, 9) },
        end: { dateTime: local(21, 10) },
        extendedProperties: { private: { mewBlockId: 'b1' } },
      }),
      CAL.id
    )
    expect(ev?.mewBlockId).toBe('b1')
  })
})

describe('ICS: VALUE=DATE and midnight spans arrive as all-day entries', () => {
  const WS = new Date(2026, 8, 21)
  const WE = new Date(2026, 9, 12)
  const ics = (body: string[]) =>
    ['BEGIN:VCALENDAR', 'X-WR-CALNAME:holidays', ...body, 'END:VCALENDAR'].join('\r\n')
  const vevent = (lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']

  it('a multi-day VALUE=DATE span keeps every day (DTEND exclusive); no DTEND = one day', () => {
    const out = icsToRemoteEvents(
      ics([
        ...vevent([
          'UID:ooo',
          'DTSTART;VALUE=DATE:20260921',
          'DTEND;VALUE=DATE:20260924',
          'SUMMARY:OOO',
        ]),
        ...vevent(['UID:bday', 'DTSTART;VALUE=DATE:20260925', 'SUMMARY:Birthday']),
      ]),
      'hol',
      WS,
      WE
    )
    expect(out.events).toEqual([
      {
        eventId: 'ooo',
        calId: 'hol',
        title: 'OOO',
        dayKey: '2026-09-21',
        startMin: 0,
        endMin: 0,
        allDay: true,
        endDayKey: '2026-09-23',
      },
      {
        eventId: 'bday',
        calId: 'hol',
        title: 'Birthday',
        dayKey: '2026-09-25',
        startMin: 0,
        endMin: 0,
        allDay: true,
      },
    ])
  })

  it('a span that began before the window still arrives; one wholly before it does not', () => {
    const out = icsToRemoteEvents(
      ics([
        ...vevent([
          'UID:into',
          'DTSTART;VALUE=DATE:20260918',
          'DTEND;VALUE=DATE:20260923',
          'SUMMARY:Trip',
        ]),
        ...vevent([
          'UID:past',
          'DTSTART;VALUE=DATE:20260918',
          'DTEND;VALUE=DATE:20260921',
          'SUMMARY:Gone',
        ]),
      ]),
      'hol',
      WS,
      WE
    )
    expect(out.events.map((e) => [e.eventId, e.dayKey, e.endDayKey])).toEqual([
      ['into', '2026-09-18', '2026-09-22'],
    ])
  })

  it('a weekly all-day rule expands to all-day occurrences, honouring EXDATE', () => {
    const out = icsToRemoteEvents(
      ics(
        vevent([
          'UID:wfh',
          'DTSTART;VALUE=DATE:20260925',
          'DTEND;VALUE=DATE:20260926',
          'RRULE:FREQ=WEEKLY;COUNT=3',
          'EXDATE;VALUE=DATE:20261002',
          'SUMMARY:WFH Friday',
        ])
      ),
      'hol',
      WS,
      WE
    )
    expect(out.events.map((e) => [e.dayKey, e.allDay])).toEqual([
      ['2026-09-25', true],
      ['2026-10-09', true],
    ])
  })

  it('a timed midnight→midnight VEVENT is all-day; an overnight one keeps the clamp', () => {
    const at = (d: number, h = 0) => {
      const x = new Date(2026, 8, d, h)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${x.getUTCFullYear()}${p(x.getUTCMonth() + 1)}${p(x.getUTCDate())}T${p(x.getUTCHours())}${p(x.getUTCMinutes())}00Z`
    }
    const out = icsToRemoteEvents(
      ics([
        ...vevent(['UID:civic', `DTSTART:${at(21)}`, `DTEND:${at(23)}`, 'SUMMARY:Civic Holiday']),
        ...vevent(['UID:late', `DTSTART:${at(24, 22)}`, `DTEND:${at(25, 1)}`, 'SUMMARY:Deploy']),
      ]),
      'hol',
      WS,
      WE
    )
    expect(out.events[0]).toMatchObject({
      dayKey: '2026-09-21',
      endDayKey: '2026-09-22',
      allDay: true,
    })
    expect(out.events[1]).toMatchObject({ dayKey: '2026-09-24', startMin: 1320, endMin: FULL_DAY })
    expect(out.events[1].allDay).toBeUndefined()
  })
})

describe('mergePull: an all-day label lands tag-neutral, at a zero span', () => {
  it('a new all-day event becomes an external all-day block — not the calendar default tag', () => {
    const r = mergePull([], [remote({ endDayKey: '2026-09-23' })], [CAL], W)
    expect(r.added).toBe(1)
    expect(r.blocks[0]).toMatchObject({
      title: 'Civic Holiday',
      tag: 'private',
      dayKey: '2026-09-21',
      endDayKey: '2026-09-23',
      startMin: 0,
      endMin: 0,
      allDay: true,
      protected: false,
      external: { calId: CAL.id, eventId: 'civic' },
    })
  })

  it('whatever clock span the wire carried, an all-day block stores a zero span', () => {
    const r = mergePull([], [remote({ startMin: 0, endMin: FULL_DAY })], [CAL], W)
    expect(r.blocks[0]).toMatchObject({ startMin: 0, endMin: 0, allDay: true })
    // …and re-pulling the same listing plans no churn
    expect(mergePull(r.blocks, [remote({})], [CAL], W).updated).toBe(0)
  })

  it('an OOO that grows a day updates its span; one that shrinks drops endDayKey', () => {
    const first = mergePull([], [remote({ endDayKey: '2026-09-22' })], [CAL], W).blocks
    const grown = mergePull(first, [remote({ endDayKey: '2026-09-23' })], [CAL], W)
    expect(grown.updated).toBe(1)
    expect(grown.blocks[0].endDayKey).toBe('2026-09-23')
    const shrunk = mergePull(grown.blocks, [remote({})], [CAL], W)
    expect(shrunk.updated).toBe(1)
    expect(shrunk.blocks[0]).not.toHaveProperty('endDayKey')
  })

  it('a timed event re-authored as all-day flips kind and turns tag-neutral', () => {
    const timed = mergePull(
      [],
      [remote({ allDay: undefined, startMin: 540, endMin: 600 })],
      [CAL],
      W
    )
    expect(timed.blocks[0]).toMatchObject({ tag: 'work', startMin: 540 })
    const flipped = mergePull(timed.blocks, [remote({})], [CAL], W)
    expect(flipped.updated).toBe(1)
    expect(flipped.blocks[0]).toMatchObject({
      tag: 'private',
      startMin: 0,
      endMin: 0,
      allDay: true,
    })
    expect(flipped.blocks[0].id).toBe(timed.blocks[0].id)
  })

  it('an all-day block the calendar now calls timed takes its default tag back and a timed verdict', () => {
    const allDay = mergePull([], [remote({ endDayKey: '2026-09-22' })], [CAL], W).blocks
    const back = mergePull(
      allDay,
      [remote({ allDay: undefined, startMin: 540, endMin: 600 })],
      [CAL],
      W
    )
    expect(back.blocks[0]).toMatchObject({ tag: 'work', startMin: 540, endMin: 600, allDay: false })
    expect(back.blocks[0]).not.toHaveProperty('endDayKey')
  })

  it('a timed event in the legacy 0:00–23:59 shape carries allDay: false — the heal never touches it', () => {
    const r = mergePull(
      [],
      [remote({ allDay: undefined, startMin: 0, endMin: FULL_DAY })],
      [CAL],
      W
    )
    expect(r.blocks[0]).toMatchObject({ startMin: 0, endMin: FULL_DAY, allDay: false, tag: 'work' })
    expect(healAllDayBlocks(r.blocks).healed).toBe(0)
  })

  it('an ordinary timed event carries no kind fields at all (stored shape unchanged)', () => {
    const r = mergePull([], [remote({ allDay: undefined, startMin: 540, endMin: 600 })], [CAL], W)
    expect(r.blocks[0]).not.toHaveProperty('allDay')
    expect(r.blocks[0]).not.toHaveProperty('endDayKey')
  })

  it('a deleted span that began before the window is removed, not stranded', () => {
    const trip = mk({
      dayKey: '2026-09-18',
      endDayKey: '2026-09-22',
      startMin: 0,
      endMin: 0,
      allDay: true,
    })
    const before = mk({ id: 'before', dayKey: '2026-09-18', startMin: 540, endMin: 600 })
    const r = mergePull([trip, before], [], [CAL], W)
    expect(r.removed).toBe(1)
    expect(r.blocks.map((b) => b.id)).toEqual(['before']) // a timed block before the window is kept, as ever
  })
})

describe('the load heal: stored 0:00–23:59 externals become the labels they always were', () => {
  it('heals an external legacy full-day block into a tag-neutral zero-span all-day block', () => {
    const stored = mk({ id: 'civic' })
    const { blocks, healed } = healAllDayBlocks([stored])
    expect(healed).toBe(1)
    expect(blocks[0]).toEqual({ ...stored, tag: 'private', startMin: 0, endMin: 0, allDay: true })
  })

  it('once: never a native block, never a classified one, never another span', () => {
    const untouched = [
      mk({ id: 'native', external: undefined }),
      mk({ id: 'verdict', allDay: false }),
      mk({ id: 'healed', allDay: true, startMin: 0, endMin: 0 }),
      mk({ id: 'late', startMin: 60 }),
      mk({ id: 'short', endMin: 23 * 60 }),
    ]
    const r = healAllDayBlocks(untouched)
    expect(r.healed).toBe(0)
    expect(r.blocks).toBe(untouched) // same array back — no phantom persistence churn
  })

  it('is idempotent: a healed week heals nothing more', () => {
    const once = healAllDayBlocks([mk({})])
    expect(healAllDayBlocks(once.blocks).healed).toBe(0)
  })

  it('a healed block the calendar confirms all-day stays put; one it calls timed never re-heals', () => {
    const healed = healAllDayBlocks([mk({})]).blocks
    const confirmed = mergePull(healed, [remote({})], [CAL], W)
    expect(confirmed.updated).toBe(0)
    const timed = mergePull(
      healed,
      [remote({ allDay: undefined, startMin: 0, endMin: FULL_DAY })],
      [CAL],
      W
    )
    expect(timed.blocks[0]).toMatchObject({
      startMin: 0,
      endMin: FULL_DAY,
      allDay: false,
      tag: 'work',
    })
    expect(healAllDayBlocks(timed.blocks).healed).toBe(0)
  })
})

describe('never pushed: an all-day entry never leaves MEW', () => {
  const matrix: RoutingMatrix = {
    [CAL.id]: { work: 'details', private: 'details', health: 'details' },
  }

  it('an all-day label adopted as native (its calendar gone) plans no push', () => {
    const label = mk({ tag: 'private', startMin: 0, endMin: 0, allDay: true })
    const { blocks } = adoptOrphanedExternals([label], [])
    expect(blocks[0].external).toBeUndefined()
    expect(planPush(blocks, matrix, [CAL], W, []).ops).toEqual([])
  })

  it('heal-then-adopt (the hydrate order) keeps a legacy orphan out of the calendar', () => {
    const healed = healAllDayBlocks([mk({})])
    const { blocks } = adoptOrphanedExternals(healed.blocks, [])
    expect(planPush(blocks, matrix, [CAL], W, []).ops).toEqual([])
    // the control: adopting first would have pushed a 24h timed event out
    const wrongOrder = adoptOrphanedExternals([mk({})], []).blocks
    expect(planPush(wrongOrder, matrix, [CAL], W, []).ops.map((o) => o.kind)).toEqual(['create'])
  })

  it('a ledger entry for a block that is all-day now plans a delete, never an update', () => {
    const label = mk({
      id: 'b1',
      tag: 'private',
      external: undefined,
      startMin: 0,
      endMin: 0,
      allDay: true,
    })
    const ledger: SyncEntry[] = [
      { id: `b1:${CAL.id}`, blockId: 'b1', calId: CAL.id, eventId: 'g-1', hash: 'x' },
    ]
    expect(planPush([label], matrix, [CAL], W, ledger).ops).toEqual([
      { kind: 'delete', calId: CAL.id, blockId: 'b1', eventId: 'g-1' },
    ])
  })
})
