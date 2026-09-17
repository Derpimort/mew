/* ── which stretch of time is a history question about? (#8) ──────────
   Block history never expires, so "how were my gym sessions over the last
   three weeks" is answerable from real blocks — IF its time phrase becomes a
   span of days. Pure text + today's key → an inclusive day range and the words
   MEW names it with; the caller holds the clock.

   The phrasings, first match wins in this order:
     between <date> and <date> · from <date> to|until|through <date> (or "now")
                                        → that span, inclusive, either order
     since <date>                       → <date> through today
     the last|past|previous N days|weeks|months|years ("a couple of", "a few")
                                        → the trailing stretch, ending today
     this|last month · this|last year   → that calendar month / year
     in|during|throughout <month> [year] · in|during|throughout <year>
                                        → that calendar month / year
     yesterday · today                  → that day
   <date> is "August 1" · "Aug 1st, 2025" · "1 August" · "the 3rd of August" ·
   "2026-08-01" · "August" [2025] · a weekday · "yesterday" · "today" ·
   "last week|month|year" · "N days|weeks|months|years ago" · "the 3rd".
   A date with no year is its latest occurrence, so "since October 5" asked in
   September means last October; a month with no year is its latest one begun;
   a weekday is its latest one before today.

   Anything else is the pre-#8 grammar, byte-identical: "last week" / "the past
   week" / "N weeks ago" / "this week" name one Mon–Sun week by offset
   (weekOffsetFromQuestion), and no phrase at all means this week. Text that
   doesn't read as a real date never guesses — it falls through to that
   grammar. A stretch longer than RANGE_CAP_DAYS keeps its most recent year
   (`capped`, and the reply says so); a stretch that starts after today is
   `future` — nothing to look back on yet. */

import {
  addDaysKey,
  fmtShortDate,
  fromDayKey,
  spell,
  stripWeekPhrase,
  weekKeys,
  weekOffsetFromQuestion,
  weekOffsetLabel,
} from './time'

/** The longest stretch a history answer sums: a year, leap day included. */
export const RANGE_CAP_DAYS = 366

export interface DayRange {
  /** first day, inclusive */
  fromDayKey: string
  /** last day, inclusive */
  toDayKey: string
  /** how MEW names the stretch in a reply ("last week", "since Aug 1") */
  label: string
  /** 'week' — one Mon–Sun week by offset (the pre-#8 phrasings); 'days' — any other stretch */
  kind: 'week' | 'days'
  /** the week's offset for kind 'week' (0 = this week); 0 for 'days' */
  weekOffset: number
  /** the asked stretch ran past RANGE_CAP_DAYS — this is its most recent year */
  capped: boolean
  /** the stretch starts after today */
  future: boolean
}

/* ── building blocks ───────────────────────────────────────────────── */

const NUM_WORDS: Record<string, number> = {
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
  eleven: 11,
  twelve: 12,
  'a couple of': 2,
  'couple of': 2,
  'a few': 3,
  few: 3,
}
const NUM =
  '(?:\\d{1,3}|a\\s+couple\\s+of|couple\\s+of|a\\s+few|few|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)'
const MON =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?'
const ORD = '\\d{1,2}(?:st|nd|rd|th)?'
const YEAR = '\\d{4}'
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const WD = `(?:${WEEKDAYS.join('|')})`
/** the end of a date phrase: not mid-word, not a possessive ("today's") */
const END = "(?![a-z0-9'’])"

const DATE = [
  '\\d{4}-\\d{1,2}-\\d{1,2}',
  `${NUM}\\s+(?:days?|weeks?|months?|years?)\\s+ago`,
  `${MON}\\s+${ORD}(?:,?\\s+${YEAR})?`,
  `(?:the\\s+)?${ORD}\\s+(?:of\\s+)?${MON}(?:,?\\s+${YEAR})?`,
  `${MON}(?:\\s+${YEAR})?`,
  WD,
  'yesterday',
  'today',
  'last\\s+(?:week|month|year)',
  'the\\s+\\d{1,2}(?:st|nd|rd|th)',
]
  .map((s) => `(?:${s})`)
  .join('|')

const num = (w: string): number => {
  const k = w.toLowerCase().replace(/\s+/g, ' ')
  return NUM_WORDS[k] ?? Number(k)
}
const monthIndex = (w: string): number =>
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
    w.toLowerCase().slice(0, 3)
  )
