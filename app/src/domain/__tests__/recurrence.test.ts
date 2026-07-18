import { describe, expect, it } from 'vitest'
import {
  describeRrule,
  expandRrule,
  normalizeRrule,
  RRULE_DEFAULT_WEEKS,
  RRULE_HARD_CAP,
  type Rrule,
  splitSeriesFrom,
} from '../recurrence'
import { addDaysKey } from '../time'

/* RFC 5545 RRULE for user-created blocks — the pure day-key/min expander that
   execPlan turns into linked blocks (#159). Same bounded DAILY/WEEKLY walk and
   800-cap the ICS importer uses, but in the domain's own vocabulary. */

const MON = '2026-06-08' // a Monday (matches the ICS suite's window start)
const ALL = '9999-12-31' // an open window end, so the rule's own bounds decide

function dow(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(y, m - 1, d).getDay()]
}

describe('expandRrule — weekly with BYDAY', () => {
  it('places one occurrence per named weekday per week, on the right days', () => {
    // gym every Mon & Wed at 7:00–8:00 for 12 weeks → 24 blocks (2 × 12)
    const rule: Rrule = { freq: 'WEEKLY', interval: 1, byday: ['MO', 'WE'], count: 24 }
    const occ = expandRrule(rule, MON, 7 * 60, 60, MON, ALL)
    expect(occ).toHaveLength(24)
    expect(occ.every((o) => o.startMin === 420 && o.endMin === 480)).toBe(true)
    expect(occ.every((o) => dow(o.dayKey) === 'Mon' || dow(o.dayKey) === 'Wed')).toBe(true)
    // first two land on the anchor Monday and the Wednesday two days later
    expect(occ[0].dayKey).toBe('2026-06-08')
    expect(occ[1].dayKey).toBe('2026-06-10')
    // 12 of each weekday
    expect(occ.filter((o) => dow(o.dayKey) === 'Mon')).toHaveLength(12)
    expect(occ.filter((o) => dow(o.dayKey) === 'Wed')).toHaveLength(12)
  })

  it('defaults BYDAY to the anchor weekday when none is given', () => {
    const rule: Rrule = { freq: 'WEEKLY', interval: 1, count: 4 }
    const occ = expandRrule(rule, MON, 9 * 60, 30, MON, ALL)
    expect(occ).toHaveLength(4)
    expect(occ.every((o) => dow(o.dayKey) === 'Mon')).toBe(true)
    expect(occ.map((o) => o.dayKey)).toEqual([
      '2026-06-08',
      '2026-06-15',
      '2026-06-22',
      '2026-06-29',
    ])
  })

  it('honors a weekly INTERVAL (every other week)', () => {
    const rule: Rrule = { freq: 'WEEKLY', interval: 2, byday: ['MO'], count: 3 }
    const occ = expandRrule(rule, MON, 9 * 60, 60, MON, ALL)
    expect(occ.map((o) => o.dayKey)).toEqual(['2026-06-08', '2026-06-22', '2026-07-06'])
  })

  it('stops at UNTIL inclusive (end of August)', () => {
    // Mon & Wed from Jun 8 through Aug 31 (a Monday) inclusive
    const rule: Rrule = { freq: 'WEEKLY', interval: 1, byday: ['MO', 'WE'], until: '2026-08-31' }
    const occ = expandRrule(rule, MON, 7 * 60, 60, MON, ALL)
    expect(occ.some((o) => o.dayKey === '2026-08-31')).toBe(true) // Aug 31 included
    expect(occ.every((o) => o.dayKey <= '2026-08-31')).toBe(true)
    // the next Wednesday (Sep 2) is past UNTIL and must not appear
    expect(occ.some((o) => o.dayKey === '2026-09-02')).toBe(false)
  })
})

describe('expandRrule — daily', () => {
  it('places every day up to COUNT', () => {
    const rule: Rrule = { freq: 'DAILY', interval: 1, count: 3 }
    const occ = expandRrule(rule, MON, 7 * 60, 30, MON, ALL)
    expect(occ.map((o) => o.dayKey)).toEqual(['2026-06-08', '2026-06-09', '2026-06-10'])
  })

  it('honors a daily INTERVAL', () => {
    const rule: Rrule = { freq: 'DAILY', interval: 3, count: 3 }
    const occ = expandRrule(rule, MON, 7 * 60, 30, MON, ALL)
    expect(occ.map((o) => o.dayKey)).toEqual(['2026-06-08', '2026-06-11', '2026-06-14'])
  })
})

