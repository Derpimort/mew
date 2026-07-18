/* Plan mode's scenario engine (#292 — v0.5 item 15a). Pure + keyless: a batch
   of classified task specs → K NAMED placement scenarios, each one greedy pass
   of the #80 scoring oracle under a different ScoreWeights profile — a scenario
   IS a weight profile. candidateSlots keeps every place conflict-free by
   construction (fixed/external/tentative honored; plain optional and background
   blocks hold no slot, by product law); placements accumulate as phantom blocks
   so a scenario never self-overlaps. Tasks that fit nowhere in the horizon are
   NAMED in the scenario's line, never silently dropped. Scenarios are data —
   this module mutates nothing; 15b applies a picked scenario byte-exactly
   through the executor. Deterministic: ids come from the injected factory. */
import type { Block, PrefPayload, Tag } from './types'
import { addDaysKey } from './time'
import { conflictsWith } from './week'
import type { ScoreWeights, SlotCandidate, TimeWindow } from './scheduler'
import { scoreSlots, windowOf } from './scheduler'
import { mealClassOf, mealWindowFor, type MealWindow } from './sustenance'
import type { EnergyProfile } from './energy'
import { adminBatch, demonstratedDeepWindows, focusClassOfTask, isDeepTask } from './energy'
import { ESTIMATE_PAD_FLOOR, padDuration, type EstimateFactorByTag } from './insights'

/** One classified braindump item (15b produces these; tests fixture them). */
export interface ScenarioTask {
  title: string
  tag: Tag
  durationMin: number
  /** must END by this minute-of-day today — SlotQuery's same-day contract */
  due?: number
  /** the user's STATED time of day; every profile honors it over its own taste */
  window?: TimeWindow
  /** #322: the user stated this length in their own words — "always" pre-size
      leaves it exactly as asked (stated word wins). */
  durationStated?: boolean
}

/** Executor-shaped (adapters/model PlaceSpec): dayOffset counts from the
    scenario's todayKey, start/duration explicit — a scenario is an exact
    quote, applied as-is, never re-derived through a second pass. */
export interface ScenarioPlace {
  title: string
  tag: Tag
  dayOffset: number
  startMin: number
  durationMin: number
  due?: number
}

export interface Scenario {
  id: string
  /** the human handle ("protected mornings") */
  name: string
  /** one-sentence rationale — lowercase MEW voice, ≤ ~90 chars, distilled from
      the chosen candidates' why strings + the fit summary */
  line: string
  /** the day offsets count from here; validation and 15b's staleness gate need it */
  todayKey: string
  places: ScenarioPlace[]
  /** planned minutes this scenario adds per dayKey (item 12's density cue) */
  dayLoad: Record<string, number>
}

export interface ScenarioOpts {
  nowMin: number
  todayKey: string
  horizonDays: number
  /** insights' bestBand mapped to a window — the first profile aligns to it */
  bestWindow?: TimeWindow
  /** standing rules ("gym starts 07:00") — 15b passes the live rulebook so
      prefScore shapes every profile's placements; absent = no rules, same math */
  prefs?: PrefPayload[]
  /** #302: MEW's meeting buffer, inherited through the same scoreSlots seam so
      every scenario places shy of external meetings' edges; absent ⇒ 0 (off) */
  bufferMin?: number
  /** #321: the learned (band × task-type) rhythm. Present ⇒ the "energy-fit"
      profile joins the set, placing deep work where the user DEMONSTRABLY
      finishes it (spread when the profile is flat, leaned when it peaks) and
      batching admin. Absent (and no batchAdmin rule) ⇒ energy-fit is omitted
      entirely and the scenario set is byte-identical to today. */
  energyProfile?: EnergyProfile
  /** #321: a stated "batch my admin"/"keep admin quick" rule. Forces the
      energy-fit profile to engage — and its admin-clustering — even with no
      learned profile yet (stated word wins, above the data floor). */
  batchAdmin?: boolean
  /** #321: a stated "deep work anytime"/"don't gate my mornings" rule. Frees
      deep work from any single window, OVERRIDING a peak-leaning learned
      profile — stated pref > learned energyProfile. */
  deepFlexible?: boolean
  /** #322: the per-task-type run-long factors ("always" auto-size). Present ⇒
      each task whose length the user did NOT state is pre-sized up to how that
      kind really runs, so the preview AND the applied places carry honest
      durations. Absent (off/ask) ⇒ every task keeps its asked length and the
      scenario set is byte-identical to today. */
  estimateFactor?: EstimateFactorByTag
  /** injected id factory — 15b's exact-apply contract rides on determinism */
  ids: () => string
}

