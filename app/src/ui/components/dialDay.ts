/* The Focus dial on any day (#23) — the pure rules, tested without a DOM. The
   dial's geometry was already day-parametric; what isn't is everything keyed
   to NOW: the day wash, the now-hand, "running", the countdown. On a day that
   isn't today there is no now, so each of those takes a defined resting state
   here, and the centre shows the day itself — never a fabricated "current". */

import type { Block } from '../../domain/types'
import {
  addDaysKey,
  fmtDow,
  fmtDowLong,
  fmtShortDate,
  fromDayKey,
  hoursLabel,
} from '../../domain/time'
import { blocksForDay, duration, isAllDay, isBackground } from '../../domain/week'

/** The minute that drives the day wash: today fills to now; a lived day is
    full; a day ahead is empty. */
export function washMinute(viewDayKey: string, todayKey: string, nowMin: number): number {
  if (viewDayKey === todayKey) return nowMin
  return viewDayKey < todayKey ? 24 * 60 : 0
}

/** The date line above the dial — the exact format the live clock already
    shows for today ("Thu · Sep 17"), so today's face never changes. */
export function dayLine(key: string): string {
  return `${fmtDow(key)} · ${fromDayKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

/** A day as the day-step buttons and the dial's accessible name speak it:
    "Friday, September 18". */
export function spokenDay(key: string): string {
  const month = fromDayKey(key).toLocaleDateString(undefined, { month: 'long' })
  return `${fmtDowLong(key)}, ${month} ${fromDayKey(key).getDate()}`
}

/** The resting centre's title off today: "Wednesday, Sep 16" (fits the 280px stack). */
export function dayTitle(key: string): string {
  return `${fmtDowLong(key)}, ${fmtShortDate(key)}`
}

/** The dial's accessible name: today stays exactly as it was. */
export function dialAriaLabel(viewDayKey: string, todayKey: string): string {
  return viewDayKey === todayKey
    ? "focus dial: 12-hour clock showing today's tasks"
    : `focus dial: 12-hour clock showing the tasks for ${spokenDay(viewDayKey)}`
}

/** The neighbouring day a step button reaches. */
export function stepDay(viewDayKey: string, dir: 1 | -1): string {
  return addDaysKey(viewDayKey, dir)
}

export interface DaySummary {
  /** the day's timed blocks (all-day labels are day labels, not blocks) */
  blocks: number
  /** blocks done — the only thing MEW counts */
  mews: number
  /** minutes the day's timed blocks hold: not optional, not background */
  committedMin: number
}

/** What a day off today holds, from the live week — the resting centre. */
export function daySummary(blocks: Block[], dayKey: string): DaySummary {
  const day = blocksForDay(blocks, dayKey).filter((b) => !isAllDay(b))
  return {
    blocks: day.length,
    mews: day.filter((b) => b.status === 'done').length,
    committedMin: day
      .filter((b) => !b.optional && !isBackground(b))
      .reduce((s, b) => s + duration(b), 0),
  }
}

/** The resting centre's line, positive by construction: counts and mews, never
    what "slipped". */
export function daySummaryLine(s: DaySummary): string {
  if (s.blocks === 0) return 'a clear day — nothing on the books'
  const parts = [`${s.blocks} block${s.blocks === 1 ? '' : 's'}`]
  if (s.committedMin > 0) parts.push(`${hoursLabel(s.committedMin)} committed`)
  if (s.mews > 0) parts.push(`${s.mews} mew${s.mews === 1 ? '' : 's'}`)
  return parts.join(' · ')
}
