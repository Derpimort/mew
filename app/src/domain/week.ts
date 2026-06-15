/* The week model — pure operations on blocks. The live week is the single
   source of truth; everything here is synchronous and side-effect free. */

import type { Block, Capture, PrefPayload, Tag } from './types'
import { flexOverride } from './prefs'
import { addDaysKey, fmtTime, uid } from './time'

/** Background holds the clock, not the user — a different axis from
    optional (which holds no time at all). Undefined ⇒ focus. */
export function isBackground(b: Block): boolean {
  return b.attention === 'background'
}

export const DAY_START = 8 * 60
export const DAY_END = 18 * 60 + 30
export const LOAD_SCALE_MIN = 10 * 60 // week-rail bars are % of a 10h day

export function blocksForDay(blocks: Block[], dayKey: string): Block[] {
  return blocks
    .filter((b) => b.dayKey === dayKey && b.status !== 'rolled')
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
}

export function duration(b: Block): number {
  return b.endMin - b.startMin
}

/** Deep work = a work block of an hour or more. Used for load math + realistic best. */
export function isDeep(b: Block): boolean {
  return b.tag === 'work' && duration(b) >= 60
}

/** Day load by rail segment (health rides with private in the bars; legend stays work/private/rest). */
export function loadBySegment(blocks: Block[], dayKey: string): { work: number; priv: number; rest: number } {
  const out = { work: 0, priv: 0, rest: 0 }
  for (const b of blocksForDay(blocks, dayKey)) {
    if (b.optional) continue // tentative time isn't load
    const d = duration(b)
    if (b.tag === 'work') out.work += d
    else if (b.tag === 'rest') out.rest += d
    else out.priv += d
  }
  return out
}

