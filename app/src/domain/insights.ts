/* GBrain pattern analyses — the brain that informs (vision: "Grow with it").
   Pure functions over the append-only memory; every insight carries the
   user's OWN numbers, in MEW's voice. History informs; the live week decides:
   nothing here answers "now", it only parameterizes proposals and copy. */

import type { Block, MemoryEvent, PrefPayload } from './types'
import { addDaysKey, dayKey, fmtDowLong, fmtTime, spell } from './time'
import { blocksForDay, duration, isDeep } from './week'
import { matchesPref, parseDurationValue, parseTimeValue } from './prefs'
import type { MemoryAggregates } from './memory'

export interface WeekdayLoad {
  dow: number // 0=Mon … 6=Sun
  name: string
  avgPlannedH: number
}

export interface BandStat {
  band: 'morning' | 'midday' | 'late'
  label: string
  completed: number
  attempted: number
  rate: number | null
}

export interface ChronicRoller {
  title: string
  rolls: number
}

export interface Insights {
  /** Trailing-4-week average planned hours per weekday; heaviest flagged. */
  weekdayLoad: WeekdayLoad[]
  heaviestDow: WeekdayLoad | null
  /** Follow-through by time band (completed vs rolled, by block start). */
  bands: BandStat[]
  bestBand: BandStat | null
  worstBand: BandStat | null
  /** Tasks that keep rolling forward (≥2 rolls, normalized title). */
  chronicRollers: ChronicRoller[]
  /** Average minutes a block finishes past its planned end (completion lateness). */
  latenessMin: number | null
  /** Booking-correction factor implied by lateness (1.0 = honest estimates). */
  estimateFactor: number | null
  /** Drift events by band — where attention slips. */
  driftBand: 'morning' | 'midday' | 'late' | null
  /** Top insight lines, MEW voice, own numbers. */
  lines: string[]
}

const BANDS = [
  { band: 'morning' as const, label: 'mornings', from: 5 * 60, to: 12 * 60 },
  { band: 'midday' as const, label: 'middays', from: 12 * 60, to: 15 * 60 },
  { band: 'late' as const, label: 'late afternoons', from: 15 * 60, to: 21 * 60 },
]

function bandOf(startMin: number): (typeof BANDS)[number] | null {
  return BANDS.find((b) => startMin >= b.from && startMin < b.to) ?? null
}

function normTitle(title: string): string {
  return title.split('—')[0].trim().toLowerCase()
}

