/* All-day entries (#27) at the domain layer: one predicate, and every reader
   of claimed time skips on it. The fixtures deliberately give the holiday the
   WORST legacy shape — tagged work, spanning 0:00–23:59 — so each assertion
   proves the allDay flag does the work (a stored all-day block is a zero span,
   which would hide a missing predicate). Where it sharpens the point, the same
   block WITHOUT the flag is the control: that is the live bug the owner saw. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import type { MemoryAggregates } from '../memory'
import {
  allDayOn,
  conflictsWith,
  contextMarkers,
  dayClear,
  dayEndMin,
  DAY_START,
  findFreeSlot,
  freeWindows,
  isAllDay,
  isDeep,
  loadBySegment,
  looseThreads,
  openItems,
  overlappingFocus,
  plannedDeepMin,
  rollup,
  tightMeetingJunction,
} from '../week'
import { liveNow } from '../liveNow'
import { detectRescues } from '../rescue'
import { buildCtx, findHeavyDay, type TickInputs } from '../nudges/engine'
import { composeMorningBrief, pickMorningRisk } from '../nudges/brief'
import { composeWeeklyRitual } from '../nudges/weekly'
import { restInsertion, scoreSlots } from '../scheduler'
import { dayShape } from '../dayShape'
import { computeInsights, dayLoadAssessment, proposeKinderPlan, trimMove } from '../insights'
import { listReadout } from '../listing'

const MON = '2026-09-21'
const TUE = '2026-09-22'
const WED = '2026-09-23'
const THU = '2026-09-24'
const SUN = '2026-09-20'
const FULL_DAY = 23 * 60 + 59

function mk(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Q3 deck',
    tag: 'work',
    dayKey: MON,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/** The owner's Civic Holiday, in its most hostile shape. */
function holiday(over: Partial<Block> = {}): Block {
  return mk({
    id: 'holiday',
    title: 'Civic Holiday',
    startMin: 0,
    endMin: FULL_DAY,
    protected: false,
    external: { calId: 'work@acme', eventId: 'civic' },
    calendarRefs: ['work@acme'],
    allDay: true,
    ...over,
  })
}

/** The same event as the pre-#27 clamp stored it — no flag: the control. */
const legacy = (): Block => {
  const { allDay: _flag, ...rest } = holiday()
  return rest
}

const agg: MemoryAggregates = {
  realisticBestH: 5,
  carryRatioByWeek: [0.1, 0.1, 0.1, 0.1],
  carryRatio: 0.1,
  restKeptRatio: 0.9,
  restSkippedStreak: 0,
}

describe('the predicate and the covered days', () => {
  it('isAllDay reads only the flag — never a 0:00–23:59 heuristic', () => {
    expect(isAllDay(holiday())).toBe(true)
    expect(isAllDay(legacy())).toBe(false) // a stored legacy block heals on load, not at read time
    expect(isAllDay(holiday({ allDay: false }))).toBe(false)
  })

  it('a Mon–Wed OOO labels Monday, Tuesday AND Wednesday — never Sunday or Thursday', () => {
    const ooo = holiday({ id: 'ooo', title: 'OOO', endDayKey: WED })
    const one = holiday({ id: 'one', title: 'Birthday', dayKey: TUE })
    const blocks = [ooo, one, mk({ dayKey: TUE })]
    expect(allDayOn(blocks, MON).map((b) => b.id)).toEqual(['ooo'])
    expect(allDayOn(blocks, TUE).map((b) => b.id)).toEqual(['ooo', 'one'])
    expect(allDayOn(blocks, WED).map((b) => b.id)).toEqual(['ooo'])
    expect(allDayOn(blocks, SUN)).toEqual([])
    expect(allDayOn(blocks, THU)).toEqual([])
  })

  it('a rolled all-day entry labels nothing', () => {
    expect(allDayOn([holiday({ status: 'rolled' })], MON)).toEqual([])
  })
})

describe('true totals — an all-day label is never load', () => {
  it('loadBySegment, plannedDeepMin, rollup and isDeep leave it out', () => {
    const blocks = [holiday(), mk({ endMin: 11 * 60 })]
    expect(loadBySegment(blocks, MON)).toEqual({ work: 120, priv: 0, rest: 0 })
    expect(plannedDeepMin(blocks, MON)).toBe(120)
    expect(isDeep(holiday())).toBe(false)
    expect(rollup(blocks, [MON], () => true)).toMatchObject({ plannedMin: 120, open: 1 })
    // the control: unflagged, the same event reads as ~24h of deep work
    expect(plannedDeepMin([legacy(), mk({ endMin: 11 * 60 })], MON)).toBe(120 + FULL_DAY)
  })

  it('the Civic-Holiday Monday is never the heavy day (the 29.5h header)', () => {
    const monday = [holiday(), mk({ startMin: 9 * 60, endMin: 12 * 60 })]
    expect(findHeavyDay(monday, MON, 5)).toBeNull()
    expect(findHeavyDay([legacy(), monday[1]], MON, 5)).toMatchObject({ dayKey: MON })
  })

  it('the day-load meter counts only real work', () => {
    const blocks = [holiday(), mk({ startMin: 9 * 60, endMin: 12 * 60 })]
    expect(dayLoadAssessment(blocks, MON, 240)).toMatchObject({ plannedMin: 180, over: false })
  })
})