/** "always" pre-size: grow a task to how its kind really runs, unless the user
    stated the length (stated word wins) or the kind is honest enough (< the pad
    floor). Pure — a new task object, never a mutation. */
function sizeToDemonstrated(t: ScenarioTask, factors: EstimateFactorByTag): ScenarioTask {
  if (t.durationStated) return t
  const cls = focusClassOfTask(t)
  const f = cls ? factors[cls] : null
  if (f == null || f < ESTIMATE_PAD_FLOOR) return t
  return { ...t, durationMin: padDuration(t.durationMin, f) }
}

/** Variation is data: adding a profile later is one entry. `bias: 'earliest'`
    picks the first fit in clock order instead of the top score; `alignsToBest`
    lets deep work inherit the user's demonstrated best window when given. */
const PROFILES: {
  name: string
  weights: ScoreWeights
  bias?: 'earliest'
  alignsToBest?: boolean
  character: string
}[] = [
  {
    name: 'protected mornings',
    weights: { timeOfDay: 0.7, rest: 0.2, preference: 0.1 },
    alignsToBest: true,
    character: 'deep work lands in the morning',
  },
  {
    name: 'spread even',
    // timeOfDay 0 on purpose: nothing pulls work toward mornings, air decides
    weights: { timeOfDay: 0, rest: 0.85, preference: 0.15 },
    character: 'every block gets breathing room',
  },
  {
    name: 'front-loaded',
    weights: { timeOfDay: 0.4, rest: 0.35, preference: 0.25 },
    bias: 'earliest',
    character: 'the heavy work lands early, the week clears sooner',
  },
]

const WINDOW_LABEL: Record<TimeWindow, string> = {
  morning: 'mornings',
  afternoon: 'afternoons',
  evening: 'evenings',
}
const LINE_MAX = 90

/** Deep work first, longest first — the hardest-to-place items claim space
    before small ones fragment it. Stable: equal tasks keep braindump order. */
function orderTasks(tasks: ScenarioTask[]): ScenarioTask[] {
  const deep = (t: ScenarioTask): number => (t.tag === 'work' && t.durationMin >= 60 ? 0 : 1)
  return [...tasks].sort((a, b) => deep(a) - deep(b) || b.durationMin - a.durationMin)
}

/** The profile's pick among the scored candidates. A STATED window narrows the
    pool first (falling back honestly when nothing starts inside it) — the
    user's constraint outranks any profile taste, including the earliest bias.
    A meal-titled task with the when left open narrows the same way to its
    circadian windows (#298): the earliest bias reads clock order, not scores,
    so without this it would front-load lunch to 9:30 — inside the window the
    bias still chooses, and a day with no in-window air falls back honestly. */
function choose(
  cands: SlotCandidate[],
  t: ScenarioTask,
  bias?: 'earliest',
  mealWins?: readonly MealWindow[] | null
): SlotCandidate | null {
  if (!cands.length) return null
  const inWindow = t.window
    ? cands.filter((c) => windowOf(c.startMin) === t.window)
    : mealWins?.length
      ? cands.filter((c) => mealWins.some((w) => c.startMin >= w.startMin && c.endMin <= w.endMin))
      : cands
  const pool = inWindow.length ? inWindow : cands
  if (bias === 'earliest')
    return [...pool].sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.startMin - b.startMin)[0]
  return pool[0] // scoreSlots ranks best-first, ties broken by the earlier slot
}

/** A placement as the next greedy pass must see it: open, focus, time-holding —
    so candidateSlots routes later tasks around it and restScore feels its
    adjacency. Ids are positional, not uid(): no randomness anywhere. */
function phantom(t: ScenarioTask, at: SlotCandidate, n: number): Block {
  return {
    id: `scenario-place-${n}`,
    title: t.title,
    tag: t.tag,
    dayKey: at.dayKey,
    startMin: at.startMin,
    endMin: at.endMin,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'mew',
  }
}

/** "budget review waits for next week" — the honest listing of what didn't fit
    the horizon. Titles ride lowercase: the line is prose, not the card rows.
    `clip` keeps the honesty inside LINE_MAX when long titles would blow it:
    the first task is named, the rest are counted ("deck +2 more wait …"). */
