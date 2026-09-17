/* The dial's all-day badges (#27), pinned as pure logic the way dialNav pins
   the arcs: an all-day entry never rides the ring and never takes the centre
   (the "Finish Civic Holiday. 573:04" regression), today's badges include every
   span covering today, a crowded day folds to "+N more", a badge's spoken name
   reads the day (never a clock span), and the arrows walk badges and arcs as
   one reading order — with no badges, exactly as before. No DOM, no store. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../../../domain/types'
import { liveNow } from '../../../domain/liveNow'
import {
  BADGE_MAX,
  badgeAriaLabel,
  badgeRow,
  dialBadges,
  dialFocusOrder,
  isBadge,
  radiiFor,
  stepDialFocus,
  visibleOrbit,
} from '../orbitGeometry'

const TODAY = '2026-09-24' // a Thursday
const FULL_DAY = 23 * 60 + 59

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'X',
    tag: 'work',
    dayKey: TODAY,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/** The owner's holiday in its most hostile shape: tagged work, 0:00–23:59. */
const holiday = (over: Partial<Block> = {}): Block =>
  mk({
    id: 'civic',
    title: 'Civic Holiday',
    startMin: 0,
    endMin: FULL_DAY,
    protected: false,
    external: { calId: 'work@acme', eventId: 'civic' },
    allDay: true,
    ...over,
  })

describe('never a wedge, never the countdown', () => {
  it('visibleOrbit keeps every all-day entry off the ring; dialBadges wears it', () => {
    const deck = mk({ id: 'deck' })
    const blocks = [holiday(), deck]
    expect(visibleOrbit(blocks, TODAY, 9.5).map((b) => b.id)).toEqual(['deck'])
    expect(dialBadges(blocks, TODAY).map((b) => b.id)).toEqual(['civic'])
  })

  it('liveNow never makes it current — at 10:26 the centre is not "Finish Civic Holiday"', () => {
    const at = liveNow([holiday()], TODAY, 10 * 60 + 26)
    expect(at.current).toBeUndefined()
    expect(at.minutesLeft).toBeUndefined()
    expect(at.headline).not.toMatch(/civic holiday/i)
    // the control: the same event without the flag is the owner's live bug
    const { allDay: _flag, ...legacy } = holiday()
    expect(liveNow([legacy], TODAY, 10 * 60 + 26).headline).toBe('Finish Civic Holiday.')
  })
})

describe('dialBadges — every entry covering today', () => {
  it('a span that started yesterday and runs past today wears today’s badge; other days do not', () => {
    const ooo = holiday({ id: 'ooo', title: 'OOO', dayKey: '2026-09-23', endDayKey: '2026-09-25' })
    const tomorrow = holiday({ id: 'bday', title: 'Birthday', dayKey: '2026-09-25' })
    const rolled = holiday({ id: 'old', status: 'rolled' })
    expect(dialBadges([ooo, tomorrow, rolled, holiday()], TODAY).map((b) => b.id)).toEqual([
      'ooo',
      'civic',
    ])
  })

  it('no all-day entries, no badges', () => {
    expect(dialBadges([mk({})], TODAY)).toEqual([])
  })
})

describe('badgeRow — up to three, then "+N more"', () => {
  const four = ['a', 'b', 'c', 'd'].map((id) => holiday({ id, title: id }))

  it(`up to BADGE_MAX (${BADGE_MAX}) all show`, () => {
    expect(badgeRow(four.slice(0, 3), false)).toEqual({ shown: four.slice(0, 3), more: 0 })
  })

  it('past it: the first two show and the third slot says how many more', () => {
    const row = badgeRow(four, false)
    expect(row.shown.map((b) => b.id)).toEqual(['a', 'b'])
    expect(row.more).toBe(2)
  })

  it('opened, every badge shows', () => {
    expect(badgeRow(four, true)).toEqual({ shown: four, more: 0 })
  })
})

describe('badgeAriaLabel — a day, never a clock span', () => {
  it('a calendar holiday, a span through a later day, a done label MEW owns', () => {
    expect(badgeAriaLabel(holiday(), TODAY)).toBe('Civic Holiday · all day · calendar')
    expect(
      badgeAriaLabel(holiday({ title: 'OOO — offsite', endDayKey: '2026-09-26' }), TODAY)
    ).toBe('OOO · all day, through saturday · calendar')
    expect(
      badgeAriaLabel(holiday({ title: 'Birthday', external: undefined, status: 'done' }), TODAY)
    ).toBe('Birthday · all day · day label, done')
  })

  it('a span ending today says no "through"', () => {
    expect(badgeAriaLabel(holiday({ dayKey: '2026-09-22', endDayKey: TODAY }), TODAY)).toBe(
      'Civic Holiday · all day · calendar'
    )
  })
})

describe('isBadge — what lights the whole ring', () => {
  it('only an id naming one of today’s badges', () => {
    const badges = [holiday()]
    expect(isBadge(badges, 'civic')).toBe(true)
    expect(isBadge(badges, 'deck')).toBe(false)
    expect(isBadge(badges, null)).toBe(false)
  })
})

describe('stepDialFocus — badges and arcs walk as one reading order', () => {
  const a9 = mk({ id: 'a9', startMin: 9 * 60, endMin: 10 * 60 })
  const a14 = mk({ id: 'a14', startMin: 14 * 60, endMin: 15 * 60 })
  const vis = [a9, a14]
  const radii = radiiFor(vis, null, 9)
  const badgeIds = ['ooo', 'civic']

  it('with no badges the walk is exactly the arcs’ (unchanged contract)', () => {
    expect(stepDialFocus(vis, radii, 'a9', 'time', 1)).toBe('a14')
    expect(stepDialFocus(vis, radii, 'a14', 'time', 1)).toBe('a9')
    expect(stepDialFocus([a9], radii, 'a9', 'time', 1)).toBe('a9')
    expect(stepDialFocus([], radii, 'x', 'time', 1)).toBe('x')
  })

  it('badges lead: → from the last arc wraps to the first badge, ← from it to the last arc', () => {
    expect(stepDialFocus(vis, radii, 'a14', 'time', 1, badgeIds)).toBe('ooo')
    expect(stepDialFocus(vis, radii, 'ooo', 'time', -1, badgeIds)).toBe('a14')
    expect(stepDialFocus(vis, radii, 'ooo', 'time', 1, badgeIds)).toBe('civic')
    expect(stepDialFocus(vis, radii, 'civic', 'time', 1, badgeIds)).toBe('a9')
  })

  it('a badge has no lane: ↑/↓ step the reading order too, never inert', () => {
    expect(stepDialFocus(vis, radii, 'ooo', 'lane', 1, badgeIds)).toBe('civic')
    expect(stepDialFocus(vis, radii, 'civic', 'lane', -1, badgeIds)).toBe('ooo')
  })

  it('an arc with no same-angle neighbour falls back to the combined order', () => {
    // a9 has no near-angle neighbour → ↑ steps back in time, into the badges
    expect(stepDialFocus(vis, radii, 'a9', 'lane', -1, badgeIds)).toBe('civic')
  })

  it('no anchor lands on the first/last of the combined order; a lone badge stays put', () => {
    expect(stepDialFocus(vis, radii, null, 'time', 1, badgeIds)).toBe('ooo')
    expect(stepDialFocus(vis, radii, null, 'time', -1, badgeIds)).toBe('a14')
    expect(stepDialFocus([], new Map(), 'civic', 'time', 1, ['civic'])).toBe('civic')
    expect([...badgeIds, ...dialFocusOrder(vis)]).toEqual(['ooo', 'civic', 'a9', 'a14'])
  })
})
