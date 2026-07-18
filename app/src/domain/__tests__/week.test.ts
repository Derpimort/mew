import { describe, expect, it } from 'vitest'
import {
  blocksForDay,
  complete,
  dayClear,
  conflictsWith,
  contextMarkers,
  dayEndMin,
  findAllByQuery,
  findByQuery,
  findFreeSlot,
  findTarget,
  freeWindows,
  isFixedTime,
  nextFreeSlot,
  nextSlotAfter,
  overlappingFocus,
  isDeep,
  loadBySegment,
  looseThreads,
  place,
  plannedDeepMin,
  resolveReferent,
  resolveRemoval,
  roll,
  rollup,
  seriesMembership,
  tightMeetingJunction,
} from '../week'
import type { Block, BlockStatus } from '../types'

const D = '2026-06-09'

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
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

describe('week model', () => {
  it('positive-only by construction: the only statuses are open/done/rolled', () => {
    // If someone adds a "failed"/"missed" status this assertion forces a conversation.
    const legal: BlockStatus[] = ['open', 'done', 'rolled']
    expect(legal).toHaveLength(3)
  })

  it('sorts a day and excludes rolled originals', () => {
    const a = mk({ startMin: 14 * 60, endMin: 15 * 60 })
    const b = mk({ startMin: 9 * 60, endMin: 10 * 60 })
    const c = mk({ startMin: 11 * 60, endMin: 12 * 60, status: 'rolled' })
    expect(blocksForDay([a, b, c], D).map((x) => x.id)).toEqual([b.id, a.id])
  })

  it('finds the first free slot around existing blocks', () => {
    const blocks = [
      mk({ startMin: 9 * 60, endMin: 11 * 60 }),
      mk({ startMin: 12 * 60, endMin: 13 * 60 }),
    ]
    expect(findFreeSlot(blocks, D, 60)).toEqual({ startMin: 8 * 60, endMin: 9 * 60 }) // first fit: before the 9:00 block
    expect(findFreeSlot(blocks, D, 90)).toEqual({ startMin: 13 * 60, endMin: 14.5 * 60 })
  })

  it('returns null when the day cannot hold the duration', () => {
    const blocks = [mk({ startMin: 8 * 60, endMin: 18 * 60 })]
    expect(findFreeSlot(blocks, D, 60)).toBeNull()
  })

  it('place without a time lands in the first free slot, protected by default', () => {
    const existing = [mk({ startMin: 8 * 60, endMin: 9 * 60 })]
    const b = place(existing, { title: 'deck', tag: 'work', dayKey: D, durationMin: 120 })
    expect(b).toMatchObject({ startMin: 9 * 60, endMin: 11 * 60, protected: true, status: 'open' })
  })

  it('roll keeps the original (linked) and creates tomorrow’s block — graceful, never a drop', () => {
    const b = mk({ title: 'deck' })
    const { blocks, rolled } = roll([b], b.id, '2026-06-10', 9 * 60)
    const orig = blocks.find((x) => x.id === b.id)!
    expect(orig.status).toBe('rolled')
    expect(orig.rolledToId).toBe(rolled!.id)
    expect(rolled).toMatchObject({
      dayKey: '2026-06-10',
      startMin: 9 * 60,
      endMin: 10 * 60,
      status: 'open',
    })
  })

  it('dayClear ignores rest blocks and needs every task done', () => {
    const t1 = mk({})
    const t2 = mk({ startMin: 11 * 60, endMin: 12 * 60 })
    const rest = mk({ tag: 'rest', startMin: 18 * 60, endMin: 19 * 60 })
    expect(dayClear([t1, t2, rest], D)).toBe(false)
    const done = complete(complete([t1, t2, rest], t1.id, 0), t2.id, 0)
    expect(dayClear(done, D)).toBe(true)
  })

  it('deep work = work blocks ≥ 1h; load segments map health with private', () => {
    const deep = mk({ startMin: 9 * 60, endMin: 12 * 60 })
    const shallow = mk({ startMin: 13 * 60, endMin: 13 * 60 + 30 })
    const health = mk({ tag: 'health', startMin: 15 * 60, endMin: 16 * 60 })
    expect(isDeep(deep)).toBe(true)
    expect(isDeep(shallow)).toBe(false)
    expect(plannedDeepMin([deep, shallow, health], D)).toBe(180)
    expect(loadBySegment([deep, shallow, health], D)).toEqual({ work: 210, priv: 60, rest: 0 })
  })

  it('the working day ends at the later of 18:30 and the last block', () => {
    expect(dayEndMin([mk({ startMin: 9 * 60, endMin: 10 * 60 })], D)).toBe(18 * 60 + 30)
    expect(dayEndMin([mk({ startMin: 19 * 60, endMin: 20 * 60 })], D)).toBe(20 * 60)
  })

  describe('findByQuery — "lunch" and "order lunch" are different blocks', () => {
    const lunch = mk({ title: 'Lunch', tag: 'private', startMin: 13 * 60, endMin: 14 * 60 })
    const order = mk({
      title: 'Order lunch',
      tag: 'private',
      startMin: 11 * 60,
      endMin: 11 * 60 + 15,
    })

    it('exact base title beats substring match', () => {
      expect(findByQuery([order, lunch], 'lunch', D)?.id).toBe(lunch.id)
      expect(findByQuery([lunch, order], 'lunch', D)?.id).toBe(lunch.id)
    })

    it('the longer phrase still finds its own block', () => {
      expect(findByQuery([lunch, order], 'order lunch', D)?.id).toBe(order.id)
    })
  })

  describe('findByQuery — fuzzy fallback when substring misses (#81)', () => {
    const mgmt = mk({
      title: 'Management Team Monday',
      tag: 'work',
      startMin: 9 * 60,
      endMin: 10 * 60,
    })
    const oneOnOne = mk({
      title: 'Mira 1:1',
      tag: 'work',
      startMin: 15 * 60,
      endMin: 15 * 60 + 30,
    })

    it("'management sync' finds 'Management Team Monday' (the reported bug)", () => {
      expect(findByQuery([mgmt, oneOnOne], 'management sync', D)?.id).toBe(mgmt.id)
    })

    it('tolerates a typo — "managment team" still finds it', () => {
      expect(findByQuery([mgmt, oneOnOne], 'managment team', D)?.id).toBe(mgmt.id)
    })

    it('no regression — substring still wins, fuzzy never fires when it hits', () => {
      const standup = mk({ title: 'Order standup notes', tag: 'work' })
      expect(findByQuery([standup], 'standup', D)?.id).toBe(standup.id)
    })

    it('an ambiguous fuzzy match is gated — ask, do not guess (and never bulk-delete)', () => {
      const sprint = mk({
        title: 'Sprint Planning',
        tag: 'work',
        startMin: 9 * 60,
        endMin: 10 * 60,
      })
      const release = mk({
        title: 'Release Planning',
        tag: 'work',
        startMin: 11 * 60,
        endMin: 12 * 60,
      })
      // "planing" (typo) is a substring of neither but fuzzy-matches both equally
      expect(findByQuery([sprint, release], 'planing', D)).toBeUndefined()
      // findAllByQuery feeds execRemove's BULK delete — an ambiguous fuzzy spread
      // must resolve to nothing, never silently delete two different blocks
      expect(findAllByQuery([sprint, release], 'planing')).toEqual([])
    })

    it('fuzzy bulk-remove is single-or-none; only explicit substring bulk-removes (#84 review)', () => {
      const mgmt = mk({ title: 'Management Team Monday', tag: 'work' })
      const gym = mk({ title: 'Gym', tag: 'health', startMin: 7 * 60, endMin: 8 * 60 })
      // fuzzy (no substring hit) → at most the one confident block, never a spread
      expect(findAllByQuery([mgmt, gym], 'managment team').map((b) => b.id)).toEqual([mgmt.id])
      // explicit substring → genuine bulk removal still works
      const p1 = mk({ title: 'Prod release', tag: 'work', startMin: 9 * 60, endMin: 10 * 60 })
      const p2 = mk({
        title: 'Prod release checklist',
        tag: 'work',
        startMin: 14 * 60,
        endMin: 15 * 60,
      })
      expect(
        findAllByQuery([p1, p2], 'prod release')
          .map((b) => b.id)
          .sort()
      ).toEqual([p1.id, p2.id].sort())
    })

    it('no false positive — an unrelated query finds nothing', () => {
      expect(findByQuery([mgmt], 'dentist appointment', D)).toBeUndefined()
    })
  })

  describe('resolveRemoval — drop the named one, never a guess (#105)', () => {
    // two same-titled sleep blocks: the long night one and the short morning one
    const night = mk({ title: 'Sleep', tag: 'rest', startMin: 22 * 60 + 30, endMin: 5 * 60 })
    const morning = mk({ title: 'Sleep', tag: 'rest', startMin: 6 * 60 + 45, endMin: 8 * 60 })

    it('a start-time pin drops only that instance, leaving the other (the repro)', () => {
      const { remove, candidates } = resolveRemoval([night, morning], 'sleep', { at: '22:30' }, D)
      expect(remove.map((b) => b.id)).toEqual([night.id])
      expect(candidates).toEqual([])
    })

    it('reuses the am-pm clock parser, not just HH:MM', () => {
      const { remove } = resolveRemoval([night, morning], 'sleep', { at: '6:45am' }, D)
      expect(remove.map((b) => b.id)).toEqual([morning.id])
    })

    it('all:true keeps every match — "drop both" still works', () => {
      const { remove, candidates } = resolveRemoval([night, morning], 'sleep', { all: true }, D)
      expect(remove.map((b) => b.id).sort()).toEqual([night.id, morning.id].sort())
      expect(candidates).toEqual([])
    })

    it('exactly one match removes it with no opts — single-block behavior unchanged', () => {
      const { remove, candidates } = resolveRemoval([night], 'sleep', {}, D)
      expect(remove.map((b) => b.id)).toEqual([night.id])
      expect(candidates).toEqual([])
    })

    it('several matches, no pin and no all → removes nothing, reports candidates', () => {
      const { remove, candidates } = resolveRemoval([night, morning], 'sleep', {}, D)
      expect(remove).toEqual([])
      expect(candidates.map((b) => b.id).sort()).toEqual([night.id, morning.id].sort())
    })

    it('an at that matches nothing reports candidates, never drops all', () => {
      const { remove, candidates } = resolveRemoval([night, morning], 'sleep', { at: '13:00' }, D)
      expect(remove).toEqual([]) // a missed pin is a miss, not a license to nuke
      expect(candidates.map((b) => b.id).sort()).toEqual([night.id, morning.id].sort())
    })

    it('only counts open, ahead blocks — past days and the resolution stay in one place', () => {
      const past = mk({
        title: 'Sleep',
        tag: 'rest',
        dayKey: '2026-06-08',
        startMin: 22 * 60 + 30,
        endMin: 5 * 60,
      })
      // the past instance is filtered out, so today's single match removes cleanly
      const { remove } = resolveRemoval([past, morning], 'sleep', {}, D)
      expect(remove.map((b) => b.id)).toEqual([morning.id])
    })

    it('no match at all → nothing to remove, nothing to ask', () => {
      expect(resolveRemoval([night], 'dentist', {}, D)).toEqual({ remove: [], candidates: [] })
    })
  })

  describe('findTarget — precise name+time addressing (#334)', () => {
    // the transcript: two same-named blocks the same evening; a bare name hit
    // the wrong one, a name+time must hit exactly the intended block
    const early = mk({ title: 'Release', startMin: 19 * 60 + 45, endMin: 20 * 60 + 45 })
    const late = mk({ title: 'Release', startMin: 21 * 60 + 30, endMin: 22 * 60 + 30 })

    it('name + time addresses exactly one block — never a silent wrong pick', () => {
      const r = findTarget([early, late], 'release', D, { at: 19 * 60 + 45 })
      expect(r).toEqual({ status: 'ok', block: early })
    })

    it('a bare ambiguous name exposes the candidate set (same day), never guesses', () => {
      const r = findTarget([early, late], 'release', D)
      expect(r.status).toBe('ambiguous')
      if (r.status === 'ambiguous')
        expect(r.candidates.map((b) => b.id).sort()).toEqual([early.id, late.id].sort())
    })

    it('a time that matches the name but not the clock surfaces the real times', () => {
      const r = findTarget([early, late], 'release', D, { at: 18 * 60 })
      expect(r.status).toBe('ambiguous') // not "none" — the name IS there, just not at 18:00
    })

    it('a single match resolves cleanly', () => {
      const r = findTarget([early], 'release', D)
      expect(r).toEqual({ status: 'ok', block: early })
    })

    it('a name shared across days resolves to the soonest, not an ambiguity', () => {
      const tue = mk({ title: 'Gym', dayKey: D, startMin: 7 * 60 })
      const wed = mk({ title: 'Gym', dayKey: '2026-06-10', startMin: 7 * 60 })
      const r = findTarget([wed, tue], 'gym', D)
      expect(r).toEqual({ status: 'ok', block: tue })
    })

    it('a done block is invisible by default but reachable with includeDone (the cage lifts)', () => {
      const done = mk({ title: 'Deck', status: 'done', startMin: 9 * 60, endMin: 10 * 60 })
      expect(findTarget([done], 'deck', D)).toEqual({ status: 'none' })
      expect(findTarget([done], 'deck', D, { includeDone: true })).toEqual({
        status: 'ok',
        block: done,
      })
    })

    it('a bare name prefers the still-open block over a finished namesake', () => {
      const open = mk({ title: 'Deck', status: 'open', startMin: 14 * 60, endMin: 15 * 60 })
      const done = mk({ title: 'Deck', status: 'done', startMin: 9 * 60, endMin: 10 * 60 })
      const r = findTarget([done, open], 'deck', D, { includeDone: true })
      expect(r).toEqual({ status: 'ok', block: open })
    })

    it('past-day blocks are not targetable by name', () => {
      const past = mk({ title: 'Release', dayKey: '2026-06-08', startMin: 19 * 60 + 45 })
      expect(findTarget([past], 'release', D)).toEqual({ status: 'none' })
    })
  })

  describe('fixed-time vs flexible (interviews own their slot; tasks can give)', () => {
    it('classifies meetings, calls, interviews, and external events as fixed', () => {
      expect(isFixedTime(mk({ title: 'Interview — Pooran Suthar' }))).toBe(true)
      expect(isFixedTime(mk({ title: 'Weekly sync' }))).toBe(true)
      expect(isFixedTime(mk({ title: 'Call with the bank' }))).toBe(true)
      expect(isFixedTime(mk({ title: 'Team standup' }))).toBe(true)
      expect(isFixedTime(mk({ title: 'Board prep', external: { calId: 'c', eventId: 'e' } }))).toBe(
        true
      )
      expect(isFixedTime(mk({ title: 'Write the Q3 deck' }))).toBe(false)
      expect(isFixedTime(mk({ title: 'Interview prep — Mira' }))).toBe(false) // prep is our task, not their meeting
      expect(isFixedTime(mk({ title: 'Call prep notes' }))).toBe(false)
    })

    it('conflictsWith sees fixed tentative interviews but stays transparent to optional tasks', () => {
      const interview = mk({
        id: 'i1',
        title: 'Interview — Mira',
        startMin: 13.5 * 60,
        endMin: 14.5 * 60,
        optional: true,
      })
      const maybeGym = mk({
        id: 'g1',
        title: 'Gym?',
        startMin: 13.5 * 60,
        endMin: 14.5 * 60,
        optional: true,
      })
      expect(conflictsWith([interview], D, 13.5 * 60, 13.75 * 60).map((b) => b.id)).toEqual(['i1'])
      expect(conflictsWith([maybeGym], D, 13.5 * 60, 13.75 * 60)).toHaveLength(0)
    })

    it('auto-placement keeps clear of a tentative interview', () => {
      const interview = mk({
        id: 'i1',
        title: 'Interview — Pooran',
        startMin: 8 * 60,
        endMin: 9 * 60,
        optional: true,
      })
      const slot = findFreeSlot([interview], D, 30)
      expect(slot?.startMin).toBe(9 * 60)
    })
  })

  describe('nextSlotAfter — giving way never teleports a block earlier', () => {
    it('an evening block moves later in the evening, not to 8:00 am', () => {
      const board = mk({
        id: 'board',
        title: 'Board sanitization',
        startMin: 20 * 60,
        endMin: 20 * 60 + 15,
      })
      const rest = mk({
        id: 'rest',
        title: 'Micro-break',
        tag: 'rest',
        startMin: 19 * 60 + 45,
        endMin: 20 * 60 + 5,
      })
      const next = nextSlotAfter([board, rest], board, 19 * 60 + 50)
      expect(next).toMatchObject({ dayKey: D, startMin: 20 * 60 + 5 })
    })

    it('falls to tomorrow morning when the evening is full', () => {
      const late = mk({ id: 'late', title: 'Wrap-up', startMin: 22 * 60, endMin: 22 * 60 + 20 })
      const wall = mk({
        id: 'wall',
        title: 'Everything else',
        startMin: 22 * 60 + 20,
        endMin: 23 * 60 + 30,
      })
      const next = nextSlotAfter([late, wall], late, 22 * 60 + 10)
      expect(next?.dayKey).toBe('2026-06-10')
      expect(next?.startMin).toBe(9 * 60)
    })
  })

  describe('freeWindows — the truth behind "find me time before 5pm"', () => {
    it('a window inside an interview does not exist', () => {
      const interview = mk({
        id: 'iv',
        title: 'Interview — Mira',
        startMin: 14.5 * 60,
        endMin: 15.5 * 60,
      })
      const post = mk({
        id: 'po',
        title: 'Post-interview reviews',
        startMin: 14.5 * 60,
        endMin: 14.75 * 60,
      })
      const windows = freeWindows([interview, post], D, 14 * 60, 17 * 60)
      expect(windows).toEqual([
        { startMin: 14 * 60, endMin: 14.5 * 60 },
        { startMin: 15.5 * 60, endMin: 17 * 60 },
      ])
    })

    it('tentative interviews block the window; optional tasks stay transparent', () => {
      const tentative = mk({
        id: 't',
        title: 'Interview — Pooran',
        optional: true,
        startMin: 13 * 60,
        endMin: 14 * 60,
      })
      const maybe = mk({
        id: 'm',
        title: 'Gym?',
        optional: true,
        startMin: 14 * 60,
        endMin: 15 * 60,
      })
      expect(freeWindows([tentative, maybe], D, 13 * 60, 15 * 60)).toEqual([
        { startMin: 14 * 60, endMin: 15 * 60 },
      ])
    })
  })

  describe('freeWindows — the #302 meeting buffer (external blocks only)', () => {
    const meeting = (over: Partial<Block>): Block =>
      mk({ external: { calId: 'work', eventId: 'ev' }, ...over })

    it('buffer 0 is byte-identical to no buffer — the default-off regression pin', () => {
      const m = meeting({ startMin: 11 * 60, endMin: 12 * 60 })
      expect(freeWindows([m], D, 8 * 60, 18 * 60, 0)).toEqual(freeWindows([m], D, 8 * 60, 18 * 60))
    })

    it('inflates an external meeting on BOTH sides, so a gap never abuts its edges', () => {
      const m = meeting({ startMin: 11 * 60, endMin: 12 * 60 })
      expect(freeWindows([m], D, 8 * 60, 18 * 60, 15)).toEqual([
        { startMin: 8 * 60, endMin: 11 * 60 - 15 }, // 10:45 — a candidate ends 15m early
        { startMin: 12 * 60 + 15, endMin: 18 * 60 }, // 12:15 — and starts 15m late
      ])
    })

    it('leaves a FIXED non-external block exact — MEW schedules around it, no margin', () => {
      const interview = mk({ title: 'Interview — Pooran', startMin: 11 * 60, endMin: 12 * 60 })
      expect(isFixedTime(interview)).toBe(true) // fixed by the word heuristic, not calendar
      expect(freeWindows([interview], D, 8 * 60, 18 * 60, 15)).toEqual([
        { startMin: 8 * 60, endMin: 11 * 60 },
        { startMin: 12 * 60, endMin: 18 * 60 },
      ])
    })

    it('left-inflation past an earlier neighbor still closes the gap (inflate THEN sort)', () => {
      const task = mk({ title: 'Deck notes', startMin: 10 * 60, endMin: 10 * 60 + 45 })
      const m = meeting({ startMin: 11 * 60, endMin: 12 * 60 }) // buffer 30 reaches back to 10:30
      expect(freeWindows([task, m], D, 8 * 60, 18 * 60, 30)).toEqual([
        { startMin: 8 * 60, endMin: 10 * 60 }, // before the task
        { startMin: 12 * 60 + 30, endMin: 18 * 60 }, // the buffer swallows the 10:45→10:30 sliver
      ])
    })
  })

  describe('tightMeetingJunction — #302 back-to-back detection (pure)', () => {
    const meeting = (id: string, startMin: number, endMin: number): Block =>
      mk({ id, external: { calId: 'work', eventId: id }, startMin, endMin })

    it('off (buffer 0) never reports a junction', () => {
      const pair = [meeting('a', 13 * 60, 14 * 60), meeting('b', 14 * 60, 15 * 60)]
      expect(tightMeetingJunction(pair, D, 0)).toBeNull()
    })

    it('two abutting meetings report the later start as the pivot', () => {
      const pair = [meeting('a', 13 * 60, 14 * 60), meeting('b', 14 * 60, 15 * 60)]
      expect(tightMeetingJunction(pair, D, 10)).toBe(14 * 60)
    })

    it('a gap wider than the buffer is not back-to-back', () => {
      const pair = [meeting('a', 13 * 60, 14 * 60), meeting('b', 14 * 60 + 20, 15 * 60)]
      expect(tightMeetingJunction(pair, D, 10)).toBeNull()
    })

    it("only external gaps count — MEW's own block between two meetings never invents one", () => {
      const a = meeting('a', 13 * 60, 14 * 60)
      const own = mk({ id: 'own', startMin: 14 * 60, endMin: 14 * 60 + 30 }) // not external
      const b = meeting('b', 15 * 60, 16 * 60) // the a→b external gap is 60m > 10
      expect(tightMeetingJunction([a, own, b], D, 10)).toBeNull()
    })
  })

  describe('findFreeSlot — the #302 buffer on the auto-slot fallback path', () => {
    const meeting = (over: Partial<Block>): Block =>
      mk({ external: { calId: 'work', eventId: 'ev' }, ...over })

    it('buffer 0 is byte-identical to no buffer — the default-off regression pin', () => {
      const m = meeting({ startMin: 11 * 60, endMin: 12 * 60 })
      expect(findFreeSlot([m], D, 60, 8 * 60, 18 * 60, 0)).toEqual(
        findFreeSlot([m], D, 60, 8 * 60, 18 * 60)
      )
    })

    it('without a buffer the fit abuts the meeting; with buffer 15 it shifts shy', () => {
      const m = meeting({ startMin: 9 * 60, endMin: 10 * 60 })
      const wall = mk({ title: 'Wall', startMin: 11 * 60, endMin: 18 * 60 + 30 })
      // the only room is [10:00, 11:00] after the meeting; a 45-min task fits at 10:00
      expect(findFreeSlot([m, wall], D, 45, 10 * 60, 18 * 60 + 30)).toEqual({
        startMin: 10 * 60,
        endMin: 10 * 60 + 45,
      })
      // buffer 15 pushes the meeting's edge to 10:15, so the fit lands shy
      expect(findFreeSlot([m, wall], D, 45, 10 * 60, 18 * 60 + 30, 15)).toEqual({
        startMin: 10 * 60 + 15,
        endMin: 11 * 60,
      })
    })

    it('inflate THEN sort: a left-inflated meeting past an earlier neighbor blocks correctly', () => {
      const own = mk({ id: 'own', startMin: 9 * 60, endMin: 9 * 60 + 30 })
      const m = meeting({ id: 'm', startMin: 9 * 60 + 10, endMin: 9 * 60 + 40 }) // buffer 30 → [8:40,10:10]
      // sorting by inflated start is what keeps the 60-min fit off the meeting's buffer
      expect(findFreeSlot([own, m], D, 60, 8 * 60, 18 * 60, 30)).toEqual({
        startMin: 10 * 60 + 10,
        endMin: 11 * 60 + 10,
      })
    })
  })

  describe('contextMarkers — calendar-owned and fixed-time are different facts', () => {
    it('a MEW-placed sync is fixed but NOT calendar', () => {
      expect(contextMarkers(mk({ title: 'Sync: Jordan/Remy' }))).toBe('work, fixed')
    })

    it('a connected-calendar event is calendar (which already implies fixed)', () => {
      expect(
        contextMarkers(mk({ title: 'Townhall', external: { calId: 'c', eventId: 'e' } }))
      ).toBe('work, calendar')
    })

    it('a plain task carries only its tag, plus state', () => {
      expect(contextMarkers(mk({ title: 'Write the deck' }))).toBe('work')
      expect(
        contextMarkers(mk({ title: 'Lunch', tag: 'private', optional: true, status: 'done' }))
      ).toBe('private, optional, done')
    })
  })
})

