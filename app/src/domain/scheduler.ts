/* The proactive scheduler's scoring oracle (#80, per docs/spikes/scheduling.md).
   Pure + keyless: given an item and the live week, enumerate candidate slots in
   the REAL free gaps — never overlapping, never over fixed/external blocks,
   ending by a due deadline — and SCORE each in [0,1] by time-of-day fit, rest
   spacing, and stored preferences. The suggest_slots tool (slice 2) hands these
   to the model, which picks; the hard gate makes a bad pick impossible.

   Slice 1 of #80 is this scorer + its tests. The suggest_slots tool, the
   execPlan/execMove rewire to consult it, and rest-block auto-insertion are
   slice 2 — see the ADR's impl plan. */
import type { Block, PrefPayload, Tag } from './types'
import { addDaysKey } from './time'
import { blocksForDay, DAY_END, DAY_START, freeWindows, isBackground } from './week'

export type TimeWindow = 'morning' | 'afternoon' | 'evening'

export interface SlotQuery {
  title: string
  tag: Tag
  durationMin: number
  /** must END by this minute-of-day today (a same-day deadline); omit = none */
  due?: number
  /** soft time-of-day preference; omit = inferred from tag */
  window?: TimeWindow
}

export interface SlotCandidate {
  dayKey: string
  startMin: number
  endMin: number
  /** [0,1], higher is better — only conflict-free candidates ever appear */
  score: number
  /** human-readable reason, for the model to reason over and for transparency */
  why: string
}

export interface ScoreWeights {
  timeOfDay: number
  rest: number
  preference: number
}

const DEFAULT_WEIGHTS: ScoreWeights = { timeOfDay: 0.4, rest: 0.35, preference: 0.25 }
/** continuous-work minutes beyond which a back-to-back placement is penalised (#79) */
const REST_RUN_CAP = 90
const STEP = 30
const MORNING_END = 12 * 60
const AFTERNOON_END = 17 * 60

function windowOf(startMin: number): TimeWindow {
  if (startMin < MORNING_END) return 'morning'
  if (startMin < AFTERNOON_END) return 'afternoon'
  return 'evening'
}
/** the query's preferred window, or a tag default (deep work → mornings) */
function preferredWindow(q: SlotQuery): TimeWindow | null {
  return q.window ?? (q.tag === 'work' ? 'morning' : null)
}

/** Non-overlapping candidate placements in the real free gaps, today (from
    `nowMin`) through +horizonDays. Each gap offers its leftmost (tight-pack)
    start plus a clock-aligned :00/:30 grid, so the scorer can honour a
    time-of-day or a "gym → 07:00" preference. Hard gate: duration must fit, and
    a `due` deadline (must END by) confines candidates to today. `freeWindows`
    already excludes fixed, external, optional and background blocks, so a
    candidate can never overlap. */
export function candidateSlots(
  blocks: Block[],
  q: SlotQuery,
  todayKey: string,
  nowMin: number,
  horizonDays = 7,
): { dayKey: string; startMin: number; endMin: number }[] {
  const out: { dayKey: string; startMin: number; endMin: number }[] = []
  const lastDay = q.due != null ? 0 : horizonDays // a same-day due confines to today
  for (let d = 0; d <= lastDay; d++) {
    const day = addDaysKey(todayKey, d)
    const from = d === 0 ? Math.max(DAY_START, nowMin) : DAY_START
    for (const w of freeWindows(blocks, day, from, DAY_END)) {
      const starts = new Set<number>()
      if (w.startMin + q.durationMin <= w.endMin) starts.add(w.startMin) // tight pack
      for (let s = Math.ceil(w.startMin / STEP) * STEP; s + q.durationMin <= w.endMin; s += STEP) starts.add(s)
      for (const startMin of [...starts].sort((a, b) => a - b)) {
        const endMin = startMin + q.durationMin
        if (q.due != null && endMin > q.due) continue // must end by the deadline
        out.push({ dayKey: day, startMin, endMin })
      }
    }
  }
  return out
}

/** spacing factor [0,1]: 1 = breathing room; lower when the slot sits
    back-to-back with adjacent work, worse when it extends a continuous run past
    the rest cap (#79). Rest blocks don't count as work to space around. */
