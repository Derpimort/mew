/* The memory console (#330, gbrain Pillar 4) — "what I've picked up about
   you." One PURE presenter over LOCAL memory: the confirmed task rules
   (#327), your rhythm (insights bestBand + weekday load, #287), your standing
   rules, and what MEW is about to ask / what you told it not to learn. No
   brain, no key, no I/O — the store reads the locals and hands them in; the
   domain only shapes them. Two skins over this ONE data: the Settings console
   and the keyless "what do you know about me?" reply (consoleSummary), so the
   two can never drift — the #287 `claim` traceability discipline, extended to
   every section. Positive voice by law: rules are what I've picked up, never
   failures.

   The (band × task-type) energyProfile is #321 (not built yet); the rhythm
   section renders what insights already computes today and is shaped so #321
   plugs in as more rhythm rows without touching this contract. */

import { normTitle, type Insights } from './insights'
import {
  candidateToRule,
  confirmedRulesFrom,
  detectTaskRules,
  dismissedMatchesFrom,
  offerPhrase,
  ruleLabel,
} from './learn'
import type { LearnedRule } from './prefs'
import type { MemoryEvent, PrefPayload } from './types'

export const MEMORY_CONSOLE_TITLE = "what i've picked up about you"

/** A confirmed task rule, ready to render and edit/forget. `rule` carries the
    full shape for the edit/forget payloads; `support` is the number of your own
    completions behind it — the traceable source the `claim` cites. */
export interface TaskRuleView {
  match: string
  title: string
  /** the rule as one line: "90 min of deep work, mornings" */
  label: string
  support: number
  /** the source, spoken: "learned from 5 times you did it" */
  claim: string
  rule: LearnedRule
}

/** One rhythm claim, each tracing to the Insights field it stands on. */
export interface RhythmRow {
  label: string
  value: string
  claim: keyof Insights
}

/** A stated standing rule, editable/removable in one place. */
export interface StandingRuleView {
  match: string
  value: string
  stated: string
  pref: PrefPayload
}

/** A pattern MEW is about to ask about — the next learn-offer, shown before
    it interrupts. `rule` is the confirm payload; `support` traces it. */
export interface PendingOfferView {
  match: string
  offer: string
  support: number
  rule: LearnedRule
}

export interface MemoryConsoleData {
  title: string
  taskRules: TaskRuleView[]
  rhythm: RhythmRow[]
  standingRules: StandingRuleView[]
  pending: PendingOfferView[]
  /** matches on the won't-learn list (dismissed offers + forgotten rules),
      each re-enablable */
  dismissed: string[]
  /** genuinely nothing yet — the UI shows one kind line instead of empty rows */
  empty: boolean
}

export interface ConsoleInputs {
  events: readonly MemoryEvent[]
  /** the LOCAL standing rulebook (activePrefsFrom over local memory) — the
      console renders from local memory alone, brain-off by law */
  prefs: readonly PrefPayload[]
  insights: Insights
}

/** how many completions formed a rule — its match IS a normTitle key, so this
    counts the same events detectTaskRules grouped. The number the claim cites. */
function supportFor(events: readonly MemoryEvent[], match: string): number {
  let n = 0
  for (const e of events) if (e.kind === 'completed' && e.title && normTitle(e.title) === match) n++
  return n
}

/** A confirmed rule's display title — the words from when it was confirmed
    (before the em-dash provenance), else the match key. */
function ruleTitle(rule: LearnedRule): string {
  const fromStated = rule.stated?.split('—')[0].trim()
  return fromStated || rule.match
}

export function memoryConsole(input: ConsoleInputs): MemoryConsoleData {
  const { events, prefs, insights } = input

  const rules = confirmedRulesFrom(events)
  const taskRules: TaskRuleView[] = rules.map((rule) => {
    const support = supportFor(events, rule.match)
    return {
      match: rule.match,
      title: ruleTitle(rule),
      label: ruleLabel(rule),
      support,
      claim:
        support > 0
          ? `learned from ${support} time${support === 1 ? '' : 's'} you did it`
          : 'a rule you confirmed',
      rule,
    }
  })

  /* rhythm — what insights already computes (bestBand + weekday load). The
     kind reading of weekdayLoad is the LIGHTEST day (room to breathe), mirroring
     the insights card. #321's band×task-type profile appends here later. */
  const rhythm: RhythmRow[] = []
  if (insights.bestBand) {
    rhythm.push({
      label: 'your best hours',
      value: `${insights.bestBand.label} hold — ${insights.bestBand.completed}/${insights.bestBand.attempted} finished there`,
      claim: 'bestBand',
    })
  }
  const load = insights.weekdayLoad.filter((w) => w.avgPlannedH > 0)
  if (load.length >= 3) {
    const lightest = [...load].sort((a, b) => a.avgPlannedH - b.avgPlannedH)[0]
    rhythm.push({
      label: 'your kindest day',
      value: `${lightest.name} run lightest — about ${lightest.avgPlannedH}h, room to breathe`,
      claim: 'weekdayLoad',
    })
  }

  const standingRules: StandingRuleView[] = prefs.map((p) => ({
    match: p.match,
    value: p.value,
    stated: p.stated,
    pref: p,
  }))

  /* pending — the next candidates the learn pass would offer (already covered
     rules/prefs skipped, dismissed skipped), shown before they interrupt. */
  const covered = [...rules.map((r) => r.match), ...prefs.map((p) => p.match)]
  const dismissed = dismissedMatchesFrom(events)
  const pending: PendingOfferView[] = detectTaskRules(events, covered, dismissed)
    .slice(0, 3)
    .map((c) => ({
      match: c.match,
      offer: offerPhrase(c),
      support: c.support,
      rule: candidateToRule(c),
    }))

  const empty =
    taskRules.length === 0 &&
    rhythm.length === 0 &&
    standingRules.length === 0 &&
    pending.length === 0 &&
    dismissed.length === 0

  return {
    title: MEMORY_CONSOLE_TITLE,
    taskRules,
    rhythm,
    standingRules,
    pending,
    dismissed,
    empty,
  }
}

/** The kind line shown (and spoken) when there's genuinely nothing yet. */
export const CONSOLE_EMPTY_LINE = "still getting to know you — I'll pick things up as we go."

/** The console as plain lines — the keyless "what do you know about me?" reply
    renders exactly this (one presenter, two skins, so the reply and the card
    can never disagree — parity by construction). Positive voice throughout. */
export function consoleSummary(data: MemoryConsoleData): string[] {
  if (data.empty) return [CONSOLE_EMPTY_LINE]
  const lines: string[] = [data.title]
  for (const r of data.taskRules) lines.push(`• ${r.title}: ${r.label} (${r.claim})`)
  for (const r of data.rhythm) lines.push(`• ${r.label}: ${r.value}`)
  for (const r of data.standingRules) lines.push(`• you told me: ${r.match} → ${r.value}`)
  if (data.pending.length)
    lines.push(`about to ask about: ${data.pending.map((p) => p.match).join(', ')}`)
  if (data.dismissed.length) lines.push(`not learning (your call): ${data.dismissed.join(', ')}`)
  return lines
}