describe('background attention — holds the clock, not the slot', () => {
  const restore = mk({
    title: 'iphone restore',
    attention: 'background',
    startMin: 9 * 60,
    endMin: 12 * 60,
  })

  it('is transparent to conflictsWith in both directions', () => {
    expect(conflictsWith([restore], D, 10 * 60, 11 * 60)).toHaveLength(0)
    const meeting = mk({ title: 'design sync', startMin: 10 * 60, endMin: 11 * 60 })
    expect(conflictsWith([restore, meeting], D, 10 * 60 + 30, 11 * 60).map((b) => b.id)).toEqual([
      meeting.id,
    ])
  })

  it('findFreeSlot places straight over a background block', () => {
    const slot = findFreeSlot([restore], D, 60)
    expect(slot).toEqual({ startMin: 8 * 60, endMin: 9 * 60 })
    const wholeMorning = findFreeSlot([restore], D, 180, 9 * 60)
    expect(wholeMorning).toEqual({ startMin: 9 * 60, endMin: 12 * 60 })
  })

  it('freeWindows ignores background time', () => {
    const wins = freeWindows([restore], D, 8 * 60, 13 * 60)
    expect(wins).toEqual([{ startMin: 8 * 60, endMin: 13 * 60 }])
  })

  it('carries its markers for the model: background + due', () => {
    expect(contextMarkers(restore)).toBe('work, background')
    expect(contextMarkers(mk({ ...restore, due: 13 * 60 }))).toBe('work, background, due 13:00')
  })

  it('place() threads attention and due onto the block', () => {
    const placed = place([], {
      title: 'swap',
      tag: 'work',
      dayKey: D,
      durationMin: 180,
      attention: 'background',
      due: 780,
    })
    expect(placed?.attention).toBe('background')
    expect(placed?.due).toBe(780)
    const plain = place([], { title: 'plain', tag: 'work', dayKey: D })
    expect(plain?.attention).toBeUndefined()
    expect(plain?.due).toBeUndefined()
  })
})

