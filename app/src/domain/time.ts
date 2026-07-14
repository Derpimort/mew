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

/** The 7 day-keys (Mon–Sun) of the week containing `d`, optionally shifted by
    whole weeks (`offsetWeeks = -1` → the week before). Calendar math via
    setDate, so a DST hour can never move the Monday. */
export function weekKeys(d: Date, offsetWeeks = 0): string[] {
  const mon = mondayOf(d)
  if (offsetWeeks) mon.setDate(mon.getDate() + offsetWeeks * 7)
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

/* ── which week is a history question about? ──────────────────────────
   Block history never expires, so "how were my gym sessions last week"
   is answerable from real blocks — IF the question's week phrase becomes
   a Mon–Sun window. Deliberately conservative: only the phrases below
   move the window; any other wording stays 0 (the live week). */

const WEEK_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

/* "last week" / "the past week" (but not "the last week of June"), "this
   week", "N weeks ago|back" with N a numeral or a small number word. An
   optional leading preposition travels with the phrase so stripping heals
   the sentence ("sessions in the past week" → "sessions"). */
const WEEK_PHRASE =
  /\b(?:(?:in|during|over|from|for)\s+)?(?:(?:the\s+)?(?:last|past)\s+week\b(?!\s+of\b)|this\s+week\b|(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+weeks?\s+(?:ago|back)\b)/i
const WEEK_PHRASE_EVERY = new RegExp(WEEK_PHRASE.source, 'gi')

/** Which Mon–Sun week a question means, as an offset from the current one:
    "last week"/"the past week" → -1, "two weeks ago"/"2 weeks back" → -2,
    "this week" or no time phrase → 0. Anything unrecognized (ranges like
    "the past two weeks", "last weekend") stays 0 — current behavior. Pure
    text → number; the caller holds the clock. */
export function weekOffsetFromQuestion(question: string): number {
  const m = question.match(WEEK_PHRASE)
  if (!m) return 0
  if (m[1] != null) {
    const n = WEEK_WORDS[m[1].toLowerCase()] ?? Number(m[1])
    return n > 0 ? -n : 0
  }
  return /\b(?:last|past)\b/i.test(m[0]) ? -1 : 0
}

/** `question` with every recognized week phrase removed (spacing and
    punctuation healed) — so subject matching never mistakes "gym last week"
    for a title fragment. */
export function stripWeekPhrase(question: string): string {
  return question
    .replace(WEEK_PHRASE_EVERY, ' ')
    .replace(/\s+([?.!,;])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** How MEW names an offset week in a reply: 0 → "this week", -1 → "last
    week", -2 → "two weeks ago" — small counts spelled the way MEW speaks. */
export function weekOffsetLabel(offset: number): string {
  if (offset === 0) return 'this week'
  if (offset === -1) return 'last week'
  if (offset < 0) return `${spell(-offset)} weeks ago`
  return offset === 1 ? 'next week' : `in ${spell(offset)} weeks`
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
