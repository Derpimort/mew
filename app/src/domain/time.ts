/* Local-time helpers. The week is Mon–Sun (PRD §2). All day math uses local
   YYYY-MM-DD keys and minutes-of-day so DST shifts can't corrupt the plan. */

export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function minOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

export function addDaysKey(key: string, n: number): string {
  const d = fromDayKey(key)
  d.setDate(d.getDate() + n)
  return dayKey(d)
}

/** Monday of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const out = new Date(d)
  const dow = (out.getDay() + 6) % 7 // Mon=0 … Sun=6
  out.setDate(out.getDate() - dow)
  out.setHours(0, 0, 0, 0)
  return out
}

/** The 7 day-keys (Mon–Sun) of the week containing `d`. */
export function weekKeys(d: Date): string[] {
  const mon = mondayOf(d)
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(mon)
    x.setDate(mon.getDate() + i)
    return dayKey(x)
  })
}

export function isoWeek(d: Date): number {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dow = x.getUTCDay() || 7
  x.setUTCDate(x.getUTCDate() + 4 - dow)
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1))
  return Math.ceil(((x.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/** "9:00", "13:30" — 24h, no leading zero (matches design copy). */
export function fmtTime(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MON_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function fmtDow(key: string): string {
  return DOW[fromDayKey(key).getDay()]
}
export function fmtDowLong(key: string): string {
  return DOW_LONG[fromDayKey(key).getDay()]
}
export function fmtShortDate(key: string): string {
  const d = fromDayKey(key)
  return `${MON[d.getMonth()]} ${d.getDate()}`
}
/** "Tuesday, June 9" */
export function fmtLongDate(d: Date): string {
  return `${DOW_LONG[d.getDay()]}, ${MON_LONG[d.getMonth()]} ${d.getDate()}`
}

export function hoursLabel(totalMin: number): string {
  const h = totalMin / 60
  const rounded = Math.round(h * 2) / 2
  return `${rounded % 1 ? rounded : rounded}h`
}

/** Weekday word ("thursday"/"thu") → next occurrence as day offset from `from` (0 = today). */
export function weekdayOffset(word: string, from: Date): number | null {
  const idx = DOW_LONG.findIndex((d) => d.toLowerCase().startsWith(word.toLowerCase()))
  if (idx < 0) return null
  const today = from.getDay()
  const diff = (idx - today + 7) % 7
  return diff
}

export function inQuietHours(min: number, q: { startMin: number; endMin: number }): boolean {
  if (q.startMin === q.endMin) return false
  if (q.startMin < q.endMin) return min >= q.startMin && min < q.endMin
  return min >= q.startMin || min < q.endMin // wraps midnight
}

/** Spell small counts the way MEW speaks ("five today"). */
export function spell(n: number): string {
  const words = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
  ]
  return n >= 0 && n <= 10 ? words[n] : String(n)
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}