const daysIn = (y: number, m: number): number => new Date(y, m + 1, 0).getDate()
const ymd = (y: number, m: number, d: number): string =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const valid = (y: number, m: number, d: number): boolean =>
  m >= 0 && m < 12 && d >= 1 && d <= daysIn(y, m)
const parts = (key: string): [number, number, number] => {
  const d = fromDayKey(key)
  return [d.getFullYear(), d.getMonth(), d.getDate()]
}
/** whole days from a to b (b − a), DST-proof */
const daysBetween = (a: string, b: string): number =>
  Math.round((fromDayKey(b).getTime() - fromDayKey(a).getTime()) / 86_400_000)
/** the same day-of-month n months on, clamped to that month's length */
const addMonths = (key: string, n: number): string => {
  const [y, m, d] = parts(key)
  const t = new Date(y, m + n, 1)
  return ymd(t.getFullYear(), t.getMonth(), Math.min(d, daysIn(t.getFullYear(), t.getMonth())))
}
const lastOfMonth = (y: number, m: number): string => ymd(y, m, daysIn(y, m))

/** "Aug 1", or "Aug 1, 2025" when the year isn't today's */
function fmtDay(key: string, todayKey: string): string {
  const y = key.slice(0, 4)
  return y === todayKey.slice(0, 4) ? fmtShortDate(key) : `${fmtShortDate(key)}, ${y}`
}
const MONTH_NAMES = [
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

/* ── one date phrase → the span it names ───────────────────────────── */

interface DateSpan {
  start: string
  end: string
  /** the same phrase one year earlier — only for dates spoken without a year */
  yearEarlier?: () => DateSpan | null
}

/** A month-day with no year: its latest valid occurrence on or before `todayKey`. */
function latestMonthDay(
  m: number,
  d: number,
  todayKey: string,
  fromYear?: number
): DateSpan | null {
  let y = fromYear ?? Number(todayKey.slice(0, 4))
  for (let i = 0; i < 9; i++, y--) {
    // nine years back always reaches a leap year for Feb 29
    if (!valid(y, m, d)) continue
    const key = ymd(y, m, d)
    if (fromYear == null && key > todayKey) continue
    const year = y
    return {
      start: key,
      end: key,
      yearEarlier: () => latestMonthDay(m, d, todayKey, year - 1),
    }
  }
  return null
}

/** A month with no year: the latest one begun by `todayKey` (or `fromYear`'s). */
function latestMonth(m: number, todayKey: string, fromYear?: number): DateSpan {
  const [ty, tm] = parts(todayKey)
  const y = fromYear ?? (m <= tm ? ty : ty - 1)
  return {
    start: ymd(y, m, 1),
    end: lastOfMonth(y, m),
    yearEarlier: () => latestMonth(m, todayKey, y - 1),
  }
}

function resolveDate(text: string, todayKey: string): DateSpan | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ')
  const [ty, tm] = parts(todayKey)
  const point = (key: string): DateSpan => ({ start: key, end: key })
  let m: RegExpMatchArray | null

  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
    return valid(y, mo, d) ? point(ymd(y, mo, d)) : null
  }
  if ((m = t.match(new RegExp(`^(${NUM}) (day|week|month|year)s? ago$`)))) {
    const n = num(m[1])
    if (!(n > 0)) return null
    if (m[2] === 'day') return point(addDaysKey(todayKey, -n))
    if (m[2] === 'week') return point(addDaysKey(todayKey, -7 * n))
    return point(addMonths(todayKey, m[2] === 'month' ? -n : -12 * n))
  }
  if (
    (m = t.match(new RegExp(`^(${MON}) (\\d{1,2})(?:st|nd|rd|th)?(?:,? (${YEAR}))?$`))) ||
    (m = t.match(
      new RegExp(`^(?:the )?(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MON})(?:,? (${YEAR}))?$`)
    ))
  ) {
    const monFirst = /^[a-z]/.test(m[1])
    const mo = monthIndex(monFirst ? m[1] : m[2])
    const d = Number(monFirst ? m[2] : m[1])
    if (m[3]) {
      const y = Number(m[3])
      return valid(y, mo, d) ? point(ymd(y, mo, d)) : null
    }
    return latestMonthDay(mo, d, todayKey)
  }
  if ((m = t.match(new RegExp(`^(${MON})(?: (${YEAR}))?$`)))) {
    const mo = monthIndex(m[1])
    if (m[2]) {
      const y = Number(m[2])
      return { start: ymd(y, mo, 1), end: lastOfMonth(y, mo) }
    }
    return latestMonth(mo, todayKey)
  }
  const wd = WEEKDAYS.indexOf(t)
  if (wd >= 0) {
    const back = (fromDayKey(todayKey).getDay() - wd + 7) % 7 || 7
    return point(addDaysKey(todayKey, -back))
  }
  if (t === 'yesterday') return point(addDaysKey(todayKey, -1))
  if (t === 'today') return point(todayKey)
  if ((m = t.match(/^last (week|month|year)$/))) {
    if (m[1] === 'week') {
      const days = weekKeys(fromDayKey(todayKey), -1)
      return { start: days[0], end: days[6] }
    }
    if (m[1] === 'month') {
      const [y, mo] = parts(addMonths(ymd(ty, tm, 1), -1))
      return { start: ymd(y, mo, 1), end: lastOfMonth(y, mo) }
    }
    return { start: ymd(ty - 1, 0, 1), end: ymd(ty - 1, 11, 31) }
  }
  if ((m = t.match(/^the (\d{1,2})(?:st|nd|rd|th)$/))) {
    const d = Number(m[1])
    // this month's, else the latest month that has that day, never after today
    for (let i = 0; i < 12; i++) {
      const [y, mo] = parts(addMonths(ymd(ty, tm, 1), -i))
      if (valid(y, mo, d) && ymd(y, mo, d) <= todayKey) return point(ymd(y, mo, d))
    }
    return null
  }
  return null
}

