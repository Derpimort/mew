/* Circadian meal anchors (#298, v0.5 plan 16a) — the domain facts about
   meals: which titles ARE one, when each naturally happens, and how much
   air keeps two meals two meals. The scheduler's scoring path consumes
   these, so every placement route (chat asks, executor tools, plan-mode
   scenarios) inherits meal sanity with zero store changes. Windows are
   research-grounded DEFAULTS in normal circadian meal timing, never hard
   rules: a remembered pref recenters them, a stated time outranks them,
   and a packed day may still force an off-window meal — the scorer only
   makes that a named last resort, never a silent preference. */

import type { Block, PrefPayload, ScaffoldMealId, ScaffoldMealPlan, Tag } from './types'
import { parseTimeValue, resolveTaskSpec, type LearnedRule } from './prefs'
import { fmtTime } from './time'
import { blocksForDay } from './week'
/* scheduler.ts also imports this module (the meal facts feed its scoring
   seam). The cycle is deliberate and safe: both directions are consumed only
   inside function bodies, never at module init — the anchors live here, the
   scoring lives there, and the scaffold (#299) is spec'd to extend THIS
   module while placing through that scoring. */
import { restInsertion, scoreSlots, type SlotQuery } from './scheduler'

export type MealClass = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface MealWindow {
  startMin: number
  endMin: number
}

/* explicit meal words only — "coffee"/"tea"/"break" and short-duration
   heuristics stay out: a title is a meal when it says so */
const MEAL_WORDS: Record<string, MealClass> = {
  breakfast: 'breakfast',
  brunch: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  supper: 'dinner',
  snack: 'snack',
}

/** The meal class a title names, or null. Head-anchored on the base title
    (before any "—" detail): "Lunch" and "Lunch with Sam" are the meal;
    "order lunch" is an errand about one (MEW_VOICE's standing-rule
    example). Whole words only, case-insensitive, total — never throws. */
export function mealClassOf(title: string): MealClass | null {
  const head = title
    .split('—')[0]
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim()
    .split(' ')[0]
  return MEAL_WORDS[head] ?? null
}

/** Default windows: breakfast 7:00–9:30, lunch 12:00–14:00, dinner
    18:30–20:30; snacks mid-morning and mid-afternoon — the one class that
    naturally happens twice, so every class carries a LIST of windows. */
export const MEAL_WINDOWS: Record<MealClass, readonly MealWindow[]> = {
  breakfast: [{ startMin: 7 * 60, endMin: 9 * 60 + 30 }],
  lunch: [{ startMin: 12 * 60, endMin: 14 * 60 }],
  dinner: [{ startMin: 18 * 60 + 30, endMin: 20 * 60 + 30 }],
  snack: [
    { startMin: 10 * 60, endMin: 11 * 60 + 30 },
    { startMin: 15 * 60, endMin: 16 * 60 + 30 },
  ],
}

/** minutes from a point to a window's nearest edge; 0 inside it */
function distTo(w: MealWindow, min: number): number {
  if (min < w.startMin) return w.startMin - min
  if (min > w.endMin) return min - w.endMin
  return 0
}

/** The class's windows with the standing rulebook applied: a `time-default`
    pref whose match itself names the class ("lunch" → "starts 13:00")
    recenters the window nearest the stated time — same width, kept inside
    the day; the other windows (snack's second) stay. No matching rule, or
    no parseable time in it, means the base — the circadian defaults, or the
    caller's own (#299: the scaffold hands its Settings-tuned window, and a
    pref still recenters it). A window the user stated in the ask never
    reaches here — the scorer skips meal anchoring entirely when `q.window`
    is present (stated intent wins). */
export function mealWindowFor(
  cls: MealClass,
  prefs: PrefPayload[] = [],
  base: readonly MealWindow[] = MEAL_WINDOWS[cls]
): readonly MealWindow[] {
  const rule = prefs.find((p) => p.kind === 'time-default' && mealClassOf(p.match) === cls)
  const at = rule ? parseTimeValue(rule.value) : null
  if (at == null) return base
  const nearest = base.reduce((a, b) => (distTo(b, at) < distTo(a, at) ? b : a))
  const width = nearest.endMin - nearest.startMin
  const startMin = Math.max(0, Math.min(at - width / 2, 24 * 60 - width))
  return base.map((w) => (w === nearest ? { startMin, endMin: startMin + width } : w))
}