export function computeInsights(
  events: MemoryEvent[],
  agg: MemoryAggregates,
  today: Date,
): Insights {
  const todayKey = dayKey(today)
  const floor28 = addDaysKey(todayKey, -28)
  const recent = events.filter((e) => e.dayKey >= floor28 && e.dayKey < todayKey)

  /* weekday load: planned minutes that existed per weekday (completed + rolled) */
  const byDow = new Map<number, { min: number; days: Set<string> }>()
  for (const e of recent) {
    if ((e.kind !== 'completed' && e.kind !== 'rolled') || !e.plannedMin) continue
    const dow = (new Date(e.dayKey + 'T12:00:00').getDay() + 6) % 7
    const slot = byDow.get(dow) ?? { min: 0, days: new Set() }
    slot.min += e.plannedMin
    slot.days.add(e.dayKey)
    byDow.set(dow, slot)
  }
  const names = ['mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays', 'saturdays', 'sundays']
  const weekdayLoad: WeekdayLoad[] = [...byDow.entries()]
    .map(([dow, v]) => ({
      dow,
      name: names[dow],
      avgPlannedH: Math.round((v.min / Math.max(v.days.size, 1) / 60) * 2) / 2,
    }))
    .sort((a, b) => a.dow - b.dow)
  const meanLoad =
    weekdayLoad.length > 0 ? weekdayLoad.reduce((s, w) => s + w.avgPlannedH, 0) / weekdayLoad.length : 0
  const heaviestDow =
    weekdayLoad.length >= 3
      ? [...weekdayLoad].sort((a, b) => b.avgPlannedH - a.avgPlannedH)[0]
      : null

  /* follow-through by time band */
  const bands: BandStat[] = BANDS.map((b) => ({ band: b.band, label: b.label, completed: 0, attempted: 0, rate: null }))
  for (const e of recent) {
    if (e.startMin == null) continue
    if (e.kind !== 'completed' && e.kind !== 'rolled') continue
    const band = bandOf(e.startMin)
    if (!band) continue
    const stat = bands.find((x) => x.band === band.band)!
    stat.attempted++
    if (e.kind === 'completed') stat.completed++
  }
  for (const b of bands) if (b.attempted >= 4) b.rate = b.completed / b.attempted
  const rated = bands.filter((b) => b.rate != null)
  const bestBand = rated.length >= 2 ? [...rated].sort((a, b) => b.rate! - a.rate!)[0] : null
  const worstBand = rated.length >= 2 ? [...rated].sort((a, b) => a.rate! - b.rate!)[0] : null

  /* chronic rollers */
  const rollCount = new Map<string, number>()
  for (const e of events) {
    if (e.kind !== 'rolled' || !e.title) continue
    const t = normTitle(e.title)
    rollCount.set(t, (rollCount.get(t) ?? 0) + 1)
  }
  const chronicRollers = [...rollCount.entries()]
    .filter(([, n]) => n >= 2)
    .map(([title, rolls]) => ({ title, rolls }))
    .sort((a, b) => b.rolls - a.rolls)
    .slice(0, 3)

  /* lateness: completion timestamp vs planned end (same-day completions only) */
  let lateSum = 0
  let lateN = 0
  let planSum = 0
  for (const e of recent) {
    if (e.kind !== 'completed' || e.endMin == null || !e.plannedMin) continue
    const done = new Date(e.ts)
    if (dayKey(done) !== e.dayKey) continue
    const lateness = done.getHours() * 60 + done.getMinutes() - e.endMin
    if (lateness < -180 || lateness > 300) continue // checked off much later ≠ worked later
    lateSum += lateness
    lateN++
    planSum += e.plannedMin
  }
  const latenessMin = lateN >= 5 ? Math.round(lateSum / lateN) : null
  const estimateFactor =
    latenessMin != null && planSum > 0 && latenessMin > 0
      ? Math.round((1 + lateSum / planSum) * 100) / 100
      : latenessMin != null
        ? 1
        : null

  /* drift clustering */
  const driftBands = new Map<string, number>()
  for (const e of recent) {
    if (e.kind !== 'drift') continue
    const m = new Date(e.ts)
    const band = bandOf(m.getHours() * 60 + m.getMinutes())
    if (band) driftBands.set(band.band, (driftBands.get(band.band) ?? 0) + 1)
  }
  const driftTop = [...driftBands.entries()].sort((a, b) => b[1] - a[1])[0]
  const driftBand = driftTop && driftTop[1] >= 3 ? (driftTop[0] as Insights['driftBand']) : null

  /* lines — top findings, own numbers, MEW voice */
  const lines: string[] = []
  if (agg.realisticBestH != null)
    lines.push(`your realistic best is about ${agg.realisticBestH}h of deep work a day — plans beyond that have history against them`)
  if (bestBand && worstBand && bestBand.band !== worstBand.band && bestBand.rate! - worstBand.rate! >= 0.2)
    lines.push(
      `${bestBand.label} hold: ${bestBand.completed}/${bestBand.attempted} finished there, against ${worstBand.completed}/${worstBand.attempted} in ${worstBand.label} — deep work belongs in ${bestBand.label}`,
    )
  if (heaviestDow && meanLoad > 0 && heaviestDow.avgPlannedH >= meanLoad * 1.3)
    lines.push(`${heaviestDow.name} run heavy — ${heaviestDow.avgPlannedH}h planned on average vs ${Math.round(meanLoad * 2) / 2}h elsewhere`)
  for (const r of chronicRollers.slice(0, 1))
    lines.push(`"${r.title}" has rolled forward ${spell(r.rolls)} times — a smaller first step usually breaks the loop`)
  if (latenessMin != null && latenessMin >= 12 && estimateFactor != null && estimateFactor > 1.05)
    lines.push(`blocks run about ${latenessMin} min past their end — booking ~${Math.round((estimateFactor - 1) * 100)}% longer would make the plan honest`)
  if (driftBand) lines.push(`drift clusters in the ${BANDS.find((b) => b.band === driftBand)!.label} — that's where a guard earns its keep`)
  if (agg.carryRatio > 0.3) lines.push(`carry-over is running ${Math.round(agg.carryRatio * 100)}% — the week is asking for a kinder shape`)

  return {
    weekdayLoad,
    heaviestDow,
    bands,
    bestBand,
    worstBand,
    chronicRollers,
    latenessMin,
    estimateFactor,
    driftBand,
    lines: lines.slice(0, 4),
  }
}