export function plannedDeepMin(blocks: Block[], dayKey: string): number {
  return blocksForDay(blocks, dayKey)
    .filter((b) => isDeep(b) && b.status !== 'rolled' && !b.optional)
    .reduce((s, b) => s + duration(b), 0)
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

export interface Rollup {
  plannedMin: number
  doneMin: number
  done: number
  open: number
  rolled: number
}

/** How much the matching blocks have eaten across `dayKeys` — real sums from
    the live week, never an estimate. Optional blocks hold no time and stay
    out, same as load math. */
export function rollup(blocks: Block[], dayKeys: string[], match: (b: Block) => boolean): Rollup {
  const days = new Set(dayKeys)
  const out: Rollup = { plannedMin: 0, doneMin: 0, done: 0, open: 0, rolled: 0 }
  for (const b of blocks) {
    if (!days.has(b.dayKey) || b.optional || !match(b)) continue
    if (b.status === 'rolled') {
      out.rolled++
      continue // a rolled block's time moved with it — counting both doubles it
    }
    out.plannedMin += duration(b)
    if (b.status === 'done') {
      out.done++
      out.doneMin += duration(b)
    } else {
      out.open++
    }
  }
  return out
}

/** First free slot of `durationMin` on `dayKey` within [windowStart, windowEnd). */
/* Fixed-time blocks own their clock slot — interviews, calls, meetings, and
   anything from a connected calendar. Tasks are flexible: they can shift or
   end early; these can't. (Heuristic now; usage patterns can refine it.) */
const FIXED_WORDS =
  /\b(interview|call|meeting|meet|standup|stand-up|sync|1:1|one[- ]on[- ]one|demo|huddle|screening|onsite|panel|intro)\b/i
/* "interview prep" is OUR work about their meeting — a flexible task */
const PREP_WORDS = /\b(prep|prepare|preparation|practice|practise|debrief|notes|research|draft|write[- ]?up)\b/i
export function isFixedTime(b: Block, prefs: PrefPayload[] = []): boolean {
  if (b.external) return true
  /* the user's own rule outranks the word heuristic ("my syncs are movable") */
  const override = flexOverride(b.title, prefs)
  if (override) return override === 'fixed'
  if (PREP_WORDS.test(b.title)) return false
  return FIXED_WORDS.test(b.title)
}

/** Open, time-holding blocks overlapping [startMin,endMin) that day. Optional
    blocks are transparent — unless they're fixed-time (a tentative interview
    still matters). Background blocks are transparent unconditionally: they
    hold the clock, not the slot — meetings place straight over them. */
export function conflictsWith(
  blocks: Block[],
  dayKey: string,
  startMin: number,
  endMin: number,
  excludeId?: string,
  prefs: PrefPayload[] = [],
): Block[] {
  return blocksForDay(blocks, dayKey).filter(
    (b) =>
      b.id !== excludeId &&
      b.status === 'open' &&
      (!b.optional || isFixedTime(b, prefs)) &&
      !isBackground(b) &&
      overlaps(b.startMin, b.endMin, startMin, endMin),
  )
}

export function findFreeSlot(
  blocks: Block[],
  dayKey: string,
  durationMin: number,
  windowStart = DAY_START,
  windowEnd = DAY_END,
): { startMin: number; endMin: number } | null {
  /* optional events don't hold time — except fixed-time ones (a tentative
     interview is still an interview; auto-placement keeps clear of it).
     background blocks don't hold the slot either: place right over them */
  const day = blocksForDay(blocks, dayKey).filter(
    (b) => (!b.optional || isFixedTime(b)) && !isBackground(b),
  )
  let cursor = windowStart
  for (const b of day) {
    if (b.endMin <= cursor) continue
    if (b.startMin - cursor >= durationMin) break
    cursor = Math.max(cursor, b.endMin)
  }
  if (cursor + durationMin > windowEnd) return null
  return { startMin: cursor, endMin: cursor + durationMin }
}

/** Context markers for one block, as the model sees them. 'calendar' =
    synced from a connected calendar (not MEW's to edit or remove). 'fixed' =
    the time owns its slot (schedule around it) — the block itself is still
    fully editable/removable. The two are different facts. */
export function contextMarkers(b: Block): string {
  const parts = [b.tag as string]
  if (b.external) parts.push('calendar')
  else if (isFixedTime(b)) parts.push('fixed')
  if (b.optional) parts.push('optional')
  if (isBackground(b)) parts.push('background')
  if (b.due != null) parts.push(`due ${fmtTime(b.due)}`)
  if (b.status === 'done') parts.push('done')
  return parts.join(', ')
}

/** The when-where proposal: the first 30-min slot from now+15 today (9:00
    floor), scanning up to a week forward. One rule, one home — the engine's
    capture nudge, the chat accept, and the thread rail all read THIS. */
export function proposeCaptureSlot(
  blocks: Block[],
  todayKey: string,
  nowMin: number,
): { dayKey: string; startMin: number } | null {
  for (let i = 0; i <= 6; i++) {
    const key = addDaysKey(todayKey, i)
    const windowStart = i === 0 ? Math.max(nowMin + 15, 9 * 60) : 9 * 60
    const slot = findFreeSlot(blocks, key, 30, windowStart)
    if (slot) return { dayKey: key, startMin: slot.startMin }
  }
  return null
}

/** The blocks that must yield when `target` is promoted to focus: every
    OTHER open focus-attention block on the day whose span overlaps the
    target's. Demoting exactly this set keeps at most one focus inside any
    overlapping cluster — the center stays deterministic now and later. */
export function overlappingFocus(blocks: Block[], target: Block): Block[] {
  return blocksForDay(blocks, target.dayKey).filter(
    (b) =>
      b.id !== target.id &&
      b.status === 'open' &&
      (b.attention ?? 'focus') === 'focus' &&
      overlaps(b.startMin, b.endMin, target.startMin, target.endMin),
  )
}

/** Every clear window within [fromMin, toMin) on the day — air that holds
    nothing busy. Busy = open blocks that hold time (optional ones only when
    fixed: a tentative interview is still an interview). */
export function freeWindows(
  blocks: Block[],
  dayKey: string,
  fromMin: number,
  toMin: number,
): { startMin: number; endMin: number }[] {
  const busy = blocksForDay(blocks, dayKey)
    .filter((b) => b.status === 'open' && (!b.optional || isFixedTime(b)) && !isBackground(b))
    .sort((a, b) => a.startMin - b.startMin)
  const out: { startMin: number; endMin: number }[] = []
  let cursor = fromMin
  for (const b of busy) {
    if (b.endMin <= cursor) continue
    if (b.startMin > cursor) out.push({ startMin: cursor, endMin: Math.min(b.startMin, toMin) })
    cursor = Math.max(cursor, b.endMin)
    if (cursor >= toMin) break
  }
  if (cursor < toMin) out.push({ startMin: cursor, endMin: toMin })
  return out.filter((w) => w.endMin > w.startMin)
}

/** Where a block moves when it has to give way: the next free slot at or
    after BOTH its original start and `fromMin` — never earlier in the day
    (an evening block must not teleport to 8:00 am), else tomorrow morning. */
export function nextSlotAfter(
  blocks: Block[],
  b: Block,
  fromMin: number,
): { dayKey: string; startMin: number } | null {
  const from = Math.max(b.startMin, fromMin)
  const today = findFreeSlot(
    blocks.filter((x) => x.id !== b.id),
    b.dayKey,
    duration(b),
    from,
    Math.max(DAY_END, 22 * 60 + 30),
  )
  if (today) return { dayKey: b.dayKey, startMin: today.startMin }
  const tomorrow = addDaysKey(b.dayKey, 1)
  const slot = findFreeSlot(blocks, tomorrow, duration(b), 9 * 60)
  return slot ? { dayKey: tomorrow, startMin: slot.startMin } : null
}

export interface PlaceSpec {
  title: string
  tag: Tag
  dayKey: string
  startMin?: number
  endMin?: number
  durationMin?: number
  protected?: boolean
  estimateSource?: Block['estimateSource']
  attention?: Block['attention']
  due?: number
}

/** Place a block; when no explicit time, the first free slot wins. Returns null if the day is full. */
export function place(blocks: Block[], spec: PlaceSpec): Block | null {
  let startMin = spec.startMin
  let endMin = spec.endMin
  const dur = spec.durationMin ?? (startMin != null && endMin != null ? endMin - startMin : 60)
  if (startMin == null) {
    const slot = findFreeSlot(blocks, spec.dayKey, dur)
    if (!slot) return null
    startMin = slot.startMin
    endMin = slot.endMin
  }
  if (endMin == null) endMin = startMin + dur
  return {
    id: uid(),
    title: spec.title,
    tag: spec.tag,
    dayKey: spec.dayKey,
    startMin,
    endMin,
    protected: spec.protected ?? true,
    status: 'open',
    calendarRefs: [],
    estimateSource: spec.estimateSource ?? 'user',
    ...(spec.attention === 'background' ? { attention: 'background' as const } : {}),
    ...(spec.due != null ? { due: spec.due } : {}),
  }
}

export function complete(blocks: Block[], id: string, now: number): Block[] {
  return blocks.map((b) => (b.id === id ? { ...b, status: 'done' as const, completedAt: now } : b))
}

export function uncomplete(blocks: Block[], id: string): Block[] {
  return blocks.map((b) => {
    if (b.id !== id) return b
    const { completedAt: _drop, ...rest } = b
    return { ...rest, status: 'open' as const }
  })
}

/** Graceful roll: original is kept (status 'rolled', linked), a fresh open block lands tomorrow. */
export function roll(
  blocks: Block[],
  id: string,
  toDayKey: string,
  toStartMin: number,
): { blocks: Block[]; rolled: Block | null } {
  const src = blocks.find((b) => b.id === id)
  if (!src) return { blocks, rolled: null }
  const next: Block = {
    ...src,
    id: uid(),
    dayKey: toDayKey,
    startMin: toStartMin,
    endMin: toStartMin + duration(src),
    status: 'open',
    estimateSource: 'mew',
  }
  return {
    blocks: blocks.map((b) => (b.id === id ? { ...b, status: 'rolled' as const, rolledToId: next.id } : b)).concat(next),
    rolled: next,
  }
}

export function move(blocks: Block[], id: string, toDayKey: string, toStartMin: number): Block[] {
  return blocks.map((b) =>
    b.id === id
      ? { ...b, dayKey: toDayKey, startMin: toStartMin, endMin: toStartMin + duration(b) }
      : b,
  )
}

/* Fuzzy title matching (#81) — pure, keyless. findByQuery keeps its exact →
   prefix → substring tiers; this token-overlap fallback fires ONLY when
   substring finds nothing, so "management sync" can reach "Management Team
   Monday" while existing matches never regress. */
const QUERY_STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'with', 'on', 'in', 'at', 'my', 'me',
  'meeting', 'sync', 'call', 'session', 'chat', 'time',
])
/** title/query → meaningful lowercase word tokens; stopwords dropped, but never
    to empty (an all-stopword query keeps its raw words so it still has signal). */
