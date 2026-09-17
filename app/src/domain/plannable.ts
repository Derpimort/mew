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

/* ── the Settings control's gate (#22 slice B) ────────────────────────── */

/** the grid a plannable bound sits on, and the latest same-day end on it */
export const PLANNABLE_GRID_MIN = 5
export const PLANNABLE_LAST_END = DAY_MIN - PLANNABLE_GRID_MIN

/** Minutes → the zero-padded 24h clock the control shows ("08:05"). */
export function clockOf(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

/** A whole "HH:MM" 24h clock time → minutes; null for anything else. */
export function parseClock(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}

export type PlannableDraftCheck =
  { ok: true; hours: PlannableHours } | { ok: false; field: 'start' | 'end'; hint: string }

/** "on a 5-minute mark — 08:05 or 08:10": the neighbouring marks, capped at the last end */
function gridHint(which: 'start' | 'end', min: number): string {
  const down = min - (min % PLANNABLE_GRID_MIN)
  const up = Math.min(down + PLANNABLE_GRID_MIN, PLANNABLE_LAST_END)
  const marks = up > down ? `${clockOf(down)} or ${clockOf(up)}` : clockOf(down)
  return `${which} on a 5-minute mark — ${marks}`
}

/** A draft commits only as a real plannable day: whole clock times on the
    5-minute grid, one date (an end at 00:00 would be tomorrow), start before
    end. The hint names what to pick, in the positive voice. */
export function checkPlannableDraft(start: string, end: string): PlannableDraftCheck {
  const s = parseClock(start)
  if (s == null) return { ok: false, field: 'start', hint: 'pick a start time, like 08:00' }
  const e = parseClock(end)
  if (e == null) return { ok: false, field: 'end', hint: 'pick an end time, like 22:30' }
  if (s % PLANNABLE_GRID_MIN) return { ok: false, field: 'start', hint: gridHint('start', s) }
  if (e % PLANNABLE_GRID_MIN) return { ok: false, field: 'end', hint: gridHint('end', e) }
  if (e === 0) {
    return {
      ok: false,
      field: 'end',
      hint: 'the day ends on the same date — 23:55 is the latest end',
    }
  }
  if (e <= s) return { ok: false, field: 'end', hint: `pick an end after ${clockOf(s)}` }
  return { ok: true, hours: { startMin: s, endMin: e } }
}

/** One keyboard step on a bound: an on-grid time moves by `deltaMin`; an
    off-grid one first lands on the neighbouring mark in the step's direction.
    Clamped to 00:00–23:55. An unreadable draft steps from `fallbackMin` (the
    stored bound). */
export function stepClock(value: string, deltaMin: number, fallbackMin: number): string {
  const cur = parseClock(value) ?? fallbackMin
  const off = cur % PLANNABLE_GRID_MIN
  const next =
    off === 0 ? cur + deltaMin : deltaMin > 0 ? cur - off + PLANNABLE_GRID_MIN : cur - off
  return clockOf(Math.max(0, Math.min(PLANNABLE_LAST_END, next)))
}
