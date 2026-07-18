/* gbrain week-scaffolding (#349) — the marquee at WEEK scale. Pure + keyless:
   the owner's learned week-shape, drafted for a target week from LOCAL memory
   alone — confirmed rules (#328) and any recurrence they carry (#159), plus the
   raw recurring series the owner created directly, laid where their learned
   energy bands (#321) say deep work actually lands. Deterministic and EMPTY
   under the floor: no confirmed shape yet ⇒ no scaffold, an honest "I don't know
   your week yet" rather than a guessed week (bands only shape WHERE a block
   goes, they never invent one). Composing is all this module does — it proposes
   concrete placements that fit AROUND whatever already sits in the week
   (external/synced events included), one PlaceSpec per occurrence so the preview
   IS the quote. Nothing here mutates; nothing commits. The store wraps the draft
   in the plan-mode scenario picker (#293) and the owner accepts / tweaks /
   discards — only an accept places, through the executor. Human-in-the-loop by
   construction, never an auto-filled week. */

import type { Block, MemoryEvent, Tag, TimeWindow } from './types'
import { aggregates } from './memory'
import { confirmedRulesFrom } from './learn'
import type { LearnedRule } from './prefs'
import { normTitle } from './insights'
import { expandRrule } from './recurrence'
import { demonstratedDeepWindows, energyProfile, isDeepTask } from './energy'
import { fromDayKey, weekKeys } from './time'
import {
  blocksForDay,
  conflictsWith,
  DAY_END,
  DAY_START,
  duration,
  findFreeSlot,
  type PlaceSpec,
} from './week'

/** Where a draft anchor may land, per window — the app's own 12:00/17:00 edges
    (energy.ts / scheduler.windowOf), capped at a civilized evening so a draft
    never proposes a block near midnight. A rule with no window (and no learned
    deep-work band to borrow) searches the whole working day instead. */
const WINDOW_BOUNDS: Record<TimeWindow, { start: number; end: number }> = {
  morning: { start: DAY_START, end: 12 * 60 },
  afternoon: { start: 12 * 60, end: 17 * 60 },
  evening: { start: 17 * 60, end: 21 * 60 },
}

/** The fixed clock start a recurring draft anchors at, per window — a sensible
    default the owner tweaks, never a claim MEW learned the exact minute. */
const WINDOW_ANCHOR: Record<TimeWindow, number> = {
  morning: 9 * 60,
  afternoon: 13 * 60,
  evening: 18 * 60,
}

/** A rule's block tag — 'work' is the default a bare rule resolves to (execPlan's
    `prefd.tag ?? p.tag`), so deep-vs-admin reads the same here as at apply. */
function ruleTag(r: LearnedRule): Tag {
  return r.tag ?? 'work'
}

function ruleDuration(r: LearnedRule): number {
  return r.durationMin ?? 60
}

/** Deep work by the shared #321 threshold — so the band a deep-work rule borrows
    here is the band the scenarios engine would place it in. */
function isDeepRule(r: LearnedRule): boolean {
  return isDeepTask({ tag: ruleTag(r), durationMin: ruleDuration(r) })
}

