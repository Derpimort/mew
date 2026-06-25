/* Pixie's condition mirrors *sustainability*, never volume (PRD §6, locked).
   Inputs: planned-vs-realistic ratio, carry-over trend, rest kept. Raw task
   count appears nowhere in this file — that's acceptance criterion #7. */

import type { PixieInputs } from './types'
import type { MemoryAggregates } from './memory'

export interface SustainabilitySignals {
  plannedDeepTodayH: number
  agg: MemoryAggregates
  dayClear: boolean
  nudgeWaiting: boolean
}

export function pixieInputs(s: SustainabilitySignals): PixieInputs {
  let pace = 1

  /* over-commitment vs the user's own realistic best */
  if (s.agg.realisticBestH != null && s.agg.realisticBestH > 0) {
    const ratio = s.plannedDeepTodayH / s.agg.realisticBestH
    if (ratio > 1.5) pace -= 0.4
    else if (ratio > 1.2) pace -= 0.25
  }

  /* chronic carry-over */
  if (s.agg.carryRatio > 0.3) pace -= 0.3
  else if (s.agg.carryRatio > 0.15) pace -= 0.15

  /* skipped recovery */
  if (s.agg.restKeptRatio != null) pace -= (1 - s.agg.restKeptRatio) * 0.2
  if (s.agg.restSkippedStreak >= 2) pace -= 0.1

  pace = Math.max(0, Math.min(1, pace))

  const mood = pace >= 0.66 ? 'healthy' : pace >= 0.4 ? 'drowsy' : 'rundown'

  return { mood, resting: s.dayClear, pace, attention: s.nudgeWaiting }
}

/** Status line + note for the companion slot — care, not blame; always an invitation. */
export function pixieCopy(
  p: PixieInputs,
  mewName: string
): { status: string; note: string; dot: string } {
  if (p.resting)
    return {
      status: 'resting — earned',
      note: "Day's items done. The good kind of tired.",
      dot: 'var(--rest-seg)',
    }
  switch (p.mood) {
    case 'healthy':
      return {
        status: 'healthy · mewing away',
        note: 'A pace you can keep. Rest is on the calendar.',
        dot: 'var(--sage)',
      }
    case 'drowsy':
      return {
        status: 'a little drowsy',
        note: 'The week is leaning heavy. A lighter tomorrow would help.',
        dot: 'var(--rest-seg)',
      }
    case 'rundown':
      return {
        status: 'run-down · asks for a lighter day',
        note: `${mewName} would love a kinder plan tomorrow.`,
        dot: 'var(--rose)',
      }
  }
}
