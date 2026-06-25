import { describe, expect, it } from 'vitest'
import {
  buildCtx,
  cooldownMultiplier,
  evaluateEvent,
  evaluateTick,
  type EngineState,
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
      buildCtx(tick({ blocks: [b], idleMin: 15, guardUntilMin: 11.5 * 60 }), fresh)
    )
    expect(guarded).toHaveLength(0)
    const repeated = evaluateTick(
      buildCtx(tick({ blocks: [b], idleMin: 15 }), { lastFired: {}, lastDriftBlockId: b.id })
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
    const early = evaluateTick(
      buildCtx(tick({ nowMin: 17 * 60 + 45, quietStartMin: quietStart }), fresh)
    )
    expect(early).toHaveLength(0)
    const windDown = evaluateTick(
      buildCtx(tick({ nowMin: 18 * 60, quietStartMin: quietStart }), fresh)
    )
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
      buildCtx(
        tick({ blocks: heavy, nowMin: 7 * 60, agg: { ...agg, realisticBestH: null } }),
        fresh
      )
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
      })
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
    expect(
      evaluateTick(buildCtx(tuesday, fresh)).find((n) => n.type === 'fresh-start')
    ).toBeUndefined()
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
      fresh
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
    const engineState = {
      lastFired: { 'right-size': { ts: nowMs - 8 * 60 * 60 * 1000, key: D } },
      lastDriftBlockId: null,
    }
    const suppressed = evaluateTick(
      buildCtx(tick({ blocks: heavy, nowMin: 7 * 60, nowMs, events: declines }), engineState)
    )
    expect(suppressed.find((x) => x.type === 'right-size')).toBeUndefined()
    /* same 8h gap with no declines would have fired (base cooldown 6h) */
    const wouldFire = evaluateTick(
      buildCtx(tick({ blocks: heavy, nowMin: 7 * 60, nowMs }), engineState)
    )
    expect(wouldFire[0]?.type).toBe('right-size')
  })

  describe('early finish is context-aware (no "engine\'s warm" noise)', () => {
    const done = mk({
      id: 'meet',
      title: 'Standup that never happened',
      startMin: 10 * 60,
      endMin: 11 * 60,
      status: 'done',
    })
    const at = (blocks: Block[]) =>
      buildCtx(tick({ blocks, nowMin: 10 * 60 + 5, nowMs: Date.UTC(2026, 5, 9, 10, 5) }), fresh, {
        justCompleted: done,
      })

    it('mid-rest: completing a block suggests nothing', () => {
      const rest = mk({
        id: 'rest',
        title: 'Recover',
        tag: 'rest',
        startMin: 9 * 60 + 30,
        endMin: 10 * 60 + 30,
      })
      const ctx = at([done, rest])
      expect(ctx.nextUp).toBeNull()
      expect(ctx.breakDue).toBe(false)
    })

    it('inside another commitment: the window reclaims nothing', () => {
      const meeting = mk({
        id: 'm2',
        title: 'Other meeting',
        external: { calId: 'c1', eventId: 'e1' },
        startMin: 10 * 60,
        endMin: 11 * 60,
      })
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
    const interview = mk({
      id: 'iv',
      title: 'Interview — Mira',
      startMin: 13.5 * 60,
      endMin: 14.5 * 60,
    })
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
    evaluateTick(
      buildCtx(tick({ nowMin, nowMs: Date.UTC(2026, 5, 9, 0, 0) + nowMin * 60_000, blocks }), fresh)
    )

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
    expect(at(10 * 60, [{ ...restore, startedAt: 5 }]).some((n) => n.type === 'start-by')).toBe(
      false
    )
    expect(at(10 * 60, [{ ...restore, due: undefined }]).some((n) => n.type === 'start-by')).toBe(
      false
    )
    expect(
      at(10 * 60, [{ ...restore, attention: undefined }]).some((n) => n.type === 'start-by')
    ).toBe(false)
    expect(at(13 * 60 + 1, [restore]).some((n) => n.type === 'start-by')).toBe(false)
  })

  it('fires once per block: the key + 8h cooldown swallow the re-trigger', () => {
    const nowMs = Date.UTC(2026, 5, 9, 0, 0) + (10 * 60 + 30) * 60_000
    const again = evaluateTick(
      buildCtx(tick({ nowMin: 10 * 60 + 30, nowMs, blocks: [restore] }), {
        lastFired: { 'start-by': { ts: nowMs - 30 * 60_000, key: 'bg1' } },
        lastDriftBlockId: null,
      })
    )
    expect(again.some((n) => n.type === 'start-by')).toBe(false)
  })
})