function waitsClause(waits: string[], clip = false): string {
  const names = waits.map((w) => w.toLowerCase())
  if (clip && names.length > 1) return `${names[0]} +${names.length - 1} more wait for next week`
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${list} ${names.length === 1 ? 'waits' : 'wait'} for next week`
}

/** The dominant upside among the chosen slots' why strings — the grounded half
    of the rationale. Neutral fillers and anything the character already says
    stay out; ties break alphabetically so the line is deterministic. */
function whySummary(whys: string[], character: string): string | null {
  const tally = new Map<string, number>()
  for (const why of whys)
    for (const part of why.split(', '))
      if (part !== 'fits a free gap' && part !== 'back-to-back' && !character.includes(part))
        tally.set(part, (tally.get(part) ?? 0) + 1)
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  if (!top) return null
  return top[1] > 1 ? `${top[0]} on ${top[1]}` : top[0]
}

function composeLine(
  profile: (typeof PROFILES)[number],
  bestWindow: TimeWindow | undefined,
  total: number,
  whys: string[],
  waits: string[]
): string {
  const character =
    profile.alignsToBest && bestWindow
      ? `deep work in your best ${WINDOW_LABEL[bestWindow]}`
      : profile.character
  const fit = waits.length ? waitsClause(waits) : `all ${total} fit`
  const clipped = waits.length > 1 ? waitsClause(waits, true) : fit
  /* the ladder of what yields to LINE_MAX, in order: the why summary first,
     then the full waits list (clipped to first + count), then the character
     itself — every task that waits stays accounted for on every rung. When
     nothing placed, the character would be a claim with nothing behind it. */
  const why = whySummary(whys, character)
  const ladder =
    waits.length === total
      ? [fit, clipped]
      : [
          ...(why ? [`${character} — ${why}, ${fit}`] : []),
          `${character} — ${fit}`,
          ...(clipped !== fit ? [`${character} — ${clipped}`, clipped] : []),
        ]
  return ladder.find((line) => line.length <= LINE_MAX) ?? ladder[ladder.length - 1]
}

/** Same placements = same scenario, whatever the profile called it. */
function placementKey(places: ScenarioPlace[]): string {
  return places
    .map((p) => `${p.dayOffset}:${p.startMin}:${p.durationMin}:${p.title}`)
    .sort()
    .join('|')
}

interface Draft {
  name: string
  line: string
  places: ScenarioPlace[]
}

/** One greedy pass under one profile: tasks in stable longest-deep-first order,
    each placed at its profile-best candidate, candidates recomputed against the
    accumulating placements so the scenario can never self-overlap. */
function buildDraft(
  blocks: Block[],
  ordered: ScenarioTask[],
  profile: (typeof PROFILES)[number],
  opts: ScenarioOpts
): Draft {
  const offsets = new Map<string, number>()
  for (let d = 0; d <= opts.horizonDays; d++) offsets.set(addDaysKey(opts.todayKey, d), d)
  const places: ScenarioPlace[] = []
  const phantoms: Block[] = []
  const whys: string[] = []
  const waits: string[] = []
  for (const t of ordered) {
    /* a meal keeps its circadian anchor (#298) unless the USER stated a
       window — so alignsToBest never synthesizes one over it (a work-tagged
       "Lunch with CEO" is still lunch, not deep work) */
    const meal = t.window == null ? mealClassOf(t.title) : null
    // the stated window always rides along; best-window alignment is the first
    // profile's taste for deep work, so it stays soft (weights, not a gate)
    const window =
      t.window ?? (!meal && profile.alignsToBest && t.tag === 'work' ? opts.bestWindow : undefined)
    const pick = choose(
      scoreSlots(
        [...blocks, ...phantoms],
        {
          title: t.title,
          tag: t.tag,
          durationMin: t.durationMin,
          ...(t.due != null ? { due: t.due } : {}),
          ...(window ? { window } : {}),
        },
        opts.todayKey,
        opts.nowMin,
        opts.prefs ?? [],
        profile.weights,
        opts.horizonDays,
        undefined, // mealBase: scenarios keep the circadian default (#298)
        opts.bufferMin ?? 0 // #302: inherit the meeting buffer through the seam
      ),
      t,
      profile.bias,
      meal ? mealWindowFor(meal, opts.prefs ?? []) : null
    )
    if (!pick) {
      waits.push(t.title)
      continue
    }
    places.push({
      title: t.title,
      tag: t.tag,
      dayOffset: offsets.get(pick.dayKey)!,
      startMin: pick.startMin,
      durationMin: t.durationMin,
      ...(t.due != null ? { due: t.due } : {}),
    })
    whys.push(pick.why)
    phantoms.push(phantom(t, pick, phantoms.length))
  }
  return {
    name: profile.name,
    line: composeLine(profile, opts.bestWindow, ordered.length, whys, waits),
    places,
  }
}

/* ── the energy-fit profile (#321) ─────────────────────────────────────
   The one profile that reads the user's OWN rhythm instead of a textbook
   curve. Deep work lands in the windows they DEMONSTRABLY finish it in —
   spread across every window when the profile is flat (never peak-ghettoed;
   the whole point: "I still do coding and dev work on low energy"), leaned to
   one window only when the data genuinely peaks there. Admin is batched into
   one contiguous "quick and dusted" run rather than sprinkled through the
   dips. Precedence is honored by the caller (deepFitWindows): a stated rule
   outranks the learned profile, which outranks today's default. */

/** slightly time-of-day-led so a demonstrated window actually pulls the deep
    block, with real breathing room; preference still counts standing rules */
const ENERGY_FIT_WEIGHTS: ScoreWeights = { timeOfDay: 0.5, rest: 0.35, preference: 0.15 }

/** The windows deep work may land in, by precedence: a stated "anytime" rule
    frees it across all three (overriding a peak-leaning profile); else the
    learned profile's demonstrated windows; else none (batch-admin-only — impose
    no window on deep work, MEW has observed no rhythm to apply). */
function deepFitWindows(opts: ScenarioOpts): TimeWindow[] {
  if (opts.deepFlexible) return ['morning', 'afternoon', 'evening']
  if (opts.energyProfile) return demonstratedDeepWindows(opts.energyProfile)
  return []
}

function energyFitLine(
  deepWindows: TimeWindow[],
  batched: boolean,
  total: number,
  waits: string[]
): string {
  const character =
    deepWindows.length >= 2
      ? 'deep work spread where you finish it'
      : deepWindows.length === 1
        ? `deep work in your ${WINDOW_LABEL[deepWindows[0]]}`
        : batched
          ? 'admin kept quick and dusted'
          : 'a steady shape'
  const admin = batched && deepWindows.length ? ', admin batched' : ''
  const fit = waits.length ? waitsClause(waits, true) : `all ${total} fit`
  const full = `${character}${admin} — ${fit}`
  return full.length <= LINE_MAX ? full : `${character}${admin}`.slice(0, LINE_MAX)
}

/** One greedy pass in the energy-fit voice. Deep tasks take a window round-robin
    from `deepWindows` (so a flat profile SPREADS them window to window, a single
    demonstrated window leans them all there), unless the user stated a window on
    the task. Everything else places on its own taste. The low-focus items are
    then dropped as ONE adjacent run in the first gap that fits the whole batch
    (adminBatch says which and how long) — its "quick and dusted" contiguity is
    the anti-sprinkle move. Phantoms accumulate so nothing self-overlaps; a task
    that fits nowhere is named in the line, never dropped. */
function buildEnergyFit(
  blocks: Block[],
  ordered: ScenarioTask[],
  deepWindows: TimeWindow[],
  opts: ScenarioOpts
): Draft {
  const offsets = new Map<string, number>()
  for (let d = 0; d <= opts.horizonDays; d++) offsets.set(addDaysKey(opts.todayKey, d), d)
  const places: ScenarioPlace[] = []
  const phantoms: Block[] = []
  const waits: string[] = []

  const placeOne = (t: ScenarioTask, window: TimeWindow | undefined) => {
    const meal = t.window == null ? mealClassOf(t.title) : null
    const win = t.window ?? window
    const pick = choose(
      scoreSlots(
        [...blocks, ...phantoms],
        {
          title: t.title,
          tag: t.tag,
          durationMin: t.durationMin,
          ...(t.due != null ? { due: t.due } : {}),
          ...(win ? { window: win } : {}),
        },
        opts.todayKey,
        opts.nowMin,
        opts.prefs ?? [],
        ENERGY_FIT_WEIGHTS,
        opts.horizonDays,
        undefined,
        opts.bufferMin ?? 0
      ),
      win ? { ...t, window: win } : t,
      undefined,
      meal ? mealWindowFor(meal, opts.prefs ?? []) : null
    )
    if (!pick) {
      waits.push(t.title)
      return
    }
    places.push({
      title: t.title,
      tag: t.tag,
      dayOffset: offsets.get(pick.dayKey)!,
      startMin: pick.startMin,
      durationMin: t.durationMin,
      ...(t.due != null ? { due: t.due } : {}),
    })
    phantoms.push(phantom(t, pick, phantoms.length))
  }

  const batch = adminBatch(ordered)
  const batched = new Set(batch?.tasks ?? [])

  /* deep + everything-not-batched first (deep first via orderTasks), so the run
     lands around them */
  let deepIdx = 0
  for (const t of ordered) {
    if (batched.has(t)) continue
    let window: TimeWindow | undefined
    if (t.window == null && !mealClassOf(t.title) && isDeepTask(t) && deepWindows.length) {
      window = deepWindows[deepIdx % deepWindows.length]
      deepIdx++
    }
    placeOne(t, window)
  }

  /* the admin batch: one contiguous run in the first gap that holds it all */
  if (batch) {
    const run = scoreSlots(
      [...blocks, ...phantoms],
      { title: 'admin', tag: 'private', durationMin: batch.totalMin },
      opts.todayKey,
      opts.nowMin,
      opts.prefs ?? [],
      ENERGY_FIT_WEIGHTS,
      opts.horizonDays,
      undefined,
      opts.bufferMin ?? 0
    )
    const slot = run[0]
    if (slot) {
      const dayOffset = offsets.get(slot.dayKey)!
      let cursor = slot.startMin
      for (const at of batch.tasks) {
        places.push({
          title: at.title,
          tag: at.tag,
          dayOffset,
          startMin: cursor,
          durationMin: at.durationMin,
        })
        phantoms.push(
          phantom(
            at,
            {
              dayKey: slot.dayKey,
              startMin: cursor,
              endMin: cursor + at.durationMin,
              score: 1,
              why: '',
            },
            phantoms.length
          )
        )
        cursor += at.durationMin
      }
    } else {
      // no single gap holds the whole run — place each honestly, still batched intent
      for (const at of batch.tasks) placeOne(at, undefined)
    }
  }

  return {
    name: 'energy-fit',
    line: energyFitLine(deepWindows, !!batch, ordered.length, waits),
    places,
  }
}

/** K named, valid, explainable week-placements for one classified braindump.
    Distinct by construction where the profiles genuinely disagree; profiles
    that collapse to identical placements dedupe (a sparse week does this), so
    returning fewer — even 1 — is a legal answer. A scenario placing fewer
    tasks ranks below one placing all. Pure and deterministic: no Date.now, no
    randomness, ids only from the injected factory. */
export function generateScenarios(
  blocks: Block[],
  tasks: ScenarioTask[],
  opts: ScenarioOpts
): Scenario[] {
  if (!tasks.length) return []
  /* #322 "always": pre-size to demonstrated durations BEFORE placing, so every
     profile (and the applied quote) reasons about the honest length. Off/ask ⇒
     estimateFactor is absent ⇒ this is the identity map, byte-identical. */
  const sized = opts.estimateFactor
    ? tasks.map((t) => sizeToDemonstrated(t, opts.estimateFactor!))
    : tasks
  const ordered = orderTasks(sized)
  const drafts = PROFILES.map((p) => buildDraft(blocks, ordered, p, opts))
  /* #321: energy-fit joins ONLY when a learned rhythm exists or a stated
     batch-admin rule forces it — no profile and no rule ⇒ this branch is skipped
     and the set is byte-identical to today (MEW imposes no energy model it
     hasn't observed). Appended last, so it dedupes/ranks against the others. */
  if (opts.energyProfile || opts.batchAdmin)
    drafts.push(buildEnergyFit(blocks, ordered, deepFitWindows(opts), opts))
  const seen = new Set<string>()
  const distinct = drafts.filter((d) => {
    const key = placementKey(d.places)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  // stable sort: more-placed first, profile order holds ties
  distinct.sort((a, b) => b.places.length - a.places.length)
  return distinct.map((d) => {
    const dayLoad: Record<string, number> = {}
    for (const p of d.places) {
      const key = addDaysKey(opts.todayKey, p.dayOffset)
      dayLoad[key] = (dayLoad[key] ?? 0) + p.durationMin
    }
    return {
      id: opts.ids(),
      name: d.name,
      line: d.line,
      todayKey: opts.todayKey,
      places: d.places,
      dayLoad,
    }
  })
}

/** The staleness gate: every stored place must still land conflict-free
    against the LIVE week (15b checks at post time and again at pick time).
    Pure — the caller brings today's blocks; a week that moved on flips false. */
export function validateScenario(blocks: Block[], s: Scenario): boolean {
  return s.places.every(
    (p) =>
      conflictsWith(
        blocks,
        addDaysKey(s.todayKey, p.dayOffset),
        p.startMin,
        p.startMin + p.durationMin
      ).length === 0
  )
}
