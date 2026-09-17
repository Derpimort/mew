/* #14 polish: protect-rest remembers each rest block it asked about, not one
   key per nudge type. Before, the one type slot held the LAST rest asked about,
   so rest A → rest B → rest A the same day asked about A twice, and while A's
   collision stood a later collision on rest B stayed hidden behind it. Now each
   rest block (id × its day) gets its one ask, whichever line asks, a different
   rest still speaks, and a new day starts fresh. Pure: buildCtx + evaluateTick,
   with recordFired standing in for the store's markFired. */

import { describe, expect, it } from 'vitest'
import {
  buildCtx,
  evaluateTick,
  recordFired,
  restFiredKey,
  type EngineState,
  type TickInputs,
} from '../engine'
import type { NudgeInstance } from '../library'
import type { Block } from '../../types'
import type { MemoryAggregates } from '../../memory'

const D = '2026-06-09' // a Tuesday — no Monday fresh-start to outrank protect-rest
const D2 = '2026-06-10'
const NOW_MS = Date.UTC(2026, 5, 9, 9, 0)
const MIN = 60_000

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Block',
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

const agg: MemoryAggregates = {
  realisticBestH: 5.5,
  carryRatioByWeek: [0.1, 0.1, 0.1, 0.1],
  carryRatio: 0.1,
  restKeptRatio: 0.9,
  restSkippedStreak: 0,
}

const fresh: EngineState = { lastFired: {}, lastDriftBlockId: null }

/** one tick at `atMs`: the protect-rest ask it posts (if any), and the engine
    state after the store records it */
function step(
  blocks: Block[],
  engine: EngineState,
  atMs: number,
  over: Partial<TickInputs> = {}
): { ask: NudgeInstance | undefined; engine: EngineState } {
  const todayKey = over.todayKey ?? D
  const ctx = buildCtx(
    {
      nowMs: atMs,
      nowMin: 9 * 60,
      todayKey,
      blocks,
      agg,
      idleMin: 0,
      interruptionsLastHour: 0,
      guardUntilMin: null,
      ...over,
    },
    engine
  )
  const ask = evaluateTick(ctx).find((x) => x.type === 'protect-rest')
  return {
    ask,
    engine: ask
      ? { ...engine, lastFired: recordFired(engine.lastFired, ask, atMs, todayKey) }
      : engine,
  }
}

/* rest A in the early evening, rest B later; work set to run over each */
const restA = mk({
  id: 'rest-walk',
  title: 'evening walk',
  tag: 'rest',
  startMin: 18 * 60,
  endMin: 18 * 60 + 45,
})
const workA = mk({ id: 'work-deck', title: 'deck', startMin: 17 * 60 + 30, endMin: 18 * 60 + 30 })
const workA2 = mk({ id: 'work-notes', title: 'notes', startMin: 18 * 60 + 15, endMin: 19 * 60 })
const restB = mk({
  id: 'rest-read',
  title: 'reading',
  tag: 'rest',
  startMin: 20 * 60,
  endMin: 21 * 60,
})
const workB = mk({ id: 'work-email', title: 'email', startMin: 20 * 60 + 15, endMin: 20 * 60 + 45 })

describe('protect-rest — each rest block gets its one ask (#14)', () => {
  it('rest A → rest B → rest A the same day: A is asked about once, and B gets its own ask', () => {
    let e = fresh
    let r = step([restA, workA], e, NOW_MS)
    expect(r.ask?.key).toBe(`rest-walk|${D}`)
    e = r.engine

    /* A's collision still stands; B's is new — B speaks, not hidden behind A */
    r = step([restA, workA, restB, workB], e, NOW_MS + 30 * MIN)
    expect(r.ask?.key).toBe(`rest-read|${D}`)
    expect(r.ask?.body).toBe('email is set to run over your reading — keep it?')
    e = r.engine

    /* B's work moved off; different work lands on A again — A stays quiet */
    r = step([restA, workA2, restB], e, NOW_MS + 60 * MIN)
    expect(r.ask).toBeUndefined()
    r = step([restA, workA, restB, workB], e, NOW_MS + 90 * MIN)
    expect(r.ask).toBeUndefined()
  })

  it("the slipped-rest line and the collision line share the rest's one ask", () => {
    const streak = { agg: { ...agg, restSkippedStreak: 2 } }
    /* the collision asks first; with the collision gone, the slipped-rest line
       stays quiet, even past the 12-hour cooldown the same day */
    let r = step([restA, workA], fresh, NOW_MS, streak)
    expect(r.ask?.key).toBe(`rest-walk|${D}`)
    expect(step([restA], r.engine, NOW_MS + 13 * 60 * MIN, streak).ask).toBeUndefined()

    /* the slipped-rest line asks first; a collision on the same rest stays quiet */
    r = step([restA], fresh, NOW_MS, streak)
    expect(r.ask?.body).toMatch(/^Rest has slipped two days running/)
    expect(r.ask?.key).toBe(`rest-walk|${D}`)
    expect(step([restA, workA], r.engine, NOW_MS + 13 * 60 * MIN, streak).ask).toBeUndefined()
  })

  it("a new day starts fresh, and yesterday's rest slots are swept", () => {
    const r = step([restA, workA], fresh, NOW_MS)
    expect(r.engine.lastFired[restFiredKey(restA)]).toEqual({ ts: NOW_MS, key: D })

    const nextDay = [
      { ...restA, dayKey: D2 },
      { ...workA, dayKey: D2 },
    ]
    const next = step(nextDay, r.engine, NOW_MS + 24 * 60 * MIN, { todayKey: D2 })
    expect(next.ask?.key).toBe(`rest-walk|${D2}`)
    expect(next.engine.lastFired[restFiredKey(restA)]).toBeUndefined()
    expect(next.engine.lastFired[restFiredKey({ id: 'rest-walk', dayKey: D2 })]).toBeDefined()
  })

  it("tomorrow's rest asked about today keeps its slot until its day has passed", () => {
    const tomorrow = [
      { ...restA, dayKey: D2 },
      { ...workA, dayKey: D2 },
    ]
    const r = step(tomorrow, fresh, NOW_MS)
    expect(r.ask?.key).toBe(`rest-walk|${D2}`)
    /* far past the 12-hour cooldown, still today: that rest was asked about */
    expect(step(tomorrow, r.engine, NOW_MS + 13 * 60 * MIN).ask).toBeUndefined()
    /* on its own day it's the same ask, still answered */
    expect(step(tomorrow, r.engine, NOW_MS + 24 * 60 * MIN, { todayKey: D2 }).ask).toBeUndefined()
  })

  it('recordFired keeps the type slot for every nudge, and adds a rest slot only for protect-rest', () => {
    const other: NudgeInstance = {
      type: 'drift',
      label: 'drift',
      body: 'still on it?',
      footnote: '',
      actions: [],
      payload: {},
      key: 'rest-walk|2026-06-09',
    }
    expect(recordFired({}, other, NOW_MS, D)).toEqual({
      drift: { ts: NOW_MS, key: 'rest-walk|2026-06-09' },
    })
  })
})