describe('pref-drift — the rulebook keeps up with the life it describes', () => {
  const gymRule = {
    kind: 'time-default' as const,
    match: 'gym',
    value: 'starts 07:00',
    stated: 'gym is always 7am',
  }
  const lived = (offset: number): MemoryEvent => ({
    id: `e${offset}`,
    ts: 0,
    kind: 'completed',
    dayKey: `2026-06-0${9 + offset}`.replace('-010', '-10'),
    title: 'Gym',
    startMin: 18 * 60,
    endMin: 19 * 60,
  })

  it('three lived contradictions fire one kind nudge with both actions', () => {
    const events = [lived(-3 as never), lived(-2 as never), lived(-1 as never)].map((e, i) => ({
      ...e,
      dayKey: ['2026-06-06', '2026-06-07', '2026-06-08'][i],
    }))
    const fired = evaluateTick(buildCtx(tick({ blocks: [], events, prefs: [gymRule] }), fresh))
    const pd = fired.find((n) => n.type === 'pref-drift')
    expect(pd).toBeDefined()
    expect(pd!.body).toBe(
      'your rule says gym starts 07:00, but it has lived near 18:00 three times running — update the rule, or keep 07:00?'
    )
    expect(pd!.actions.map((a) => a.id)).toEqual(['update', 'keep'])
    expect(pd!.body).not.toMatch(/breaking|failed|broke/)
  })

  it('the per-pref key + 7d cooldown swallows a re-fire', () => {
    const events = ['2026-06-06', '2026-06-07', '2026-06-08'].map((dayKey, i) => ({
      ...lived(0 as never),
      id: `e${i}`,
      dayKey,
    }))
    const nowMs = Date.UTC(2026, 5, 9, 9, 52)
    const again = evaluateTick(
      buildCtx(tick({ blocks: [], events, prefs: [gymRule], nowMs }), {
        lastFired: { 'pref-drift': { ts: nowMs - 60 * 60_000, key: 'time-default:gym' } },
        lastDriftBlockId: null,
      })
    )
    expect(again.some((n) => n.type === 'pref-drift')).toBe(false)
  })

  it('a kept rule never starves the queue: a second drifted rule fires inside the first one’s window', () => {
    const deployRule = {
      kind: 'time-default' as const,
      match: 'deploy',
      value: 'starts 09:00',
      stated: 'deploys at 9',
    }
    const nowMs = Date.UTC(2026, 5, 9, 9, 52)
    const events: MemoryEvent[] = ['2026-06-06', '2026-06-07', '2026-06-08'].flatMap((dk, i) => [
      { ...lived(0 as never), id: `g${i}`, dayKey: dk }, // gym lives at 18:00 against 07:00
      {
        ...lived(0 as never),
        id: `d${i}`,
        dayKey: dk,
        title: 'Deploy',
        startMin: 15 * 60,
        endMin: 16 * 60,
      },
    ])
    /* gym was kept an hour ago: declined outcome stretches its cooldown to 14d */
    events.push({
      id: 'o1',
      ts: nowMs - 60 * 60_000,
      kind: 'nudge_outcome',
      dayKey: '2026-06-09',
      nudgeType: 'pref-drift',
      outcome: 'declined',
    })
    const fired = evaluateTick(
      buildCtx(tick({ blocks: [], events, prefs: [gymRule, deployRule], nowMs }), {
        lastFired: { 'pref-drift': { ts: nowMs - 60 * 60_000, key: 'time-default:gym' } },
        lastDriftBlockId: null,
      })
    )
    const pd = fired.find((n) => n.type === 'pref-drift')
    expect(pd).toBeDefined()
    expect(pd!.key).toBe('time-default:deploy')
    expect(pd!.body).toContain('deploy')
    expect(pd!.body).not.toContain('gym') // the cooling rule waits its turn; never a list
  })
})

