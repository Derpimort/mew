/* #22 slice A — the evening exists. The issue's repro harness, inverted: every
   deterministic placement path now sees the plannable day (08:00–22:30 by
   default) instead of stopping at 18:30, the evening ranks low unless it's
   asked for, and anything the old day could hold still lands byte-identically. */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLANNABLE_HOURS,
  DEFAULT_SETTINGS,
  type Block,
  type PlannableHours,
} from '../types'
import { candidateSlots, restInsertion, scoreSlots, type SlotQuery } from '../scheduler'
import { findFreeSlot, nextFreeSlot, nextSlotAfter, place } from '../week'
import { CLASSIC_DAY, airPastEnd, pastEndNote, plannableLabel, plannableOf } from '../plannable'
import { rescueOptions } from '../rescue'
import { fitOffers } from '../inbox'
import { scaffoldDay } from '../sustenance'

const D = '2026-07-25'
const NEXT = '2026-07-26'

let n = 0
function mk(over: Partial<Block>): Block {
  return {
    id: `b${n++}`,
    title: 'X',
    tag: 'work',
    dayKey: D,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/* The live evening: a fixed home call 23:15–00:15, nothing else after 18:30.
   The user asks at 20:46 for a 60-min work block "tonight". */
const homeCall = mk({
  title: 'Home call',
  tag: 'private',
  startMin: 23 * 60 + 15,
  endMin: 24 * 60 + 15,
})
const NOW = 20 * 60 + 46
const release: SlotQuery = { title: 'Prod release + email', tag: 'work', durationMin: 60 }

describe('the repro, inverted: the evening is visible to every deterministic path', () => {
  it('candidateSlots offers tonight for a 60-min work block', () => {
    const tonight = candidateSlots([homeCall], release, D, NOW).filter((c) => c.dayKey === D)
    expect(tonight.length).toBeGreaterThan(0)
    expect(tonight[0]).toEqual({ dayKey: D, startMin: NOW, endMin: NOW + 60 })
    // nothing runs past the plannable end, and nothing touches the call
    for (const c of tonight) expect(c.endMin).toBeLessThanOrEqual(22 * 60 + 30)
  })

  it('scoreSlots ranks a slot tonight — the auto-place floor has an answer', () => {
    const best = scoreSlots([homeCall], release, D, NOW).find((c) => c.dayKey === D)
    expect(best).toBeDefined()
    expect(best!.startMin).toBeGreaterThanOrEqual(NOW)
    expect(best!.endMin).toBeLessThanOrEqual(23 * 60 + 15)
  })

  it('the first-fit fallback finds the evening: windowEnd defaults to the plannable end', () => {
    expect(findFreeSlot([homeCall], D, 60, NOW + 15)).toEqual({
      startMin: NOW + 15,
      endMin: NOW + 75,
    })
    // …and stops there: 22:00 + 60 would run past 22:30
    expect(findFreeSlot([homeCall], D, 60, 22 * 60)).toBeNull()
  })

  it('dinner at 20:46 has somewhere to go tonight', () => {
    const dinner = { title: 'Dinner', tag: 'private' as const, durationMin: 60 }
    expect(candidateSlots([homeCall], dinner, D, NOW).filter((c) => c.dayKey === D)).not.toEqual([])
    expect(scoreSlots([homeCall], dinner, D, NOW).find((c) => c.dayKey === D)).toBeDefined()
  })
})

describe('the evening ranks low unless asked for', () => {
  it('an explicit evening window leads with the evening', () => {
    const ranked = scoreSlots([], { ...release, window: 'evening' }, D, 9 * 60)
    expect(ranked[0].dayKey).toBe(D)
    expect(ranked[0].startMin).toBeGreaterThanOrEqual(17 * 60)
  })

  it('a remembered rule pointing into the evening is honored, not damped', () => {
    const prefs = [
      { kind: 'time-default' as const, match: 'gaming', value: 'starts 20:00', stated: '' },
    ]
    const ranked = scoreSlots(
      [],
      { title: 'gaming', tag: 'private', durationMin: 60 },
      D,
      9 * 60,
      prefs
    )
    expect(ranked[0].startMin).toBe(20 * 60)
  })

  it('without an ask, an open afternoon still beats the evening', () => {
    const busyMorning = mk({ startMin: 8 * 60, endMin: 12 * 60 })
    const best = scoreSlots([busyMorning], release, D, 8 * 60).find((c) => c.dayKey === D)!
    expect(best.endMin).toBeLessThanOrEqual(18 * 60 + 30)
  })

  /* the regression law: with room inside 08:00–18:30, the pick is byte-identical
     to the classic day — swept over seeded random days, tags, durations and now */
  it('byte-identical inside the classic day: the plannable span never changes an in-day pick', () => {
    let seed = 22
    const rand = (k: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed % k
    }
    const tags = ['work', 'private', 'health', 'rest'] as const
    const windows = [undefined, 'morning', 'afternoon'] as const
    let compared = 0
    for (let trial = 0; trial < 400; trial++) {
      const blocks: Block[] = []
      for (let i = 0; i < rand(6); i++) {
        const start = 8 * 60 + rand(20) * 30
        const end = Math.min(18 * 60 + 30, start + 30 + rand(6) * 30)
        blocks.push(mk({ startMin: start, endMin: end, tag: tags[rand(4)] }))
      }
      const window = windows[rand(3)]
      const q: SlotQuery = {
        title: `task ${trial}`,
        tag: tags[rand(4)],
        durationMin: 30 + rand(6) * 15,
        ...(window ? { window } : {}),
      }
      const now = 8 * 60 + rand(16) * 30
      const classic = scoreSlots(blocks, q, D, now, [], undefined, 0, undefined, 0, CLASSIC_DAY)
      if (!classic.length) continue
      const wide = scoreSlots(blocks, q, D, now, [], undefined, 0)
      expect(wide[0]).toEqual(classic[0])
      compared++
    }
    expect(compared).toBeGreaterThan(200)
  })
})

describe('the owner’s plannable hours thread through every domain path', () => {
  const early: PlannableHours = { startMin: 7 * 60, endMin: 20 * 60 }

  it('candidateSlots and scoreSlots start and end where the hours say', () => {
    const c = candidateSlots([], release, NEXT, 0, 0, early.endMin, 0, early.startMin)
    expect(c[0].startMin).toBe(7 * 60)
    expect(Math.max(...c.map((x) => x.endMin))).toBe(20 * 60)
    const ranked = scoreSlots([], release, NEXT, 0, [], undefined, 0, undefined, 0, early)
    expect(Math.min(...ranked.map((x) => x.startMin))).toBe(7 * 60)
    expect(Math.max(...ranked.map((x) => x.endMin))).toBe(20 * 60)
  })

  it('nextFreeSlot, nextSlotAfter and place honor the hours', () => {
    const wall = mk({ startMin: 7 * 60, endMin: 19 * 60 + 30 })
    expect(nextFreeSlot([wall], D, 7 * 60, 60, 1, 0, early)).toEqual({
      dayKey: NEXT,
      startMin: 7 * 60,
    })
    expect(nextFreeSlot([wall], D, 7 * 60, 60, 1)).toEqual({ dayKey: D, startMin: 19 * 60 + 30 })

    const flex = mk({ startMin: 18 * 60, endMin: 19 * 60 })
    expect(nextSlotAfter([wall, flex], flex, 19 * 60 + 30)).toEqual({
      dayKey: D,
      startMin: 19 * 60 + 30,
    })
    expect(nextSlotAfter([wall, flex], flex, 19 * 60 + 30, early)!.dayKey).toBe(NEXT)

    const spec = { title: 'Walk', tag: 'private' as const, dayKey: D, durationMin: 60 }
    expect(place([wall], spec, early)).toBeNull()
    expect(place([wall], spec)!.startMin).toBe(19 * 60 + 30)
  })

  it('restInsertion finds its seam inside the hours', () => {
    const run = mk({ title: 'All day', startMin: 8 * 60, endMin: 18 * 60 + 30 })
    // the plannable evening holds the breather right after the stretch…
    expect(restInsertion([run], D)).toMatchObject({ kind: 'place', startMin: 18 * 60 + 30 })
    // …the classic day ends with the run, so it can only offer
    expect(restInsertion([run], D, CLASSIC_DAY)!.kind).toBe('suggest')
  })

  it('rescue shift reaches the evening; roll reads the hours for the next day', () => {
    const block = mk({ id: 'deck', title: 'Deck polish', startMin: 14 * 60, endMin: 16 * 60 })
    const meeting = mk({
      id: 'm',
      title: 'Board sync',
      startMin: 14 * 60 + 30,
      endMin: 15 * 60,
      external: { calId: 'c', eventId: 'e' },
    })
    const wall = mk({ id: 'w', startMin: 16 * 60, endMin: 18 * 60 + 30 })
    const opts = rescueOptions([block, meeting, wall], { meeting, block }, D, 13 * 60)
    expect(opts.find((o) => o.id === 'shift')?.label).toBe('shift to 18:30')
    const tight = rescueOptions([block, meeting, wall], { meeting, block }, D, 13 * 60, {
      startMin: 8 * 60,
      endMin: 18 * 60 + 30,
    })
    expect(tight.some((o) => o.id === 'shift')).toBe(false)
  })

  it('inbox offers read the hours from opts', () => {
    const now = new Date(2026, 6, 25, 17, 0)
    const item = {
      id: 'x',
      title: 'call the bank',
      createdAt: now.getTime(),
      status: 'open' as const,
      durationMin: 60,
    }
    const today = fitOffers([item], [], [], now)
    expect(today[0].dayKey).toBe(D) // 17:15 today — the evening holds it
    const tomorrow = fitOffers([item], [], [], now, {
      hours: { startMin: 8 * 60, endMin: 18 * 60 },
    })
    expect(tomorrow[0].dayKey).toBe(NEXT)
  })

  it('the autonomous morning scaffold keeps the classic span — a packed day stays quiet', () => {
    const packed = [mk({ title: 'Offsite', startMin: 8 * 60, endMin: 21 * 60 })]
    const meals = DEFAULT_SETTINGS.sustenanceMeals
    expect(scaffoldDay(packed, D, { meals, nowMin: 8 * 60 })).toEqual([])
  })
})

describe('plannableOf — the owner’s bounds, or the default', () => {
  it('reads valid hours and labels them', () => {
    const h = { startMin: 7 * 60, endMin: 23 * 60 }
    expect(plannableOf({ plannableHours: h })).toBe(h)
    expect(plannableLabel(h)).toBe('7:00–23:00')
    expect(plannableLabel(DEFAULT_PLANNABLE_HOURS)).toBe('8:00–22:30')
  })

  it('falls back on absent or malformed hours (no past-midnight or inverted spans)', () => {
    for (const bad of [
      undefined,
      { startMin: 20 * 60, endMin: 8 * 60 },
      { startMin: 8 * 60, endMin: 8 * 60 },
      { startMin: 8 * 60, endMin: 25 * 60 },
      { startMin: -30, endMin: 20 * 60 },
      { startMin: 8.5, endMin: 20 * 60 },
    ]) {
      expect(plannableOf({ plannableHours: bad as PlannableHours })).toEqual(
        DEFAULT_PLANNABLE_HOURS
      )
    }
    expect(plannableOf(null)).toEqual(DEFAULT_PLANNABLE_HOURS)
  })

  it('the default is independent of quiet hours', () => {
    expect(DEFAULT_SETTINGS.plannableHours).toEqual({ startMin: 8 * 60, endMin: 22 * 60 + 30 })
    expect(DEFAULT_SETTINGS.plannableHours).not.toBe(DEFAULT_SETTINGS.quietHours)
  })
})

describe('pastEndNote — the honest clause for air past the plannable end', () => {
  const late = mk({ startMin: 8 * 60, endMin: 22 * 60 })

  it('names the bounds and the real free time', () => {
    const note = pastEndNote([late, homeCall], D, 22 * 60, 60, DEFAULT_PLANNABLE_HOURS, 'today')
    expect(note).toBe(
      "Open air today: 22:00–23:15, running past the hours I plan in (8:00–22:30) — name a time there and I'll hold it."
    )
    expect(note).not.toMatch(/held/)
  })

  it('is null when nothing past the end fits — the gap really is held', () => {
    const allNight = mk({ startMin: 22 * 60, endMin: 24 * 60 })
    expect(
      pastEndNote([late, allNight], D, 22 * 60, 60, DEFAULT_PLANNABLE_HOURS, 'today')
    ).toBeNull()
  })

  it('airPastEnd only counts windows that reach past the end and hold the duration', () => {
    const blocks = [
      mk({ startMin: 8 * 60, endMin: 20 * 60 }),
      mk({ startMin: 21 * 60, endMin: 22 * 60 + 10 }),
    ]
    // 20:00–21:00 fits but sits inside the day; 22:10–24:00 reaches past it
    expect(airPastEnd(blocks, D, 8 * 60, 60, DEFAULT_PLANNABLE_HOURS)).toEqual([
      { startMin: 22 * 60 + 10, endMin: 24 * 60 },
    ])
    // a deadline caps the reach
    expect(airPastEnd(blocks, D, 8 * 60, 60, DEFAULT_PLANNABLE_HOURS, 0, 23 * 60)).toEqual([])
  })
})
