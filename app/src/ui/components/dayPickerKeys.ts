/* The Focus dial's day picker (#23 slice 2) — its key grammar and month grid
   as pure logic, tested without a DOM (the weekKeys / dialGeometry precedent).
   The grammar is the APG date-picker dialog's: ←/→ a day, ↑/↓ a week,
   PageUp/PageDown a month (Shift: a year), Home/End the week's edges, Enter or
   Space picks, Escape closes. MEW's weeks run Monday → Sunday, so the grid and
   Home/End do too. The range is Week's: unbounded, one calendar forever. */

import { addDaysKey, dayKey, fromDayKey } from '../../domain/time'

export type PickerIntent =
  | { kind: 'move'; days: number }
  | { kind: 'month'; months: number }
  | { kind: 'weekEdge'; edge: 'start' | 'end' }
  | { kind: 'pick' }
  | { kind: 'close' }
  | null

/** What a key means inside the picker's grid; null lets it bubble (Tab, characters). */
export function pickerKeyIntent(key: string, mods: { shift?: boolean } = {}): PickerIntent {
  switch (key) {
    case 'ArrowLeft':
      return { kind: 'move', days: -1 }
    case 'ArrowRight':
      return { kind: 'move', days: 1 }
    case 'ArrowUp':
      return { kind: 'move', days: -7 }
    case 'ArrowDown':
      return { kind: 'move', days: 7 }
    case 'PageUp':
      return { kind: 'month', months: mods.shift ? -12 : -1 }
    case 'PageDown':
      return { kind: 'month', months: mods.shift ? 12 : 1 }
    case 'Home':
      return { kind: 'weekEdge', edge: 'start' }
    case 'End':
      return { kind: 'weekEdge', edge: 'end' }
    case 'Enter':
    case ' ':
    case 'Spacebar':
      return { kind: 'pick' }
    case 'Escape':
    case 'Esc':
      return { kind: 'close' }
    default:
      return null
  }
}

/** Monday-based weekday: Mon 0 … Sun 6. */
function mon0(key: string): number {
  return (fromDayKey(key).getDay() + 6) % 7
}

/** The same day-of-month `months` away, clamped to that month's last day
    (Jan 31 + 1 month → Feb 28, or 29 in a leap year). */
export function addMonthsKey(key: string, months: number): string {
  const d = fromDayKey(key)
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(d.getDate(), last))
  return dayKey(target)
}

/** Where the active day goes for a move / month / week-edge intent. */
export function stepActiveDay(
  active: string,
  intent: Extract<NonNullable<PickerIntent>, { kind: 'move' | 'month' | 'weekEdge' }>
): string {
  switch (intent.kind) {
    case 'move':
      return addDaysKey(active, intent.days)
    case 'month':
      return addMonthsKey(active, intent.months)
    case 'weekEdge':
      return addDaysKey(active, intent.edge === 'start' ? -mon0(active) : 6 - mon0(active))
  }
}

/** "YYYY-MM" of a day key. */
export function monthOf(key: string): string {
  return key.slice(0, 7)
}

/** The month's calendar as Monday-first weeks of day keys — whole weeks, so
    the first and last rows carry the neighbouring months' days. */
export function monthGrid(anyDayInMonth: string): string[][] {
  const d = fromDayKey(anyDayInMonth)
  const first = dayKey(new Date(d.getFullYear(), d.getMonth(), 1))
  const lastKey = dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  let cursor = addDaysKey(first, -mon0(first))
  const weeks: string[][] = []
  while (cursor <= lastKey) {
    const week = Array.from({ length: 7 }, (_, i) => addDaysKey(cursor, i))
    weeks.push(week)
    cursor = addDaysKey(cursor, 7)
  }
  return weeks
}

/** "September 2026" — the picker's heading. */
export function monthLabel(key: string): string {
  return fromDayKey(key).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** A day cell's accessible name: "Wednesday, September 16, 2026". */
export function cellLabel(key: string): string {
  return fromDayKey(key).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