describe('transparent to slot search and conflicts — MEW schedules through a holiday', () => {
  it('conflictsWith never names it; the unflagged control does', () => {
    expect(conflictsWith([holiday()], MON, 13 * 60, 14 * 60)).toEqual([])
    expect(conflictsWith([legacy()], MON, 13 * 60, 14 * 60).map((b) => b.id)).toEqual(['holiday'])
  })

  it('findFreeSlot and freeWindows see the whole day as air', () => {
    expect(findFreeSlot([holiday()], MON, 60)).toEqual({
      startMin: DAY_START,
      endMin: DAY_START + 60,
    })
    expect(freeWindows([holiday()], MON, 9 * 60, 17 * 60)).toEqual([
      { startMin: 9 * 60, endMin: 17 * 60 },
    ])
    expect(findFreeSlot([legacy()], MON, 60)).toBeNull()
  })

  it('never a focus to demote, never half of a tight meeting pair', () => {
    const target = mk({ id: 'deck', startMin: 13 * 60, endMin: 14 * 60 })
    expect(overlappingFocus([holiday(), target], target)).toEqual([])
    const standup = mk({
      id: 'standup',
      startMin: 5,
      endMin: 20,
      external: { calId: 'work@acme', eventId: 's' },
    })
    expect(tightMeetingJunction([holiday(), standup], MON, 10)).toBeNull()
  })

  it('the scheduler ranks and paces as if the label were not there', () => {
    const run = [
      mk({ startMin: 8 * 60, endMin: 10 * 60 }),
      mk({ startMin: 10 * 60, endMin: 12 * 60 }),
    ]
    expect(restInsertion([holiday(), ...run], MON)).toEqual(restInsertion(run, MON))
    const q = { title: 'Write spec', tag: 'work' as const, durationMin: 60 }
    expect(scoreSlots([holiday(), ...run], q, MON, 7 * 60)).toEqual(scoreSlots(run, q, MON, 7 * 60))
  })

  it('dayShape reads no dead air or streak from midnight', () => {
    const day = [mk({ startMin: 9 * 60, endMin: 10 * 60 })]
    expect(dayShape([holiday(), ...day], MON)).toEqual(dayShape(day, MON))
  })
})

describe('never the countdown — "Finish Civic Holiday. 573:04" cannot return', () => {
  it('liveNow never makes it current or next, nor counts it as a task', () => {
    const lunch = mk({
      id: 'lunch',
      title: 'Lunch',
      tag: 'private',
      startMin: 12 * 60,
      endMin: 13 * 60,
    })
    const at = liveNow([holiday(), lunch], MON, 10 * 60)
    expect(at.current).toBeUndefined()
    expect(at.next?.id).toBe('lunch')
    expect(at.minutesLeft).toBeUndefined()
    expect(at.headline).toBe('Next: Lunch.')
    expect(at.openToday).toBe(1)
    const bare = liveNow([holiday()], MON, 10 * 60)
    expect(bare.headline).toBe('A clear stretch.')
    // the control is the live bug, verbatim
    expect(liveNow([legacy()], MON, 10 * 60 + 26).headline).toBe('Finish Civic Holiday.')
  })

  it('a holiday never holds a day open, never slips, never extends the day', () => {
    const done = mk({ status: 'done' })
    expect(dayClear([holiday(), done], MON)).toBe(true)
    expect(openItems([holiday(), done], MON)).toEqual([])
    expect(dayEndMin([holiday()], MON)).toBe(18 * 60 + 30)
    expect(looseThreads([holiday()], [], MON, 15 * 60).slipped).toEqual([])
  })
})