function queryTokens(s: string): string[] {
  const raw = s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const kept = raw.filter((w) => !QUERY_STOP.has(w))
  return kept.length ? kept : raw
}
/** Levenshtein edit distance — tokens are short, so the O(m·n) DP is cheap. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m || !n) return m || n
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}
/** token similarity in [0,1]: 1 = identical, high for a typo, ~0 for unrelated. */
function tokenSim(a: string, b: string): number {
  if (a === b) return 1
  const longer = Math.max(a.length, b.length)
  return longer ? 1 - editDistance(a, b) / longer : 0
}
/** Fuzzy score [0,1]: the fraction of query tokens that find a near-match
    (sim ≥ 0.8) in the title, weighted by closeness. Recall-oriented — naming
    one real word of a longer title ("management" → "Management Team Monday")
    scores high; unrelated words score ~0. */
function fuzzyScore(query: string, title: string): number {
  const q = queryTokens(query)
  const t = queryTokens(title.split('—')[0])
  if (!q.length || !t.length) return 0
  let acc = 0
  for (const qt of q) {
    let best = 0
    for (const tt of t) best = Math.max(best, tokenSim(qt, tt))
    if (best >= 0.8) acc += best
  }
  return acc / q.length
}
const FUZZY_MIN = 0.6 // confident-match floor
const FUZZY_TIE = 0.08 // two DIFFERENT blocks within this → ambiguous, don't guess