describe('delegate — handoff suggestions at week-shaping moments', () => {
  const MON = '2026-06-08'
  const NOW = Date.UTC(2026, 5, 8, 9, 0)
  const LINKS = [{ from: 'task/doc-review', to: 'person/robin' }]
  const mkEv = (daysAgo: number, title: string): MemoryEvent => ({
    id: `e${daysAgo}-${title}`,
    ts: NOW - daysAgo * 24 * 60 * 60 * 1000,
    kind: 'completed',
    dayKey: MON,
    title,
  })
  const EVENTS = [
    mkEv(2, 'Doc review — Robin'),
    mkEv(7, 'Doc review — Robin'),
    mkEv(12, 'Doc review — Robin'),
    mkEv(4, 'Doc review'),
  ]
  /* fresh-start owns the first tick of the window; delegate rides behind it */
  const freshStartCooling: EngineState = {
    lastFired: { 'fresh-start': { ts: NOW - 60_000, key: MON } },
    lastDriftBlockId: null,
  }
  const at = (over: Partial<TickInputs>, engine: EngineState = freshStartCooling) =>
    evaluateTick(
      buildCtx(
        tick({
          nowMs: NOW,
          nowMin: 9 * 60,
          todayKey: MON,
          events: EVENTS,
          brainLinks: LINKS,
          ...over,
        }),
        engine
      )
    )

  it('fires in the Monday window with receipts: body, actions, per-pair key', () => {
    const fired = at({})
    expect(fired[0]?.type).toBe('delegate')
    expect(fired[0].body).toBe(
      'doc review has run with Robin three times this month — worth handing them the thread this week?'
    )
    expect(fired[0].actions.map((a) => a.id)).toEqual(['capture', 'later'])
    expect(fired[0].key).toBe('robin:doc-review')
  })

  it('fresh-start outranks it on the same tick — the opener lands first', () => {
    const fired = evaluateTick(
      buildCtx(
        tick({ nowMs: NOW, nowMin: 9 * 60, todayKey: MON, events: EVENTS, brainLinks: LINKS }),
        fresh
      )
    )
    expect(fired[0]?.type).toBe('fresh-start')
  })

  it('outside the week-shaping window it stays quiet (Tuesday, or Monday 11:30)', () => {
    expect(at({ todayKey: D, nowMin: 9 * 60 })).toHaveLength(0)
    expect(at({ nowMin: 11 * 60 + 30 }).some((n) => n.type === 'delegate')).toBe(false)
  })

  it('no brain links (brain off) → the nudge cannot exist', () => {
    expect(at({ brainLinks: undefined })).toHaveLength(0)
  })

  it('once per pair per week: same key cools, a different pair still fires', () => {
    const cooled = at(
      {},
      {
        lastFired: {
          'fresh-start': { ts: NOW - 60_000, key: MON },
          delegate: { ts: NOW - 2 * 24 * 60 * 60 * 1000, key: 'robin:doc-review' },
        },
        lastDriftBlockId: null,
      }
    )
    expect(cooled.some((n) => n.type === 'delegate')).toBe(false)

    const other = at(
      {
        events: [
          ...EVENTS,
          mkEv(1, 'Sprint notes — Dana'),
          mkEv(3, 'Sprint notes — Dana'),
          mkEv(5, 'Sprint notes — Dana'),
          mkEv(6, 'Sprint notes — Dana'),
          mkEv(8, 'Sprint notes'),
        ],
        brainLinks: [...LINKS, { from: 'task/sprint-notes', to: 'person/dana' }],
      },
      {
        lastFired: {
          'fresh-start': { ts: NOW - 60_000, key: MON },
          delegate: { ts: NOW - 2 * 24 * 60 * 60 * 1000, key: 'robin:doc-review' },
        },
        lastDriftBlockId: null,
      }
    )
    expect(other[0]?.type).toBe('delegate')
    expect(other[0].key).toBe('dana:sprint-notes')
  })
})

