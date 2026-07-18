/* Applying the standing rulebook — pure. A remembered preference changes
   MECHANICS, not just prose: time-defaults choose the slot, duration-
   defaults size the block, flexibility overrides the fixed-time heuristic.
   The law throughout: prefs fill DEFAULTS — anything the user said
   explicitly in this message always wins. */

import type { PrefPayload, Tag, TimeWindow } from './types'
import type { Rrule } from './recurrence'
import { normTitle, type TaskDuration } from './insights'

/** A rule matches a block when its normalized `match` phrase appears on
    token boundaries in the normalized title (the base half, before any
    em-dash detail). Whole tokens only: "call" never hits "Recall budget". */
export function matchesPref(title: string, match: string): boolean {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .split('—')[0]
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const t = norm(title)
  const m = norm(match)
  return m.length > 0 && ` ${t} `.includes(` ${m} `)
}

/** "starts 07:00" → 420; tolerant of a bare "07:00" or "7am". */
export function parseTimeValue(value: string): number | null {
  const m = value.match(/(\d{1,2}):(\d{2})/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  const ampm = value.match(/\b(\d{1,2})\s*(am|pm)\b/i)
  if (ampm) {
    let h = Number(ampm[1])
    if (ampm[2].toLowerCase() === 'pm' && h < 12) h += 12
    if (ampm[2].toLowerCase() === 'am' && h === 12) h = 0
    return h * 60
  }
  return null
}

/** "45m" / "45 min" / "1.5h" → minutes. */
export function parseDurationValue(value: string): number | null {
  const h = value.match(/(\d+(?:\.\d+)?)\s*h\b/i)
  if (h) return Math.round(Number(h[1]) * 60)
  const m = value.match(/(\d+)\s*m(?:in)?\b/i)
  if (m) return Number(m[1])
  return null
}

/** Every placement field the resolver can fill. Title is the match key, passed
    separately — this is only what the resolver reads and fills. `windowFirm` is
    an OUTPUT: set when the resolved window is firm (a confirmed rule chose it),
    so the scheduler collapses off-window instead of a soft nudge (#328). */
export interface TaskSpec {
  startMin?: number
  endMin?: number
  durationMin?: number
  tag?: Tag
  attention?: 'focus' | 'background'
  protected?: boolean
  rrule?: Rrule
  window?: TimeWindow
  windowFirm?: boolean
}

/** A CONFIRMED task rule — gbrain Pillar 1's output (#327, the learn side),
    applied here in Pillar 2. Being in the list at all means confirmed: the
    values are CHOSEN, not weighted. Every field optional — a rule pins only
    what repetition confirmed. `match` selects the way a PrefPayload does
    (whole-token, base title). Until #327 merges no rules exist and the resolver
    falls back to stated prefs + history, byte-identical to today. */
export interface LearnedRule {
  match: string
  durationMin?: number
  tag?: Tag
  window?: TimeWindow
  attention?: 'focus' | 'background'
  protected?: boolean
  rrule?: Rrule
  /** the user's own words when they confirmed it, for the reply credit */
  stated?: string
}

export interface Resolution {
  spec: TaskSpec
  /** stated PrefPayload rules applied (existing behavior; the store credits
      these as "(your standing rule)") */
  applied: PrefPayload[]
  /** the history median that sized the duration, if it did — a soft hint */
  usual: TaskDuration | null
  /** the confirmed rule that filled any field, if one matched (#327 input) */
  learned: LearnedRule | null
  /** the reply's one-line memory credit for the CONFIRMED-rule fills, in MEW's
      positive voice ("deep work, your usual morning"); null when no rule filled
      anything, so today's replies stay byte-identical without a confirmed rule. */
  credit: string | null
}

/** Deterministic apply (gbrain Pillar 2, #328). Fill every UNSTATED placement
    field from precedence: (1) the user's explicit words THIS TURN — already on
    `spec`, never touched, suggest-don't-seize even against their own rules; (2)
    a CONFIRMED rule — a stated PrefPayload OR a learned rule (#327) — firm, the
    value is chosen; (3) plain history (`histDurations` median, n≥3) — a soft
    duration hint. One resolver, every placement path, keyless included.

    Precedence within tier 2: a stated PrefPayload (a direct user instruction)
    fills before a learned rule (confirmed inference) for the same field; a
    learned rule then fills only what remains. A confirmed window becomes FIRM
    (`windowFirm`), which the scheduler honors as a hard preference — a soft tag
    default / history stays the 0.25 scorer term. `learned`/`credit` are null
    with no matching rule, so no-rule/no-history placement is byte-identical. */
export function resolveTaskSpec(
  title: string,
  spec: TaskSpec,
  prefs: PrefPayload[],
  histDurations?: Map<string, TaskDuration>,
  learned?: LearnedRule[]
): Resolution {
  const applied: PrefPayload[] = []
  let next: TaskSpec = spec

  // (2a) STATED rules — the user's own words, kept as PrefPayloads. Same single
  //      pass and precedence as before: an explicit spec field is never touched.
  for (const p of prefs) {
    if (!matchesPref(title, p.match)) continue
    if (p.kind === 'time-default' && next.startMin == null && next.endMin == null) {
      const min = parseTimeValue(p.value)
      if (min != null) {
        next = { ...next, startMin: min }
        applied.push(p)
      }
    }
    if (p.kind === 'duration-default' && next.durationMin == null && next.endMin == null) {
      const dur = parseDurationValue(p.value)
      if (dur != null) {
        next = { ...next, durationMin: dur }
        applied.push(p)
      }
    }
  }

  // (2b) a CONFIRMED learned rule (#327) — firm; fills any field still unstated
  //      after explicit words and stated rules. A window it pins is FIRM.
  const rule = (learned ?? []).find((r) => matchesPref(title, r.match)) ?? null
  if (rule) {
    if (next.durationMin == null && next.endMin == null && rule.durationMin != null)
      next = { ...next, durationMin: rule.durationMin }
    if (next.tag == null && rule.tag != null) next = { ...next, tag: rule.tag }
    // a window fills only when the time is genuinely open — an explicit start
    // or end already fixes the band, and explicit words win over any rule.
    if (next.window == null && next.startMin == null && next.endMin == null && rule.window != null)
      next = { ...next, window: rule.window, windowFirm: true }
    if (next.attention == null && rule.attention != null)
      next = { ...next, attention: rule.attention }
    if (next.protected == null && rule.protected != null)
      next = { ...next, protected: rule.protected }
    if (next.rrule == null && rule.rrule != null) next = { ...next, rrule: rule.rrule }
  }

  // (3) plain HISTORY — a soft hint, duration only; unchanged from before.
  let usual: TaskDuration | null = null
  if (next.durationMin == null && next.endMin == null) {
    const hist = histDurations?.get(normTitle(title))
    if (hist) {
      next = { ...next, durationMin: hist.median }
      usual = hist
    }
  }

  return { spec: next, applied, usual, learned: rule, credit: creditPhrase(next, rule) }
}

const WINDOW_WORD: Record<TimeWindow, string> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
}