/** Find a block by title query: exact → prefix → substring, then a fuzzy
    token-overlap fallback (#81). A weak or ambiguous fuzzy match returns
    undefined so the caller asks rather than acting on the wrong block. */
export function findByQuery(blocks: Block[], query: string, todayKey: string): Block | undefined {
  const q = query.toLowerCase().trim()
  if (!q) return undefined
  /* "lunch" must find "Lunch", not "Order lunch": exact base title beats
     prefix beats substring, and a tighter (shorter) title beats a looser one */
  const rank = (b: Block): number => {
    const base = b.title.split('—')[0].trim().toLowerCase()
    if (base === q) return 0
    if (base.startsWith(q)) return 1
    return 2
  }
  const candidates = blocks
    .filter((b) => b.status !== 'rolled' && b.title.toLowerCase().includes(q))
    .sort((a, b) => {
      const ar = rank(a)
      const br = rank(b)
      if (ar !== br) return ar - br
      const ao = a.status === 'open' ? 0 : 1
      const bo = b.status === 'open' ? 0 : 1
      if (ao !== bo) return ao - bo
      const al = a.title.length
      const bl = b.title.length
      if (al !== bl) return al - bl
      const ad = Math.abs(a.dayKey.localeCompare(todayKey))
      const bd = Math.abs(b.dayKey.localeCompare(todayKey))
      return ad - bd || a.startMin - b.startMin
    })
  if (candidates.length) return candidates[0]

  /* substring found nothing → fuzzy fallback. Return the best ONLY if it clears
     the floor and isn't a near-tie with a DIFFERENT block; a weak/ambiguous
     score returns undefined, and the executor's "say it another way?" path
     keeps us from silently mutating the wrong block. */
  const scored = blocks
    .filter((b) => b.status !== 'rolled')
    .map((b) => ({ b, score: fuzzyScore(q, b.title) }))
    .filter((x) => x.score >= FUZZY_MIN)
    .sort((a, z) => {
      if (z.score !== a.score) return z.score - a.score
      const ao = a.b.status === 'open' ? 0 : 1
      const zo = z.b.status === 'open' ? 0 : 1
      if (ao !== zo) return ao - zo
      return a.b.title.length - z.b.title.length
    })
  if (!scored.length) return undefined
  if (scored.length > 1 && scored[0].b.id !== scored[1].b.id && scored[0].score - scored[1].score < FUZZY_TIE) {
    return undefined // two plausible, different blocks — ask, don't guess
  }
  return scored[0].b
}

