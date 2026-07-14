/* domain/time.ts — week math + the week-offset question parser (#249 fix 2).
   Block history never expires, so "last week" must reach a real Mon–Sun
   window: these tests pin the parser's deliberately conservative vocabulary
   (unknown wording stays the live week) and the offset-aware weekKeys.
   Everything is pure — fixed strings and dates in, offsets and keys out. */

import { describe, expect, it } from 'vitest'
import { stripWeekPhrase, weekKeys, weekOffsetFromQuestion, weekOffsetLabel } from '../time'

/* Tue Jun 9 2026 — the canonical scenario week (Mon Jun 8 – Sun Jun 14). */
const TUE = new Date(2026, 5, 9, 9, 40)

describe('weekKeys', () => {
  it('gives the 7 Mon–Sun keys of the containing week', () => {
    expect(weekKeys(TUE)).toEqual([
      '2026-06-08',
      '2026-06-09',
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
    ])
  })

  it('offset 0 is the default — both spellings agree', () => {
    expect(weekKeys(TUE, 0)).toEqual(weekKeys(TUE))
  })

  it('offset -1 is the previous Mon–Sun', () => {
    expect(weekKeys(TUE, -1)).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
      '2026-06-06',
      '2026-06-07',
    ])
  })

  it('offsets cross month and year boundaries on calendar math', () => {
    expect(weekKeys(TUE, -2)[0]).toBe('2026-05-25')
    // Fri Jan 2 2026 sits in the week of Mon Dec 29 2025
    expect(weekKeys(new Date(2026, 0, 2), 0)[0]).toBe('2025-12-29')
    expect(weekKeys(new Date(2026, 0, 2), -1)).toEqual([
      '2025-12-22',
      '2025-12-23',
      '2025-12-24',
      '2025-12-25',
      '2025-12-26',
      '2025-12-27',
      '2025-12-28',
    ])
  })
})

describe('weekOffsetFromQuestion', () => {
  it('"last week" and "the past week" mean the week before', () => {
    expect(weekOffsetFromQuestion('how much time did gym take last week')).toBe(-1)
    expect(weekOffsetFromQuestion('how were my gym sessions last week?')).toBe(-1)
    expect(weekOffsetFromQuestion('i had good gym sessions in the past week, see those?')).toBe(-1)
    expect(weekOffsetFromQuestion('past week')).toBe(-1)
    expect(weekOffsetFromQuestion('what did the deck cost over the last week')).toBe(-1)
    expect(weekOffsetFromQuestion('WHAT HAPPENED LAST WEEK')).toBe(-1) // case-blind
  })

  it('counted weeks: numerals and number words, "ago" and "back"', () => {
    expect(weekOffsetFromQuestion('how much has the deck eaten two weeks ago')).toBe(-2)
    expect(weekOffsetFromQuestion('2 weeks ago')).toBe(-2)
    expect(weekOffsetFromQuestion('three weeks back')).toBe(-3)
    expect(weekOffsetFromQuestion('what took my time four weeks ago?')).toBe(-4)
    expect(weekOffsetFromQuestion('five weeks ago')).toBe(-5)
    expect(weekOffsetFromQuestion('ten weeks back')).toBe(-10)
    expect(weekOffsetFromQuestion('12 weeks ago')).toBe(-12)
  })

  it('"a/one week ago" is last week by another name', () => {
    expect(weekOffsetFromQuestion('a week ago')).toBe(-1)
    expect(weekOffsetFromQuestion('one week ago')).toBe(-1)
    expect(weekOffsetFromQuestion('1 week back')).toBe(-1)
  })

  it('"this week" and no time phrase stay 0 — the live week', () => {
    expect(weekOffsetFromQuestion('how much has spicanova eaten this week')).toBe(0)
    expect(weekOffsetFromQuestion('how much time on gym')).toBe(0)
    expect(weekOffsetFromQuestion('')).toBe(0)
  })

  it('anything else stays 0 — conservative by design', () => {
    expect(weekOffsetFromQuestion('what did I do last weekend')).toBe(0) // not "last week"
    expect(weekOffsetFromQuestion('over the past two weeks')).toBe(0) // a range, not a week
    expect(weekOffsetFromQuestion('the last few weeks were heavy')).toBe(0)
    expect(weekOffsetFromQuestion('the last week of june')).toBe(0) // a calendar week, not -1
    expect(weekOffsetFromQuestion('my weekly review')).toBe(0)
    expect(weekOffsetFromQuestion('next week')).toBe(0) // history only
    expect(weekOffsetFromQuestion('0 weeks ago')).toBe(0)
  })

  it('the first phrase wins when a question carries two', () => {
    expect(weekOffsetFromQuestion('was this week lighter than last week?')).toBe(0)
    expect(weekOffsetFromQuestion('last week vs this week')).toBe(-1)
  })
})

describe('stripWeekPhrase', () => {
  it('removes the phrase and heals spacing and punctuation', () => {
    expect(stripWeekPhrase('how much time did gym take last week?')).toBe(
      'how much time did gym take?'
    )
    expect(stripWeekPhrase('how much time on gym this week?')).toBe('how much time on gym?')
    expect(stripWeekPhrase('what did the deck cost two weeks ago')).toBe('what did the deck cost')
  })

  it('takes the leading preposition with it', () => {
    expect(stripWeekPhrase('good gym sessions in the past week, can you see those?')).toBe(
      'good gym sessions, can you see those?'
    )
  })

  it('leaves unrecognized wording untouched', () => {
    expect(stripWeekPhrase('what did I do last weekend')).toBe('what did I do last weekend')
    expect(stripWeekPhrase('how much time on gym')).toBe('how much time on gym')
  })

  it('removes every phrase, not just the first', () => {
    expect(stripWeekPhrase('gym last week vs gym this week')).toBe('gym vs gym')
  })
})

describe('weekOffsetLabel', () => {
  it('names the week the way the question asked', () => {
    expect(weekOffsetLabel(0)).toBe('this week')
    expect(weekOffsetLabel(-1)).toBe('last week')
    expect(weekOffsetLabel(-2)).toBe('two weeks ago')
    expect(weekOffsetLabel(-5)).toBe('five weeks ago')
    expect(weekOffsetLabel(-12)).toBe('12 weeks ago') // beyond spelled counts
    expect(weekOffsetLabel(1)).toBe('next week')
    expect(weekOffsetLabel(3)).toBe('in three weeks')
  })
})
