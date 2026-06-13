/* The nudge engine — pure evaluation over live state + memory, with cooldowns.
   Posting, quiet-hour queueing, and outcome logging live in the state layer;
   this file only decides *what is true right now*. */

import type { Block, Capture, MemoryEvent, NudgeId, PrefPayload } from '../types'
import type { MemoryAggregates } from '../memory'
import { liveNow, type LiveNow } from '../liveNow'
import { computeInsights, delegationCandidates, prefContradictions, prefKey } from '../insights'
import {
  blocksForDay,
  dayEndMin,
  duration,
  findFreeSlot,
  isBackground,
  isFixedTime,
  openItems,
  proposeCaptureSlot,
  overlaps,
  plannedDeepMin,
} from '../week'
import { addDaysKey, fromDayKey } from '../time'
import { NUDGES, type NudgeCtx, type NudgeInstance } from './library'

export interface EngineState {
  lastFired: Partial<Record<NudgeId, { ts: number; key?: string }>>
  lastDriftBlockId: string | null
}

export interface TickInputs {
  nowMs: number
  nowMin: number
  todayKey: string
  blocks: Block[]
  agg: MemoryAggregates
  /** Raw memory events — pattern analyses + outcome learning read these. */
  events?: MemoryEvent[]
  idleMin: number
  interruptionsLastHour: number
  guardUntilMin: number | null
  /** the standing rulebook, for drift validation (optional: floor-safe) */
  prefs?: PrefPayload[]
  /** Quiet hours, so close-the-loop can land in the wind-down before them. */
  quietStartMin?: number
  /** Unplaced intentions — next-up may offer one for a reclaimed gap. */
  captures?: Capture[]
  /** task→person edges from the brain (the store fetches; absent = brain off,
      and the delegate nudge stays silent — no degradation theater). */
  brainLinks?: { from: string; to: string }[]
}

/** Heaviest day in the next 3 days whose planned deep work exceeds 1.2× realistic best. */
export function findHeavyDay(
  blocks: Block[],
  todayKey: string,
  realisticBestH: number | null,
): { dayKey: string; plannedH: number } | null {
  if (realisticBestH == null || realisticBestH <= 0) return null
  let heaviest: { dayKey: string; plannedH: number } | null = null
  for (let i = 0; i <= 2; i++) {
    const key = addDaysKey(todayKey, i)
    const open = blocksForDay(blocks, key).some((b) => b.status === 'open')
    if (!open) continue
    const plannedH = Math.round((plannedDeepMin(blocks, key) / 60) * 2) / 2
    if (plannedH > realisticBestH * 1.2 && (!heaviest || plannedH > heaviest.plannedH)) {
      heaviest = { dayKey: key, plannedH }
    }
  }
  return heaviest
}

function findRestCollision(
  blocks: Block[],
  todayKey: string,
): { rest: Block; intruder: Block } | null {
  for (let i = 0; i <= 1; i++) {
    const key = addDaysKey(todayKey, i)
    const day = blocksForDay(blocks, key)
    /* protectable rest = actual rest, or a private block long enough to BE rest;
       a 15-minute "order lunch" errand is a task, not a walk */
    const rests = day.filter(
      (b) =>
        b.status === 'open' &&
        b.protected &&
        !b.optional &&
        (b.tag === 'rest' || (b.tag === 'private' && b.endMin - b.startMin >= 30)),
    )
    for (const rest of rests) {
      const intruder = day.find(
        (b) =>
          b.id !== rest.id &&
          b.status === 'open' &&
          b.tag === 'work' &&
          !b.optional &&
          overlaps(b.startMin, b.endMin, rest.startMin, rest.endMin),
      )
      if (intruder) return { rest, intruder }
    }
  }
  return null
}

/** A background block with a hard due and an unstarted engine, inside the
    latest-start warning window (10 min of slack left, deadline still
    makable). due − duration = the last moment starting still works. */
