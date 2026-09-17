/* The history question's stretch of time (#8), pinned as a phrasing → range
   table: the pre-#8 week phrasings answer byte-identically; multi-week, month,
   year and day spans; "since <date>" in every date shape, including a future
   one; "between"/"from … to" in either order; month and year boundaries (and a
   leap day); the one-year cap; and garbage that never guesses. Today is a
   Thursday unless a case says otherwise. */

import { describe, expect, it } from 'vitest'
import {
  addDaysKey,
  fromDayKey,
  stripWeekPhrase,
  weekKeys,
  weekOffsetFromQuestion,
  weekOffsetLabel,
} from '../time'
import {
  RANGE_CAP_DAYS,
  rangeDayKeys,
  rangeFromQuestion,
  readRange,
  stripRangePhrase,
} from '../timeRange'

const THU = '2026-09-17'

/** [from, to, label] — the shape every table row compares */
const span = (q: string, today = THU) => {
  const r = rangeFromQuestion(q, today)
  return [r.fromDayKey, r.toDayKey, r.label]
}

describe('the pre-#8 phrasings answer exactly as before', () => {
  const OLD = [
    'how much time did gym take last week',
    'how were my gym sessions last week?',
    'i had good gym sessions in the past week, see those?',
    'past week',
    'what did the deck cost over the last week',
    'WHAT HAPPENED LAST WEEK',
    'how much has the deck eaten two weeks ago',
    '2 weeks ago',
    'three weeks back',
    'what took my time four weeks ago?',
    '12 weeks ago',
    'a week ago',
    '1 week back',
    'how much has spicanova eaten this week',
    'how much time on gym',
    '',
    'what did I do last weekend',
    'the last week of june',
    'my weekly review',
    'next week',
    '0 weeks ago',
    'was this week lighter than last week?',
    'last week vs this week',
  ]

  it('each one is its Mon–Sun week, its old label, and its old stripped subject', () => {
    const got = OLD.map((q) => ({ q, ...readRange(q, THU) }))
    const want = OLD.map((q) => {
      const offset = weekOffsetFromQuestion(q)
      const days = weekKeys(fromDayKey(THU), offset)
      return {
        q,
        range: {
          fromDayKey: days[0],
          toDayKey: days[6],
          label: weekOffsetLabel(offset),
          kind: 'week',
          weekOffset: offset,
          capped: false,
          future: false,
        },
        rest: stripWeekPhrase(q),
      }
    })
    expect(got).toEqual(want)
  })

  it('spot checks: last week is Sep 7–13, two weeks ago Aug 31–Sep 6, this week runs to Sunday', () => {
    expect(span('how much time did gym take last week')).toEqual([
      '2026-09-07',
      '2026-09-13',
      'last week',
    ])
    expect(span('two weeks ago')).toEqual(['2026-08-31', '2026-09-06', 'two weeks ago'])
    expect(span('how much time on gym')).toEqual(['2026-09-14', '2026-09-20', 'this week'])
  })
})

describe('spans: the last N, months, years, single days', () => {
  it.each([
    [
      'how were my gym sessions over the last 3 weeks?',
      '2026-08-28',
      '2026-09-17',
      'the last three weeks',
    ],
    ['over the past two weeks', '2026-09-04', '2026-09-17', 'the last two weeks'],
    ['the last few weeks were heavy', '2026-08-28', '2026-09-17', 'the last three weeks'],
    ['the past couple of weeks', '2026-09-04', '2026-09-17', 'the last two weeks'],
    ['in the last 10 days', '2026-09-08', '2026-09-17', 'the last ten days'],
    ['the past 14 days', '2026-09-04', '2026-09-17', 'the last 14 days'],
    ['the previous 1 day', '2026-09-17', '2026-09-17', 'the last one day'],
    ['the past 3 months', '2026-06-18', '2026-09-17', 'the last three months'],
    ['gym this month', '2026-09-01', '2026-09-30', 'this month'],
    ['gym last month', '2026-08-01', '2026-08-31', 'last month'],
    ['this year', '2026-01-01', '2026-12-31', 'this year'],
    ['during last year', '2025-01-01', '2025-12-31', 'last year'],
    ['in August', '2026-08-01', '2026-08-31', 'in August'],
    ['in September', '2026-09-01', '2026-09-30', 'in September'],
    ['during October', '2025-10-01', '2025-10-31', 'in October 2025'], // the latest October begun
    ['throughout March 2025', '2025-03-01', '2025-03-31', 'in March 2025'],
    ['in 2025', '2025-01-01', '2025-12-31', 'in 2025'],
    ['yesterday', '2026-09-16', '2026-09-16', 'yesterday'],
    ['what did I get done today?', '2026-09-17', '2026-09-17', 'today'],
  ])('%s', (q, from, to, label) => {
    const r = rangeFromQuestion(q, THU)
    expect([r.fromDayKey, r.toDayKey, r.label]).toEqual([from, to, label])
    expect(r.kind).toBe('days')
    expect(r.capped || r.future).toBe(false)
  })
})