/** Name what a CONFIRMED rule filled, once, in MEW's positive voice — the
    "offer once → then it just does it" payoff made visible ("deep work, your
    usual morning"). Only the rule's fills are credited here; a history-sized
    duration and stated PrefPayloads keep their existing wording in the store,
    so a turn with no confirmed rule reads exactly as it does today. */
function creditPhrase(spec: TaskSpec, rule: LearnedRule | null): string | null {
  if (!rule) return null
  const parts: string[] = []
  // "deep work" is MEW's word for a work block of an hour or more (week.isDeep)
  if (rule.tag === 'work' && (spec.durationMin ?? 0) >= 60) parts.push('deep work')
  if (rule.window != null) parts.push(`your usual ${WINDOW_WORD[rule.window]}`)
  return parts.length ? parts.join(', ') : null
}

/** A flexibility rule overrides the fixed-time word heuristic — in either
    direction. Classification only: collision honesty is untouched. */
export function flexOverride(title: string, prefs: PrefPayload[]): 'fixed' | 'flexible' | null {
  for (const p of prefs) {
    if (p.kind !== 'flexibility' || !matchesPref(title, p.match)) continue
    if (/never moves|fixed|can'?t move/i.test(p.value)) return 'fixed'
    if (/can (?:always )?move|flexible|movable/i.test(p.value)) return 'flexible'
  }
  return null
}

/* ── energy-fit's standing rules (#321) ────────────────────────────────
   Two rules that OUTRANK the learned energyProfile — stated word wins. Parsed
   by the remember path (parse.ts parsePref) into canonical PrefPayloads and
   read here as booleans the scenarios engine threads into its opts. Precedence,
   pinned: these stated rules > the learned energyProfile > today's default. */

/** "I do deep work anytime" / "don't gate my mornings" — deep work is not
    window-confined, so energy-fit spreads it across every window even when the
    learned profile peaks (the override the user explicitly asked for). */
export function deepWorkAnytime(prefs: PrefPayload[]): boolean {
  return prefs.some(
    (p) =>
      p.kind === 'flexibility' &&
      /\bdeep\b/.test(p.match.toLowerCase()) &&
      /any\s?time/.test(p.value.toLowerCase())
  )
}

/** "batch my admin" / "keep admin quick" — always cluster the low-focus items
    into one contiguous run, forcing energy-fit to engage even with no learned
    profile yet (above the data floor, on the user's word alone). */
export function batchAdminRule(prefs: PrefPayload[]): boolean {
  return prefs.some(
    (p) =>
      p.kind === 'ordering' &&
      /\badmin\b/.test(p.match.toLowerCase()) &&
      /\bbatch\b/.test(p.value.toLowerCase())
  )
}
