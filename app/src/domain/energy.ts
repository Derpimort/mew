/* Energy-aware scheduling (#321) — the (band × task-type) rhythm, learned from
   what you ACTUALLY finish, computed on-device from the append-only memory.
   Pure + keyless: zero brain I/O, same local-memory floor the insights card
   reads (#287). This is gbrain Pillars 1+2 applied to WHERE work lands — learn
   the pattern (energyProfile), apply it deterministically (the scenarios engine
   reads demonstratedDeepWindows).

   The whole point, in the owner's words: "I like keeping admin work quick and
   dusted coz I still do coding and dev work on low energy." So MEW must NOT ship
   a textbook circadian curve (deep work in a peak, admin in the dips). It reads
   the user's REAL rhythm — deep-work completion per time band — and treats
   admin-batching as a first-class move. A stated rule still outranks anything
   learned here (that precedence lives in scenarios.ts / prefs.ts); with no
   history this module returns null and placement stays byte-identical to today
   — MEW never imposes an energy model it hasn't observed. */

import type { MemoryEvent, Tag, TimeWindow } from './types'
import { addDaysKey, dayKey } from './time'
import type { MemoryAggregates } from './memory'

/** Deep work = a work block of an hour or more — week.isDeep's convention, kept
    here so the domain agrees on the word without a Block in hand. */
export const DEEP_MIN = 60

/** The four completion bands. Edges align to the scheduler's window edges
    (windowOf: 12:00 / 17:00), so each band maps to exactly one TimeWindow with
    no straddle — evening is a real fourth band (a user who "codes on low
    energy" finishes deep work after 17:00, and the 3-band insights model tops
    out at 21:00 and never sees it). Anything before 5:00 falls in no band and
    is excluded, exactly as the insights bands exclude it. */
export const ENERGY_BANDS = [
  { band: 'morning' as const, label: 'mornings', from: 5 * 60, to: 12 * 60 },
  { band: 'midday' as const, label: 'middays', from: 12 * 60, to: 15 * 60 },
  { band: 'late' as const, label: 'late afternoons', from: 15 * 60, to: 17 * 60 },
  { band: 'evening' as const, label: 'evenings', from: 17 * 60, to: 24 * 60 },
]

export type EnergyBand = (typeof ENERGY_BANDS)[number]['band']
/** The task-type axis (#321): the three kinds the profile scores separately —
    deep work vs low-focus admin vs health. Rest is not a task you "finish", so
    it carries no cell. */
export type FocusClass = 'deep' | 'admin' | 'health'

/** Each band maps to one scheduler window with no straddle (see ENERGY_BANDS).
    midday and late both sit in the afternoon — two diagnostic bands, one
    placement window. */
export const BAND_TO_WINDOW: Record<EnergyBand, TimeWindow> = {
  morning: 'morning',
  midday: 'afternoon',
  late: 'afternoon',
  evening: 'evening',
}

/** clock order — the windows a spread walks through, left to right */
const WINDOW_ORDER: TimeWindow[] = ['morning', 'afternoon', 'evening']

export interface BandTagRate {
  completed: number
  attempted: number
  /** completed / attempted, or null under the per-cell floor (too few to claim) */
  rate: number | null
}

export interface EnergyProfile {
  /** demonstrated completion rate per band per focus class */
  cells: Record<EnergyBand, Record<FocusClass, BandTagRate>>
}

/* ── the floor, mirrored from the insights card (#287) ──────────────────
   ~10 banded outcomes over ≥3 distinct weekdays ≈ two honest weeks — and, like
   dayThroughputMin (#301), gated on the realistic best being known, so
   energy-fit never claims a rhythm before the capacity read does. Below the
   floor energyProfile is null and energy-fit disengages. */
const FLOOR_OUTCOMES = 10
const FLOOR_WEEKDAYS = 3
/** a single band×class cell needs this many outcomes before its rate is a
    claim rather than an anecdote (the insights bands' `attempted ≥ 4` spirit,
    a touch lower because four bands split the same history thinner) */
const CELL_FLOOR = 3

/** How close to the best band a band must complete deep work to count as a
    place the user "demonstrably finishes it" — a flat profile clears this in
    every band (→ spread), a peaked one only at the peak (→ that band). */
const SPREAD_MARGIN = 0.15
/** below this a band isn't a place deep work lands, however it compares */
const DEEP_FLOOR = 0.5

function bandOf(startMin: number): EnergyBand | null {
  return ENERGY_BANDS.find((b) => startMin >= b.from && startMin < b.to)?.band ?? null
}

/** MEW-voice labels for the three focus classes — one home, shared by the
    estimate offer's copy ("your deep-work blocks…") and the pad chip's reply
    ("give my deep-work blocks room"), so the ask and the answer can't drift. */
export const FOCUS_CLASS_LABEL: Record<FocusClass, string> = {
  deep: 'deep-work',
  admin: 'admin',
  health: 'health',
}

/** The focus class of a completed/rolled outcome. Deep = a work block of an
    hour or more (or one the event already flagged `deep`); private and short
    work are the low-focus "admin/errand/quick" set the user keeps quick and
    dusted; health is its own. Rest carries no class. */
export function focusClassOf(e: MemoryEvent): FocusClass | null {
  if (e.tag === 'health') return 'health'
  if (e.tag === 'private') return 'admin'
  if (e.tag === 'work') return e.deep || (e.plannedMin ?? 0) >= DEEP_MIN ? 'deep' : 'admin'
  return null
}

function emptyCells(): EnergyProfile['cells'] {
  const zero = (): BandTagRate => ({ completed: 0, attempted: 0, rate: null })
  const out = {} as EnergyProfile['cells']
  for (const b of ENERGY_BANDS) out[b.band] = { deep: zero(), admin: zero(), health: zero() }
  return out
}