function findStartBy(
  blocks: Block[],
  todayKey: string,
  nowMin: number,
): { block: Block; latestStart: number } | null {
  for (const b of blocksForDay(blocks, todayKey)) {
    if (b.status !== 'open' || !isBackground(b) || b.due == null || b.startedAt != null) continue
    if (nowMin >= b.due) continue // the deadline already passed — start-by is moot
    if (nowMin + duration(b) > b.due - 10) return { block: b, latestStart: b.due - duration(b) }
  }
  return null
}

export function buildCtx(
  t: TickInputs,
  engine: EngineState,
  event?: { justCompleted?: Block; newCapture?: Capture; justCleared?: { scope: string; count: number } },
): NudgeCtx {
  const live: LiveNow = liveNow(t.blocks, t.todayKey, t.nowMin)
  const tomorrow = addDaysKey(t.todayKey, 1)
  const events = t.events ?? []
  const insights = computeInsights(events, t.agg, new Date(t.nowMs))

  /* drift candidates: a kept-but-still-contradicting rule sits in its
     stretched cooldown — it must not starve the drifted rules behind it.
     Surface the first candidate that isn't the cooling key; fire() then
     applies the per-key cooldown exactly as it does for start-by. */
  const drifts = prefContradictions(t.prefs ?? [], events, new Date(t.nowMs))
  const coolingPrefKey = engine.lastFired['pref-drift']?.key
  const prefDrift = drifts.find((d) => prefKey(d.pref) !== coolingPrefKey) ?? drifts[0] ?? null

  /* a chronic roller (≥3 rolls) that still has an open block → starter proposal */
  let stalled: NudgeCtx['stalled'] = null
  const roller = insights.chronicRollers.find((r) => r.rolls >= 3)
  if (roller) {
    const open = t.blocks.find(
      (b) =>
        b.status === 'open' &&
        !b.external &&
        b.dayKey >= t.todayKey &&
        b.title.split('—')[0].trim().toLowerCase() === roller.title,
    )
    if (open) {
      const todaySlot = findFreeSlot(t.blocks, t.todayKey, 25, Math.max(t.nowMin + 15, 8 * 60))
      const slot = todaySlot ?? findFreeSlot(t.blocks, tomorrow, 25, 9 * 60)
      stalled = {
        title: roller.title,
        rolls: roller.rolls,
        blockId: open.id,
        proposal: slot ? { dayKey: todaySlot ? t.todayKey : tomorrow, startMin: slot.startMin } : null,
      }
    }
  }

  /* outcome learning: trailing-14d accept/decline per nudge type */
  const floor14 = t.nowMs - 14 * 24 * 60 * 60 * 1000
  const outcomeStats: NudgeCtx['outcomeStats'] = {}
  for (const e of events) {
    if (e.kind !== 'nudge_outcome' || !e.nudgeType || e.ts < floor14) continue
    const slot = (outcomeStats[e.nudgeType] ??= { accepted: 0, declined: 0 })
    if (e.outcome === 'accepted') slot.accepted++
    else if (e.outcome === 'declined') slot.declined++
  }

  /* The day "ends" at the working day's end — but never inside quiet hours:
     close-the-loop must say "let it go for tonight" *tonight*, so it fires in
     the half hour of wind-down before quiet hours begin. */
  let eodMin = dayEndMin(t.blocks, t.todayKey)
  if (t.quietStartMin != null && t.quietStartMin > 12 * 60) {
    eodMin = Math.min(eodMin, t.quietStartMin - 30)
  }
  const pastDayEnd = t.nowMin >= eodMin
  /* never propose rolling an external event — someone else's meeting isn't ours to move */
  const eodOpen = openItems(t.blocks, t.todayKey).find((b) => !b.external) ?? null
  /* tomorrow may be full — the loop must still close: search up to 3 days out */
  const eodProposal = eodOpen
    ? (() => {
        for (let i = 1; i <= 3; i++) {
          const key = addDaysKey(t.todayKey, i)
          const slot = findFreeSlot(t.blocks, key, eodOpen.endMin - eodOpen.startMin, 9 * 60)
          if (slot) return { toDayKey: key, toStartMin: slot.startMin }
        }
        return null
      })()
    : null

  const captureProposal = event?.newCapture
    ? proposeCaptureSlot(t.blocks, t.todayKey, t.nowMin)
    : null

  /* a big fixed event that wrapped in the last 12 minutes, with the user not
     inside anything else and no review/rest cushion already following it —
     the moment a post-meeting buffer is worth offering */
  const dayBlocks = blocksForDay(t.blocks, t.todayKey)
  const justEndedFixed =
    live.current == null
      ? (dayBlocks.find(
          (b) =>
            !b.optional &&
            b.status !== 'rolled' &&
            isFixedTime(b) &&
            duration(b) >= 45 &&
            b.endMin <= t.nowMin &&
            t.nowMin - b.endMin <= 12 &&
            !dayBlocks.some(
              (n) =>
                n.id !== b.id &&
                n.status === 'open' &&
                !n.optional &&
                n.startMin >= b.endMin &&
                n.startMin <= b.endMin + 20,
            ),
        ) ?? null)
      : null

  return {
    nowMs: t.nowMs,
    nowMin: t.nowMin,
    todayKey: t.todayKey,
    blocks: t.blocks,
    live,
    agg: t.agg,
    /* you can't have been off a block longer than it has existed — stale idle
       from a previous block (or an expired guard) must not instantly qualify
       the next block for a drift check-in */
    idleMin: live.current ? Math.min(t.idleMin, t.nowMin - live.current.startMin) : t.idleMin,
    interruptionsLastHour: t.interruptionsLastHour,
    guardUntilMin: t.guardUntilMin,
    heavyDay: findHeavyDay(t.blocks, t.todayKey, t.agg.realisticBestH),
    pastDayEnd,
    eodOpen,
    eodProposal,
    restCollision: findRestCollision(t.blocks, t.todayKey),
    restPlannedToday:
      blocksForDay(t.blocks, t.todayKey).find((b) => b.tag === 'rest' && b.status === 'open') ??
      null,
    justEndedFixed,
    startBy: findStartBy(t.blocks, t.todayKey, t.nowMin),
    prefDrift,
    justCompleted: event?.justCompleted ?? null,
    newCapture: event?.newCapture ?? null,
    captureProposal,
    justCleared: event?.justCleared ?? null,
    ...earlyFinish(t, event?.justCompleted ?? null),
    insights,
    delegations: t.brainLinks?.length ? delegationCandidates(events, t.brainLinks, t.nowMs) : [],
    dowMon0: (fromDayKey(t.todayKey).getDay() + 6) % 7,
    stalled,
    outcomeStats,
    lastFired: engine.lastFired,
    lastDriftBlockId: engine.lastDriftBlockId,
  }
}