/** Every open block matching the query — for targeted removal ("drop both
    prod release blocks"). Same matching as findByQuery, minus the pick-one. */
export function findAllByQuery(blocks: Block[], query: string): Block[] {
  const q = query.toLowerCase().trim()
  if (!q) return []
  const substring = blocks.filter((b) => b.status === 'open' && b.title.toLowerCase().includes(q))
  if (substring.length) return substring
  /* substring missed → fuzzy fallback. This feeds execRemove's bulk delete, and
     a fuzzy match across SEVERAL different blocks is inherently a guess — so
     never return an ambiguous fuzzy spread (it would silently delete several
     blocks). Resolve to the single confident block, or nothing (caller then
     asks). Genuine bulk removal goes through the explicit substring tier above
     ("drop both prod release blocks"). (#81, #84 review) */
  const scored = blocks
    .filter((b) => b.status === 'open')
    .map((b) => ({ b, score: fuzzyScore(q, b.title) }))
    .filter((x) => x.score >= FUZZY_MIN)
    .sort((a, z) => z.score - a.score || a.b.title.length - z.b.title.length)
  if (!scored.length) return []
  if (scored.length > 1 && scored[0].b.id !== scored[1].b.id && scored[0].score - scored[1].score < FUZZY_TIE) {
    return [] // ambiguous fuzzy spread — don't silently bulk-act on a guess
  }
  return [scored[0].b]
}

/** All of the day's non-rest items are done → the day is clear, rest is earned. */
export function dayClear(blocks: Block[], dayKey: string): boolean {
  const day = blocksForDay(blocks, dayKey).filter((b) => b.tag !== 'rest' && !b.optional)
  return day.length > 0 && day.every((b) => b.status === 'done')
}

export function openItems(blocks: Block[], dayKey: string): Block[] {
  return blocksForDay(blocks, dayKey).filter(
    (b) => b.status === 'open' && b.tag !== 'rest' && !b.optional,
  )
}

/** The working day ends at the later of 18:30 and the last non-rest block. */
export function dayEndMin(blocks: Block[], dayKey: string): number {
  const day = blocksForDay(blocks, dayKey).filter((b) => b.tag !== 'rest')
  return Math.max(DAY_END, ...day.map((b) => b.endMin))
}

/* ── loose threads — everything alive that isn't the current focus ────── */

export interface LooseThreads {
  /** background blocks actually started and inside their window right now */
  running: Block[]
  /** focus commitments whose window passed today without completion */
  slipped: Block[]
  /** interrupt follow-ups: open blocks some rolled block points at (rolledToId) */
  paused: Block[]
  /** captured intentions that never got a time */
  unplaced: Capture[]
}

/** A pure derived query — nothing here is persisted, so it can never go
    stale. Optional invites never slip (they hold no commitment), and the
    groups may overlap by design: membership is per-definition, not a
    partition. */
export function looseThreads(
  blocks: Block[],
  captures: Capture[],
  todayKey: string,
  nowMin: number,
): LooseThreads {
  const day = blocksForDay(blocks, todayKey)
  const running = day.filter(
    (b) =>
      b.status === 'open' &&
      isBackground(b) &&
      b.startedAt != null &&
      b.startMin <= nowMin &&
      nowMin < b.endMin,
  )
  const slipped = day.filter(
    (b) => b.status === 'open' && !isBackground(b) && !b.optional && b.endMin < nowMin,
  )
  const rolledTargets = new Set(blocks.map((b) => b.rolledToId).filter((id): id is string => !!id))
  const paused = blocks.filter((b) => b.status === 'open' && rolledTargets.has(b.id))
  const unplaced = captures.filter((c) => c.status === 'open')
  return { running, slipped, paused, unplaced }
}
