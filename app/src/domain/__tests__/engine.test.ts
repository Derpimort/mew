import { describe, expect, it } from 'vitest'
import {
  buildCtx,
  cooldownMultiplier,
  evaluateEvent,
  evaluateTick,
  type TickInputs,
} from '../nudges/engine'
import type { Block, MemoryEvent } from '../types'
import type { MemoryAggregates } from '../memory'
import { inQuietHours } from '../time'

const D = '2026-06-09'

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Q3 deck — deep work',
    tag: 'work',
    dayKey: D,
    startMin: 9 * 60,
    endMin: 11.5 * 60,
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

function tick(over: Partial<TickInputs>): TickInputs {
  return {
    nowMs: Date.UTC(2026, 5, 9, 9, 52),
    nowMin: 9 * 60 + 52,
    todayKey: D,
    blocks: [mk({})],
    agg,
    idleMin: 0,
    interruptionsLastHour: 0,
    guardUntilMin: null,
    ...over,
  }
}

const fresh = { lastFired: {}, lastDriftBlockId: null }

describe('nudge engine', () => {
  it('drift fires at ≥10 idle minutes inside an open block (acceptance #4)', () => {
    const quiet = evaluateTick(buildCtx(tick({ idleMin: 9 }), fresh))
    expect(quiet).toHaveLength(0)
    const drifted = evaluateTick(buildCtx(tick({ idleMin: 12 }), fresh))
    expect(drifted[0]?.type).toBe('drift')
    expect(drifted[0].body).toContain('~12 minutes')
    expect(drifted[0].actions.map((a) => a.id)).toEqual(['still', 'move', 'guard'])
  })

  it('drift respects an active guard and never re-fires for the same block', () => {
    const b = mk({})
    const guarded = evaluateTick(
      buildCtx(tick({ blocks: [b], idleMin: 15, guardUntilMin: 11.5 * 60 }), fresh),
    )
    expect(guarded).toHaveLength(0)
    const repeated = evaluateTick(
      buildCtx(tick({ blocks: [b], idleMin: 15 }), { lastFired: {}, lastDriftBlockId: b.id }),
    )
    expect(repeated).toHaveLength(0)
  })

  it('close-the-loop fires after day end with an open item and proposes a concrete tomorrow slot (acceptance #5)', () => {
    const out = evaluateTick(buildCtx(tick({ nowMin: 19 * 60 }), fresh))
    expect(out[0]?.type).toBe('close-loop')
    expect(out[0].body).toMatch(/tomorrow at 9:00/)
    expect(out[0].payload).toMatchObject({ toDayKey: '2026-06-10', toStartMin: 9 * 60 })
  })

  it('close-the-loop lands in the wind-down before quiet hours — "tonight" must mean tonight', () => {
    const quietStart = 18.5 * 60
    const early = evaluateTick(buildCtx(tick({ nowMin: 17 * 60 + 45, quietStartMin: quietStart }), fresh))
    expect(early).toHaveLength(0)
    const windDown = evaluateTick(buildCtx(tick({ nowMin: 18 * 60, quietStartMin: quietStart }), fresh))
    expect(windDown[0]?.type).toBe('close-loop')
  })

  it('right-size fires when planned deep work exceeds 1.2× the user’s own realistic best', () => {
    const heavy = [
      mk({ startMin: 8 * 60, endMin: 12 * 60 }),
      mk({ id: 'b2', startMin: 13 * 60, endMin: 17 * 60, title: 'Spec — deep work' }),
    ]
    const out = evaluateTick(buildCtx(tick({ blocks: heavy, nowMin: 7 * 60 }), fresh))
    expect(out[0]?.type).toBe('right-size')
    expect(out[0].body).toContain('8 hours of deep work')
    expect(out[0].body).toContain('about 5.5')
  })

  it('right-size stays silent without history — MEW never invents numbers', () => {
    const heavy = [mk({ startMin: 8 * 60, endMin: 17 * 60 })]
    const out = evaluateTick(
      buildCtx(tick({ blocks: heavy, nowMin: 7 * 60, agg: { ...agg, realisticBestH: null } }), fresh),
    )
    expect(out.find((n) => n.type === 'right-size')).toBeUndefined()
  })

  it('celebrate always fires on completion and is positive-only', () => {
    const done = mk({ status: 'done', completedAt: 1 })
    const ctx = buildCtx(tick({ blocks: [done] }), fresh, { justCompleted: done })
    const out = evaluateEvent(ctx)
    expect(out[0]?.type).toBe('celebrate')
    expect(out[0].body).toMatch(/That's a mew — one today/)
    expect(out[0].actions).toHaveLength(0)
  })

  it('kinder-plan needs four straight heavy weeks, once per week at most', () => {
    const heavyAgg = { ...agg, carryRatioByWeek: [0.35, 0.4, 0.31, 0.5], carryRatio: 0.5 }
    const ctx = buildCtx(tick({ agg: heavyAgg, blocks: [] }), fresh)
    const out = evaluateTick(ctx)
    expect(out[0]?.type).toBe('kinder-plan')
    const again = evaluateTick(
      buildCtx(tick({ agg: heavyAgg, blocks: [] }), {
        lastFired: { 'kinder-plan': { ts: ctx.nowMs - 1000 } },
        lastDriftBlockId: null,
      }),
    )
    expect(again).toHaveLength(0)
  })

  it('quiet hours wrap midnight correctly (gating tested where it lives: the clock)', () => {
    const q = { startMin: 18.5 * 60, endMin: 8.5 * 60 }
    expect(inQuietHours(19 * 60, q)).toBe(true)
    expect(inQuietHours(2 * 60, q)).toBe(true)
    expect(inQuietHours(8.5 * 60, q)).toBe(false)
    expect(inQuietHours(12 * 60, q)).toBe(false)
  })

  it('fresh-start opens the Monday window — and only the Monday window (Dai/Milkman/Riis)', () => {
    const monday = tick({ todayKey: '2026-06-08', nowMin: 9 * 60, blocks: [] })
    const fired = evaluateTick(buildCtx(monday, fresh))
    expect(fired[0]?.type).toBe('fresh-start')
    expect(fired[0].footnote).toContain('Dai, Milkman & Riis')
    const tuesday = tick({ todayKey: '2026-06-09', nowMin: 9 * 60, blocks: [] })
    expect(evaluateTick(buildCtx(tuesday, fresh)).find((n) => n.type === 'fresh-start')).toBeUndefined()
  })

  it('fresh-start also answers a deliberate blank page (clear event)', () => {
    const ctx = buildCtx(tick({ blocks: [], nowMin: 14 * 60 }), fresh, {
      justCleared: { scope: 'upcoming', count: 5 },
    })
    const fired = evaluateEvent(ctx)
    expect(fired[0]?.type).toBe('fresh-start')
    expect(fired[0].body).toMatch(/blank page/i)
  })

  it('break-it-smaller targets a ≥3× roller that still has an open block, with a concrete starter', () => {
    let n = 0
    const rolledEv = (): MemoryEvent => ({
      id: `r${n++}`,
      ts: Date.UTC(2026, 5, 1),
      kind: 'rolled',
      dayKey: '2026-06-0' + (n + 1),
      title: 'Inbox sweep',
      plannedMin: 45,
    })
    const open = mk({ title: 'Inbox sweep', startMin: 14 * 60, endMin: 15 * 60 })
    const ctx = buildCtx(
      tick({ blocks: [open], events: [rolledEv(), rolledEv(), rolledEv()], nowMin: 8 * 60 }),
      fresh,
    )
    const fired = evaluateTick(ctx)
    expect(fired[0]?.type).toBe('break-smaller')
    expect(fired[0].body).toMatch(/rolled forward three times/)
    expect(fired[0].footnote).toContain('Bandura & Schunk')
    expect(fired[0].actions[0].id).toBe('starter')
    expect(fired[0].payload.startMin).toBeDefined()
  })

  it('outcome learning: repeated declines stretch a nudge’s cooldown (care, not nagging)', () => {
    expect(cooldownMultiplier(undefined)).toBe(1)
    expect(cooldownMultiplier({ accepted: 1, declined: 1 })).toBe(1)
    expect(cooldownMultiplier({ accepted: 0, declined: 1 })).toBe(2)
    expect(cooldownMultiplier({ accepted: 0, declined: 2 })).toBe(3)
    expect(cooldownMultiplier({ accepted: 2, declined: 1 })).toBe(1)

    /* integration: right-size declined twice → 6h base stretches to 18h */
    const heavy = [
      mk({ startMin: 8 * 60, endMin: 12 * 60 }),
      mk({ id: 'b2', startMin: 13 * 60, endMin: 17 * 60, title: 'Spec — deep work' }),
    ]
    const nowMs = Date.UTC(2026, 5, 9, 7, 0)
    const declines: MemoryEvent[] = [0, 1].map((i) => ({
      id: `d${i}`,
      ts: nowMs - 1000,
      kind: 'nudge_outcome',
      dayKey: '2026-06-08',
      nudgeType: 'right-size',
      outcome: 'declined',
    }))
    const engineState = { lastFired: { 'right-size': { ts: nowMs - 8 * 60 * 60 * 1000, key: D } }, lastDriftBlockId: null }
    const suppressed = evaluateTick(
      buildCtx(tick({ blocks: heavy, nowMin: 7 * 60, nowMs, events: declines }), engineState),
    )
    expect(suppressed.find((x) => x.type === 'right-size')).toBeUndefined()
    /* same 8h gap with no declines would have fired (base cooldown 6h) */
    const wouldFire = evaluateTick(buildCtx(tick({ blocks: heavy, nowMin: 7 * 60, nowMs }), engineState))
    expect(wouldFire[0]?.type).toBe('right-size')
  })

  describe('early finish is context-aware (no "engine\'s warm" noise)', () => {
    const done = mk({ id: 'meet', title: 'Standup that never happened', startMin: 10 * 60, endMin: 11 * 60, status: 'done' })
    const at = (blocks: Block[]) =>
      buildCtx(tick({ blocks, nowMin: 10 * 60 + 5, nowMs: Date.UTC(2026, 5, 9, 10, 5) }), fresh, {
        justCompleted: done,
      })

    it('mid-rest: completing a block suggests nothing', () => {
      const rest = mk({ id: 'rest', title: 'Recover', tag: 'rest', startMin: 9 * 60 + 30, endMin: 10 * 60 + 30 })
      const ctx = at([done, rest])
      expect(ctx.nextUp).toBeNull()
      expect(ctx.breakDue).toBe(false)
    })

    it('inside another commitment: the window reclaims nothing', () => {
      const meeting = mk({ id: 'm2', title: 'Other meeting', external: { calId: 'c1', eventId: 'e1' }, startMin: 10 * 60, endMin: 11 * 60 })
      const ctx = at([done, meeting])
      expect(ctx.earlyGapMin).toBe(0)
      expect(ctx.nextUp).toBeNull()
    })

    it('a later commitment truncates the reclaimed gap', () => {
      const next = mk({ id: 'n1', title: 'Doc review', startMin: 10 * 60 + 20, endMin: 11 * 60 })
      const ctx = at([done, next])
      expect(ctx.earlyGapMin).toBe(15) // 10:05 → 10:20, not 10:05 → 11:00
    })
  })

  describe('post-buffer — a review offer right after a big meeting', () => {
    const interview = mk({ id: 'iv', title: 'Interview — Mira', startMin: 13.5 * 60, endMin: 14.5 * 60 })
    const at = (blocks: Block[], nowMin: number) =>
      buildCtx(tick({ blocks, nowMin, nowMs: Date.UTC(2026, 5, 9, 14, 35) }), fresh)

    it('fires within minutes of the meeting wrapping, when nothing follows', () => {
      const ctx = at([interview], 14.5 * 60 + 5)
      expect(ctx.justEndedFixed?.id).toBe('iv')
      const out = evaluateTick(ctx)
      expect(out[0]?.type).toBe('post-buffer')
      expect(out[0]?.footnote).toContain('Microsoft')
    })

    it('stays quiet when the user is already inside the next block', () => {
      const nextBlock = mk({ id: 'nb', title: 'Deep work', startMin: 14.5 * 60, endMin: 16 * 60 })
      const ctx = at([interview, nextBlock], 14.5 * 60 + 5)
      expect(ctx.justEndedFixed).toBeNull()
    })

    it('stays quiet for flexible tasks — only fixed events earn a buffer', () => {
      const task = mk({ id: 'tk', title: 'Write the deck', startMin: 13.5 * 60, endMin: 14.5 * 60 })
      const ctx = at([task], 14.5 * 60 + 5)
      expect(ctx.justEndedFixed).toBeNull()
    })
  })

  describe('drift idle is scoped to the current block', () => {
    it('stale idle from before a block started does not trigger drift on it', () => {
      const fresh2 = { lastFired: {}, lastDriftBlockId: null }
      const justStarted = mk({ id: 'new', startMin: 9 * 60 + 50, endMin: 11 * 60 })
      const ctx = buildCtx(tick({ blocks: [justStarted], idleMin: 14 }), fresh2)
      expect(ctx.idleMin).toBe(2) // block is 2 min old at 9:52
      expect(evaluateTick(ctx).find((n) => n.type === 'drift')).toBeUndefined()
    })
  })
})

describe('start-by — latest-start intelligence for due-bearing background', () => {
  /* 3h restore due 13:00 → latest start 10:00, warning opens after 9:50 */
  const restore = mk({
    id: 'bg1',
    title: 'iphone restore',
    attention: 'background',
    startMin: 9 * 60,
    endMin: 12 * 60,
    due: 13 * 60,
  })

  const at = (nowMin: number, blocks = [restore]) =>
    evaluateTick(buildCtx(tick({ nowMin, nowMs: Date.UTC(2026, 5, 9, 0, 0) + nowMin * 60_000, blocks }), fresh))

  it('stays quiet while there is still slack, fires inside the 10-min warning window', () => {
    expect(at(9 * 60 + 49).some((n) => n.type === 'start-by')).toBe(false) // 9:49 + 180 = 12:49 ≤ 12:50
    const fired = at(9 * 60 + 51)
    const sb = fired.find((n) => n.type === 'start-by')
    expect(sb).toBeDefined()
    expect(sb!.body).toBe('start iphone restore by 10:00 or it misses 13:00.')
    expect(sb!.actions.map((a) => a.id)).toEqual(['start', 'ack'])
    expect(sb!.payload).toEqual({ blockId: 'bg1' })
  })

  it('never fires once started, without a due, for focus blocks, or past the deadline', () => {
    expect(at(10 * 60, [{ ...restore, startedAt: 5 }]).some((n) => n.type === 'start-by')).toBe(false)
    expect(at(10 * 60, [{ ...restore, due: undefined }]).some((n) => n.type === 'start-by')).toBe(false)
    expect(at(10 * 60, [{ ...restore, attention: undefined }]).some((n) => n.type === 'start-by')).toBe(false)
    expect(at(13 * 60 + 1, [restore]).some((n) => n.type === 'start-by')).toBe(false)
  })

  it('fires once per block: the key + 8h cooldown swallow the re-trigger', () => {
    const nowMs = Date.UTC(2026, 5, 9, 0, 0) + (10 * 60 + 30) * 60_000
    const again = evaluateTick(
      buildCtx(
        tick({ nowMin: 10 * 60 + 30, nowMs, blocks: [restore] }),
        { lastFired: { 'start-by': { ts: nowMs - 30 * 60_000, key: 'bg1' } }, lastDriftBlockId: null },
      ),
    )
    expect(again.some((n) => n.type === 'start-by')).toBe(false)
  })
})