describe('looseThreads — a derived query, nothing persisted', () => {
  const now = 14 * 60
  const cap = { id: 'c1', title: 'call the bank', createdAt: 0, status: 'open' as const }

  it('groups running / slipped / paused / unplaced by definition', () => {
    const running = mk({
      id: 'r1',
      title: 'restore',
      attention: 'background',
      startMin: 13 * 60,
      endMin: 16 * 60,
      startedAt: 1,
    })
    const slipped = mk({ id: 's1', title: 'review', startMin: 10 * 60, endMin: 11 * 60 })
    const followUp = mk({
      id: 'p1',
      title: 'deck — rest of it',
      startMin: 16 * 60,
      endMin: 17 * 60,
    })
    const interrupted = mk({
      id: 'i1',
      title: 'deck',
      status: 'rolled' as BlockStatus,
      rolledToId: 'p1',
    })
    const t = looseThreads([running, slipped, followUp, interrupted], [cap], D, now)
    expect(t.running.map((b) => b.id)).toEqual(['r1'])
    expect(t.slipped.map((b) => b.id)).toEqual(['s1'])
    expect(t.paused.map((b) => b.id)).toEqual(['p1'])
    expect(t.unplaced.map((c) => c.id)).toEqual(['c1'])
  })

  it('running needs ALL of: background, started, inside the window', () => {
    const unstarted = mk({ attention: 'background', startMin: 13 * 60, endMin: 16 * 60 })
    const notYet = mk({ attention: 'background', startMin: 15 * 60, endMin: 16 * 60, startedAt: 1 })
    const focusStarted = mk({ startMin: 13 * 60, endMin: 16 * 60, startedAt: 1 })
    expect(looseThreads([unstarted, notYet, focusStarted], [], D, now).running).toHaveLength(0)
  })

  it('optional invites never slip, background never slips, done is done', () => {
    const invite = mk({ optional: true, startMin: 10 * 60, endMin: 11 * 60 })
    const bg = mk({ attention: 'background', startMin: 10 * 60, endMin: 11 * 60 })
    const done = mk({ status: 'done' as BlockStatus, startMin: 10 * 60, endMin: 11 * 60 })
    expect(looseThreads([invite, bg, done], [], D, now).slipped).toHaveLength(0)
  })

  it('paused derives purely from rolledToId — closed captures stay out too', () => {
    const t = looseThreads([], [{ ...cap, status: 'placed' as const }], D, now)
    expect(t.unplaced).toHaveLength(0)
    expect(t.paused).toHaveLength(0)
  })

  describe('overlappingFocus — promotion demotes the whole overlapping cluster', () => {
    const deck = mk({ id: 'deck', title: 'Deck', startMin: 9 * 60, endMin: 11 * 60 })
    const sync = mk({ id: 'sync', title: 'Design sync', startMin: 9.5 * 60, endMin: 10.5 * 60 })
    const review = mk({ id: 'rev', title: 'Code review', startMin: 9.75 * 60, endMin: 10.25 * 60 })

    it('the review repro: promoting code review demotes BOTH other live blocks', () => {
      expect(
        overlappingFocus([deck, sync, review], review)
          .map((b) => b.id)
          .sort()
      ).toEqual(['deck', 'sync'])
    })

    it('promoting a future block leaves a non-overlapping live focus alone', () => {
      const future = mk({ id: 'fut', title: 'Later thing', startMin: 15 * 60, endMin: 16 * 60 })
      expect(overlappingFocus([deck, future], future)).toHaveLength(0)
    })

    it('background and done blocks never need demoting', () => {
      const bg = mk({
        id: 'bg',
        title: 'Restore',
        attention: 'background',
        startMin: 9 * 60,
        endMin: 12 * 60,
      })
      const done = mk({
        id: 'dn',
        title: 'Done thing',
        status: 'done',
        startMin: 9 * 60,
        endMin: 10 * 60,
      })
      expect(overlappingFocus([bg, done, review], review)).toHaveLength(0)
    })
  })
})

