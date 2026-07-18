import { describe, expect, it } from 'vitest'
import type { Block, InboxItem, MemoryEvent, Tag } from '../types'
import { dayKey } from '../time'
import { DEFAULT_DURATION_MIN, fitOffers, offerBody } from '../inbox'

/* now = Monday, so today's own placement is real; the profile reads the three
   canonical weekdays (Tue/Wed/Thu, June 9–11 2026 — the seeded week) that sit
   inside the trailing 28-day window and clear the ≥3-weekday floor. */
const NOW = new Date('2026-06-15T09:00:00')
const TODAY = dayKey(NOW)
const DAYS = ['2026-06-09', '2026-06-10', '2026-06-11']

let eseq = 0
function ev(over: Partial<MemoryEvent>): MemoryEvent {
  return { id: `e${eseq++}`, ts: 0, kind: 'completed', dayKey: DAYS[0], ...over } as MemoryEvent
}

/** completed/rolled outcomes for one (band × class) cell, spread round-robin
    across the three weekdays so the floor's weekday spread always holds */
function cell(
  startMin: number,
  tag: Tag,
  deep: boolean,
  done: number,
  rolled: number
): MemoryEvent[] {
  const out: MemoryEvent[] = []
  let i = 0
  const base = { startMin, tag, deep, plannedMin: deep ? 90 : 30, title: 'x' }
  for (let k = 0; k < done; k++, i++)
    out.push(ev({ ...base, kind: 'completed', dayKey: DAYS[i % DAYS.length] }))
  for (let k = 0; k < rolled; k++, i++)
    out.push(ev({ ...base, kind: 'rolled', dayKey: DAYS[i % DAYS.length] }))
  return out
}

/* a peaked-morning deep rhythm (deep completed only in the morning) + an
   afternoon admin rhythm — enough banded outcomes over three weekdays, with a
   known realistic best, so energyProfile returns a real profile. */
const PROFILE_MEM: MemoryEvent[] = [
  ...cell(9 * 60, 'work', true, 12, 0), // morning deep: rate 1.0 → the deep window
  ...cell(20 * 60, 'work', true, 1, 4), // evening deep: rate 0.2 (< floor) → not a deep window
  ...cell(13 * 60, 'private', false, 6, 0), // afternoon admin: rate 1.0
]

let iseq = 0
function item(over: Partial<InboxItem>): InboxItem {
  return { id: `i${iseq++}`, title: 'a thing', createdAt: 0, status: 'open', ...over }
}