describe('debrief — the day gets its story after the loop closes', () => {
  /* one open block (close-loop bait) + one completion (debrief material) */
  const open = mk({ id: 'open1' })
  const NOW = Date.UTC(2026, 5, 9, 19, 0)
  const EVENTS: MemoryEvent[] = [
    {
      id: 'c1',
      ts: new Date(2026, 5, 9, 15, 40).getTime(),
      kind: 'completed',
      dayKey: D,
      title: 'Reply to Sam',
      endMin: 15 * 60,
      plannedMin: 30,
    },
  ]
  const at = (nowMin: number, engine = fresh, over: Partial<TickInputs> = {}) =>
    evaluateTick(
      buildCtx(tick({ nowMs: NOW, nowMin, blocks: [open], events: EVENTS, ...over }), engine)
    )

  it('close-loop owns the first wind-down tick; the story follows once the loop is cooling', () => {
    expect(at(19 * 60)[0]?.type).toBe('close-loop')
    const next = at(19 * 60 + 1, {
      lastFired: { 'close-loop': { ts: NOW - 60_000, key: D } },
      lastDriftBlockId: null,
    })
    expect(next[0]?.type).toBe('debrief')
    expect(next[0].body).toContain('1 mew; the reply to sam slipped 40 past its window.')
    expect(next[0].actions).toEqual([]) // information, not a demand
    expect(next[0].key).toBe(D)
  })

  it('nothing open → no close-loop to wait for; the story leads', () => {
    const doneDay = [mk({ id: 'd1', status: 'done' })]
    const out = at(19 * 60, fresh, { blocks: doneDay })
    expect(out[0]?.type).toBe('debrief')
  })

  it('before day end there is no story to tell', () => {
    expect(at(17 * 60).some((n) => n.type === 'debrief')).toBe(false)
  })

  it('once per evening: the day key holds it', () => {
    const again = at(19 * 60 + 30, {
      lastFired: {
        'close-loop': { ts: NOW - 60_000, key: D },
        debrief: { ts: NOW - 10 * 60_000, key: D },
      },
      lastDriftBlockId: null,
    })
    expect(again.some((n) => n.type === 'debrief')).toBe(false)
  })
})

describe('fresh-start carries the week review', () => {
  const MON = '2026-06-08'
  const NOW = Date.UTC(2026, 5, 8, 9, 0)
  const LASTWEEK: MemoryEvent[] = [
    ...[1, 2, 3, 4].map((d) => ({
      id: `w${d}`,
      ts: NOW - d * 24 * 60 * 60 * 1000,
      kind: 'completed' as const,
      dayKey: `2026-06-0${8 - d}`, // Jun 4–7
      title: 'Deep work',
      startMin: 9 * 60,
      plannedMin: 300,
    })),
    {
      id: 'r1',
      ts: NOW - 3 * 24 * 60 * 60 * 1000,
      kind: 'rolled' as const,
      dayKey: '2026-06-05',
      title: 'Inbox sweep',
      startMin: 15 * 60 + 30,
      plannedMin: 45,
    },
  ]
  const monday = (events: MemoryEvent[], over: Partial<TickInputs> = {}) =>
    evaluateTick(
      buildCtx(tick({ nowMs: NOW, nowMin: 9 * 60, todayKey: MON, events, ...over }), fresh)
    )

  it('Monday with history: the body leads with last week and keeps the actions', () => {
    const out = monday(LASTWEEK)
    expect(out[0]?.type).toBe('fresh-start')
    expect(out[0].body).toMatch(/^last week: 4 mews, carry-over 20%/)
    expect(out[0].body).toContain('Shape this week the same?')
    expect(out[0].actions.map((a) => a.id)).toEqual(['shape', 'later'])
  })

  it('heavy carry asks kinder', () => {
    const heavyCarry = [
      LASTWEEK[0],
      ...[1, 2].map((i) => ({ ...LASTWEEK[4], id: `rr${i}`, kind: 'rolled' as const })),
    ]
    const out = monday(heavyCarry)
    expect(out[0].body).toContain('Shape this week the same, or kinder?')
  })

  it('week one (no events): the original Monday copy stands', () => {
    const out = monday([])
    expect(out[0]?.type).toBe('fresh-start')
    expect(out[0].body).toMatch(/^Monday — a new accounting period/)
  })

  it('a mid-week clear keeps the blank-page copy — last week is not the story', () => {
    const out = evaluateTick(
      buildCtx(tick({ events: LASTWEEK }), fresh, { justCleared: { scope: 'week', count: 3 } })
    )
    const fs = out.find((n) => n.type === 'fresh-start')
    expect(fs).toBeDefined()
    expect(fs!.body).toMatch(/^A blank page/)
  })
})