describe('flexibility prefs override the fixed-time heuristic', () => {
  const movableSyncs = [
    {
      kind: 'flexibility' as const,
      match: 'sync',
      value: 'can always move',
      stated: 'my syncs are movable',
    },
  ]

  it('a "sync" title stops being fixed when the rule says so — and vice versa', () => {
    const sync = mk({ title: 'Weekly sync' })
    expect(isFixedTime(sync)).toBe(true)
    expect(isFixedTime(sync, movableSyncs)).toBe(false)
    const pages = mk({ title: 'Morning pages' })
    expect(
      isFixedTime(pages, [
        { kind: 'flexibility', match: 'pages', value: 'never moves', stated: 's' },
      ])
    ).toBe(true)
  })

  it('external events never flip — the calendar still owns them', () => {
    const ext = mk({ title: 'Weekly sync', external: { calId: 'c', eventId: 'e' } })
    expect(isFixedTime(ext, movableSyncs)).toBe(true)
  })

  it('conflictsWith follows: an optional movable sync goes transparent', () => {
    const tentative = mk({
      id: 'sy',
      title: 'Weekly sync',
      optional: true,
      startMin: 13 * 60,
      endMin: 14 * 60,
    })
    expect(conflictsWith([tentative], D, 13 * 60, 13.5 * 60).map((b) => b.id)).toEqual(['sy'])
    expect(conflictsWith([tentative], D, 13 * 60, 13.5 * 60, undefined, movableSyncs)).toHaveLength(
      0
    )
  })
})