/** Finishing a block early reclaims time. Whether that time should hold a
    task or a breather depends on how long the engine has been running. */
function earlyFinish(
  t: TickInputs,
  done: Block | null,
): Pick<NudgeCtx, 'earlyGapMin' | 'workStreakMin' | 'breakDue' | 'nextUp'> {
  const none = { earlyGapMin: 0, workStreakMin: 0, breakDue: false, nextUp: null }
  if (!done || done.dayKey !== t.todayKey || t.nowMin < done.startMin || t.nowMin >= done.endMin) {
    return none
  }
  const day = blocksForDay(t.blocks, t.todayKey)

  /* the "reclaimed" window is only what's actually free. completing a meeting
     that never happened, mid-rest, with three other things booked over the
     same hour reclaims nothing — suggesting more work there reads as noise. */
  let gapEnd = done.endMin
  for (const b of day) {
    if (b.id === done.id || b.status !== 'open' || b.optional) continue
    if (b.startMin <= t.nowMin && t.nowMin < b.endMin) {
      return none // already inside another commitment (a rest block counts double)
    }
    if (b.startMin > t.nowMin && b.startMin < gapEnd) gapEnd = b.startMin
  }
  const earlyGapMin = gapEnd - t.nowMin
  if (earlyGapMin < 10) return none
  const restEnds = day
    .filter((b) => b.tag === 'rest' && (b.status === 'done' || b.endMin <= t.nowMin))
    .map((b) => b.endMin)
  const firstStart = Math.min(...day.filter((b) => !b.optional).map((b) => b.startMin))
  const anchor = restEnds.length
    ? Math.max(...restEnds)
    : Number.isFinite(firstStart)
      ? firstStart
      : t.nowMin
  const workStreakMin = Math.max(0, t.nowMin - anchor)
  const breakDue = workStreakMin >= 100

  let nextUp: NudgeCtx['nextUp'] = null
  const fitBlock = day.find(
    (b) =>
      b.status === 'open' &&
      !b.external &&
      !b.optional &&
      b.id !== done.id &&
      b.startMin > t.nowMin &&
      duration(b) <= earlyGapMin + 10,
  )
  if (fitBlock) {
    nextUp = {
      kind: 'block',
      id: fitBlock.id,
      title: fitBlock.title.split('—')[0].trim(),
      durMin: duration(fitBlock),
    }
  } else {
    const cap = (t.captures ?? []).find((c) => c.status === 'open')
    if (cap && earlyGapMin >= 25) {
      nextUp = { kind: 'capture', id: cap.id, title: cap.title, durMin: Math.min(30, earlyGapMin) }
    }
  }
  return { earlyGapMin, workStreakMin, breakDue, nextUp }
}