/* ── the kinder plan, made concrete (nudge #8's Apply) ─────────────────
   Proposal: cap each upcoming day's deep work at the realistic best by moving
   the smallest deep blocks to the lightest days; keep one afternoon free.
   Proposed, not imposed — the caller renders it and applies only on accept. */

export interface DelegationCandidate {
  /** normalized task kind (slug form, matches the graph's task/ pages) */
  taskKind: string
  /** display form, from the live titles */
  label: string
  /** person slug (matches person/ pages) */
  person: string
  personLabel: string
  count: number
}

/** Recurring task×person co-occurrence with receipts. A candidate needs all
    three: the pair ran ≥3 times in the trailing 28 days, the task kind is
    also YOURS (it appears without that person — shared, not theirs already),
    and the graph holds the task→person edge (links are the receipts; no
    brain, no links, no candidates). Links arrive as data — the store fetches,
    the domain never does I/O. */
export function delegationCandidates(
  events: MemoryEvent[],
  links: { from: string; to: string }[],
  nowMs: number,
): DelegationCandidate[] {
  const floor = nowMs - 28 * 24 * 60 * 60 * 1000
  const recent = events.filter(
    (e) => e.kind === 'completed' && e.ts >= floor && e.ts <= nowMs && !!e.title,
  )
  if (!recent.length) return []
  const kindSlug = (title: string) =>
    normTitle(title)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

  const out: DelegationCandidate[] = []
  const seen = new Set<string>()
  for (const l of links) {
    if (!l.from.startsWith('task/') || !l.to.startsWith('person/')) continue
    const kind = l.from.slice('task/'.length)
    const person = l.to.slice('person/'.length)
    const key = `${person}:${kind}`
    if (!kind || !person || seen.has(key)) continue
    seen.add(key)
    const ofKind = recent.filter((e) => kindSlug(e.title!) === kind)
    const together = ofKind.filter((e) => e.title!.toLowerCase().includes(person.replace(/-/g, ' ')) || e.title!.toLowerCase().includes(person))
    const alsoYours = ofKind.some((e) => !together.includes(e))
    if (together.length >= 3 && alsoYours) {
      const personLabel = person
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
      out.push({
        taskKind: kind,
        label: normTitle(together[0].title!),
        person,
        personLabel,
        count: together.length,
      })
    }
  }
  return out.sort((a, b) => b.count - a.count)
}

export interface KinderMove {
  blockId: string
  title: string
  fromDayKey: string
  toDayKey: string
  toStartMin: number
}