describe('no nudge from an all-day span', () => {
  const lunch = mk({ id: 'lunch', title: 'Lunch', tag: 'rest', startMin: 12 * 60, endMin: 13 * 60 })
  const tick = (blocks: Block[], nowMin = 9 * 60): TickInputs => ({
    nowMs: new Date(2026, 8, 21, Math.floor(nowMin / 60), nowMin % 60).getTime(),
    nowMin,
    todayKey: MON,
    blocks,
    agg,
    idleMin: 0,
    interruptionsLastHour: 0,
    guardUntilMin: null,
  })
  const fresh = { lastFired: {}, lastDriftBlockId: null }

  it('protect-rest: the civic holiday never "runs over your lunch"', () => {
    expect(buildCtx(tick([holiday(), lunch]), fresh).restCollision).toBeNull()
    // the control: the exact false conflict the owner was asked to keep
    expect(buildCtx(tick([legacy(), lunch]), fresh).restCollision).toMatchObject({
      rest: { id: 'lunch' },
      intruder: { id: 'holiday' },
    })
  })

  it('rescue: an inbound all-day event lands on nothing', () => {
    const deck = mk({ id: 'deck', startMin: 13 * 60, endMin: 15 * 60 })
    expect(detectRescues([deck], [deck, holiday()], MON)).toEqual([])
    expect(detectRescues([deck], [deck, legacy()], MON)).toHaveLength(1)
  })

  it('post-buffer and the early-finish micro-break read only timed blocks', () => {
    const meeting = mk({
      id: 'sync',
      title: 'Planning sync',
      startMin: 9 * 60,
      endMin: 10 * 60,
      external: { calId: 'work@acme', eventId: 'p' },
    })
    const ctx = buildCtx(tick([holiday(), meeting], 10 * 60 + 5), fresh)
    expect(ctx.justEndedFixed?.id).toBe('sync')
    const deck = mk({ id: 'deck', startMin: 10 * 60, endMin: 12 * 60 })
    const early = buildCtx(tick([holiday(), deck], 11 * 60), fresh, { justCompleted: deck })
    expect(early.earlyGapMin).toBe(60)
    expect(early.workStreakMin).toBe(60) // anchored at 10:00, not at the holiday's midnight
  })

  it('the morning brief shapes the timed day; the weekly ritual counts no holiday as a meeting', () => {
    const insights = computeInsights([], agg, new Date(2026, 8, 21, 8))
    const a = mk({ id: 'a', startMin: 9 * 60, endMin: 10 * 60 })
    expect(pickMorningRisk([holiday(), a], MON)).toBeNull()
    expect(composeMorningBrief([holiday(), a], MON, insights).body).toContain(
      'today: 1 block, 9:00–10:00'
    )
    expect(composeWeeklyRitual([holiday()], SUN, insights).body).toContain(
      'the calendar is a clean page'
    )
  })
})

describe('insights never move or weigh a day label', () => {
  /* an all-day label adopted as MEW's own (its calendar gone) is the one shape
     these movers could otherwise reach — given a real clock span here so only
     the flag can keep it put */
  const adopted = (flag: boolean): Block => {
    const { allDay: _flag, ...rest } = holiday({
      dayKey: TUE,
      startMin: 9 * 60,
      endMin: 10 * 60,
      external: undefined,
      calendarRefs: [],
    })
    return flag ? { ...rest, allDay: true } : rest
  }

  it('trimMove never offers to move a holiday off an over-line day', () => {
    const deck = mk({
      id: 'deck',
      title: 'Spec draft',
      dayKey: TUE,
      startMin: 10 * 60,
      endMin: 16 * 60,
    })
    expect(trimMove([adopted(true), deck], TUE, MON, 8 * 60, 300)).toBeNull()
    expect(trimMove([adopted(false), deck], TUE, MON, 8 * 60, 300)?.blockId).toBe('holiday')
  })

  it('the kinder plan never shifts a holiday onto a lighter day', () => {
    const light = { ...agg, realisticBestH: 1 }
    const deep = mk({
      id: 'deep',
      title: 'Deep work',
      dayKey: TUE,
      startMin: 13 * 60,
      endMin: 14 * 60,
    })
    // flagged: Tuesday holds 1h of real deep work — within the line, nothing moves
    expect(proposeKinderPlan([adopted(true), deep], light, MON, findFreeSlot).moves).toEqual([])
    // the control: the label counts as deep work and gets shipped to Wednesday
    expect(proposeKinderPlan([adopted(false), deep], light, MON, findFreeSlot).moves).toMatchObject(
      [{ blockId: 'holiday', fromDayKey: TUE, toDayKey: WED }]
    )
  })
})

describe('the chat surface reads it as a day label', () => {
  it('contextMarkers: tag-neutral, with the span when there is one', () => {
    expect(contextMarkers(holiday())).toBe('all-day, calendar')
    expect(contextMarkers(holiday({ endDayKey: WED }))).toBe(`all-day through ${WED}, calendar`)
  })

  it('listReadout shows it on every covered day, never as a clock span or under a tag', () => {
    const ooo = holiday({ id: 'ooo', title: 'OOO', endDayKey: WED })
    const blocks = [ooo, mk({ dayKey: TUE, title: 'Q3 deck' })]
    const tue = listReadout(blocks, { dayKeys: [TUE], todayKey: MON })
    expect(tue).toBe(
      `here's tomorrow:\n- all day OOO [all-day through ${WED}, calendar]\n- 9:00–10:00 Q3 deck [work]`
    )
    expect(listReadout(blocks, { dayKeys: [WED], todayKey: MON })).toContain('- all day OOO')
    expect(listReadout(blocks, { dayKeys: [TUE], todayKey: MON, tag: 'work' })).not.toContain('OOO')
  })
})