/* the spacing that keeps meals distinct: dinner earns its name a real
   stretch after lunch; breakfast and lunch never crowd each other */
const MEAL_GAPS: readonly (readonly [MealClass, MealClass, number])[] = [
  ['breakfast', 'lunch', 150],
  ['lunch', 'dinner', 240],
]

function gapNeeded(a: MealClass, b: MealClass): number | null {
  const hit = MEAL_GAPS.find(([x, y]) => (x === a && y === b) || (x === b && y === a))
  return hit ? hit[2] : null
}

/** [0,1] multiplier on a meal candidate starting at `startMin`: 1 with
    clear air, collapsing linearly as the candidate crowds a paired
    meal-class block already on the day (dinner within ~4h after a lunch
    ends; breakfast/lunch within ~2.5h of each other). The candidate is a
    point at its start measured against each block's real extent; rolled
    blocks moved away and don't count; snack pairs are exempt. Total. */
export function mealAdjacencyPenalty(cls: MealClass, startMin: number, dayBlocks: Block[]): number {
  let factor = 1
  for (const b of dayBlocks) {
    if (b.status === 'rolled') continue
    const other = mealClassOf(b.title)
    if (!other) continue
    const need = gapNeeded(cls, other)
    if (need == null) continue
    const gap = startMin >= b.endMin ? startMin - b.endMin : Math.max(0, b.startMin - startMin)
    factor = Math.min(factor, Math.min(1, gap / need))
  }
  return factor
}

/* ── the meal guardrail (#323) ─────────────────────────────────────────
   The anchors above engage only through the SCORER (candidateSlots →
   scoreSlots). A model plan_blocks reshape with an EXPLICIT startMin skips
   that path, so its own meal arithmetic — "dinner 18:15 after a 15:19 lunch"
   — lands uncorrected ("how can dinner be 6pm are you stupid?"). These two
   pure functions are the safety net the executor runs on every explicit meal
   placement, keyed and keyless alike: check the time against the same window
   + gap the scorer honors, and — for a time the MODEL derived, not one the
   USER stated — pull it back to the nearest sane slot the scorer would itself
   have chosen. A stated time always wins: it is kept, named once. */

/** A meal placement's standing against its circadian window and the hard
    inter-meal gap. Pure diagnosis, no slot search. A non-meal title is
    trivially sane (`cls` null). `inWindow`: the whole meal fits one of its
    (pref-recentered) windows — the scorer's own `inMealWindow` notion.
    `spaced`: it clears every paired-meal gap (adjacency at full strength).
    Total — never throws. */
export interface MealCheck {
  cls: MealClass | null
  inWindow: boolean
  spaced: boolean
  ok: boolean
}

export function validateMealPlacement(
  dayBlocks: Block[],
  place: { title: string; startMin: number; endMin: number },
  prefs: PrefPayload[] = [],
  base?: readonly MealWindow[]
): MealCheck {
  const cls = mealClassOf(place.title)
  if (!cls) return { cls: null, inWindow: true, spaced: true, ok: true }
  const wins = mealWindowFor(cls, prefs, base)
  const inWindow = wins.some((w) => place.startMin >= w.startMin && place.endMin <= w.endMin)
  // a full-strength adjacency factor (exactly 1) IS the hard minimum gap; any
  // crowding of a paired meal-class block on the day drops it below 1
  const spaced = mealAdjacencyPenalty(cls, place.startMin, dayBlocks) === 1
  return { cls, inWindow, spaced, ok: inWindow && spaced }
}

/** What to do with a meal placed at an EXPLICIT time. `ok` — already sane (or
    not a meal). `shift` — a MODEL-derived time out of window or too close to
    another meal, moved to the nearest in-window, gap-respecting slot the
    scorer ranks first (never to another day; a packed day with no sane slot
    stays `ok` and silent — the scorer would land there too). `warn` — the
    USER's own stated time, kept as placed and named once so the tension is
    honest, never overridden and never blamed. */