export function weekScaffold(
  memory: readonly MemoryEvent[],
  week: readonly Block[],
  targetWeekKey: string,
  /* the trailing-window anchor for the learned energy read (#321 reads the last
     28 days ending today) — the target week is the future being shaped, "now" is
     what the rhythm is learned from. */
  now: Date
): PlaceSpec[] {
  const events = [...memory]
  const blocks = [...week]
  const days = weekKeys(fromDayKey(targetWeekKey)) // Mon–Sun of the target week
  const first = days[0]
  const last = days[days.length - 1]

  /* the learned rhythm: the windows the owner DEMONSTRABLY finishes deep work in
     (spread when flat, leaned when it peaks). Empty under the energy floor — a
     deep-work rule with no stated window then just takes the first free slot of a
     day, no invented band. */
  const profile = energyProfile(events, aggregates(events, now), now)
  const deepWindows = profile ? demonstratedDeepWindows(profile) : []

  /* titles already sitting in the target week (any source, external included):
     never re-propose what's already there, so a pre-materialized recurring series
     (#159 lands its occurrences +52w ahead) or a half-planned week dedups clean. */
  const present = new Set<string>()
  for (const d of days) for (const b of blocksForDay(blocks, d)) present.add(normTitle(b.title))

  /* placed anchors accumulate as phantoms so the draft never self-overlaps and
     every free-slot / conflict check sees the growing shape. Seeded with the real
     week, so the whole draft fits AROUND existing and external events. */
  const phantoms: Block[] = [...blocks]
  const out: PlaceSpec[] = []
  const proposed = new Set<string>() // normalized titles this draft has placed

  const add = (
    title: string,
    tag: Tag,
    dayKey: string,
    startMin: number,
    durationMin: number,
    attention: 'background' | undefined
  ): void => {
    const endMin = startMin + durationMin
    out.push({ title, tag, dayKey, startMin, endMin, ...(attention ? { attention } : {}) })
    phantoms.push({
      id: `scaffold-phantom-${out.length}`,
      title,
      tag,
      dayKey,
      startMin,
      endMin,
      protected: true,
      status: 'open',
      calendarRefs: [],
      estimateSource: 'mew',
      ...(attention ? { attention } : {}),
    })
  }

  const attentionOf = (
    a: Block['attention'] | LearnedRule['attention']
  ): 'background' | undefined => (a === 'background' ? 'background' : undefined)

  /* ── source A: confirmed rules (#328) ─────────────────────────────────
     The owner's learned shape. A rule that carries a recurrence expands across
     the week at its window's anchor time; a plain rule proposes ONE weekly
     anchor, windowed by its own stated window or (for deep work) the learned
     band, and spread across the week by a round-robin start day so the draft
     doesn't pile every anchor onto Monday. */
  const rules = confirmedRulesFrom(events)
  rules.forEach((rule, i) => {
    const key = normTitle(rule.match)
    if (!key || present.has(key) || proposed.has(key)) return
    const tag = ruleTag(rule)
    const dur = ruleDuration(rule)
    const attention = attentionOf(rule.attention)
    const window =
      rule.window ??
      (isDeepRule(rule) && deepWindows.length ? deepWindows[i % deepWindows.length] : undefined)

    if (rule.rrule) {
      const anchorStart = WINDOW_ANCHOR[window ?? 'morning']
      let placed = false
      for (const occ of expandRrule(rule.rrule, first, anchorStart, dur, first, last)) {
        // schedule AROUND existing/external events — skip an occupied slot, never place over it
        if (conflictsWith(phantoms, occ.dayKey, occ.startMin, occ.endMin).length) continue
        add(rule.match, tag, occ.dayKey, occ.startMin, dur, attention)
        placed = true
      }
      if (placed) proposed.add(key)
      return
    }

    const bounds = window ? WINDOW_BOUNDS[window] : { start: DAY_START, end: DAY_END }
    for (let j = 0; j < days.length; j++) {
      const dayKey = days[(i + j) % days.length]
      const slot = findFreeSlot(phantoms, dayKey, dur, bounds.start, bounds.end)
      if (!slot) continue
      add(rule.match, tag, dayKey, slot.startMin, dur, attention)
      proposed.add(key)
      break
    }
  })

  /* ── source B: raw recurring series the owner created directly (#159) ──
     Grouped by series id, one anchor block each. Expanded into the target week
     and proposed only where not already present — usually a no-op (the series is
     materialized ahead), but a week past the +52w horizon (or a cleared one)
     still gets the owner's standing cadence back. */
  const anchorBySeries = new Map<string, Block>()
  const series = [...blocks]
    .filter((x) => x.recurringBlockId && x.rrule)
    .sort(
      (x, y) =>
        x.dayKey.localeCompare(y.dayKey) || x.startMin - y.startMin || x.id.localeCompare(y.id)
    )
  for (const b of series) {
    if (!anchorBySeries.has(b.recurringBlockId!)) anchorBySeries.set(b.recurringBlockId!, b)
  }
  for (const b of anchorBySeries.values()) {
    const key = normTitle(b.title)
    if (present.has(key) || proposed.has(key)) continue
    const dur = duration(b)
    const attention = attentionOf(b.attention)
    let placed = false
    for (const occ of expandRrule(b.rrule!, b.dayKey, b.startMin, dur, first, last)) {
      if (conflictsWith(phantoms, occ.dayKey, occ.startMin, occ.endMin).length) continue
      add(b.title, b.tag, occ.dayKey, occ.startMin, dur, attention)
      placed = true
    }
    if (placed) proposed.add(key)
  }

  return out
}