describe('expandRrule — window + bounds', () => {
  it('clips to the [from, to] window without consuming the COUNT outside it', () => {
    // a daily rule, but the window only opens on day 3
    const rule: Rrule = { freq: 'DAILY', interval: 1, count: 5 }
    const occ = expandRrule(rule, MON, 9 * 60, 60, '2026-06-10', '2026-06-12')
    // occurrences are Jun 8..12 (count 5); only 10,11,12 fall in the window
    expect(occ.map((o) => o.dayKey)).toEqual(['2026-06-10', '2026-06-11', '2026-06-12'])
  })

  it('hard-caps an open-ended rule at RRULE_HARD_CAP occurrences', () => {
    // no UNTIL, no COUNT, an effectively infinite window → bounded walk
    const rule: Rrule = { freq: 'DAILY', interval: 1 }
    const occ = expandRrule(rule, MON, 9 * 60, 60, MON, ALL)
    expect(occ).toHaveLength(RRULE_HARD_CAP)
  })

  it('caps a COUNT that exceeds the hard cap', () => {
    const rule: Rrule = { freq: 'DAILY', interval: 1, count: 5000 }
    const occ = expandRrule(rule, MON, 9 * 60, 60, MON, ALL)
    expect(occ).toHaveLength(RRULE_HARD_CAP)
  })

  it('returns nothing when the window ends before the series starts', () => {
    const rule: Rrule = { freq: 'WEEKLY', interval: 1, byday: ['MO'], count: 4 }
    const occ = expandRrule(rule, MON, 9 * 60, 60, '2026-01-01', '2026-01-31')
    expect(occ).toHaveLength(0)
  })
})

describe('normalizeRrule', () => {
  it('accepts a clean DAILY/WEEKLY shape and clamps interval to 1+', () => {
    expect(normalizeRrule({ freq: 'WEEKLY', interval: 0, byday: ['MO', 'we'] })).toEqual({
      freq: 'WEEKLY',
      interval: 1,
      byday: ['MO', 'WE'],
    })
  })

  it('lowercases freq and drops unknown weekdays', () => {
    expect(normalizeRrule({ freq: 'daily', byday: ['MO', 'XX'] })).toEqual({
      freq: 'DAILY',
      interval: 1,
      byday: ['MO'],
    })
  })

  it('rejects monthly/yearly and junk, exactly as the importer skips them', () => {
    expect(normalizeRrule({ freq: 'MONTHLY' })).toBeNull()
    expect(normalizeRrule({ freq: 'YEARLY' })).toBeNull()
    expect(normalizeRrule(null)).toBeNull()
    expect(normalizeRrule({})).toBeNull()
  })

  it('keeps a valid until and count, drops malformed ones', () => {
    expect(normalizeRrule({ freq: 'WEEKLY', until: '2026-08-31', count: 12 })).toMatchObject({
      until: '2026-08-31',
      count: 12,
    })
    const noUntil = normalizeRrule({ freq: 'WEEKLY', until: 'soon', count: 0 })
    expect(noUntil).toEqual({ freq: 'WEEKLY', interval: 1 })
  })
})

describe('describeRrule', () => {
  it('names the weekdays for a weekly rule', () => {
    expect(describeRrule({ freq: 'WEEKLY', interval: 1, byday: ['MO', 'WE'] }, MON)).toBe(
      'Mon & Wed'
    )
  })

  it('names the anchor weekday when BYDAY is absent', () => {
    expect(describeRrule({ freq: 'WEEKLY', interval: 1 }, MON)).toBe('Mon')
  })

  it('spells out a weekly interval', () => {
    expect(describeRrule({ freq: 'WEEKLY', interval: 2, byday: ['FR'] }, MON)).toBe(
      'Fri every 2 weeks'
    )
  })

  it('describes daily cadence', () => {
    expect(describeRrule({ freq: 'DAILY', interval: 1 }, MON)).toBe('every day')
    expect(describeRrule({ freq: 'DAILY', interval: 3 }, MON)).toBe('every 3 days')
  })
})

/* splitSeriesFrom — the "this & following" divide (#343). The head keeps the
   cadence but ends the day before the split; the tail carries it forward from
   the split day. Verified by expanding both halves with the same walk the store
   re-links against, so the split is proven at the occurrence level. */