export type MealCorrection =
  | { kind: 'ok' }
  | { kind: 'shift'; startMin: number; endMin: number; reason: string }
  | { kind: 'warn'; reason: string }

export function correctMeal(
  blocks: Block[],
  dayKey: string,
  todayKey: string,
  nowMin: number,
  place: { title: string; tag: Tag; startMin: number; durationMin: number; stated: boolean },
  prefs: PrefPayload[] = [],
  base?: readonly MealWindow[]
): MealCorrection {
  const dayBlocks = blocksForDay(blocks, dayKey)
  const endMin = place.startMin + place.durationMin
  const check = validateMealPlacement(
    dayBlocks,
    { title: place.title, startMin: place.startMin, endMin },
    prefs,
    base
  )
  const cls = check.cls
  if (check.ok || cls == null) return { kind: 'ok' }
  // the user's own words win — keep the time, name the tension once
  if (place.stated) return { kind: 'warn', reason: statedNote(cls, check) }
  // a model-derived time: the nearest in-window, gap-respecting slot the
  // scorer ranks first — the same slot suggest_slots would have handed back
  const q: SlotQuery = { title: place.title, tag: place.tag, durationMin: place.durationMin }
  const sane = scoreSlots(blocks, q, todayKey, nowMin, prefs, undefined, undefined, base).find(
    (c) =>
      c.dayKey === dayKey &&
      validateMealPlacement(
        dayBlocks,
        { title: place.title, startMin: c.startMin, endMin: c.endMin },
        prefs,
        base
      ).ok
  )
  if (sane && sane.startMin !== place.startMin)
    return {
      kind: 'shift',
      startMin: sane.startMin,
      endMin: sane.endMin,
      reason: shiftNote(cls, check),
    }
  return { kind: 'ok' } // packed day, no sane slot — leave it as placed
}

/* positive-voice, time-free — the executor's own line already names the slot */
function shiftNote(cls: MealClass, check: MealCheck): string {
  return check.spaced
    ? `settled ${cls} back into its usual window`
    : `gave ${cls} real room after your other meals`
}
function statedNote(cls: MealClass, check: MealCheck): string {
  return check.spaced
    ? `${cls}'s a little off its usual window, but it's yours`
    : `${cls} lands close on your last meal, but it's your call`
}

/* ── the standing day-scaffold (#299, v0.5 plan 16b) ──────────────────
   Each morning, the layer of the day that should simply be there: the meals
   the day is missing, placed through the 16a-anchored scoring around
   whatever already holds time, plus the pacing breathers the existing
   restInsertion pass finds in the fed shape. Pure and keyless: the store
   owns WHEN (the once-per-day 'sustenance' key at the brief's tick) and HOW
   (the executor plan path); this file only says WHAT the day is missing. */

/** Executor-shaped (adapters/model PlaceSpec, the scenarios.ts precedent):
    dayOffset is always 0 — today is the scaffold's whole world. Meals are
    `private`, breathers `rest`, and everything is UNPROTECTED non-work: a
    reshape absorbs them, rescue (#286) never treats them as displaced work,
    and completing one is never celebrated as a mew. */
export interface ScaffoldPlacement {
  title: string
  tag: Tag
  dayOffset: number
  startMin: number
  durationMin: number
  protected: false
}

const SCAFFOLD_ORDER: readonly ScaffoldMealId[] = ['lunch', 'dinner'] // dinner scored after lunch, so adjacency sees it
const SCAFFOLD_TITLE: Record<ScaffoldMealId, string> = { lunch: 'Lunch', dinner: 'Dinner' }

/** the placements as a working block — so the next meal (and the breather
    pass) score against the day as it will be, not as it was */
function asBlock(todayKey: string, p: ScaffoldPlacement): Block {
  return {
    id: `scaffold:${p.title}:${p.startMin}`, // never persisted — execPlan mints real ids
    title: p.title,
    tag: p.tag,
    dayKey: todayKey,
    startMin: p.startMin,
    endMin: p.startMin + p.durationMin,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'mew',
  }
}