describe('rollup — real sums for "how much has X eaten"', () => {
  const days = ['2026-06-08', D, '2026-06-10']
  const spica = (over: Partial<Block>) => mk({ title: 'Deck for Spicanova', ...over })

  it('sums planned and done minutes over the given days, counting statuses', () => {
    const blocks = [
      spica({ startMin: 9 * 60, endMin: 10 * 60, status: 'done' }), // 60 done
      spica({ startMin: 11 * 60, endMin: 12 * 60 + 30 }), // 90 open
      spica({ dayKey: '2026-06-10', startMin: 9 * 60, endMin: 9 * 60 + 45 }), // 45 open
      mk({ title: 'Inbox sweep' }), // different subject — out by matcher
    ]
    const r = rollup(blocks, days, (b) => b.title.includes('Spicanova'))
    expect(r).toEqual({ plannedMin: 195, doneMin: 60, done: 1, open: 2, rolled: 0 })
  })

  it('rolled blocks count once as a fact, never as time (the moved copy holds it)', () => {
    const blocks = [
      spica({ status: 'rolled' }),
      spica({ dayKey: '2026-06-10', startMin: 9 * 60, endMin: 10 * 60 }), // the landed copy
    ]
    const r = rollup(blocks, days, (b) => b.title.includes('Spicanova'))
    expect(r.plannedMin).toBe(60)
    expect(r.rolled).toBe(1)
  })

  it('optional blocks hold no time; days outside the window stay out', () => {
    const blocks = [
      spica({ optional: true }),
      spica({ dayKey: '2026-06-15', startMin: 9 * 60, endMin: 11 * 60 }), // next week
    ]
    const r = rollup(blocks, days, () => true)
    expect(r.plannedMin).toBe(0)
    expect(r.open).toBe(0)
  })
})