describe('since <date> — every date shape, through today', () => {
  it.each([
    ['how much gym since August 1', '2026-08-01', 'since Aug 1'],
    ['since Aug. 1st', '2026-08-01', 'since Aug 1'],
    ['since 1 August 2026', '2026-08-01', 'since Aug 1'],
    ['since the 3rd of September', '2026-09-03', 'since Sep 3'],
    ['since 2026-08-15', '2026-08-15', 'since Aug 15'],
    ['since August', '2026-08-01', 'since Aug 1'],
    ['since Monday', '2026-09-14', 'since Sep 14'],
    ['since Thursday', '2026-09-10', 'since Sep 10'], // today is Thursday: the one before
    ['since yesterday', '2026-09-16', 'since Sep 16'],
    ['since today', '2026-09-17', 'since Sep 17'],
    ['since last week', '2026-09-07', 'since Sep 7'],
    ['since last month', '2026-08-01', 'since Aug 1'],
    ['since last year', '2025-09-17', 'since Jan 1, 2025'], // capped: see below
    ['since 2 weeks ago', '2026-09-03', 'since Sep 3'],
    ['since three days ago', '2026-09-14', 'since Sep 14'],
    ['since 2 months ago', '2026-07-17', 'since Jul 17'],
    ['since a year ago', '2025-09-17', 'since Sep 17, 2025'],
    ['since December 2025', '2025-12-01', 'since Dec 1, 2025'],
    ['since the 20th', '2026-08-20', 'since Aug 20'], // Sep 20 hasn't come yet
    ['since the 31st', '2026-08-31', 'since Aug 31'], // September has no 31st
    ['since October 5', '2025-10-05', 'since Oct 5, 2025'], // no year: its latest occurrence
  ])('%s', (q, from, label) => {
    const r = rangeFromQuestion(q, THU)
    expect([r.fromDayKey, r.toDayKey, r.label]).toEqual([from, THU, label])
    expect(r.future).toBe(false)
  })

  it('a date still ahead is future — whatever its shape', () => {
    for (const q of ['since October 5, 2027', 'since 2026-09-18', 'since Jan 1 2030']) {
      const r = rangeFromQuestion(q, THU)
      expect(r.future).toBe(true)
      expect(r.fromDayKey > THU).toBe(true)
      expect(rangeDayKeys(r)).toEqual([]) // nothing to sum
    }
    expect(rangeFromQuestion('since October 5, 2027', THU).label).toBe('since Oct 5, 2027')
  })
})

describe('between / from … to — inclusive, either order', () => {
  it.each([
    ['between Aug 3 and Aug 17', '2026-08-03', '2026-08-17', 'from Aug 3 to Aug 17'],
    ['from August 3 to August 17', '2026-08-03', '2026-08-17', 'from Aug 3 to Aug 17'],
    ['between Aug 17 and Aug 3', '2026-08-03', '2026-08-17', 'from Aug 3 to Aug 17'],
    ['from the 3rd of August until now', '2026-08-03', '2026-09-17', 'from Aug 3 to Sep 17'],
    ['between June and August', '2026-06-01', '2026-08-31', 'from Jun 1 to Aug 31'],
    ['from 2026-09-01 through 2026-09-01', '2026-09-01', '2026-09-01', 'on Sep 1'],
    ['between last month and today', '2026-08-01', '2026-09-17', 'from Aug 1 to Sep 17'],
  ])('%s', (q, from, to, label) => {
    expect(span(q)).toEqual([from, to, label])
  })
})

