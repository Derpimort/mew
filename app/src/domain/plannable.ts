/* The plannable day (#22) — the hours placement looks in. Pure + keyless: one
   home for reading the owner's bounds (with a safe fallback) and for the
   honest "no slot" wording, so find_slot and suggest_slots never say a gap is
   held when the free air merely sits outside the plannable hours. */
import { DEFAULT_PLANNABLE_HOURS, type Block, type PlannableHours, type Settings } from './types'
import { DAY_END, DAY_START, freeWindows } from './week'
import { fmtTime } from './time'

const DAY_MIN = 24 * 60

/** The classic 08:00–18:30 span, for the autonomous passes that keep their
    pre-#22 reach (the morning scaffold): nobody asked them for the evening. */
export const CLASSIC_DAY: PlannableHours = { startMin: DAY_START, endMin: DAY_END }

/** The owner's plannable hours, or the default when absent or malformed: a
    same-day span (no past-midnight bounds) that starts before it ends. */
export function plannableOf(settings: Pick<Settings, 'plannableHours'> | null | undefined) {
  const h = settings?.plannableHours
  const valid =
    h != null &&
    Number.isInteger(h.startMin) &&
    Number.isInteger(h.endMin) &&
    h.startMin >= 0 &&
    h.endMin <= DAY_MIN &&
    h.startMin < h.endMin
  return valid ? h : DEFAULT_PLANNABLE_HOURS
}

/** "8:00–22:30" — how the bounds read in a tool result or the week context. */
export function plannableLabel(hours: PlannableHours): string {
  return `${fmtTime(hours.startMin)}–${fmtTime(hours.endMin)}`
}

/** Free air on `dayKey` from `fromMin` that fits `durationMin` only by running
    past the plannable end (up to `toMin`, midnight by default) — the evening the
    plannable hours leave out. Empty ⇒ nothing past the end fits either. */
export function airPastEnd(
  blocks: Block[],
  dayKey: string,
  fromMin: number,
  durationMin: number,
  hours: PlannableHours,
  bufferMin = 0,
  toMin = DAY_MIN
): { startMin: number; endMin: number }[] {
  return freeWindows(blocks, dayKey, fromMin, toMin, bufferMin).filter(
    (w) => w.endMin - w.startMin >= durationMin && w.endMin > hours.endMin
  )
}

/** The honest clause for a search that came back empty inside the plannable
    hours while free air past their end would hold it: names the bounds and the
    real free time, in the positive voice, and how to use it (an explicit time
    always lands). Null when nothing past the end fits — the gap really is held. */
export function pastEndNote(
  blocks: Block[],
  dayKey: string,
  fromMin: number,
  durationMin: number,
  hours: PlannableHours,
  when: string,
  bufferMin = 0,
  toMin = DAY_MIN
): string | null {
  const air = airPastEnd(blocks, dayKey, fromMin, durationMin, hours, bufferMin, toMin)
  if (!air.length) return null
  const spans = air.slice(0, 2).map((w) => `${fmtTime(w.startMin)}–${fmtTime(w.endMin)}`)
  return `Open air ${when}: ${spans.join(' and ')}, running past the hours I plan in (${plannableLabel(hours)}) — name a time there and I'll hold it.`
}