export function proposeKinderPlan(
  blocks: Block[],
  agg: MemoryAggregates,
  todayKey: string,
  findFreeSlot: (blocks: Block[], dayKey: string, durationMin: number, windowStart?: number) => { startMin: number } | null,
): { moves: KinderMove[]; summary: string } {
  const bestH = agg.realisticBestH ?? 5
  const capMin = bestH * 60
  const horizon = Array.from({ length: 7 }, (_, i) => addDaysKey(todayKey, i + 1))
  /* deep work never moves onto the weekend — that would be louder, not kinder */
  const isWeekday = (k: string) => {
    const dow = (new Date(k + 'T12:00:00').getDay() + 6) % 7
    return dow < 5
  }
  const moves: KinderMove[] = []
  let working = blocks

  for (const day of horizon) {
    const deepOf = (k: string) =>
      blocksForDay(working, k).filter((b) => isDeep(b) && b.status === 'open' && !b.external)
    let load = deepOf(day).reduce((s, b) => s + duration(b), 0)
    if (load <= capMin * 1.2) continue
    const candidates = deepOf(day).sort((a, b) => duration(a) - duration(b))
    for (const cand of candidates) {
      if (load <= capMin) break
      /* lightest future weekday with room (a touch of give: ≤ 1.15× cap) */
      const target = horizon
        .filter((k) => k > day && isWeekday(k))
        .map((k) => ({ k, load: deepOf(k).reduce((s, b) => s + duration(b), 0) }))
        .sort((a, b) => a.load - b.load)
        .find((t) => t.load + duration(cand) <= capMin * 1.15)
      if (!target) continue
      const slot = findFreeSlot(working.filter((b) => b.id !== cand.id), target.k, duration(cand), 9 * 60)
      if (!slot) continue
      moves.push({
        blockId: cand.id,
        title: cand.title.split('—')[0].trim(),
        fromDayKey: day,
        toDayKey: target.k,
        toStartMin: slot.startMin,
      })
      working = working.map((b) =>
        b.id === cand.id ? { ...b, dayKey: target.k, startMin: slot.startMin, endMin: slot.startMin + duration(cand) } : b,
      )
      load -= duration(cand)
    }
  }

  const summary = moves.length
    ? moves
        .map((m) => `${m.title} → ${fmtDowLong(m.toDayKey).toLowerCase()}`)
        .join(', ')
    : ''
  return { moves, summary }
}

/* ── preference validation: rules that reality has outgrown ──────────── */

export interface PrefContradiction {
  pref: PrefPayload
  /** what behavior actually shows — "starts 18:00" / "85m" */
  observed: string
  count: number
}

/** Cooldown identity of a rule — one home for the key grammar, shared by the
    nudge's build (library) and the engine's candidate selection. */
export function prefKey(p: PrefPayload): string {
  return `${p.kind}:${p.match.toLowerCase()}`
}

/** Compare the standing rulebook against lived events, trailing 14 days.
    A rule contradicted ≥3 times has been outgrown, not broken — surface it
    kindly. Pref-driven placements land AT the rule, so they can never
    self-confirm a contradiction; only real deviations count.
    Matching and value parsing are imported from prefs.ts — validation must
    read the rulebook with exactly the grammar placement applies it with. */
export function prefContradictions(
  prefs: PrefPayload[],
  events: MemoryEvent[],
  today: Date,
): PrefContradiction[] {
  const floor = addDaysKey(dayKey(today), -14)
  const lived = events.filter(
    (e) => e.kind === 'completed' && e.dayKey >= floor && e.title != null && e.startMin != null,
  )
  const out: PrefContradiction[] = []
  for (const p of prefs) {
    if (p.kind === 'time-default') {
      const ruleMin = parseTimeValue(p.value)
      if (ruleMin == null) continue
      const off = lived.filter(
        (e) => matchesPref(e.title!, p.match) && Math.abs(e.startMin! - ruleMin) >= 60,
      )
      if (off.length >= 3) {
        const mid = [...off.map((e) => e.startMin!)].sort((a, b) => a - b)[Math.floor(off.length / 2)]
        out.push({ pref: p, observed: `starts ${fmtTime(mid)}`, count: off.length })
      }
    }
    if (p.kind === 'duration-default') {
      const ruleDur = parseDurationValue(p.value)
      if (ruleDur == null || ruleDur === 0) continue
      const off = lived.filter((e) => {
        if (!matchesPref(e.title!, p.match) || e.endMin == null) return false
        const actual = e.endMin - e.startMin!
        return actual > 0 && Math.abs(actual - ruleDur) / ruleDur >= 0.25
      })
      if (off.length >= 3) {
        const mid = [...off.map((e) => e.endMin! - e.startMin!)].sort((a, b) => a - b)[Math.floor(off.length / 2)]
        out.push({ pref: p, observed: `${mid}m`, count: off.length })
      }
    }
  }
  return out
}