let bseq = 0
function blk(over: Partial<Block>): Block {
  return {
    id: `b${bseq++}`,
    title: 'busy',
    tag: 'work',
    dayKey: TODAY,
    startMin: 8 * 60,
    endMin: 18 * 60 + 30,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

const inWindow = (min: number, from: number, to: number) => min >= from && min < to

describe('fitOffers — the keyless floor (no learned signal)', () => {
  it('offers the soonest clear slot that fits, with no energy claim', () => {
    const offers = fitOffers([item({ id: 'x' })], [], [], NOW)
    expect(offers).toHaveLength(1)
    const o = offers[0]
    expect(o.itemId).toBe('x')
    expect(o.dayKey).toBe(TODAY)
    expect(o.durationMin).toBe(DEFAULT_DURATION_MIN)
    expect(o.fitsEnergy).toBe(false)
    expect(o.reason).toMatch(/soonest clear/)
    // day-zero floor: never in the past-15-min, never before now
    expect(o.startMin).toBeGreaterThanOrEqual(9 * 60 + 15)
  })

  it('is deterministic — identical inputs give byte-identical offers', () => {
    const a = fitOffers([item({ id: 'x' })], [], [], NOW)
    const b = fitOffers([item({ id: 'x' })], [], [], NOW)
    expect(a).toEqual(b)
  })

  it('honors the duration hint and rolls to a later day when today is full', () => {
    // fill today wall-to-wall so a 90-min block cannot land today
    const full = [blk({ startMin: 8 * 60, endMin: 18 * 60 + 30 })]
    const offers = fitOffers([item({ id: 'x', durationMin: 90 })], full, [], NOW)
    expect(offers).toHaveLength(1)
    expect(offers[0].durationMin).toBe(90)
    expect(offers[0].dayKey > TODAY).toBe(true) // tomorrow or later
  })

  it('offers nothing when no slot fits anywhere in the horizon', () => {
    // every day within the horizon is wall-to-wall (a repeating fixed block)
    const busy: Block[] = []
    for (let d = 0; d <= 14; d++) {
      const key = dayKey(new Date(2026, 5, 15 + d))
      busy.push(blk({ id: `full${d}`, dayKey: key, startMin: 0, endMin: 24 * 60 }))
    }
    const offers = fitOffers([item({ id: 'x', durationMin: 120 })], busy, [], NOW)
    expect(offers).toEqual([])
  })
})

describe('fitOffers — energy fit (learned rhythm, #321)', () => {
  it('lands deep work where the owner demonstrably finishes it (the morning)', () => {
    const offers = fitOffers(
      [item({ id: 'deck', title: 'ship the deck', tag: 'work', durationMin: 90 })],
      [],
      PROFILE_MEM,
      NOW
    )
    expect(offers).toHaveLength(1)
    const o = offers[0]
    expect(o.fitsEnergy).toBe(true)
    expect(o.reason).toMatch(/deep work in the morning/)
    expect(inWindow(o.startMin, 8 * 60, 12 * 60)).toBe(true)
  })

  it('lands an admin item in a demonstrated admin window (the afternoon)', () => {
    const offers = fitOffers(
      [item({ id: 'bank', title: 'call the bank', tag: 'private', durationMin: 30 })],
      [],
      PROFILE_MEM,
      NOW
    )
    expect(offers).toHaveLength(1)
    const o = offers[0]
    expect(o.fitsEnergy).toBe(true)
    expect(inWindow(o.startMin, 12 * 60, 17 * 60)).toBe(true)
  })

  it('energyFit:false disengages the energy read — back to the honest floor', () => {
    const offers = fitOffers(
      [item({ id: 'deck', title: 'ship the deck', tag: 'work', durationMin: 90 })],
      [],
      PROFILE_MEM,
      NOW,
      { energyFit: false }
    )
    expect(offers[0].fitsEnergy).toBe(false)
    expect(offers[0].reason).toMatch(/soonest clear/)
  })

  it('an explicit energy hint overrides the tag-derived class', () => {
    // tagged private (would read admin) but the owner marked it deep → morning
    const offers = fitOffers(
      [item({ id: 'x', title: 'deep review', tag: 'private', durationMin: 90, energy: 'deep' })],
      [],
      PROFILE_MEM,
      NOW
    )
    expect(offers[0].fitsEnergy).toBe(true)
    expect(inWindow(offers[0].startMin, 8 * 60, 12 * 60)).toBe(true)
  })

  it('falls to the floor when the profile has no home for the class', () => {
    // deep work but the profile shows deep finished ONLY in the evening below
    // the floor → no demonstrated deep window → honest soonest slot
    const noDeepHome: MemoryEvent[] = [
      ...cell(20 * 60, 'work', true, 2, 6), // evening deep rate 0.25 (< 0.5 floor)
      ...cell(13 * 60, 'private', false, 6, 0),
      ...cell(9 * 60, 'health', false, 4, 0),
    ]
    const offers = fitOffers([item({ id: 'x', tag: 'work', durationMin: 90 })], [], noDeepHome, NOW)
    expect(offers[0].fitsEnergy).toBe(false)
  })
})

describe('fitOffers — a confirmed rule (#328) outranks the learned profile', () => {
  const rule: MemoryEvent = {
    id: 'r1',
    ts: 0,
    kind: 'learned_rule',
    dayKey: DAYS[0],
    rule: { match: 'call the bank', window: 'afternoon' },
  }
  it('offers the rule’s firm window and credits it', () => {
    const offers = fitOffers(
      [item({ id: 'bank', title: 'call the bank' })],
      [],
      // profile peaks in the morning; the firm afternoon rule must still win
      [rule, ...PROFILE_MEM],
      NOW
    )
    expect(offers[0].fitsEnergy).toBe(true)
    expect(offers[0].reason).toMatch(/your usual afternoon/)
    expect(inWindow(offers[0].startMin, 12 * 60, 17 * 60)).toBe(true)
  })

  it('fills the duration a rule confirmed when the item left it open', () => {
    const durRule: MemoryEvent = {
      id: 'r2',
      ts: 0,
      kind: 'learned_rule',
      dayKey: DAYS[0],
      rule: { match: 'call the bank', durationMin: 45 },
    }
    const offers = fitOffers([item({ id: 'bank', title: 'call the bank' })], [], [durRule], NOW)
    expect(offers[0].durationMin).toBe(45)
  })
})

describe('fitOffers — waiting-set discipline', () => {
  it('skips placed and done items — only WAITING items get an offer', () => {
    const offers = fitOffers(
      [
        item({ id: 'open' }),
        item({ id: 'placed', status: 'placed' }),
        item({ id: 'done', status: 'done' }),
      ],
      [],
      [],
      NOW
    )
    expect(offers.map((o) => o.itemId)).toEqual(['open'])
  })

  it('returns offers soonest-first, then by id', () => {
    const offers = fitOffers([item({ id: 'zzz' }), item({ id: 'aaa' })], [], [], NOW)
    // same empty week ⇒ same slot ⇒ tie broken by id
    expect(offers.map((o) => o.itemId)).toEqual(['aaa', 'zzz'])
  })

  it('does not mutate its inputs (pure — holds no time)', () => {
    const inbox = [item({ id: 'x' })]
    const blocks: Block[] = []
    fitOffers(inbox, blocks, PROFILE_MEM, NOW)
    expect(blocks).toHaveLength(0) // no block was placed
    expect(inbox[0].status).toBe('open') // the item is untouched
    expect(inbox[0].placedBlockId).toBeUndefined()
  })
})

describe('offerBody — the owner-facing offer line (MEW voice)', () => {
  it('names the free time, the day, the reason, and asks', () => {
    const o = fitOffers(
      [item({ id: 'x', title: 'call the bank', tag: 'private', durationMin: 90 })],
      [],
      PROFILE_MEM,
      NOW
    )[0]
    const body = offerBody('call the bank', o, TODAY)
    expect(body).toMatch(/^Free 1h 30m at /)
    expect(body).toMatch(/today/)
    expect(body).toMatch(/Drop “call the bank” in\?$/)
  })

  it('says the weekday when the slot is not today', () => {
    const full = [blk({ startMin: 0, endMin: 24 * 60 })] // today full → rolls forward
    const o = fitOffers([item({ id: 'x', durationMin: 30 })], full, [], NOW)[0]
    const body = offerBody('a thing', o, TODAY)
    expect(body).not.toMatch(/today/)
    expect(body).toMatch(/Free 30 min at/)
  })
})