function restScore(blocks: Block[], cand: { dayKey: string; startMin: number; endMin: number }): number {
  const work = blocksForDay(blocks, cand.dayKey).filter(
    (b) => b.status === 'open' && !isBackground(b) && b.tag !== 'rest',
  )
  const before = work.filter((b) => b.endMin <= cand.startMin).sort((a, b) => b.endMin - a.endMin)[0]
  const after = work.filter((b) => b.startMin >= cand.endMin).sort((a, b) => a.startMin - b.startMin)[0]
  let score = 1
  if (before && before.endMin === cand.startMin) {
    const runLen = cand.endMin - before.startMin
    score -= runLen > REST_RUN_CAP ? 0.5 : 0.2
  }
  if (after && after.startMin === cand.endMin) score -= 0.2
  return Math.max(0, score)
}

/** parse a clock time out of a pref value ("starts 07:00" → 420); null if none */
function parseTime(value: string): number | null {
  const m = /(\d{1,2}):(\d{2})/.exec(value)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h >= 0 && h < 24 && min >= 0 && min < 60 ? h * 60 + min : null
}

/** preference factor [0,1]: a stored time-default rule ("gym → starts 07:00")
    rewards candidates near that time; no matching rule → neutral (no signal). */
function prefScore(q: SlotQuery, startMin: number, prefs: PrefPayload[]): number {
  const title = q.title.toLowerCase()
  const rule = prefs.find((p) => p.kind === 'time-default' && title.includes(p.match.toLowerCase()))
  const want = rule ? parseTime(rule.value) : null
  if (want == null) return 0.5
  return Math.max(0, 1 - Math.abs(startMin - want) / 120) // full at the time, fading over 2h
}

function timeOfDayScore(q: SlotQuery, startMin: number): number {
  const want = preferredWindow(q)
  if (!want) return 0.5
  return windowOf(startMin) === want ? 1 : 0.4
}

/** Rank the conflict-free candidate slots for an item. Pure, deterministic,
    keyless (`brainLines` is optional future enrichment, unused in the floor).
    Highest score first; ties broken by the earlier slot. */
export function scoreSlots(
  blocks: Block[],
  q: SlotQuery,
  todayKey: string,
  nowMin: number,
  prefs: PrefPayload[] = [],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  horizonDays = 7,
): SlotCandidate[] {
  return candidateSlots(blocks, q, todayKey, nowMin, horizonDays)
    .map((c) => {
      const tod = timeOfDayScore(q, c.startMin)
      const rest = restScore(blocks, c)
      const pref = prefScore(q, c.startMin, prefs)
      const score = weights.timeOfDay * tod + weights.rest * rest + weights.preference * pref
      const reasons: string[] = []
      if (tod >= 1) reasons.push(`${preferredWindow(q)} fit`)
      if (pref >= 1) reasons.push('matches your rule')
      if (rest >= 1) reasons.push('breathing room')
      else if (rest < 0.6) reasons.push('back-to-back')
      return {
        dayKey: c.dayKey,
        startMin: c.startMin,
        endMin: c.endMin,
        score: Number(score.toFixed(3)),
        why: reasons.length ? reasons.join(', ') : 'fits a free gap',
      }
    })
    .sort((a, b) => b.score - a.score || a.dayKey.localeCompare(b.dayKey) || a.startMin - b.startMin)
}

/* ── rest insertion (#103) — the #80 follow-up ────────────────────────
   #80 made placement rest-AWARE (the REST_RUN_CAP scoring factor biases away
   from long back-to-back runs) but never INSERTS a rest. This pass closes the
   loop: after a plan/reshape, if a day holds a continuous committed-work run
   past the cap with no break, find a short pacing rest to sit inside it.

   Rationale, not a cadence: a long unbroken stretch erodes focus (Pomodoro;
   WHO ICD-11 burn-out QD85 is the *why* MEW protects rest) — NOT a literal
   90-min clock (the round number is popularised, not physiological). So the
   rest is short and UNPROTECTED: a later reshape can absorb it, never an
   orphaned-break duplicate. The executor (store) is the only mutation path —
   this pass just says where (or that it'd have to displace, so only offer). */

/** a short pacing rest stays absorbable: ≤20m so a reshape can dissolve it */
export const PACING_REST_MIN = 15
const PACING_REST_MAX = 20
/** below this a break isn't worth a block; mirrors dayShape's rest threshold */
const PACING_REST_FLOOR = 10
/** <15m of air doesn't break a run — same continuity notion as dayShape */
const RUN_GAP = 15

/** the committed work that forms a run: open, focus, non-rest, non-optional —
    the same set the day's load and streak math already trust. */