describe('heads-up — pre-meeting recall with a shelf life', () => {
  const meeting = mk({
    id: 'm1',
    title: 'Sync: mira',
    startMin: 10 * 60,
    endMin: 10 * 60 + 30,
    protected: false,
  })
  const RECALL = {
    m1: [
      'task/q3-deck — 14:05 completed · ran over +20m',
      'person/mira — prefers decisions pre-read',
    ],
  }
  const at = (
    nowMin: number,
    blocks: Block[] = [meeting],
    personRecall: Record<string, string[]> | undefined = RECALL,
    engine = fresh
  ) => evaluateTick(buildCtx(tick({ nowMin, blocks, personRecall }), engine))

  it('fires only inside the 8–12 minute window before a fixed block', () => {
    expect(at(10 * 60 - 13).some((n) => n.type === 'heads-up')).toBe(false) // 13 min out — too early
    expect(at(10 * 60 - 12)[0]?.type).toBe('heads-up')
    expect(at(10 * 60 - 8)[0]?.type).toBe('heads-up')
    expect(at(10 * 60 - 7).some((n) => n.type === 'heads-up')).toBe(false) // the meeting owns the moment
  })

  it('carries the recall lines verbatim, dismiss-only — information, not a demand', () => {
    const hu = at(10 * 60 - 10).find((n) => n.type === 'heads-up')
    expect(hu).toBeDefined()
    expect(hu!.body).toContain('task/q3-deck — 14:05 completed · ran over +20m')
    expect(hu!.body).toContain('person/mira — prefers decisions pre-read')
    expect(hu!.actions.map((a) => a.id)).toEqual(['ack'])
    expect(hu!.payload).toEqual({ blockId: 'm1' })
  })

  it('needs a fixed-time, non-optional block — flexible work never triggers it', () => {
    const flexible = { ...meeting, title: 'Draft notes for mira' } // no fixed word
    expect(at(10 * 60 - 10, [flexible], { m1: RECALL.m1 }).some((n) => n.type === 'heads-up')).toBe(
      false
    )
    const optional = { ...meeting, optional: true }
    expect(at(10 * 60 - 10, [optional]).some((n) => n.type === 'heads-up')).toBe(false)
  })

  it('stays silent without recall lines (brain off, fetch failed, or person unknown)', () => {
    /* no personRecall in TickInputs at all (the event path never carries it) */
    const bare = evaluateTick(buildCtx(tick({ nowMin: 10 * 60 - 10, blocks: [meeting] }), fresh))
    expect(bare.some((n) => n.type === 'heads-up')).toBe(false)
    expect(at(10 * 60 - 10, [meeting], {}).some((n) => n.type === 'heads-up')).toBe(false)
    expect(at(10 * 60 - 10, [meeting], { m1: [] }).some((n) => n.type === 'heads-up')).toBe(false)
  })

  it('fires once per block: the per-block key holds the cooldown', () => {
    const nowMs = Date.UTC(2026, 5, 9, 9, 50)
    const again = at(10 * 60 - 10, [meeting], RECALL, {
      lastFired: { 'heads-up': { ts: nowMs - 60_000, key: 'm1' } },
      lastDriftBlockId: null,
    })
    expect(again.some((n) => n.type === 'heads-up')).toBe(false)
    const other = at(10 * 60 - 10, [meeting], RECALL, {
      lastFired: { 'heads-up': { ts: nowMs - 60_000, key: 'SOME-OTHER-BLOCK' } },
      lastDriftBlockId: null,
    })
    expect(other[0]?.type).toBe('heads-up')
  })

  it('caps the body at two lines — a heads-up, not a dossier', () => {
    const hu = at(10 * 60 - 10, [meeting], { m1: ['one', 'two', 'three', 'four'] }).find(
      (n) => n.type === 'heads-up'
    )
    expect(hu!.body.split('\n').slice(1)).toEqual(['one', 'two'])
  })
})