/* priority = position. fresh-start outranks right-size: on a Monday morning
   the opener is "shape the week", and right-sizing follows once shaped. */
const TICK_NUDGES: NudgeId[] = [
  'drift',
  'guard',
  'start-by', // a hard deadline outranks pacing suggestions
  'post-buffer',
  'close-loop',
  'protect-rest',
  'fresh-start',
  'delegate', // rides the same window, one tick behind the opener
  'right-size',
  'break-smaller',
  'kinder-plan',
  'pref-drift', // rulebook hygiene waits behind everything urgent
]
const EVENT_NUDGES: NudgeId[] = ['celebrate', 'micro-break', 'next-up', 'when-where', 'fresh-start']

/** Outcome learning: declining a nudge type stretches its cooldown; accepting
    restores it. Care, not nagging — celebrate (cooldown 0) is never modulated. */
export function cooldownMultiplier(stats?: { accepted: number; declined: number }): number {
  if (!stats) return 1
  if (stats.declined >= 2 && stats.accepted === 0) return 3
  if (stats.declined > stats.accepted) return 2
  return 1
}

const DEF_BY_ID = new Map(NUDGES.map((d) => [d.id, d]))

/** ids is the PRIORITY order — first triggered wins the tick. */
function fire(ctx: NudgeCtx, ids: NudgeId[]): NudgeInstance[] {
  const out: NudgeInstance[] = []
  for (const id of ids) {
    const def = DEF_BY_ID.get(id)
    if (!def) continue
    const last = ctx.lastFired[def.id]
    if (!def.trigger(ctx)) continue
    const built = def.build(ctx)
    if (last && def.cooldownMs > 0) {
      const cooldown = def.cooldownMs * cooldownMultiplier(ctx.outcomeStats[def.id])
      const sameKey = built.key == null || last.key === built.key
      if (sameKey && ctx.nowMs - last.ts < cooldown) continue
    }
    out.push({ type: def.id, label: def.label, ...built })
  }
  return out
}

/** Tick-driven evaluation — at most one nudge per tick (the first by library priority). */
export function evaluateTick(ctx: NudgeCtx): NudgeInstance[] {
  return fire(ctx, TICK_NUDGES).slice(0, 1)
}

/** Event-driven nudges (a completion, a capture) — always evaluated immediately. */
export function evaluateEvent(ctx: NudgeCtx): NudgeInstance[] {
  return fire(ctx, EVENT_NUDGES)
}
