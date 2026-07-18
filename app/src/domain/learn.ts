/* gbrain Pillar 1 — learn from doing (#327). Pure detection over the append-only
   memory: a task title you place the same way a few times becomes a candidate
   rule MEW offers ONCE. Deterministic frequency + variance — no model, no brain
   I/O, so the keyless floor learns identically. The offer/confirm/dismiss loop
   and persistence live in the store; here is only the math + the phrasing, both
   fully testable. A confirmed candidate becomes a `LearnedRule` (#328/prefs.ts)
   the resolver then applies silently forever. */

import type { MemoryEvent, Tag, TimeWindow } from './types'
import { matchesPref, type LearnedRule } from './prefs'
import { normTitle } from './insights'
import { windowOf } from './scheduler'

/** A rule candidate formed from repetition: the title, how strongly it recurred,
    and ONLY the dimensions that stayed consistent (a dim that varies is absent —
    MEW never invents a rule for something you do differently each time). */
export interface RuleCandidate {
  /** normalized match key (base title, lowercased) — becomes LearnedRule.match */
  match: string
  /** a readable base title for the offer copy */
  title: string
  /** how many completions formed this candidate */
  support: number
  dims: {
    durationMin?: number
    tag?: Tag
    window?: TimeWindow
    /** only ever 'background' — focus is the implicit default (Block law:
        attention undefined ⇒ focus), so a "focus" rule adds nothing to surface */
    attention?: 'focus' | 'background'
  }
}

/** Occurrences below this are an anecdote, not a habit — mirrors taskDurations. */
const MIN_SUPPORT = 3
/** A duration is "consistent" when its spread stays within this, in minutes. */
const DURATION_TOL_MIN = 15

/** Form candidate rules from what the user repeatedly DID. Groups completed
    events by normalized title; a group with ≥ minSupport occurrences and at
    least one consistent dimension yields exactly one candidate. Skips a title
    already covered by a confirmed rule or stated pref (`covered`) or one the
    user has dismissed (`dismissed`). Pure: same events in, same candidates out. */
export function detectTaskRules(
  events: readonly MemoryEvent[],
  covered: readonly string[],
  dismissed: readonly string[],
  opts: { minSupport?: number } = {}
): RuleCandidate[] {
  const minSupport = opts.minSupport ?? MIN_SUPPORT
  const groups = new Map<string, MemoryEvent[]>()
  for (const e of events) {
    if (e.kind !== 'completed' || !e.title) continue
    const k = normTitle(e.title)
    if (!k) continue
    groups.set(k, [...(groups.get(k) ?? []), e])
  }

  const out: RuleCandidate[] = []
  for (const [match, evs] of groups) {
    if (evs.length < minSupport) continue
    if (dismissed.includes(match)) continue
    if (covered.some((c) => matchesPref(match, c))) continue
    const dims = signature(evs)
    if (!hasDim(dims)) continue
    out.push({ match, title: baseTitle(evs[evs.length - 1].title!), support: evs.length, dims })
  }

  /* one candidate is offered at a time: strongest support first, then the
     richer signature, then a stable title order so the pick is deterministic */
  return out.sort(
    (a, b) =>
      b.support - a.support ||
      dimCount(b.dims) - dimCount(a.dims) ||
      (a.match < b.match ? -1 : a.match > b.match ? 1 : 0)
  )
}

/** The consistent dimensions across a group's occurrences — a varying dim is
    left out, which is exactly the "skip dims that vary" law. */
function signature(evs: MemoryEvent[]): RuleCandidate['dims'] {
  const dims: RuleCandidate['dims'] = {}

  // duration: low variance around the median (continuous, so a tolerance band)
  const durs = evs.map((e) => e.plannedMin).filter((d): d is number => d != null)
  if (durs.length === evs.length && durs.length > 0) {
    const sorted = [...durs].sort((a, b) => a - b)
    if (sorted[sorted.length - 1] - sorted[0] <= DURATION_TOL_MIN) dims.durationMin = median(sorted)
  }

  // tag / window / attention: categorical, so "consistent" means unanimous
  const tag = unanimous(evs.map((e) => e.tag))
  if (tag) dims.tag = tag
  const window = unanimous(evs.map((e) => (e.startMin != null ? windowOf(e.startMin) : null)))
  if (window) dims.window = window
  // background is the informative case; focus is the default and never surfaced
  const attention = unanimous(
    evs.map((e) => (e.attention === 'background' ? 'background' : 'focus'))
  )
  if (attention === 'background') dims.attention = 'background'

  return dims
}

/** A confirmed candidate as the flat rule the resolver reads (#328). Only the
    consistent dims travel; `stated` records the provenance for the reply/console. */