/* ── the phrase grammar ────────────────────────────────────────────── */

interface Hit {
  from: string
  to: string
  label: string
}

interface Matcher {
  re: RegExp
  read: (m: RegExpMatchArray, todayKey: string) => Hit | null
}

/** "between A and B" resolved: each date alone, then — if they cross — the
    tighter of swapping them or reading A a year earlier ("between Dec 20 and
    Jan 5" asked on Dec 25 means last winter; "between Aug 17 and Aug 3" means
    Aug 3–17). */
function span(aText: string, bText: string, todayKey: string): Hit | null {
  const a = resolveDate(aText, todayKey)
  const b = /^now$/i.test(bText.trim())
    ? { start: todayKey, end: todayKey }
    : resolveDate(bText, todayKey)
  if (!a || !b) return null
  let from = a.start
  let to = b.end
  if (from > to) {
    const swapped: [string, string] = [b.start, a.end]
    const earlier = a.yearEarlier?.()
    const yearBack: [string, string] | null =
      earlier && earlier.start <= b.end ? [earlier.start, b.end] : null
    ;[from, to] =
      yearBack && daysBetween(yearBack[0], yearBack[1]) < daysBetween(swapped[0], swapped[1])
        ? yearBack
        : swapped
  }
  const label =
    from === to
      ? `on ${fmtDay(from, todayKey)}`
      : `from ${fmtDay(from, todayKey)} to ${fmtDay(to, todayKey)}`
  return { from, to, label }
}

const PRE = '(?:(?:in|during|over|for|within|across|throughout)\\s+)?'