describe('resolveReferent — sentinel + live week → concrete block (#320)', () => {
  // A fixture Tuesday: lunch anchors a before/after pair; a 15:00 block for "@at".
  const NOW = 9 * 60 + 40
  const TOMORROW = '2026-06-10'
  const week = [
    mk({ id: 'deck', title: 'Q3 deck', startMin: 9 * 60, endMin: 10 * 60 + 30 }),
    mk({ id: 'lunch', title: 'Lunch', tag: 'private', startMin: 12 * 60, endMin: 13 * 60 }),
    mk({ id: 'review', title: 'Spec review', startMin: 14 * 60, endMin: 15 * 60 }),
    mk({ id: 'call', title: 'Client call', startMin: 15 * 60, endMin: 16 * 60 }),
    mk({ id: 'done1', title: 'Standup', status: 'done', startMin: 8 * 60, endMin: 8 * 60 + 30 }),
  ]

  it('a plain title is passthrough (the caller resolves it normally)', () => {
    expect(resolveReferent(week, 'deck', null, D, NOW)).toEqual({ status: 'passthrough' })
  })

  it('@referent resolves the session id — and asks (none) when it is gone', () => {
    expect(resolveReferent(week, '@referent', 'review', D, NOW)).toEqual({
      status: 'ok',
      block: week[2],
    })
    expect(resolveReferent(week, '@referent', null, D, NOW)).toEqual({ status: 'none' })
    expect(resolveReferent(week, '@referent', 'ghost', D, NOW)).toEqual({ status: 'none' })
  })

  it('@after / @before resolve adjacency to a named anchor, same day', () => {
    // after lunch (12–13) → the next block by start: the 14:00 review
    expect(resolveReferent(week, '@after:lunch', null, D, NOW)).toMatchObject({
      status: 'ok',
      block: { id: 'review' },
    })
    // before lunch → the latest block ending by 12:00: the 9:00 deck
    expect(resolveReferent(week, '@before:lunch', null, D, NOW)).toMatchObject({
      status: 'ok',
      block: { id: 'deck' },
    })
    // an anchor that isn't on the week → none, never a guess
    expect(resolveReferent(week, '@after:dentist', null, D, NOW)).toEqual({ status: 'none' })
  })

  it('@next is the next open block from now', () => {
    expect(resolveReferent(week, '@next', null, D, 11 * 60)).toMatchObject({
      status: 'ok',
      block: { id: 'lunch' },
    })
  })

  it('@at resolves the block at that clock time', () => {
    expect(resolveReferent(week, '@at:900', null, D, NOW)).toMatchObject({
      status: 'ok',
      block: { id: 'call' }, // 15:00
    })
    expect(resolveReferent(week, '@at:840', null, D, NOW)).toMatchObject({
      status: 'ok',
      block: { id: 'review' }, // 14:00
    })
  })

  it('@at is ambiguous when two open blocks share the time on the soonest day', () => {
    const clash = [
      mk({ id: 'a', title: 'A', startMin: 15 * 60, endMin: 16 * 60 }),
      mk({ id: 'b', title: 'B', startMin: 15 * 60, endMin: 15 * 60 + 30 }),
    ]
    const r = resolveReferent(clash, '@at:900', null, D, NOW)
    expect(r.status).toBe('ambiguous')
    if (r.status === 'ambiguous') expect(r.candidates).toHaveLength(2)
  })

  it('@at prefers the soonest day, not an ambiguity, across days', () => {
    const acrossDays = [
      mk({ id: 'today3', title: 'Today 3pm', startMin: 15 * 60, endMin: 16 * 60, dayKey: D }),
      mk({
        id: 'tmw3',
        title: 'Tomorrow 3pm',
        startMin: 15 * 60,
        endMin: 16 * 60,
        dayKey: TOMORROW,
      }),
    ]
    expect(resolveReferent(acrossDays, '@at:900', null, D, NOW)).toMatchObject({
      status: 'ok',
      block: { id: 'today3' },
    })
  })
})

