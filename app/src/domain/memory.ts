/* Memory — append-only history; aggregates are always recomputed from events.
   Rule: history informs; the live week decides. Nothing here answers "now". */

import type { MemoryEvent } from './types'
import { addDaysKey, dayKey, fromDayKey, isoWeek } from './time'

export interface MemoryAggregates {
  /** Trailing median of daily *completed* deep-work hours. Null until 3+ days of data. */
  realisticBestH: number | null
  /** rolled / (rolled + completed), per trailing ISO week, oldest → newest (up to 4). */
  carryRatioByWeek: number[]
  /** Carry-over of the most recent fully counted weeks. */
  carryRatio: number
  /** Rest blocks honored over the trailing 7 days, 0–1 (null when no rest planned). */
  restKeptRatio: number | null
  /** Consecutive trailing days (ending yesterday) with planned rest skipped. */
  restSkippedStreak: number
}

export function aggregates(events: MemoryEvent[], today: Date): MemoryAggregates {
  const todayKey = dayKey(today)

  /* realistic best: per-day sum of completed deep minutes, trailing 14 days (excl. today) */
  const deepByDay = new Map<string, number>()
  for (const e of events) {
    if (e.kind !== 'completed' || !e.deep || !e.plannedMin) continue
    if (e.dayKey >= todayKey) continue
    deepByDay.set(e.dayKey, (deepByDay.get(e.dayKey) ?? 0) + e.plannedMin)
  }
  const floor14 = addDaysKey(todayKey, -14)
  const recent = [...deepByDay.entries()].filter(([k]) => k >= floor14).map(([, v]) => v / 60)
  recent.sort((a, b) => a - b)
  const realisticBestH =
    recent.length >= 3
      ? Math.round(
          (recent.length % 2
            ? recent[(recent.length - 1) / 2]
            : (recent[recent.length / 2 - 1] + recent[recent.length / 2]) / 2) * 2,
        ) / 2
      : null

  /* carry-over per ISO week */
  const byWeek = new Map<number, { rolled: number; completed: number }>()
  for (const e of events) {
    if (e.kind !== 'rolled' && e.kind !== 'completed') continue
    const wk = isoWeek(fromDayKey(e.dayKey))
    const slot = byWeek.get(wk) ?? { rolled: 0, completed: 0 }
    if (e.kind === 'rolled') slot.rolled++
    else slot.completed++
    byWeek.set(wk, slot)
  }
  const thisWeek = isoWeek(today)
  const weeks = [...byWeek.entries()]
    .filter(([wk]) => wk < thisWeek && wk >= thisWeek - 4)
    .sort(([a], [b]) => a - b)
  const carryRatioByWeek = weeks.map(([, v]) =>
    v.rolled + v.completed === 0 ? 0 : v.rolled / (v.rolled + v.completed),
  )
  const carryRatio = carryRatioByWeek.length
    ? carryRatioByWeek[carryRatioByWeek.length - 1]
    : 0

  /* rest kept, trailing 7 days */
  const floor7 = addDaysKey(todayKey, -7)
  let kept = 0
  let skipped = 0
  const restByDay = new Map<string, 'kept' | 'skipped'>()
  for (const e of events) {
    if (e.kind !== 'rest_kept' && e.kind !== 'rest_skipped') continue
    if (e.dayKey < floor7 || e.dayKey >= todayKey) continue
    if (e.kind === 'rest_kept') kept++
    else skipped++
    restByDay.set(e.dayKey, e.kind === 'rest_kept' ? 'kept' : 'skipped')
  }
  const restKeptRatio = kept + skipped === 0 ? null : kept / (kept + skipped)

  let restSkippedStreak = 0
  for (let i = 1; i <= 7; i++) {
    const k = addDaysKey(todayKey, -i)
    const v = restByDay.get(k)
    if (v === 'skipped') restSkippedStreak++
    else if (v === 'kept') break
    /* days with no planned rest don't break or extend the streak */
  }

  return { realisticBestH, carryRatioByWeek, carryRatio, restKeptRatio, restSkippedStreak }
}

/** Four consecutive trailing weeks of carry-over above the threshold (kinder-plan trigger). */
export function heavyCarryWeeks(agg: MemoryAggregates, threshold = 0.3): boolean {
  return agg.carryRatioByWeek.length >= 4 && agg.carryRatioByWeek.every((r) => r > threshold)
}

/** Self-interruption count in the trailing hour (guard-the-block trigger). */
export function interruptionsLastHour(events: MemoryEvent[], now: number): number {
  return events.filter((e) => e.kind === 'interruption' && now - e.ts <= 60 * 60 * 1000).length
}

/* ── overnight consolidation (PRD §8) ─────────────────────────────────
   The brain sharpens while you sleep: raw events older than the analysis
   horizon compact into one weekly_summary per ISO week. Aggregates and
   insights only read recent raw events, so nothing they compute changes —
   this bounds growth while keeping deep history queryable. */

const CONSOLIDATE_AFTER_DAYS = 56

export interface ConsolidationResult {
  kept: MemoryEvent[]
  removedIds: string[]
  summaries: MemoryEvent[]
}

export function consolidate(events: MemoryEvent[], today: Date, uid: () => string): ConsolidationResult {
  const floor = addDaysKey(dayKey(today), -CONSOLIDATE_AFTER_DAYS)
  const kept: MemoryEvent[] = []
  const old: MemoryEvent[] = []
  for (const e of events) {
    /* preferences are state, not history — a standing rule never ages out
       (it's the brain-off rulebook; compacting it un-teaches MEW) */
    if (e.kind !== 'weekly_summary' && e.kind !== 'preference' && e.dayKey < floor) old.push(e)
    else kept.push(e)
  }
  if (!old.length) return { kept, removedIds: [], summaries: [] }

  const byWeek = new Map<string, MemoryEvent[]>()
  for (const e of old) {
    const d = fromDayKey(e.dayKey)
    const key = `${d.getFullYear()}-w${isoWeek(d)}`
    byWeek.set(key, [...(byWeek.get(key) ?? []), e])
  }
  const summaries: MemoryEvent[] = [...byWeek.entries()].map(([, evs]) => {
    const first = evs.reduce((a, b) => (a.dayKey < b.dayKey ? a : b))
    return {
      id: uid(),
      ts: first.ts,
      kind: 'weekly_summary' as const,
      dayKey: first.dayKey,
      summary: {
        completed: evs.filter((e) => e.kind === 'completed').length,
        rolled: evs.filter((e) => e.kind === 'rolled').length,
        deepMin: evs.filter((e) => e.kind === 'completed' && e.deep).reduce((s, e) => s + (e.plannedMin ?? 0), 0),
        restKept: evs.filter((e) => e.kind === 'rest_kept').length,
        restSkipped: evs.filter((e) => e.kind === 'rest_skipped').length,
        drifts: evs.filter((e) => e.kind === 'drift').length,
      },
    }
  })
  return { kept: [...kept, ...summaries], removedIds: old.map((e) => e.id), summaries }
}
