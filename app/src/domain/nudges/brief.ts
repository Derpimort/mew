/* The morning brief & evening wrap — once-a-day ritual composers (#285).
   Pure functions over the week + insights: no clock reads, no I/O, keyless by
   construction (the rules floor composes the exact same bytes). Voice is law:
   rolled work is "waiting", never {missed, failed, behind, overdue} — the
   voice suite pins that word set absent. The engine owns WHEN these fire
   (once per day, persisted key); this file only says WHAT the day looks like. */

import type { Block, MemoryEvent } from '../types'
import type { Insights } from '../insights'
import { blocksForDay, isBackground, openItems, overlaps, plannedDeepMin } from '../week'
import { fmtTime, hoursLabel, spell } from '../time'

/** The base half of a title — the same convention every nudge phrases with. */
function base(title: string): string {
  return title.split('—')[0].trim()
}

/* ── the one risk (morning) ────────────────────────────────────────────
   Exactly one risk, picked deterministically: the busiest overlap-pressure
   first (the pair sharing the most minutes; ties break on earlier overlap,
   then day order), else the earliest hard due. None ⇒ null — the composer
   turns that into the kind clean-runway line. */
export function pickMorningRisk(blocks: Block[], todayKey: string): string | null {
  const open = blocksForDay(blocks, todayKey).filter((b) => b.status === 'open' && !b.optional)

  /* overlap pressure — only blocks that hold attention can collide */
  const focus = open.filter((b) => !isBackground(b))
  let top: { a: Block; b: Block; shared: number; at: number } | null = null
  for (let i = 0; i < focus.length; i++) {
    for (let j = i + 1; j < focus.length; j++) {
      const a = focus[i]
      const b = focus[j]
      if (!overlaps(a.startMin, a.endMin, b.startMin, b.endMin)) continue
      const shared = Math.min(a.endMin, b.endMin) - Math.max(a.startMin, b.startMin)
      const at = Math.max(a.startMin, b.startMin)
      if (!top || shared > top.shared || (shared === top.shared && at < top.at)) {
        top = { a, b, shared, at }
      }
    }
  }
  if (top) {
    return `one thing: ${base(top.a.title)} and ${base(top.b.title)} share ${top.shared} minutes around ${fmtTime(top.at)} — one of them may need to drift`
  }

  /* a hard deadline — the earliest due is the day's one thing */
  const due = open
    .filter((b) => b.due != null)
    .sort((a, b) => a.due! - b.due! || a.startMin - b.startMin)[0]
  if (due) {
    return `one thing: ${base(due.title)} needs to land by ${fmtTime(due.due!)} — the ${fmtTime(due.startMin)} block covers it`
  }
  return null
}

/** Three lines to open the day: today's shape, the first block, the one risk.
    A clean day gets a clean-runway line, flavored with the user's own winning
    band when insights hold one (cold start ⇒ the plain kind line). */
export function composeMorningBrief(
  blocks: Block[],
  todayKey: string,
  insights: Insights
): { body: string } {
  const day = blocksForDay(blocks, todayKey).filter((b) => !b.optional)

  let shape: string
  if (!day.length) {
    shape = 'today: a clean page — nothing on the books yet'
  } else {
    const first = Math.min(...day.map((b) => b.startMin))
    const last = Math.max(...day.map((b) => b.endMin))
    const deep = plannedDeepMin(blocks, todayKey)
    shape =
      `today: ${day.length} block${day.length === 1 ? '' : 's'}, ` +
      `${fmtTime(first)}–${fmtTime(last)}` +
      (deep > 0 ? ` · ${hoursLabel(deep)} deep work` : '')
  }

  const next = day.find((b) => b.status === 'open')
  const firstUp = !day.length
    ? 'first up: whatever you choose — the page is yours'
    : next
      ? `first up: ${base(next.title)} at ${fmtTime(next.startMin)}`
      : 'first up: nothing — the day is already clear'

  const risk =
    pickMorningRisk(blocks, todayKey) ??
    (insights.bestBand
      ? `one thing: a clean runway — no overlaps, nothing due. your ${insights.bestBand.label} usually hold; use them well`
      : 'one thing: a clean runway — no overlaps, nothing due')

  return { body: [shape, firstUp, risk].join('\n') }
}

/* ── the evening wrap ─────────────────────────────────────────────────── */

/** What the wrap narrates — derived the way dayDebrief derives its story:
    mews from the day's completed events (count + the minutes they held),
    open items as what waits for tomorrow (never what "slipped away"). */
export interface WrapDebrief {
  doneCount: number
  doneMin: number
  /** base titles of today's open, non-external items, in day order */
  waiting: string[]
}

export function buildWrapDebrief(
  blocks: Block[],
  events: MemoryEvent[],
  todayKey: string
): WrapDebrief {
  const mews = events.filter((e) => e.kind === 'completed' && e.dayKey === todayKey)
  return {
    doneCount: mews.length,
    doneMin: mews.reduce((s, e) => s + (e.plannedMin ?? 0), 0),
    /* external events are someone else's meeting — they don't "wait" on us */
    waiting: openItems(blocks, todayKey)
      .filter((b) => !b.external)
      .map((b) => base(b.title)),
  }
}

/** One kind observation from the user's own patterns — the winning band when
    there is one; a cold start (no insights yet) gets a kind, honest default.
    Deterministic: bestBand's tie-breaks live in computeInsights (stable sort,
    band order), so the same history always picks the same line. */
export function pickKindObservation(insights: Insights): string {
  const b = insights.bestBand
  if (b) {
    return `noticed: your ${b.label} keep winning — ${b.completed}/${b.attempted} finished there, worth protecting`
  }
  return 'noticed: the wrap gets sharper as the weeks fill in — see you tomorrow'
}

/** Three lines to close the day: what got done, what waits for tomorrow, one
    kind observation. Positive by construction — an open item is waiting,
    a slow day is a slow day, and the scorecard does not exist. */
export function composeEveningWrap(debrief: WrapDebrief, insights: Insights): { body: string } {
  const { doneCount, doneMin, waiting } = debrief

  const done =
    doneCount > 0
      ? `done: ${doneCount} block${doneCount === 1 ? '' : 's'}` +
        (doneMin > 0 ? ` · ${hoursLabel(doneMin)}` : '')
      : waiting.length
        ? 'a slower day — nothing checked off yet, and that is okay'
        : 'a quiet day — nothing was on the books'

  const waits =
    waiting.length === 0
      ? 'nothing waiting for tomorrow — the slate is clean'
      : waiting.length === 1
        ? `waiting for tomorrow: ${waiting[0]}`
        : `waiting for tomorrow: ${waiting[0]} and ${spell(waiting.length - 1)} more`

  return { body: [done, waits, pickKindObservation(insights)].join('\n') }
}
