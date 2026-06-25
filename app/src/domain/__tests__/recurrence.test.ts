import { describe, expect, it } from 'vitest'
import {
  describeRrule,
  expandRrule,
  normalizeRrule,
  RRULE_HARD_CAP,
  type Rrule,
} from '../recurrence'

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