/** The demonstrated (band × task-type) completion rate, from local memory
    alone. Trailing 28 days (today excluded — today is still being lived), the
    same window the insights bands read. Null under the insights-card floor:
    below it MEW has seen too little to read a rhythm, so energy-fit disengages
    and placement stays exactly as today. `agg` gates on the realistic best
    being known (dayThroughputMin's precedent) so the two capacity claims can
    never contradict. */
export function energyProfile(
  events: MemoryEvent[],
  agg: MemoryAggregates,
  today: Date
): EnergyProfile | null {
  const todayKey = dayKey(today)
  const floor28 = addDaysKey(todayKey, -28)
  const cells = emptyCells()
  let total = 0
  const weekdays = new Set<number>()
  for (const e of events) {
    if (e.kind !== 'completed' && e.kind !== 'rolled') continue
    if (e.startMin == null || e.dayKey < floor28 || e.dayKey >= todayKey) continue
    const band = bandOf(e.startMin)
    if (!band) continue
    const cls = focusClassOf(e)
    if (!cls) continue
    const cell = cells[band][cls]
    cell.attempted++
    if (e.kind === 'completed') cell.completed++
    total++
    weekdays.add((new Date(e.dayKey + 'T12:00:00').getDay() + 6) % 7)
  }
  if (total < FLOOR_OUTCOMES || weekdays.size < FLOOR_WEEKDAYS || agg.realisticBestH == null)
    return null
  for (const b of ENERGY_BANDS)
    for (const cls of ['deep', 'admin', 'health'] as const) {
      const cell = cells[b.band][cls]
      if (cell.attempted >= CELL_FLOOR) cell.rate = cell.completed / cell.attempted
    }
  return { cells }
}

/** The windows where the user DEMONSTRABLY finishes deep work — the heart of
    the anti-peak-ghetto rule. A band counts when its deep-work completion rate
    is within SPREAD_MARGIN of the best rated band and clears DEEP_FLOOR:
    - flat across bands (finishes deep work everywhere) → every window qualifies
      → the caller SPREADS deep work, never confines it to one peak.
    - peaked in one band → only that window → deep work leans there, because
      that is where it actually lands, not because a textbook says so.
    Empty when no band clears the floor (a real profile with no deep signal) —
    the caller then imposes no window at all. Returned in clock order. */
export function demonstratedDeepWindows(profile: EnergyProfile): TimeWindow[] {
  const rated = ENERGY_BANDS.map((b) => ({
    window: BAND_TO_WINDOW[b.band],
    rate: profile.cells[b.band].deep.rate,
  })).filter((x): x is { window: TimeWindow; rate: number } => x.rate != null)
  if (!rated.length) return []
  const best = Math.max(...rated.map((x) => x.rate))
  const winning = new Set(
    rated.filter((x) => x.rate >= best - SPREAD_MARGIN && x.rate >= DEEP_FLOOR).map((x) => x.window)
  )
  return WINDOW_ORDER.filter((w) => winning.has(w))
}

/** A task low-focus enough to batch: private (admin/errand/quick) or a short
    work item (under the deep threshold — the "routine" work the user dusts off
    fast). The classification the admin batch and energy-fit both share. */
export function isAdminTask(t: { tag: Tag; durationMin: number }): boolean {
  return t.tag === 'private' || (t.tag === 'work' && t.durationMin < DEEP_MIN)
}

/** A deep-work task: work of an hour or more (isDeepTask ⇔ week.isDeep). */
export function isDeepTask(t: { tag: Tag; durationMin: number }): boolean {
  return t.tag === 'work' && t.durationMin >= DEEP_MIN
}

/** The focus class of a task/block from its {tag, length} — the by-tag twin of
    focusClassOf (which reads a MemoryEvent). Same thresholds, so the estimate
    factor (learned from events) and the padding (applied to blocks/tasks) always
    agree on what "deep" vs "admin" means. Rest carries no class. */
export function focusClassOfTask(t: { tag: Tag; durationMin: number }): FocusClass | null {
  if (t.tag === 'health') return 'health'
  if (isDeepTask(t)) return 'deep'
  if (isAdminTask(t)) return 'admin'
  return null
}

/** The minimum shape adminBatch needs — a superset of ScenarioTask, so the
    scenarios engine passes its own tasks straight through and the concrete type
    is preserved by the generic. A `due` (same-day deadline) or a stated
    `window` keeps an item OUT of the cluster: a deadline can't slide into a
    contiguous run, and a stated window is the user's own judgment (stated word
    wins) — placed where they said, not folded in. */
export interface BatchableTask {
  tag: Tag
  durationMin: number
  due?: number
  window?: TimeWindow
}

export interface AdminBatch<T> {
  /** the low-focus items to place as one adjacent run, in the given order */
  tasks: T[]
  /** the run's total length — the single gap the scheduler must find */
  totalMin: number
}

/** Cluster the low-focus items into ONE contiguous window ("quick and dusted")
    instead of sprinkling one into every dip. Pure: it names WHICH items and how
    long the run is; the scenarios engine finds the gap and lays them adjacent.
    Null when fewer than two batchable items exist — nothing to cluster (a lone
    admin item is already its own tight window). Whether to batch AT ALL (even
    below the data floor, on a stated "batch my admin" rule) is the caller's
    call; this only groups. */
export function adminBatch<T extends BatchableTask>(tasks: T[]): AdminBatch<T> | null {
  const admin = tasks.filter((t) => isAdminTask(t) && t.due == null && t.window == null)
  if (admin.length < 2) return null
  return { tasks: admin, totalMin: admin.reduce((s, t) => s + t.durationMin, 0) }
}