describe('splitSeriesFrom — this & following', () => {
  // gym Mon & Wed, until Aug 31 — the bounded case where head+tail must partition
  const bounded: Rrule = { freq: 'WEEKLY', interval: 1, byday: ['MO', 'WE'], until: '2026-08-31' }
  const days = (r: Rrule, anchor: string) =>
    expandRrule(r, anchor, 7 * 60, 60, anchor, ALL).map((o) => o.dayKey)

  it('is null-safe for a one-off block (no rule)', () => {
    expect(splitSeriesFrom(null, MON)).toBeNull()
    expect(splitSeriesFrom(undefined, '2026-06-22')).toBeNull()
  })

  it('bounds the head the day before the split and starts the tail at it', () => {
    const split = splitSeriesFrom(bounded, '2026-06-22')! // a middle Monday
    expect(split.head.until).toBe('2026-06-21') // the day before
    expect(split.tail.until).toBe('2026-08-31') // the rule's own end rides along
    // cadence is untouched on both halves — a split never changes which days fire
    expect(split.head.byday).toEqual(['MO', 'WE'])
    expect(split.tail.byday).toEqual(['MO', 'WE'])
    expect(split.head.freq).toBe('WEEKLY')
    expect(split.tail.freq).toBe('WEEKLY')
  })

  it('head + tail exactly partition the original series (no gap, no overlap)', () => {
    const FROM = '2026-06-22'
    const full = days(bounded, MON)
    const head = days(split(bounded, FROM).head, MON) // head keeps the original anchor
    const tail = days(split(bounded, FROM).tail, FROM) // tail is anchored at the split
    expect(head.every((d) => d < FROM)).toBe(true)
    expect(tail.every((d) => d >= FROM)).toBe(true)
    expect([...head, ...tail]).toEqual(full) // union, in order, is the whole series
    expect(head.filter((d) => tail.includes(d))).toHaveLength(0) // disjoint
  })

  it('splitting at the FIRST occurrence leaves an empty head and the whole tail', () => {
    const full = days(bounded, MON)
    const s = split(bounded, MON) // MON is the anchor = first occurrence
    expect(days(s.head, MON)).toEqual([]) // nothing before the first
    expect(days(s.tail, MON)).toEqual(full) // the tail is the entire series
  })

  it('splitting at the LAST occurrence gives all-but-last as head, just it as tail', () => {
    const full = days(bounded, MON)
    const last = full[full.length - 1]
    const s = split(bounded, last)
    expect(days(s.head, MON)).toEqual(full.slice(0, -1))
    expect(days(s.tail, last)).toEqual([last])
  })

  it('splits a DAILY series at a day boundary', () => {
    const daily: Rrule = { freq: 'DAILY', interval: 1, until: '2026-06-15' }
    const s = split(daily, '2026-06-11')
    expect(days(s.head, MON)).toEqual(['2026-06-08', '2026-06-09', '2026-06-10'])
    expect(days(s.tail, '2026-06-11')).toEqual([
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
    ])
  })

  it('drops COUNT (unknowable across a split) and lets the open tail lean on the window/cap', () => {
    const counted: Rrule = { freq: 'WEEKLY', interval: 1, count: 24 } // no until → open-ended tail
    const FROM = '2026-06-22'
    const s = split(counted, FROM)
    expect(s.head.count).toBeUndefined()
    expect(s.tail.count).toBeUndefined()
    expect(s.tail.until).toBeUndefined()
    // no COUNT/UNTIL fights the caller's window: expanded across execPlan's
    // RRULE_DEFAULT_WEEKS horizon, an open weekly tail fills exactly that window
    const windowEnd = addDaysKey(FROM, RRULE_DEFAULT_WEEKS * 7)
    const tail = expandRrule(s.tail, FROM, 9 * 60, 30, FROM, windowEnd)
    expect(tail.length).toBeLessThanOrEqual(RRULE_DEFAULT_WEEKS + 1)
    expect(tail[0].dayKey).toBe(FROM)
    expect(tail.every((o) => o.dayKey <= windowEnd)).toBe(true)
    // and against an unbounded horizon the day-walk still stops at the hard cap
    const unbounded = expandRrule(s.tail, FROM, 9 * 60, 30, FROM, '9999-12-31')
    expect(unbounded.length).toBeLessThan(RRULE_HARD_CAP)
  })

  function split(r: Rrule, from: string) {
    const s = splitSeriesFrom(r, from)
    if (!s) throw new Error('expected a split')
    return s
  }
})