describe('seriesMembership — recurring-scope relevance (#343)', () => {
  const series = (over: Partial<Block> & { dayKey: string }) =>
    mk({ title: 'Gym', recurringBlockId: 'r1', startMin: 7 * 60, endMin: 8 * 60, ...over })
  const three = [
    series({ id: 'a', dayKey: '2026-06-09' }),
    series({ id: 'b', dayKey: '2026-06-10' }),
    series({ id: 'c', dayKey: '2026-06-11' }),
  ]

  it('is null for a one-off block (no recurringBlockId)', () => {
    expect(seriesMembership(three, mk({ id: 'solo' }))).toBeNull()
  })

  it('reports the shared id, the open count, and first/middle/last position', () => {
    expect(seriesMembership(three, three[0])).toEqual({
      recurringBlockId: 'r1',
      position: 'first',
      count: 3,
    })
    expect(seriesMembership(three, three[1])!.position).toBe('middle')
    expect(seriesMembership(three, three[2])!.position).toBe('last')
  })

  it("is 'only' with count 1 when the block stands alone in its series", () => {
    const [solo] = three
    expect(seriesMembership([solo], solo)).toEqual({
      recurringBlockId: 'r1',
      position: 'only',
      count: 1,
    })
  })

  it('counts open occurrences only — a done sibling is off the count', () => {
    const withDone = [three[0], three[1], series({ id: 'c', dayKey: '2026-06-11', status: 'done' })]
    const m = seriesMembership(withDone, three[0])!
    expect(m.count).toBe(2)
    expect(seriesMembership(withDone, withDone[1])!.position).toBe('last')
  })
})

