import { describe, expect, it } from 'vitest'
import { buildCtx, evaluateTick, type EngineState, type TickInputs } from '../engine'
import type { Block } from '../../types'
import type { MemoryAggregates } from '../../memory'

/* The live bug (#326): the rest-encroachment nudge composed a doubled-title
   run-on — "…lands on your grocery pickup for meal prep. the grocery pickup for
   meal prep is yours — keep it?" — and it re-fired on every placement in a
   burst. These pin the fix against the transcript's own block names. */

const D = '2026-06-09' // a Tuesday — no Monday fresh-start to outrank protect-rest

// the transcript's block names, verbatim
const WORK = 'stabilize and push v1.2-rc (main release rc)'
const ERRAND = 'grocery pickup for meal prep'

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

const NOW_MS = Date.UTC(2026, 5, 9, 9, 0)

function tick(over: Partial<TickInputs>): TickInputs {
  return {
    nowMs: NOW_MS,
    nowMin: 9 * 60, // 09:00 — ahead of every fixture block, so nothing is live (no drift)
    todayKey: D,
    blocks: [],
    agg,
    idleMin: 0,
    interruptionsLastHour: 0,
    guardUntilMin: null,
    ...over,
  }
}

const fresh: EngineState = { lastFired: {}, lastDriftBlockId: null }

/* the transcript's shape: an errand long enough to BE rest (private, ≥30 min,
   protected) with a work block scheduled to run over it. */
function restCollisionBlocks(restId = 'rest-groceries', workId = 'work-rc') {
  const rest = mk({
    id: restId,
    title: ERRAND,
    tag: 'private',
    startMin: 18 * 60,
    endMin: 18 * 60 + 45,
    protected: true,
  })
  const intruder = mk({
    id: workId,
    title: WORK,
    tag: 'work',
    startMin: 17 * 60 + 30,
    endMin: 18 * 60 + 30,
  })
  return { rest, intruder, blocks: [rest, intruder] }
}

const firedInstance = (
  blocks: Block[],
  engine: EngineState = fresh,
  over: Partial<TickInputs> = {}
) =>
  evaluateTick(buildCtx(tick({ blocks, ...over }), engine)).find((x) => x.type === 'protect-rest')

describe('protect-rest — one clean line (#326)', () => {
  it('composes ONE sentence, naming the work and the rest once each — no doubled title', () => {
    const { blocks } = restCollisionBlocks()
    const n = firedInstance(blocks)
    expect(n).toBeDefined()
    const body = n!.body

    // the garbled transcript must never reappear
    expect(body).not.toContain('lands on your')
    expect(body).not.toMatch(/is yours — keep it\?/)

    // ONE sentence: no interior sentence break, exactly one terminal question
    expect(body).not.toMatch(/\.\s/)
    expect(body.match(/\?/g)).toHaveLength(1)

    // each title appears exactly once — the doubling is gone
    expect(body.toLowerCase().split(ERRAND).length - 1).toBe(1)
    expect(body.toLowerCase().split(WORK.toLowerCase()).length - 1).toBe(1)

    // the errand is named naturally, by its own title
    expect(body).toContain(WORK)
    expect(body).toContain(ERRAND)
  })

  it('reads positive and carries both chips through the executor unchanged', () => {
    const { blocks, rest, intruder } = restCollisionBlocks()
    const n = firedInstance(blocks)!
    expect(n.actions.map((a) => a.id)).toEqual(['keeprest', 'moverest'])
    expect(n.actions.map((a) => a.label)).toEqual(['Keep it', 'Move the rest instead'])
    // the store's protect-rest:keeprest / :moverest handlers read these keys
    expect(n.payload).toEqual({ restId: rest.id, intruderId: intruder.id })
  })

  it('MEW_VOICE: the {stupid, wrong, failed} vocabulary stays absent', () => {
    const { blocks } = restCollisionBlocks()
    expect(firedInstance(blocks)!.body).not.toMatch(/\b(stupid|wrong|failed)\b/i)
  })
})

describe('protect-rest — dedup per (rest block × day) (#326)', () => {
  it('keys the fire on the rest block and day, not the intruder', () => {
    const { blocks, rest } = restCollisionBlocks()
    expect(firedInstance(blocks)!.key).toBe(`${rest.id}|${rest.dayKey}`)
  })

  it('fires once, then a burst of new placements on the same rest does not re-fire', () => {
    const { blocks, rest } = restCollisionBlocks()
    const first = firedInstance(blocks)!
    expect(first).toBeDefined()

    // the store records { ts, key: n.key } after a nudge posts — mirror that
    const afterFire: EngineState = {
      lastFired: { 'protect-rest': { ts: NOW_MS, key: first.key } },
      lastDriftBlockId: null,
    }

    // 30s later (same minute): the SAME rest, a DIFFERENT work block lands on it
    const otherWork = mk({
      id: 'work-hotfix',
      title: 'hotfix the login bug',
      tag: 'work',
      startMin: 18 * 60 + 10,
      endMin: 18 * 60 + 40,
    })
    const burst = firedInstance([rest, otherWork], afterFire, { nowMs: NOW_MS + 30_000 })
    expect(burst).toBeUndefined()
  })

  it('the dedup is scoped to the rest block: a different rest the same day still speaks', () => {
    const { rest } = restCollisionBlocks()
    const afterFire: EngineState = {
      lastFired: { 'protect-rest': { ts: NOW_MS, key: `${rest.id}|${rest.dayKey}` } },
      lastDriftBlockId: null,
    }

    // a second, distinct rest block gets encroached later the same day
    const otherRest = mk({
      id: 'rest-lunch',
      title: 'lunch walk',
      tag: 'rest',
      startMin: 12 * 60,
      endMin: 12 * 60 + 45,
      protected: true,
    })
    const otherWork = mk({
      id: 'work-review',
      title: 'design review',
      tag: 'work',
      startMin: 12 * 60 + 15,
      endMin: 13 * 60,
    })
    const n = firedInstance([otherRest, otherWork], afterFire, { nowMs: NOW_MS + 30_000 })
    expect(n).toBeDefined()
    expect(n!.key).toBe(`rest-lunch|${D}`)
  })
})