/** What today is missing, as ready-to-apply placements. A day already
    holding any lunch-class block (user-placed, recurring, an inbound
    invite) gets no second lunch; a fully-fed day gains nothing at all —
    breathers ride along only when the scaffold is already feeding the day
    (protect-rest owns the standalone pacing conversation). Placement is the
    16a scoring (candidateSlots/scoreSlots): conflict-free by construction,
    around fixed/external blocks, windows from Settings recentered by a
    remembered pref, off-window only when nothing in-window fits. A packed
    day may yield nothing — honest silence, never displacement. Total. */
export function scaffoldDay(
  blocks: Block[],
  todayKey: string,
  opts: {
    prefs?: PrefPayload[]
    /** #328: confirmed rules — a "dinner → 45m" rule sizes the meal it feeds;
        absent (today, pre-#327) the plan default holds, byte-identical. */
    learned?: LearnedRule[]
    meals: Record<ScaffoldMealId, ScaffoldMealPlan>
    nowMin: number
  }
): ScaffoldPlacement[] {
  const prefs = opts.prefs ?? []
  const present = new Set(
    blocksForDay(blocks, todayKey)
      .filter((b) => b.status !== 'rolled')
      .map((b) => mealClassOf(b.title))
  )
  const missing = SCAFFOLD_ORDER.filter((m) => !present.has(m))
  if (!missing.length) return []

  const out: ScaffoldPlacement[] = []
  let working = blocks
  for (const meal of missing) {
    const plan = opts.meals[meal]
    /* #328: the scaffold inherits the resolver — a confirmed duration rule (or
       a stated one) sizes the meal; the circadian window stays firm via the
       meal seam below. No rule ⇒ the plan default, byte-identical. */
    const durationMin =
      resolveTaskSpec(SCAFFOLD_TITLE[meal], {}, prefs, undefined, opts.learned).spec.durationMin ??
      plan.durationMin
    const q: SlotQuery = {
      title: SCAFFOLD_TITLE[meal],
      tag: 'private',
      durationMin,
    }
    const best = scoreSlots(working, q, todayKey, opts.nowMin, prefs, undefined, 0, [
      { startMin: plan.startMin, endMin: plan.endMin },
    ])[0]
    if (!best) continue // no air for this one — the day stays as it is
    const placed: ScaffoldPlacement = {
      title: SCAFFOLD_TITLE[meal],
      tag: 'private',
      dayOffset: 0,
      startMin: best.startMin,
      durationMin,
      protected: false,
    }
    out.push(placed)
    working = [...working, asBlock(todayKey, placed)]
  }

  /* breathers over the fed shape: restInsertion returns at most one rest per
     pass (the longest over-cap run), so feeding each back as a working block
     walks every qualifying run; a `suggest` (wall-to-wall) ends it — the
     scaffold never displaces committed work. Past insertions still pace the
     walk but aren't emitted: placing a breather behind the clock is a lie. */
  for (;;) {
    const r = restInsertion(working, todayKey)
    if (!r || r.kind !== 'place') break
    const breather: ScaffoldPlacement = {
      title: 'Breather',
      tag: 'rest',
      dayOffset: 0,
      startMin: r.startMin,
      durationMin: r.endMin - r.startMin,
      protected: false,
    }
    working = [...working, asBlock(todayKey, breather)]
    if (r.startMin >= opts.nowMin) out.push(breather)
  }
  return out
}

/** The one line the scaffold says — meals by name and start time, breathers
    at the tail; empty placements ⇒ '' (a fed day says nothing). */
export function scaffoldLine(placed: ScaffoldPlacement[]): string {
  const parts = placed
    .filter((p) => p.tag !== 'rest')
    .map((p) => `${p.title.toLowerCase()} ${fmtTime(p.startMin)}`)
  const rests = placed.filter((p) => p.tag === 'rest').map((p) => fmtTime(p.startMin))
  if (rests.length === 1) parts.push(`a breather at ${rests[0]}`)
  else if (rests.length > 1) parts.push(`breathers at ${rests.join(' and ')}`)
  return parts.length ? `fed and paced: ${parts.join(', ')} — say the word to reshape` : ''
}