describe('nextFreeSlot — the cross-day "next free slot" search (#335)', () => {
  it('returns the soonest clear window from fromMin on today when one fits', () => {
    // today (D) holds 9–10; a 60-min task from 9:00 lands at 10:00
    const busy = [mk({ startMin: 9 * 60, endMin: 10 * 60 })]
    const slot = nextFreeSlot(busy, D, 9 * 60, 60)
    expect(slot).toEqual({ dayKey: D, startMin: 10 * 60 })
  })

  it('rolls forward to the next day when today is packed to the cap', () => {
    // fill the whole working day so nothing fits today → the search steps to D+1
    const full = [mk({ startMin: 8 * 60, endMin: 18 * 60 + 30 })]
    const slot = nextFreeSlot(full, D, 8 * 60, 60)
    expect(slot).toEqual({ dayKey: '2026-06-10', startMin: 8 * 60 })
  })

  it('lands clear of a fixed/external block — never over it', () => {
    // a calendar meeting 9–11; a 60-min task from 8:00 must take 8:00 (before) or 11:00 (after)
    const ext = mk({
      startMin: 9 * 60,
      endMin: 11 * 60,
      external: { calId: 'c', eventId: 'e' },
    } as Partial<Block>)
    const slot = nextFreeSlot([ext], D, 9 * 60 + 30, 60) // from 9:30, mid-meeting
    expect(slot).toEqual({ dayKey: D, startMin: 11 * 60 }) // after the meeting, not over it
  })

  it('returns null when nothing fits inside the horizon', () => {
    // every day full across a 1-day horizon
    const wall = [
      mk({ dayKey: D, startMin: 8 * 60, endMin: 18 * 60 + 30 }),
      mk({ dayKey: '2026-06-10', startMin: 8 * 60, endMin: 18 * 60 + 30 }),
    ]
    expect(nextFreeSlot(wall, D, 8 * 60, 60, 1)).toBeNull()
  })
})