const MATCHERS: Matcher[] = [
  {
    re: new RegExp(
      `\\b(?:between\\s+(${DATE})\\s+and\\s+(${DATE}|now)|from\\s+(${DATE})\\s+(?:to|until|till|through|thru)\\s+(${DATE}|now))${END}`,
      'gi'
    ),
    read: (m, today) => span(m[1] ?? m[3], m[2] ?? m[4], today),
  },
  {
    re: new RegExp(`\\bsince\\s+(${DATE})${END}`, 'gi'),
    read: (m, today) => {
      const d = resolveDate(m[1], today)
      return d ? { from: d.start, to: today, label: `since ${fmtDay(d.start, today)}` } : null
    },
  },
  {
    re: new RegExp(
      `\\b${PRE}(?:the\\s+)?(?:last|past|previous)\\s+(${NUM})\\s+(days?|weeks?|months?|years?)${END}`,
      'gi'
    ),
    read: (m, today) => {
      const n = num(m[1])
      if (!(n > 0)) return null
      const unit = m[2].toLowerCase().replace(/s$/, '')
      const from =
        unit === 'day'
          ? addDaysKey(today, -(n - 1))
          : unit === 'week'
            ? addDaysKey(today, -(7 * n - 1))
            : addDaysKey(addMonths(today, unit === 'month' ? -n : -12 * n), 1)
      return { from, to: today, label: `the last ${spell(n)} ${unit}${n === 1 ? '' : 's'}` }
    },
  },
  {
    re: new RegExp(`\\b${PRE}(this|last)\\s+(month|year)${END}`, 'gi'),
    read: (m, today) => {
      const [ty, tm] = parts(today)
      const which = m[1].toLowerCase()
      const label = `${which} ${m[2].toLowerCase()}`
      if (m[2].toLowerCase() === 'year') {
        const y = which === 'this' ? ty : ty - 1
        return { from: ymd(y, 0, 1), to: ymd(y, 11, 31), label }
      }
      const [y, mo] = which === 'this' ? [ty, tm] : parts(addMonths(ymd(ty, tm, 1), -1))
      return { from: ymd(y, mo, 1), to: lastOfMonth(y, mo), label }
    },
  },
  {
    re: new RegExp(
      `\\b(?:in|during|throughout)\\s+(?:(${MON})(?:,?\\s+(${YEAR}))?|(${YEAR}))${END}`,
      'gi'
    ),
    read: (m, today) => {
      if (m[3]) {
        const y = Number(m[3])
        return { from: ymd(y, 0, 1), to: ymd(y, 11, 31), label: `in ${y}` }
      }
      const mo = monthIndex(m[1])
      const s = m[2]
        ? { start: ymd(Number(m[2]), mo, 1), end: lastOfMonth(Number(m[2]), mo) }
        : latestMonth(mo, today)
      const y = s.start.slice(0, 4)
      const label = `in ${MONTH_NAMES[mo]}${y === today.slice(0, 4) ? '' : ` ${y}`}`
      return { from: s.start, to: s.end, label }
    },
  },
  {
    re: new RegExp(`\\b${PRE}(yesterday|today)${END}`, 'gi'),
    read: (m, today) =>
      m[1].toLowerCase() === 'today'
        ? { from: today, to: today, label: 'today' }
        : { from: addDaysKey(today, -1), to: addDaysKey(today, -1), label: 'yesterday' },
  },
]

const heal = (text: string): string =>
  text
    .replace(/\s+([?.!,;])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()

/** The question's stretch of time, and the question with that phrase (and any
    week phrase) removed — so subject matching never mistakes "gym since
    August 1" for a title fragment. */
export function readRange(question: string, todayKey: string): { range: DayRange; rest: string } {
  for (const { re, read } of MATCHERS) {
    for (const m of question.matchAll(re)) {
      const hit = read(m, todayKey)
      if (!hit) continue
      const future = hit.from > todayKey
      const long = daysBetween(hit.from, hit.to) + 1 > RANGE_CAP_DAYS
      const range: DayRange = {
        fromDayKey: long ? addDaysKey(hit.to, -(RANGE_CAP_DAYS - 1)) : hit.from,
        toDayKey: hit.to,
        label: hit.label,
        kind: 'days',
        weekOffset: 0,
        capped: long,
        future,
      }
      const at = m.index ?? 0
      const rest = stripWeekPhrase(
        heal(`${question.slice(0, at)} ${question.slice(at + m[0].length)}`)
      )
      return { range, rest }
    }
  }
  const offset = weekOffsetFromQuestion(question)
  const days = weekKeys(fromDayKey(todayKey), offset)
  return {
    range: {
      fromDayKey: days[0],
      toDayKey: days[6],
      label: weekOffsetLabel(offset),
      kind: 'week',
      weekOffset: offset,
      capped: false,
      future: false,
    },
    rest: stripWeekPhrase(question),
  }
}

/** Which stretch of days a history question means (see the grammar above). */
export function rangeFromQuestion(question: string, todayKey: string): DayRange {
  return readRange(question, todayKey).range
}

/** `question` without its time phrase — spacing and punctuation healed. */
export function stripRangePhrase(question: string, todayKey: string): string {
  return readRange(question, todayKey).rest
}

/** Every day key of the range, first to last. */
export function rangeDayKeys(range: DayRange): string[] {
  const n = daysBetween(range.fromDayKey, range.toDayKey)
  return Array.from({ length: Math.max(0, n + 1) }, (_, i) => addDaysKey(range.fromDayKey, i))
}

/** The range's first day the way a reply names it ("Aug 1", "Oct 5, 2027"). */
export function rangeStartLabel(range: DayRange, todayKey: string): string {
  return fmtDay(range.fromDayKey, todayKey)
}