describe('month and year boundaries', () => {
  const TUE_JAN5 = '2027-01-05'

  it('asked on Jan 5: last month is December, "since December 28" and the last 2 weeks cross the year', () => {
    expect(span('last month', TUE_JAN5)).toEqual(['2026-12-01', '2026-12-31', 'last month'])
    expect(span('this month', TUE_JAN5)).toEqual(['2027-01-01', '2027-01-31', 'this month'])
    expect(span('since December 28', TUE_JAN5)).toEqual([
      '2026-12-28',
      TUE_JAN5,
      'since Dec 28, 2026',
    ])
    expect(span('the last 2 weeks', TUE_JAN5)).toEqual([
      '2026-12-23',
      TUE_JAN5,
      'the last two weeks',
    ])
    expect(span('between Dec 20 and Jan 3', TUE_JAN5)).toEqual([
      '2026-12-20',
      '2027-01-03',
      'from Dec 20, 2026 to Jan 3',
    ])
    expect(span('in December', TUE_JAN5)).toEqual(['2026-12-01', '2026-12-31', 'in December 2026'])
    expect(span('last year', TUE_JAN5)).toEqual(['2026-01-01', '2026-12-31', 'last year'])
  })

  it('whole months across New Year: "between November and February" asked in December is last winter', () => {
    expect(span('between November and February', '2026-12-10')).toEqual([
      '2025-11-01',
      '2026-02-28',
      'from Nov 1, 2025 to Feb 28',
    ])
  })

  it('a span that crosses New Year reads last winter, not a year the wrong way round', () => {
    // asked Dec 25: Dec 20 this year is after Jan 5 this year — the tighter reading wins
    expect(span('between Dec 20 and Jan 5', '2026-12-25')).toEqual([
      '2025-12-20',
      '2026-01-05',
      'from Dec 20, 2025 to Jan 5',
    ])
  })

  it('February: short months, and a leap day found in its own year', () => {
    expect(span('last month', '2026-03-01')).toEqual(['2026-02-01', '2026-02-28', 'last month'])
    expect(span('since Feb 29', '2028-03-10')).toEqual(['2028-02-29', '2028-03-10', 'since Feb 29'])
    const back = rangeFromQuestion('since Feb 29', THU) // 2024's, then kept to a year
    expect(back.label).toBe('since Feb 29, 2024')
    expect(back.capped).toBe(true)
  })
})

describe('the cap — a year at most, said plainly', () => {
  it('a longer stretch keeps its most recent year', () => {
    const r = rangeFromQuestion('how much gym since 2019-01-01', THU)
    expect(r.capped).toBe(true)
    expect(r.label).toBe('since Jan 1, 2019')
    expect(r.toDayKey).toBe(THU)
    expect(r.fromDayKey).toBe(addDaysKey(THU, -(RANGE_CAP_DAYS - 1)))
    expect(rangeDayKeys(r)).toHaveLength(RANGE_CAP_DAYS)
    expect(rangeFromQuestion('the last 18 months', THU).capped).toBe(true)
  })

  it('a whole year — even a leap year — fits', () => {
    expect(rangeFromQuestion('this year', THU).capped).toBe(false)
    const leap = rangeFromQuestion('this year', '2028-12-31')
    expect(leap.capped).toBe(false)
    expect(rangeDayKeys(leap)).toHaveLength(366)
  })
})

describe('garbage never guesses — it falls through to the week grammar', () => {
  it.each([
    'how much gym since blorp',
    'since 2026-13-45',
    'since Feb 30',
    'between foo and bar',
    'the last 0 weeks',
    'the last -3 weeks',
    "today's deck",
    'in smarch',
    'since 3',
    'since the 45th',
  ])('%s', (q) => {
    const { range, rest } = readRange(q, THU)
    expect(range.kind).toBe('week')
    expect(range.label).toBe('this week')
    expect(rest).toBe(stripWeekPhrase(q))
  })
})

describe('stripRangePhrase — the subject survives, the stretch goes', () => {
  it('removes the phrase with its preposition and heals the sentence', () => {
    expect(stripRangePhrase('how much has spicanova eaten since August 1?', THU)).toBe(
      'how much has spicanova eaten?'
    )
    expect(
      stripRangePhrase('gym sessions over the last three weeks, can you see those?', THU)
    ).toBe('gym sessions, can you see those?')
    expect(stripRangePhrase('between Aug 3 and Aug 17 how much gym', THU)).toBe('how much gym')
    expect(stripRangePhrase('gym since August 1 vs gym last week', THU)).toBe('gym vs gym')
  })
})

describe('rangeDayKeys', () => {
  it('every day, contiguous, across a month edge and a DST change', () => {
    const three = rangeDayKeys(rangeFromQuestion('the last 3 weeks', THU))
    expect(three).toHaveLength(21)
    expect([three[0], three[20]]).toEqual(['2026-08-28', THU])
    const march = rangeDayKeys(rangeFromQuestion('between March 1 and March 15', THU))
    expect(march).toHaveLength(15)
    expect(march.every((k, i) => i === 0 || addDaysKey(march[i - 1], 1) === k)).toBe(true)
  })
})