function committedWork(blocks: Block[], dayKey: string): Block[] {
  return blocksForDay(blocks, dayKey).filter(
    (b) => b.status === 'open' && !b.optional && !isBackground(b) && b.tag !== 'rest',
  )
}

interface WorkRun {
  startMin: number
  endMin: number
}

/** Continuous committed-work runs: consecutive work blocks with <RUN_GAP of
    air between them, split by any real rest (≥floor) — a rest already breaks
    the run, so a day that's broken up yields only short runs and no insertion. */
function workRuns(blocks: Block[], dayKey: string): WorkRun[] {
  const day = blocksForDay(blocks, dayKey).filter(
    (b) => b.status === 'open' && !b.optional && !isBackground(b),
  )
  const runs: WorkRun[] = []
  let cur: WorkRun | null = null
  for (const b of day) {
    if (b.tag === 'rest') {
      if (b.endMin - b.startMin >= PACING_REST_FLOOR) cur = null // a real break ends the run
      continue
    }
    if (cur && b.startMin - cur.endMin < RUN_GAP) cur.endMin = Math.max(cur.endMin, b.endMin)
    else runs.push((cur = { startMin: b.startMin, endMin: b.endMin }))
  }
  return runs
}

export interface RestInsertion {
  dayKey: string
  /** where the pacing rest goes (place), or the run that needs one (suggest) */
  startMin: number
  endMin: number
  /** auto-place into a free seam, or only offer (inserting would displace work) */
  kind: 'place' | 'suggest'
  why: string
}

/** The pacing-rest pass over one already-placed day. Pure + idempotent: returns
    at most one rest for the LONGEST over-cap run that has no break, and nothing
    once a rest sits inside that run (re-running a reshape can't stack rests).

    Prefer the natural seam — a free gap touching the run that fits the rest
    without moving anything (auto `place`). If the run is wall-to-wall so the
    only way in is to displace a committed block, `suggest` instead: MEW offers
    it in chat rather than seizing time. `freeWindows` already excludes fixed,
    external, optional and background blocks, so a placed rest never overlaps. */
export function restInsertion(blocks: Block[], dayKey: string): RestInsertion | null {
  const work = committedWork(blocks, dayKey)
  if (!work.length) return null
  /* a run is the unbroken non-rest stretch (dayShape's notion: errands abutting
     work extend the same stretch), but only one ANCHORED BY WORK earns a rest —
     a long string of pure errands isn't the focus fatigue this paces. */
  const runs = workRuns(blocks, dayKey)
    .filter((r) => r.endMin - r.startMin > REST_RUN_CAP)
    .filter((r) => work.some((w) => w.startMin < r.endMin && w.endMin > r.startMin))
  if (!runs.length) return null
  // the longest over-cap run is the one most in need of a break
  const run = runs.sort((a, b) => b.endMin - b.startMin - (a.endMin - a.startMin))[0]

  const rests = blocksForDay(blocks, dayKey).filter((b) => b.tag === 'rest' && b.status === 'open')
  /* idempotent: any rest inside the run OR touching its edge (the breather we
     tuck right after a stretch sits at run.endMin) already paces it — re-running
     a reshape must never stack a second. Inclusive bounds make adjacency count. */
  if (rests.some((r) => r.startMin <= run.endMin && r.endMin >= run.startMin)) return null

  /* candidate seams: free gaps from inside the run through the moment it ends —
     never before it (a breather ahead of the work breaks nothing). Leftmost
     first, so an internal split wins over the gap right after the stretch; a
     sliver only counts if it clears the floor. The run being continuous means
     internal gaps are <RUN_GAP, so the usual seam is the air just after it. */
  const fits = freeWindows(blocks, dayKey, DAY_START, DAY_END)
    .filter((w) => w.startMin >= run.startMin && w.startMin <= run.endMin)
    .filter((w) => w.endMin - w.startMin >= PACING_REST_FLOOR)
    .sort((a, b) => a.startMin - b.startMin)

  if (fits.length) {
    const seam = fits[0]
    const dur = Math.min(PACING_REST_MAX, Math.max(PACING_REST_FLOOR, PACING_REST_MIN), seam.endMin - seam.startMin)
    return {
      dayKey,
      startMin: seam.startMin,
      endMin: seam.startMin + dur,
      kind: 'place',
      why: 'a short breather inside a long stretch',
    }
  }
  // no seam — breaking the run means moving committed work, so only offer it
  return {
    dayKey,
    startMin: run.startMin,
    endMin: run.endMin,
    kind: 'suggest',
    why: 'a long unbroken stretch with no room for a break',
  }
}
