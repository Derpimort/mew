/* The mini-week strip's pure logic (#293) — geometry, density steps, and the
   spoken summary, kept beside the picker component the way sessionWindow.ts
   sits beside SessionLog: data in, data out, string-pinnable headlessly. The
   strip draws ONLY from a scenario's stored places/dayLoad — rendering never
   re-validates (staleness is pick-time truth, in the store). */

import type { StoredScenario } from '../../domain/types'
import { addDaysKey, fmtDow } from '../../domain/time'

/** The strip's day span — wide enough for a 7:00 gym rule and a late dinner;
    slivers outside it clamp to the edge rather than vanish. */
export const STRIP_LO = 7 * 60
export const STRIP_HI = 22 * 60
export const STRIP_DAYS = 7

/** Discrete density steps so the tint is a pinnable class, not a float:
    l0 empty · l1 a light day (≤90m) · l2 solid (≤180m) · l3 heavy. */
export function loadClass(min: number): 'l0' | 'l1' | 'l2' | 'l3' {
  if (min <= 0) return 'l0'
  if (min <= 90) return 'l1'
  if (min <= 180) return 'l2'
  return 'l3'
}

const hours = (min: number): string =>
  min % 60 === 0 ? `${min / 60}h` : `${Math.round((min / 60) * 10) / 10}h`

/** The strip, spoken: "mon 2h, tue 3h" — only days this scenario loads. */
export function stripSummary(sc: StoredScenario): string {
  const parts: string[] = []
  for (let d = 0; d < STRIP_DAYS; d++) {
    const key = addDaysKey(sc.todayKey, d)
    const load = sc.dayLoad[key] ?? 0
    if (load > 0) parts.push(`${fmtDow(key).toLowerCase()} ${hours(load)}`)
  }
  return parts.length ? parts.join(', ') : 'nothing placed this week'
}

/** One sliver's vertical geometry, as percentages of the strip column. */
export function sliverRect(startMin: number, durationMin: number): { top: number; height: number } {
  const span = STRIP_HI - STRIP_LO
  const top = Math.min(Math.max(((startMin - STRIP_LO) / span) * 100, 0), 96)
  const height = Math.min(Math.max((durationMin / span) * 100, 4), 100 - top)
  return { top, height }
}