export function candidateToRule(c: RuleCandidate): LearnedRule {
  return {
    match: c.match,
    ...(c.dims.durationMin != null ? { durationMin: c.dims.durationMin } : {}),
    ...(c.dims.tag != null ? { tag: c.dims.tag } : {}),
    ...(c.dims.window != null ? { window: c.dims.window } : {}),
    ...(c.dims.attention != null ? { attention: c.dims.attention } : {}),
    stated: `${c.title} — learned from what you do`,
  }
}

/** The one-tap offer, in MEW's positive voice: names what you keep doing and
    asks to just do it — never "you forgot / you always". */
export function offerPhrase(c: RuleCandidate): string {
  const d = c.dims
  const parts: string[] = []
  const dur = d.durationMin != null ? `${d.durationMin} min` : ''
  const kind = kindWord(d)
  const core = dur && kind ? `${dur} of ${kind}` : dur || kind
  if (core) parts.push(`as ${core}`)
  if (d.window) parts.push(`in the ${d.window}`)
  if (d.attention === 'background') parts.push('in the background')
  const how = parts.length ? ` ${parts.join(' ')}` : ''
  return `you've been blocking "${c.title}"${how} a few times — want me to just do that from now on?`
}

/** The habitual-plural window word for a declarative label ("mornings"), vs
    offerPhrase's "in the morning" — same band, the console just states it. */
const WINDOW_LABEL: Record<TimeWindow, string> = {
  morning: 'mornings',
  afternoon: 'afternoons',
  evening: 'evenings',
}

/** A CONFIRMED rule stated flat, in MEW's positive voice — the console's
    row and the "what I've picked up" reply both read a rule as one line
    ("90 min of deep work, mornings"). Only what repetition pinned appears;
    a rule that pinned nothing describable still reads kind. Shares kindWord
    with the offer, so the console and the offer name a block the same way. */
export function ruleLabel(rule: LearnedRule): string {
  const dur = rule.durationMin != null ? `${rule.durationMin} min` : ''
  const kind = kindWord(rule)
  const core = dur && kind ? `${dur} of ${kind}` : dur || kind
  const parts: string[] = []
  if (core) parts.push(core)
  if (rule.window) parts.push(WINDOW_LABEL[rule.window])
  if (rule.attention === 'background') parts.push('in the background')
  return parts.length ? parts.join(', ') : 'the way you usually do it'
}

/** Name the kind of block for the offer: "deep work" is MEW's word for an hour+
    of work (mirrors prefs.creditPhrase / week.isDeep). */
function kindWord(d: RuleCandidate['dims']): string {
  switch (d.tag) {
    case 'work':
      return (d.durationMin ?? 0) >= 60 ? 'deep work' : 'work'
    case 'private':
      return 'personal time'
    case 'health':
      return 'health'
    case 'rest':
      return 'rest'
    default:
      return ''
  }
}

/** The CONFIRMED learned rules, read from the append-only memory (the always-on
    floor — survives restart, works brain-off). Newest confirmation per match
    wins. This is what the store's `learnedRules` seam returns to the resolver. */
export function confirmedRulesFrom(events: readonly MemoryEvent[]): LearnedRule[] {
  const seen = new Set<string>()
  const out: LearnedRule[] = []
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.kind !== 'learned_rule' || !e.rule || seen.has(e.rule.match)) continue
    seen.add(e.rule.match)
    out.push(e.rule)
  }
  return out
}

/** Normalized titles the user dismissed — a dismissed pattern is never offered
    again (persisted in memory, so the silence survives restart). */
export function dismissedMatchesFrom(events: readonly MemoryEvent[]): string[] {
  const out = new Set<string>()
  for (const e of events) if (e.kind === 'dismissed_rule' && e.rule) out.add(e.rule.match)
  return [...out]
}

/** Parse a rule carried through a chip's payload back to a LearnedRule; null on
    anything malformed, so a bad payload settles the offer without persisting. */
export function parseLearnedRule(raw: string): LearnedRule | null {
  try {
    const r = JSON.parse(raw) as LearnedRule
    return r && typeof r.match === 'string' && r.match.length > 0 ? r : null
  } catch {
    return null
  }
}

function baseTitle(title: string): string {
  return title.split('—')[0].trim()
}
function unanimous<T>(vals: (T | null | undefined)[]): T | null {
  const first = vals[0]
  if (first == null) return null
  return vals.every((v) => v === first) ? first : null
}
function median(sorted: number[]): number {
  const mid = sorted.length >> 1
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.round(m / 5) * 5
}
function hasDim(d: RuleCandidate['dims']): boolean {
  return d.durationMin != null || d.tag != null || d.window != null || d.attention != null
}
function dimCount(d: RuleCandidate['dims']): number {
  return (
    (d.durationMin != null ? 1 : 0) +
    (d.tag != null ? 1 : 0) +
    (d.window != null ? 1 : 0) +
    (d.attention != null ? 1 : 0)
  )
}
