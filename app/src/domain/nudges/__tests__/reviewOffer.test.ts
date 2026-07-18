import { describe, expect, it } from 'vitest'
import { REVIEW_OFFER_WEEKDAY, composeReviewOffer, shouldOfferReview } from '../review'
import type { WeeklyReview } from '../../review'
import type { Block } from '../../types'

const block = (over: Partial<Block> = {}): Block => ({
  id: Math.random().toString(36).slice(2),
  title: 'X',
  tag: 'work',
  dayKey: '2026-06-10',
  startMin: 540,
  endMin: 600,
  protected: true,
  status: 'open',
  calendarRefs: [],
  estimateSource: 'user',
  ...over,
})

const review = (mews: number, carried: number): WeeklyReview => ({
  weekKey: '2026-06-08',
  mews: Array.from({ length: mews }, () => block({ status: 'done' })),
  carried: Array.from({ length: carried }, () => block({ status: 'open' })),
  byTag: {},
  empty: mews === 0 && carried === 0,
})

const WRAP = 17 * 60 + 30

describe('shouldOfferReview', () => {
  it('fires on Friday at/after the wrap time only', () => {
    expect(shouldOfferReview(REVIEW_OFFER_WEEKDAY, WRAP, WRAP)).toBe(true)
    expect(shouldOfferReview(REVIEW_OFFER_WEEKDAY, WRAP + 60, WRAP)).toBe(true)
  })
  it('stays silent before the wrap time, and on every other day', () => {
    expect(shouldOfferReview(REVIEW_OFFER_WEEKDAY, WRAP - 1, WRAP)).toBe(false) // too early Friday
    expect(shouldOfferReview(0, WRAP + 120, WRAP)).toBe(false) // Monday
    expect(shouldOfferReview(6, WRAP + 120, WRAP)).toBe(false) // Sunday (that's the shaping ritual)
  })
})

describe('composeReviewOffer — positive voice, keyless-templated', () => {
  it('leads on the celebration and offers the carry, in the owner’s own numbers', () => {
    expect(composeReviewOffer(review(3, 2)).body).toBe(
      'friday — want your week in review? three mews to celebrate — and two things you can carry into next week if you like.'
    )
    expect(composeReviewOffer(review(1, 1)).body).toContain('one mew to celebrate')
    expect(composeReviewOffer(review(1, 1)).body).toContain('one thing you can carry')
  })

  it('still invites a warm look-back when nothing was logged done', () => {
    const body = composeReviewOffer(review(0, 2)).body
    expect(body).toContain('a whole week to look back on')
    expect(body).toContain('two things you can carry')
  })

  it('never uses shame / streak vocabulary', () => {
    for (const [m, c] of [
      [0, 0],
      [3, 2],
      [0, 4],
      [5, 0],
    ] as const) {
      const body = composeReviewOffer(review(m, c)).body
      expect(body).not.toMatch(/\b(missed|failed|behind|overdue|streak|broke|broken|fell short)\b/i)
    }
  })
})
