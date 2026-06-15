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
