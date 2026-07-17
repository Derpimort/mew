/* The weekly planning ritual (#304) — Sunday's shaping invite + the keyless
   task defaults. Pure functions, same discipline as brief.ts: the engine owns
   WHEN the invite fires (once per ISO week, persisted weekKey); this file only
   says WHAT the coming week looks like and what a zero-key "plan my week"
   proposes. The ritual itself is a composition of EXISTING tools — the invite
   carries one chip whose words become an ordinary user turn; the turn runs
   offer_choices / propose_scenarios; nothing here touches the week. */

import type { Block, PrefPayload, Tag } from '../types'
import type { Insights } from '../insights'
import { addDaysKey, spell } from '../time'
import { blocksForDay, isFixedTime } from '../week'
import { inferTag } from '../parse'

/** One kept invite: the coming week's fixed load + how MEW will plan around
    it. Two lines, inviting — the chip (store-side) does the asking. */
export function composeWeeklyRitual(
  blocks: Block[],
  todayKey: string,
  insights: Insights
): { body: string } {
  /* the ritual fires Sunday, so "the coming week" is tomorrow through +7 —
     exactly the Mon–Sun ahead */
  let fixed = 0
  for (let i = 1; i <= 7; i++) {
    fixed += blocksForDay(blocks, addDaysKey(todayKey, i)).filter(
      (b) => b.status === 'open' && !b.optional && isFixedTime(b)
    ).length
  }
  const shape =
    fixed > 0
      ? `${spell(fixed)} fixed meeting${fixed === 1 ? '' : 's'} already hold${fixed === 1 ? 's' : ''} their spot${fixed === 1 ? '' : 's'}`
      : 'the calendar is a clean page'
  const best = insights.bestBand ? ` in your ${insights.bestBand.label}` : ''
  return {
    body: [
      `sunday — want to shape the coming week while it's soft?`,
      `${shape}; I'll lay deep work around them${best} and you pick the shape.`,
    ].join('\n'),
  }
}

/** A classified task the ritual proposes — structurally a ScenarioTaskSpec
    (adapters/model), declared here so the domain stays import-free of it. */
export interface RitualTask {
  title: string
  tag: Tag
  durationMin?: number
}

const ANCHOR_MIN = 90
/* distinct BASE titles on purpose: execPlan's re-plan de-dup (#89) folds
   same-base places on one day into a move, and the picker's apply must stay
   byte-exact — numbered anchors can never collapse into each other */
const ANCHOR_NAMES = ['Deep work I', 'Deep work II', 'Deep work III', 'Deep work IV']

/** The zero-key "plan my week" defaults: what a keyed model would classify
    from the shaping questions, derived instead from what MEW already knows.
    Open captures are the standing "top priority" answers (their own words);
    time-default rules are the standing habit answers ("gym starts 07:00" →
    a Gym task the rulebook then times); deep-work anchors fill the rest,
    counted from the realistic best (90-min blocks, 2–4). Durations stay
    open where history can size them; anchors are explicit. Deterministic —
    same inputs, same list, so the keyless picker is reproducible. */
export function ritualTasks(opts: {
  realisticBestH: number | null
  /** open (unplaced) capture titles, oldest first */
  captures: string[]
  /** the standing rulebook — habit rules become tasks; the rest just scores */
  prefs: PrefPayload[]
}): RitualTask[] {
  const tasks: RitualTask[] = []
  const seen = new Set<string>()
  const claim = (title: string): boolean => {
    const base = title.split('—')[0].trim().toLowerCase()
    if (!base || seen.has(base)) return false
    seen.add(base)
    return true
  }

  for (const title of opts.captures.slice(0, 3)) {
    if (claim(title)) tasks.push({ title, tag: inferTag(title) })
  }

  /* a time-default rule names a habit worth a weekly home ("gym starts
     07:00"); the rule itself then times and sizes it at placement */
  const habits = opts.prefs.filter((p) => p.kind === 'time-default')
  for (const p of habits.slice(0, 2)) {
    const title = p.match.trim()
    if (title && claim(title)) {
      tasks.push({ title: title[0].toUpperCase() + title.slice(1), tag: inferTag(title) })
    }
  }

  const anchors = Math.max(2, Math.min(4, Math.round((opts.realisticBestH ?? 3) / 1.5)))
  for (const name of ANCHOR_NAMES.slice(0, anchors)) {
    if (claim(name)) tasks.push({ title: name, tag: 'work', durationMin: ANCHOR_MIN })
  }
  return tasks
}
