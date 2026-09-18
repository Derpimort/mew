/* Deterministic talk-to-schedule parser — the no-key floor under the model
   adapters (PRD §9: everything degrades gracefully). The Claude adapter
   produces the same ScheduleIntent through strict tool use. */

import type { ScheduleIntent, Tag } from './types'
import { dayKey, fromDayKey, weekdayOffset } from './time'
import { parseClockRange } from './split'

const PARTS: Record<string, { start: number; end: number }> = {
  morning: { start: 9 * 60, end: 12 * 60 },
  afternoon: { start: 13 * 60, end: 17 * 60 },
  evening: { start: 18 * 60, end: 21 * 60 },
}

const PRIVATE_WORDS =
  /\b(walk|run|gym|yoga|swim|lunch|dinner|family|kids?|friends?|groceries|errand|date|movie|read(ing)?)\b/i
const HEALTH_WORDS = /\b(doctor|dentist|therapy|checkup|meditat|health)\b/i
const REST_WORDS = /\b(rest|break|recover|nap|unwind|off)\b/i

export function inferTag(title: string): Tag {
  if (REST_WORDS.test(title)) return 'rest'
  if (HEALTH_WORDS.test(title)) return 'health'
  if (PRIVATE_WORDS.test(title)) return 'private'
  return 'work'
}

function parseDayOffset(text: string, now: Date): { offset: number; matched: string } | null {
  const lower = text.toLowerCase()
  if (/\btoday\b/.test(lower)) return { offset: 0, matched: 'today' }
  if (/\btomorrow\b/.test(lower)) return { offset: 1, matched: 'tomorrow' }
  const m = lower.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/
  )
  if (m) {
    const off = weekdayOffset(m[1], now)
    if (off != null) return { offset: off, matched: m[1] }
  }
  return null
}

/** #62: the day a remove is pinned to, read ONLY from a day PHRASE — a bare
    today / tomorrow, "on <weekday>", "<weekday>'s", or "this <weekday>" past the
    phrase's first word. A pin is a hard filter, so a weekday word that belongs
    to a TITLE ("the Friday demo", "Sun salutation", "remove this Friday demo")
    must never become one; nor does "next <weekday>" (this week's or the one
    after is the owner's call). Unpinned is always safe: a time that repeats
    across days asks with day chips, and those chips speak "on <weekday>". */
const REMOVE_DOW =
  '(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)'

function removeDayPin(text: string, now: Date): number | null {
  const lower = text.toLowerCase()
  if (/\btoday\b/.test(lower)) return 0
  if (/\btomorrow\b/.test(lower)) return 1
  const m =
    lower.match(new RegExp(`\\bon\\s+${REMOVE_DOW}\\b`)) ??
    // a possessive after "next" names next week's day, which never pins (#72 review)
    lower.match(new RegExp(`(?<!\\bnext\\s+)\\b${REMOVE_DOW}['’]s\\b`)) ??
    lower.match(new RegExp(`\\S\\s+this\\s+${REMOVE_DOW}\\b`))
  return m ? weekdayOffset(m[1], now) : null
}

/** #72: the day phrases a remove reads as a DAY are not part of the title —
    "this <weekday>" past the phrase's first word and a possessive "<weekday>'s"
    (both pin, above), plus "next <weekday>" (a day, left unpinned). Lift each
    out whole — a possessive with its qualifier ("next thursday's") — so "the
    lunch this thursday" asks for "lunch", never "lunch this". Only a WEEKDAY
    makes the phrase: "this morning" or "next week" stays in the query. A weekday
    word outside those phrases ("the friday demo", "Sun salutation") is untouched
    here — it stays the title's, exactly as before. */
function stripRemoveDayPhrases(text: string): string {
  return (
    text
      .replace(new RegExp(`(?:\\b(?:this|next)\\s+)?\\b${REMOVE_DOW}['’]s\\b`, 'gi'), ' ')
      .replace(new RegExp(`(\\S)\\s+(?:this|next)\\s+${REMOVE_DOW}\\b`, 'gi'), '$1 ')
      /* #160: "on <weekday>" too, which removeDayPin has always PINNED but this
         did not lift — remove got away with it because its own path runs
         stripTimeWords afterwards and that swallowed the phrase. Move has no such
         downstream strip, so the reader has to be complete rather than rely on a
         second pass one caller happens to have. Remove is unchanged in effect:
         the phrase leaves here instead of two steps later. */
      .replace(new RegExp(`(\\S)\\s+on\\s+${REMOVE_DOW}\\b`, 'gi'), '$1 ')
  )
}

/** #72 peer review: "next <weekday>" names a day MEW never pins (this week's or
    the one after is the owner's call), so it may never WIDEN a remove — with it,
    "all"/"every" is dropped and the ask takes the day-chip path, exactly as
    "remove the lunch next thursday" does. A bulk remove only ever sweeps a day
    the owner pinned, or every day when they named none. */
function namesUnpinnedDay(text: string): boolean {
  return new RegExp(`\\bnext\\s+${REMOVE_DOW}\\b`, 'i').test(text)
}

function parseTime(text: string): number | null {
  const m = text.toLowerCase().match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  if (m[3] === 'pm' && h < 12) h += 12
  if (m[3] === 'am' && h === 12) h = 0
  return h * 60 + min
}

/** A move/edit DESTINATION time — "at 9" (via parseTime) plus a bare "4pm",
    "4:30pm", or 24h "16:00", so "move it to 4pm" lands at 16:00 without an
    "at". A bare hour with no am/pm stays out (2 is 2am or 2pm — ambiguous). */
function parseDestTime(text: string): number | null {
  const viaAt = parseTime(text)
  if (viaAt != null) return viaAt
  const ap = text.toLowerCase().match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
  if (ap) {
    let h = Number(ap[1])
    const min = ap[2] ? Number(ap[2]) : 0
    if (ap[3] === 'pm' && h < 12) h += 12
    if (ap[3] === 'am' && h === 12) h = 0
    return h * 60 + min
  }
  const hhmm = text.match(/\b(\d{1,2}):(\d{2})\b/)
  return hhmm ? Number(hhmm[1]) * 60 + Number(hhmm[2]) : null
}

/** Pull a TARGET block's start time out of a query phrase (#334) — "release at
    19:45", "the 19:45 release", "the 4pm standup" — and return it as a canonical
    H:MM string plus the phrase with the time removed (so the leftover is the
    title). This is the name+time handle edit/move/complete target by; the
    executor's own clock parser (prefs.parseTimeValue) reads the canonical value,
    the single authority. Distinct from a DESTINATION time (parseDestTime), which
    a move reads from the other side of "to". */
function extractTargetAt(text: string): { at?: string; rest: string } {
  const bare = text.match(/\b(\d{1,2}):(\d{2})\b/)
  const atMin =
    parseTime(text) ?? parseDestTime(text) ?? (bare ? Number(bare[1]) * 60 + Number(bare[2]) : null)
  if (atMin == null) return { rest: text }
  const at = `${Math.floor(atMin / 60)}:${String(atMin % 60).padStart(2, '0')}`
  const rest = text
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i, ' ') // "at 19:45" / "at 9am"
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ') // bare "19:45"
    .replace(/\b\d{1,2}\s*(?:am|pm)\b/i, ' ') // bare "4pm"
  return { at, rest }
}

/* "in the background" / "bg task" / "while I work" — holds the clock, not the user */
const BG_CUE = /\b(?:in the background|background|bg task|while i work)\b/i
/* #117: the evening, said the way people say it. With no clock time it's the
   evening WINDOW (from the classic day's end, inside the plannable hours), not
   the fixed 18:00 "evening" part, and the phrase never stays in the title */
const EVENING_CUE = /\b(?:tonight|this\s+evening|after\s+dinner)(?:['’]s)?\b/i // "tonight's reading" too

/* "due by 1pm" / "due 13:00" / "must finish by 1" — a hard deadline, distinct
   from the block's end. Bare hours ≤ 7 read as afternoon (a 1pm world). */
const DUE_CUE =
  /\b(?:due(?:\s+(?:by|at))?|(?:must\s+(?:be\s+)?)?(?:finish(?:ed)?|done)\s+by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i

function parseDue(text: string): number | null {
  const m = text.match(DUE_CUE)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12
  if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0
  if (!m[3] && h >= 1 && h <= 7) h += 12 // "due 1" means 13:00, not dawn
  return h * 60 + min
}

function stripAttentionWords(s: string): string {
  return s.replace(BG_CUE, ' ').replace(DUE_CUE, ' ')
}

function parseDuration(text: string): number | null {
  const h = text.match(/\b(\d+(?:\.\d+)?)\s*h(?:ours?)?\b/i)
  if (h) return Math.round(Number(h[1]) * 60)
  const m = text.match(/\b(\d+)\s*m(?:in(?:utes?)?)?\b/i)
  if (m) return Number(m[1])
  return null
}

function parsePart(text: string): { start: number; end: number; matched: string } | null {
  const m = text.toLowerCase().match(/\b(morning|afternoon|evening)\b/)
  return m ? { ...PARTS[m[1]], matched: m[1] } : null
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/\b(the|a|an)\s+/i, (s, _g, offset) => (offset === 0 ? '' : s))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Strip scheduling words so they never leak into block titles. */
function stripTimeWords(s: string): string {
  return s
    .replace(
      /\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|morning|afternoon|evening)\b/gi,
      ' '
    )
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*h(?:ours?)?\b/gi, ' ')
    .replace(/\b\d+\s*m(?:in(?:utes?)?)?\b/gi, ' ')
    .replace(/\bon\s*$/i, ' ')
}

/** Split a multi-clause command on commas / " and " (but not inside short titles). */
function clauses(text: string): string[] {
  return text
    .split(/,| and (?=(?:block|keep|move|add|schedule|free|hold)\b)/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

/* "gym is always at 7am" → a structured rule. Deliberate shapes only;
   anything else lands as kind:'fact' with the words kept verbatim. */
function parsePref(raw: string): NonNullable<ScheduleIntent['pref']> {
  const text = raw.trim().replace(/\.+$/, '')
  const stated = text
  const timeM = text.match(
    /^(.*?)\s+(?:is|are|starts?|happens?)\s+always\s+(?:at\s+)?(\d{1,2}(?::(\d{2}))?)\s*(am|pm)?$/i
  )
  if (timeM) {
    let h = Number(timeM[2].split(':')[0])
    const min = timeM[2].includes(':') ? Number(timeM[2].split(':')[1]) : 0
    if (timeM[4]?.toLowerCase() === 'pm' && h < 12) h += 12
    if (timeM[4]?.toLowerCase() === 'am' && h === 12) h = 0
    return {
      kind: 'time-default',
      match: timeM[1].replace(/^(the|my)\s+/i, '').trim(),
      value: `starts ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
      stated,
    }
  }
  const durM = text.match(
    /^(.*?)\s+(?:always\s+|really\s+)?takes\s+(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hours?)\b/i
  )
  if (durM) {
    const n = Number(durM[2])
    const mins = /^h/i.test(durM[3]) ? Math.round(n * 60) : Math.round(n)
    return {
      kind: 'duration-default',
      match: durM[1].replace(/^(the|my)\s+/i, '').trim(),
      value: `${mins}m`,
      stated,
    }
  }
  const flexM = text.match(/^(.*?)\s+(never|always)\s+(?:moves?|can move|flexes)$/i)
  if (flexM) {
    return {
      kind: 'flexibility',
      match: flexM[1].replace(/^(the|my)\s+/i, '').trim(),
      value: flexM[2].toLowerCase() === 'never' ? 'never moves' : 'can always move',
      stated,
    }
  }
  const ordM = text.match(/^(.*?)\s+(?:always\s+)?(?:comes?\s+|goes?\s+)?(before|after)\s+(.+)$/i)
  if (ordM) {
    return {
      kind: 'ordering',
      match: ordM[1].replace(/^(the|my)\s+/i, '').trim(),
      value: `${ordM[2].toLowerCase()} ${ordM[3].trim()}`,
      stated,
    }
  }
  /* #321 — energy-fit's two standing rules. "batch my admin" / "keep admin
     quick (and dusted)" clusters low-focus work; canonical ordering rule read
     by prefs.batchAdminRule. */
  if (/\badmin\b/i.test(text) && /\b(batch|batched|batching|quick|dusted)\b/i.test(text)) {
    return { kind: 'ordering', match: 'admin', value: 'batch', stated }
  }
  /* "I do deep work anytime" / "don't gate my mornings" frees deep work from
     any window; canonical flexibility rule read by prefs.deepWorkAnytime. */
  const deepAnytime =
    (/\bdeep\s+work\b/i.test(text) && /\bany\s?time\b/i.test(text)) ||
    (/\bdon'?t\s+gate\b/i.test(text) && /\bmornings?\b/i.test(text)) ||
    (/\bmornings?\b/i.test(text) && /\b(?:aren'?t|not|un-?)\s*gated\b/i.test(text))
  if (deepAnytime) {
    return { kind: 'flexibility', match: 'deep work', value: 'anytime', stated }
  }
  const subject = cleanTitle(text.split(/\s+(?:is|are|means|=)\s+/i)[0]).slice(0, 40)
  return { kind: 'fact', match: subject || 'note', value: text, stated }
}

/* ── conversational referents (#320) ──────────────────────────────────────
   A follow-up that names no block ("move it earlier", "make that 45", "the one
   after lunch") leans on the session's last-touched block, or points at the
   live week by position. parse.ts only NAMES the target as a sentinel string in
   `query`; week.resolveReferent turns a sentinel into a concrete block id
   against the live week — ONE resolver for the keyed and keyless paths alike,
   so the two never drift. Relative deltas ride the intent as signed minutes;
   the executor does the math after resolution, against the referent's current
   start/duration (today move/edit read the live block, parse.ts stays pure). */

/** Deictic sentinel: "it/that/this" with no other noun → the last-touched
    block. week.resolveReferent swaps it for the session's lastReferent id. */
export const REFERENT = '@referent'

const DEICTIC =
  /^(it|that|this|that one|this one|the one|the block|the thing|it again|the same( one)?|the last (one|thing)( i (added|made|placed|created|did))?|the (one|thing) i just (added|made|placed|created|did))$/i
const NEXT_ONE = /^(my |the )?next( (block|one|thing|task|up|meeting|event))?$/i
const AT_TIME = /^the (\d{1,2})(:(\d{2}))?\s*(am|pm)?( (block|one|meeting|thing|slot|event))?$/i
const AFTER_ONE =
  /^(the )?(one |block |task |thing |meeting |event )*(right )?after (the |my )?(.+)$/i
const BEFORE_ONE =
  /^(the )?(one |block |task |thing |meeting |event )*(right )?before (the |my )?(.+)$/i

/** Strip a trailing generic noun + stray punctuation off a positional anchor,
    so "after the standup block" anchors on "standup". */
function anchorText(raw: string): string {
  return raw
    .replace(/[?.!,]+$/, '')
    .replace(/\s+(block|one|thing|task|meeting|event)$/i, '')
    .trim()
}

/** A bare/pronoun/positional target phrase → a resolver sentinel, or null when
    the phrase names a real title (then the caller resolves it the ordinary
    way). Pure text → sentinel; no week is consulted here. */
export function referentQuery(phrase: string): string | null {
  const p = phrase
    .trim()
    .replace(/^please\s+/i, '')
    .replace(/[?.!]+$/, '')
    .trim()
  if (!p) return null
  if (DEICTIC.test(p)) return REFERENT
  if (NEXT_ONE.test(p)) return '@next'
  const at = p.match(AT_TIME)
  if (at) {
    let h = Number(at[1])
    const min = at[3] ? Number(at[3]) : 0
    const ap = at[4]?.toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    if (!ap && h >= 1 && h <= 7) h += 12 // "the 3" reads pm in a 1pm world
    return `@at:${h * 60 + min}`
  }
  const af = p.match(AFTER_ONE)
  if (af) return `@after:${anchorText(af[5])}`
  const bf = p.match(BEFORE_ONE)
  if (bf) return `@before:${anchorText(bf[5])}`
  return null
}

/* batch (#75): wide changes, keyless.
   · a shift: "push everything after 3pm back an hour", "pull all work before
     noon 30 min earlier", "push all "deck" after 9:00 and before 12:00 on
     thursday later by 30 min"
   · a move to another day: "move all of today's work to tomorrow", "move all
     thursday's deck review blocks to friday", "move all my blocks to friday"
   Each needs a batch word: "everything", a tag, quoted title words, "blocks",
   "my", a start window, a day's possessive or "of". So "push all hands back an
   hour" and "move all hands to friday" stay single-block moves. A confirm chip
   re-asks in these words for every selector a batch can hold (both edges, quoted
   title words, a date past this week), ending " — yes, all N · TOKEN": the count
   and the list token the owner said yes to. */
const BATCH_TAGS: Tag[] = ['work', 'private', 'health', 'rest']
const BATCH_YES = /\s*[—–-]+\s*yes,?\s+all\s+(\d+)(?:\s*·\s*([a-z0-9]+))?\s*$/
const BATCH_CLOCK = String.raw`noon|\d{1,2}(?::\d{2})?\s*(?:am|pm)?`
const BATCH_WINDOW = String.raw`(?:\s+after\s+(${BATCH_CLOCK}))?(?:\s+(?:and\s+)?before\s+(${BATCH_CLOCK}))?`
const BATCH_SHIFT = new RegExp(
  String.raw`^(?:push|move|shift|bring|pull)\s+(everything|all(?:\s+(work|private|health|rest))?(?:\s+"([^"]*)")?(?:\s+(blocks))?)` +
    BATCH_WINDOW +
    String.raw`(?:\s+(today|tomorrow|on\s+(?:[a-z]+|\d{4}-\d{2}-\d{2})))?\s+(.+)$`
)
/* a shift's tail, read strictly: an amount and a direction ("back an hour",
   "30 min earlier", "later by 60 min"), then optionally the day. Any other word
   left over ("after lunch", "this afternoon") means the ask isn't one MEW can
   line up exactly, so it asks rather than guess the whole day */
const SHIFT_AMOUNT = String.raw`(?:\d+(?:\.\d+)?\s*(?:h|hr|hrs|hours?|m|mins?|minutes?)?|an\s+hour|half\s+an\s+hour)`
const SHIFT_DIR = String.raw`(?:later|back|backwards?|forward|out|delayed?|earlier|sooner|up)`
const BATCH_SHIFT_TAIL = new RegExp(
  String.raw`^(?:${SHIFT_DIR}\s+(?:by\s+)?${SHIFT_AMOUNT}|${SHIFT_AMOUNT}\s+${SHIFT_DIR})(?:\s+(today|tomorrow|on\s+(?:[a-z]+|\d{4}-\d{2}-\d{2})))?$`
)
const BATCH_MOVE = new RegExp(
  String.raw`^move\s+all\s+(of\s+)?(?:(today's|tomorrow's|[a-z]+day's|\d{4}-\d{2}-\d{2}'s)\s+)?(.+?)` +
    BATCH_WINDOW +
    String.raw`\s+to\s+(today|tomorrow|(?:on\s+)?[a-z]+day|(?:on\s+)?\d{4}-\d{2}-\d{2})$`
)

const BATCH_TAG = new RegExp(
  String.raw`^(?:tag|retag|mark)\s+all\s+(of\s+)?(?:(today's|tomorrow's|[a-z]+day's|\d{4}-\d{2}-\d{2}'s)\s+)?(.+?)` +
    BATCH_WINDOW +
    String.raw`\s+as\s+(work|private|health|rest)$`
)

/* "between 2 and 5pm" is the two-edge window "after 2pm and before 5pm" (#75
   slice 2): a bare first hour takes the second's half of the day when it comes
   earlier on the clock ("between 2 and 5pm"), and the other half when it can't
   ("between 11 and 1pm" is 11am to 1pm) */
const BETWEEN = new RegExp(String.raw`\bbetween\s+(${BATCH_CLOCK})\s+and\s+(${BATCH_CLOCK})\b`)
function betweenAsEdges(text: string): string {
  return text.replace(BETWEEN, (_m, a: string, b: string) => {
    const from = a.trim()
    const to = b.trim()
    const half = to.match(/(am|pm)$/)?.[1]
    const bareFrom = from.match(/^(\d{1,2})(?::\d{2})?$/)
    const toHour = Number(to.match(/^(\d{1,2})/)?.[1] ?? NaN)
    const fromHour = bareFrom ? Number(bareFrom[1]) : NaN
    let first = from
    if (half && bareFrom && fromHour >= 1 && fromHour <= 12) {
      const same = fromHour % 12 <= toHour % 12
      first = `${from}${same ? half : half === 'pm' ? 'am' : 'pm'}`
    }
    /* the clock's optional am/pm can swallow the space after it: give it back */
    return `after ${first} and before ${to}${b.slice(b.trimEnd().length)}`
  })
}

/** "3pm" · "3:30pm" · "15:00" · "noon" → minutes; a bare "3" is ambiguous → null */
function batchClock(s: string): number | null {
  const t = s.trim().toLowerCase()
  if (t === 'noon') return 12 * 60
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!m) return null
  const h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  if (min > 59) return null
  if (m[3]) {
    if (h < 1 || h > 12) return null
    return ((h % 12) + (m[3] === 'pm' ? 12 : 0)) * 60 + min
  }
  if (m[2] || h >= 13) return h <= 23 ? h * 60 + min : null
  return null
}

function parseBatch(text: string, now: Date): ScheduleIntent | null {
  let lower = text.trim().toLowerCase()
  let confirmCount: number | undefined
  let confirmToken: string | undefined
  const yes = lower.match(BATCH_YES)
  if (yes && yes.index != null) {
    confirmCount = Number(yes[1])
    confirmToken = yes[2]
    lower = lower.slice(0, yes.index).trim()
  }
  lower = betweenAsEdges(lower)
  const confirm = {
    ...(confirmCount != null ? { confirmCount } : {}),
    ...(confirmToken ? { confirmToken } : {}),
  }
  /* a day word, weekday or (for a day past this week) a date, as days from today */
  const dayOf = (phrase: string | undefined): number | undefined => {
    if (!phrase) return undefined
    const p = phrase.replace(/^on\s+/, '').replace(/'s$/, '')
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) {
      const today = dayKey(now)
      if (dayKey(fromDayKey(p)) !== p) return undefined
      const off = Math.round((fromDayKey(p).getTime() - fromDayKey(today).getTime()) / 86_400_000)
      return off >= 0 && off <= 13 ? off : undefined
    }
    const d = parseDayOffset(p, now)
    return d ? d.offset : undefined
  }
  /* a start window; a bare hour ("after 3") is 3am or 3pm: ask, rather than read
     a block called "everything after 3" */
  const windowOf = (after?: string, before?: string) => {
    const bare = [after, before].find((c) => c != null && /^\d{1,2}$/.test(c.trim()))
    if (bare)
      return {
        ask: {
          kind: 'chat' as const,
          reply: `after ${bare.trim()}am or ${bare.trim()}pm? say "after ${bare.trim()}pm" and I'll line them up.`,
        },
      }
    const afterMin = after != null ? batchClock(after) : undefined
    const beforeMin = before != null ? batchClock(before) : undefined
    if (afterMin === null || beforeMin === null) return null
    return {
      window: {
        ...(afterMin != null ? { afterMin } : {}),
        ...(beforeMin != null ? { beforeMin } : {}),
      },
    }
  }

  /* a shift: minutes later or earlier, the same day */
  const shiftM = lower.match(BATCH_SHIFT)
  const deltaMin = shiftM ? parseTimeShift(shiftM[8]) : null
  if (shiftM && deltaMin != null) {
    const [, who, tag, quoted, blocks, after, before, dayBefore, tail] = shiftM
    if (who === 'all' && !tag && quoted == null && !blocks && after == null && before == null)
      return null
    const win = windowOf(after, before)
    if (!win) return null
    if (win.ask) return win.ask
    const strict = tail.match(BATCH_SHIFT_TAIL)
    if (!strict || (dayBefore && strict[1]))
      return {
        kind: 'chat',
        reply: `I can move them together with a start time and a day, like "push everything after 3pm back an hour tomorrow".`,
      }
    const day = dayBefore ?? strict[1]
    const dayOffset = dayOf(day)
    if (day && dayOffset == null) return null
    return {
      kind: 'batch',
      batch: {
        ...(dayOffset != null ? { dayOffset } : {}),
        ...win.window,
        ...(tag ? { tag: tag as Tag } : {}),
        ...(quoted?.trim() ? { titleQuery: quoted.trim() } : {}),
        op: 'shift',
        deltaMin,
        ...confirm,
      },
    }
  }

  /* a move to another day, same clock: "move all [of] [day's] [my] <tag |
     "title words" | title words blocks | blocks> [window] to <day>" */
  /* the selection a move or a retag names: "[of] [day's] [my] <tag | "title words" |
     title words blocks | blocks> [window]" (#75 slice 1, shared by slice 2) */
  const readSelection = (
    of: string | undefined,
    fromDay: string | undefined,
    whatIn: string,
    after: string | undefined,
    before: string | undefined
  ):
    | { ask: ScheduleIntent }
    | {
        sel: {
          tag?: Tag
          titleQuery?: string
          dayOffset?: number
          afterMin?: number
          beforeMin?: number
        }
      }
    | null => {
    const fromOffset = dayOf(fromDay)
    if (fromDay && fromOffset == null) return null
    const mine = /^my\s+/.test(whatIn)
    const what = whatIn.replace(/^my\s+/, '').trim()
    const quoted = what.match(/^(?:(work|private|health|rest)\s+)?"([^"]*)"(?:\s+blocks?)?$/)
    const bare = what.replace(/\s+blocks?$/, '')
    const named: { tag?: Tag; titleQuery?: string } = quoted
      ? {
          ...(quoted[1] ? { tag: quoted[1] as Tag } : {}),
          ...(quoted[2].trim() ? { titleQuery: quoted[2].trim() } : {}),
        }
      : /^blocks?$/.test(what)
        ? {}
        : BATCH_TAGS.includes(bare as Tag)
          ? { tag: bare as Tag }
          : { titleQuery: bare }
    /* "move all hands to friday" is one block called All hands, not a batch */
    const signal =
      !!of ||
      !!fromDay ||
      mine ||
      after != null ||
      before != null ||
      !!quoted ||
      /^blocks?$/.test(what) ||
      bare !== what ||
      named.tag != null
    if (!signal || !what) return null
    const win = windowOf(after, before)
    if (!win) return null
    if (win.ask) return { ask: win.ask }
    return {
      sel: { ...(fromOffset != null ? { dayOffset: fromOffset } : {}), ...win.window, ...named },
    }
  }

  /* a move to another day, same clock: "move all [of] [day's] <selection> to <day>" */
  const moveM = lower.match(BATCH_MOVE)
  if (moveM) {
    const [, of, fromDay, whatIn, after, before, toDay] = moveM
    const toDayOffset = dayOf(toDay)
    if (toDayOffset == null) return null
    const read = readSelection(of, fromDay, whatIn, after, before)
    if (!read) return null
    if ('ask' in read) return read.ask
    return { kind: 'batch', batch: { ...read.sel, op: 'moveToDay', toDayOffset, ...confirm } }
  }

  /* a retag, in place (#75 slice 2): "tag all [of] [day's] <selection> as <tag>" */
  const tagM = lower.match(BATCH_TAG)
  if (tagM) {
    const [, of, fromDay, whatIn, after, before, toTag] = tagM
    const read = readSelection(of, fromDay, whatIn, after, before)
    if (!read) return null
    if ('ask' in read) return read.ask
    return {
      kind: 'batch',
      batch: { ...read.sel, op: 'setTag', toTag: toTag as Tag, ...confirm },
    }
  }
  return null
}

/** "undo", "undo that", "no, put it back", "take that back", "revert it" —
    the whole message, with an optional lead-in ("no", "oops", "actually") and a
    closing "please" (#118). */
const UNDO_ASK =
  /^(?:(?:no|oops|actually|wait|hmm)[,.!]*\s+)?(?:undo(?:\s+(?:that|it|this|the\s+last\s+(?:one|change|step)))?|put\s+(?:it|that|them)\s+back|take\s+(?:it|that)\s+back|revert\s+(?:that|it))(?:[,\s]+please)?[.!]*$/

/** A relative TIME shift for move — signed minutes, needing both an amount
    ("30 min", "an hour", "half an hour") and a direction (earlier/later, push
    back, move up). Returns null when either is missing, so a plain duration
    ("90m") or a directionless mention ("in an hour") never reads as a shift. */
function parseTimeShift(text: string): number | null {
  const t = text.toLowerCase()
  const earlier = /\b(earlier|sooner)\b/.test(t) || /\bup\b/.test(t)
  const later = /\b(later|back|backwards?|forward|out|delayed?)\b/.test(t)
  if (!earlier && !later) return null
  let amount: number | null = null
  const num = t.match(/(\d+(?:\.\d+)?)\s*(h(?:ours?|r)?|m(?:in(?:utes?)?)?)?\b/)
  if (num) {
    const unit = num[2] ?? 'm'
    amount = /^h/.test(unit) ? Math.round(parseFloat(num[1]) * 60) : Math.round(parseFloat(num[1]))
  } else if (/\bhalf an hour\b/.test(t)) amount = 30
  else if (/\ban hour\b/.test(t)) amount = 60
  if (amount == null || amount <= 0) return null
  const sign = earlier && !later ? -1 : 1
  return sign * amount
}

/** A relative or absolute DURATION edit aimed at a referent/positional target
    ("make it 45", "make that 90 min", "make it longer", "give it another 30",
    "extend it by an hour"). Returns null when the target names a real title —
    the caller then falls through to the ordinary named-edit grammar so
    "make the release 45" is byte-unchanged. */
/** A duration amount in minutes from a phrase — "45", "45 min", "1.5h", "an
    hour", "half an hour". null when no amount is stated (the caller defaults). */
function parseDurAmount(text: string): number | null {
  const t = text.trim().toLowerCase()
  const num = t.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?\b/)
  if (num)
    return /^h/.test(num[2] ?? '')
      ? Math.round(parseFloat(num[1]) * 60)
      : Math.round(parseFloat(num[1]))
  if (/^half an hour\b/.test(t)) return 30
  if (/^an hour\b/.test(t)) return 60
  return null
}

/** A relative/absolute duration edit aimed at a referent/positional target
    ("make it 45", "make that 90 min", "make it longer", "give it another 30",
    "extend it by an hour"). Returns null when the target names a real title —
    the caller falls through to the named-edit grammar so "make the release 45"
    is byte-unchanged. */
function parseReferentEdit(text: string): ScheduleIntent | null {
  // relative: "make/give it [N] longer|shorter" (bare ⇒ ±15)
  let m = text.match(
    /^(?:make|set|give|keep)\s+(.+?)(?:\s+(.+?))?\s+(longer|shorter|bigger|smaller)$/i
  )
  if (m) {
    const q = referentQuery(m[1])
    if (q) {
      const amt = m[2] ? (parseDurAmount(m[2]) ?? 15) : 15
      const sign = /longer|bigger/i.test(m[3]) ? 1 : -1
      return { kind: 'edit', query: q, edit: { relDurationMin: sign * amt } }
    }
  }
  // relative: "give it another 30 (min)" / "give it another hour"
  m = text.match(/^give\s+(.+?)\s+another\s+(.+)$/i)
  if (m) {
    const q = referentQuery(m[1])
    const amt = parseDurAmount(m[2])
    if (q && amt != null) return { kind: 'edit', query: q, edit: { relDurationMin: amt } }
  }
  // relative: "extend it (by an hour)" / "shorten it (by 15)" — bare defaults 30
  m = text.match(/^(extend|lengthen|stretch|shorten|trim|shrink)\s+(.+?)(?:\s+by\s+(.+))?$/i)
  if (m) {
    const q = referentQuery(m[2])
    if (q) {
      const sign = /^(extend|lengthen|stretch)/i.test(m[1]) ? 1 : -1
      const amt = m[3] != null ? (parseDurAmount(m[3]) ?? 30) : 30
      return { kind: 'edit', query: q, edit: { relDurationMin: sign * amt } }
    }
  }
  // absolute: "make it 45 (min)" / "make that 90 minutes" (bare number ⇒ minutes)
  m = text.match(
    /^(?:make|set|resize|change)\s+(.+?)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?$/i
  )
  if (m) {
    const q = referentQuery(m[1])
    if (q) {
      const dur = /^h/i.test(m[3] ?? '')
        ? Math.round(parseFloat(m[2]) * 60)
        : Math.round(parseFloat(m[2]))
      return { kind: 'edit', query: q, edit: { durationMin: dur } }
    }
  }
  return null
}

/** A NAMED-target resize (#335) — the duration-only nudge the referent grammar
    (parseReferentEdit) handles for "it/that" but that falls to a WRONG absolute
    edit when the target is named: "make the deck 30 min longer" would drop the
    "longer" and set 30. Here a named target + a longer/shorter suffix (or an
    explicit resize/stretch/shorten verb with "by") yields a RELATIVE resize, and
    "resize X to N" an absolute one. Returns null for a referent target
    (parseReferentEdit owns those) and for the plain "make X N min" absolute edit
    (durEdit owns that, unchanged), so nothing existing regresses. */
function parseResize(text: string): ScheduleIntent | null {
  const mk = (
    raw: string,
    resize: { durationMin?: number; relDurationMin?: number }
  ): ScheduleIntent | null => {
    if (referentQuery(raw)) return null // a referent resize stays an edit (parseReferentEdit)
    const { at, rest } = extractTargetAt(raw)
    const query = cleanTitle(stripTimeWords(rest))
    if (!query) return null
    return { kind: 'resize', query, ...(at ? { at } : {}), resize }
  }
  // "make/set/resize <target> [N unit] longer|shorter|bigger|smaller" (bare ⇒ ±15)
  let m = text.match(
    /^(?:make|set|resize)\s+(.+?)(?:\s+(\d+(?:\.\d+)?\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?))?\s+(longer|shorter|bigger|smaller)$/i
  )
  if (m) {
    const amt = m[2] ? (parseDurAmount(m[2]) ?? 15) : 15
    const out = mk(m[1], { relDurationMin: (/longer|bigger/i.test(m[3]) ? 1 : -1) * amt })
    if (out) return out
  }
  // "extend/lengthen/stretch/shorten/trim/shrink <target> [by <N>]" (bare ⇒ ±30) —
  // NOT the absolute "shorten X to 30m" (that has "to", left to durEdit → edit)
  m = text.match(/^(extend|lengthen|stretch|shorten|trim|shrink)\s+(.+?)(?:\s+by\s+(.+))?$/i)
  if (m && !/\bto\s+\d/i.test(m[2])) {
    const sign = /^(?:extend|lengthen|stretch)/i.test(m[1]) ? 1 : -1
    const amt = m[3] != null ? (parseDurAmount(m[3]) ?? 30) : 30
    const out = mk(m[2], { relDurationMin: sign * amt })
    if (out) return out
  }
  // "give <target> another <N>"
  m = text.match(/^give\s+(.+?)\s+another\s+(.+)$/i)
  if (m) {
    const amt = parseDurAmount(m[2])
    if (amt != null) {
      const out = mk(m[1], { relDurationMin: amt })
      if (out) return out
    }
  }
  // "resize <target> to <N> [min]" — the explicit-verb absolute form
  m = text.match(
    /^resize\s+(.+?)\s+to\s+(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?$/i
  )
  if (m) {
    const dur = /^h/i.test(m[3] ?? '')
      ? Math.round(parseFloat(m[2]) * 60)
      : Math.round(parseFloat(m[2]))
    const out = mk(m[1], { durationMin: dur })
    if (out) return out
  }
  return null
}

/** A relative move with NO absolute time (#335): bare "earlier/later" (no amount
    ⇒ the executor's default shift), "to the next free slot", or "to the next
    day". The amount-carrying "30 min earlier" stays a move (parseTimeShift,
    above); an absolute destination ("to 3pm", "to friday") stays a move too
    (guarded here). Requires a leading move verb so stray chat never trips it. */
function parseRelmove(text: string, now: Date): ScheduleIntent | null {
  const lower = text.trim().toLowerCase()
  if (!/^(?:move|push|shift|bring|pull|nudge|bump)\b/.test(lower)) return null
  // an absolute destination (a clock time or a day word) means this is an
  // ordinary move, not a relative nudge — leave it to the move grammar
  if (parseDestTime(lower) != null || parseDayOffset(lower, now) != null) return null
  const nextFree =
    /\bnext\s+(?:free\s+|open\s+|available\s+)?(?:slot|opening|time|window)\b/.test(lower) ||
    /\ba\s+new\s+slot\b/.test(lower)
  const nextDay = /\b(?:to\s+the\s+next\s+day|a\s+day\s+later|next\s+day)\b/.test(lower)
  const dir = /\b(?:earlier|sooner|forward)\b/.test(lower)
    ? 'earlier'
    : /\b(?:later|backwards?|back|out)\b/.test(lower)
      ? 'later'
      : null
  const direction: 'earlier' | 'later' | 'next_day' | 'next_free' | null = nextFree
    ? 'next_free'
    : nextDay
      ? 'next_day'
      : dir
  if (!direction) return null
  const body = text
    .trim()
    .replace(/^(?:move|push|shift|bring|pull|nudge|bump)\s+/i, '')
    .replace(
      /\bto\s+the\s+next\s+(?:free\s+|open\s+|available\s+)?(?:slot|opening|time|window|day)\b/gi,
      ' '
    )
    .replace(
      /\b(?:the\s+)?next\s+(?:free\s+|open\s+|available\s+)?(?:slot|opening|time|window|day)\b/gi,
      ' '
    )
    .replace(/\b(?:a\s+new\s+slot|a\s+day\s+later)\b/gi, ' ')
    .replace(/\b(?:earlier|sooner|later|backwards?|back|forward|out)\b/gi, ' ')
    .replace(/\bby\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const refQ = referentQuery(body)
  const { at, rest } = extractTargetAt(body)
  const query = refQ ?? cleanTitle(stripTimeWords(rest))
  if (!query) return null
  return { kind: 'relmove', query, ...(!refQ && at ? { at } : {}), relmove: { direction } }
}

/** Pull a recurring-edit scope word out of an edit/delete ask (#343) so the
    executor can apply it without re-asking, and strip the phrase so the ordinary
    edit/remove grammar parses the remainder cleanly (a trailing scope phrase must
    never pollute a title or a time). Bare "all" is left untouched — the remove
    grammar already reads it as the whole series. The phrases here are the ones
    the store's scope chips re-issue ("just this one", "this and following",
    "across the whole series") plus the natural words a user types ("from now on",
    "the whole series", "all of them"). */
export function extractSeriesScope(text: string): {
  scope?: 'this' | 'following' | 'series'
  text: string
} {
  const rules: [RegExp, 'this' | 'following' | 'series'][] = [
    [/\b(?:just|only)\s+this\s+one\b/i, 'this'],
    [/\bthis\s+one\s+only\b/i, 'this'],
    [/\bthis\s+occurrence(?:\s+only)?\b/i, 'this'],
    [/\bthis\s+and\s+(?:the\s+)?following\b/i, 'following'],
    [/\bthis\s+and\s+(?:the\s+)?(?:ones?|rest)\s+after\b/i, 'following'],
    [/\bfrom\s+(?:now|then|here)\s+on(?:ward|wards)?\b/i, 'following'],
    [/\bgoing\s+forward\b/i, 'following'],
    [/\bthe\s+rest\s+of\s+(?:the\s+|this\s+)?series\b/i, 'following'],
    [/\b(?:across|for)\s+the\s+(?:whole|entire)\s+series\b/i, 'series'],
    [/\bthe\s+(?:whole|entire)\s+series\b/i, 'series'],
    [/\ball\s+of\s+them\b/i, 'series'],
    [/\bevery\s+occurrence\b/i, 'series'],
  ]
  for (const [re, scope] of rules) {
    if (re.test(text)) {
      return {
        scope,
        text: text
          .replace(re, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim(),
      }
    }
  }
  return { text }
}

/** The typed split ask (#73). The target's own time ("the 12:00 deck", "deck
    at 12:00") pins which of several same-named blocks; the around side is a
    clock range or another block, whose time pins which ("the 1pm call"). A
    trailing day phrase (today, tomorrow, on <weekday>) pins the day. The
    rescue chip's exact ask ("…, keep 45m after") rides ahead of this grammar
    in the rules floor (rescue.ts parseSplitAsk) and never reaches here. */
const SPLIT_DAY =
  /\s+(?:on\s+)?(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)$/i

function parseSplit(text: string, now: Date): ScheduleIntent | null {
  const m = text.match(/^split\s+(.+?)\s+around\s+(.+?)\.?$/i)
  if (!m) return null
  let around = m[2].trim()
  let dayOffset: number | undefined
  const dayM = around.match(SPLIT_DAY)
  if (dayM && dayM.index != null) {
    const d = parseDayOffset(dayM[1], now)
    if (d) {
      dayOffset = d.offset
      around = around.slice(0, dayM.index).trim()
    }
  }
  /* a split chip re-asking a rescue split carries its length: ", keep 45m after" */
  let tailMin: number | undefined
  const keepM = around.match(/\s*,\s*keep\s+(\d+)\s*m(?:in(?:ute)?s?)?\s+after$/i)
  if (keepM && keepM.index != null) {
    tailMin = Number(keepM[1])
    around = around.slice(0, keepM.index).trim()
  }
  const refQ = referentQuery(m[1])
  const target = extractTargetAt(m[1])
  const query = refQ ?? cleanTitle(stripTimeWords(target.rest))
  if (!query || !around) return null
  const base = {
    kind: 'split' as const,
    query,
    ...(!refQ && target.at ? { at: target.at } : {}),
  }
  const day = {
    ...(dayOffset != null ? { dayOffset } : {}),
    ...(tailMin != null && tailMin > 0 ? { tailMin } : {}),
  }
  const range = parseClockRange(around)
  if (range) {
    return { ...base, split: { gapStartMin: range.startMin, gapEndMin: range.endMin, ...day } }
  }
  const other = extractTargetAt(around)
  const aroundQuery = cleanTitle(stripTimeWords(other.rest))
  if (!aroundQuery) return null
  return {
    ...base,
    split: { aroundQuery, ...(other.at ? { aroundAt: other.at } : {}), ...day },
  }
}

export function parseCommand(text: string, now: Date): ScheduleIntent {
  /* #343: lift any recurring-edit scope word off the top so it can't pollute the
     grammar below, then attach it to an edit/remove result — the ONLY kinds a
     scope reaches (a scope word on anything else is ignored, harmlessly). */
  const { scope, text: scoped } = extractSeriesScope(text)
  const cmd = parseCommandInner(scoped, now)
  return scope &&
    (cmd.kind === 'edit' ||
      cmd.kind === 'remove' ||
      cmd.kind === 'resize' ||
      cmd.kind === 'split' ||
      /* #75 slice 3: a sweep takes the same answer, so the scope chips can
         re-issue a batch ask ("push all work after 5pm back 30 min just this one") */
      cmd.kind === 'batch')
    ? { ...cmd, seriesScope: scope }
    : cmd
}

function parseCommandInner(text: string, now: Date): ScheduleIntent {
  const trimmed = text.trim()
  if (!trimmed) return { kind: 'chat', reply: '' }
  const lower = trimmed.toLowerCase()

  /* "undo that" (#118): the same undo the keyed model calls, never a thought
     for the inbox. Whole-message phrases only, so "put it back at 3" stays a
     move and "undo the laundry" stays whatever it was. */
  if (UNDO_ASK.test(lower)) return { kind: 'undo' }

  /* "remember that gym is always at 7am" — a rule for the standing rulebook.
     "remember to <do the thing>" is a TODO in disguise — capture intent, not
     a rule; one-off noise in the rulebook is a failure. */
  const remM = trimmed.match(/^remember\s+(?:that\s+)?(.+)$/i)
  if (remM) {
    const todoM = remM[1].match(/^to\s+(.+)$/i)
    if (todoM) return { kind: 'capture', title: cleanTitle(todoM[1]) }
    return { kind: 'remember', pref: parsePref(remM[1]) }
  }

  /* capture lead-ins (#348) — an intent for the inbox, said in chat. Strip the
     phrasing so the item is the thing itself ("call the bank"), not "remind me
     to call the bank". "remind me to/about X" and "add/put/jot X on my
     list/inbox/todos" only — the list TAIL is required, so "add lunch at 1"
     (a timed plan) never lands here; a bare timed ask stays the plan path. */
  const remindM = trimmed.match(/^remind\s+me\s+(?:to|about)\s+(.+)$/i)
  if (remindM) return { kind: 'capture', title: cleanTitle(remindM[1]) }
  const listAddM = trimmed.match(
    /^(?:add|put|jot(?:\s+down)?|save)\s+(.+?)\s+(?:on|to|in|into)\s+(?:my\s+|the\s+)?(?:list|inbox|to-?dos?|tasks?|backlog)\b/i
  )
  if (listAddM) return { kind: 'capture', title: cleanTitle(listAddM[1]) }

  /* "show insights" — a read-only ask: surface what the local memory already
     computed (#287). The adapter renders the reply from the shared presenter;
     the grammar only names the intent. Without this hook the bare word would
     fall through to capture and become a task called "insights". */
  if (/^(?:show\s+(?:me\s+)?(?:my\s+|the\s+)?)?insights[?.!\s]*$/.test(lower)) {
    return { kind: 'insights' }
  }

  /* "give my hour-plus work blocks room" (#322, worded by #90) — the "give them
     room?" chip's ask. The pre-#90 "give my deep-work blocks room" still reads the
     same, so a chip already in the chat history keeps working. The chip's ask,
     resizing the just-placed blocks of one kind up to how it really runs. A
     dedicated intent so both floors (keyless here, keyed via the give_room tool)
     answer the offer identically. Placed ahead of the grammar so it never falls
     through to capture as a task called "give my blocks". */
  const roomM = lower.match(/^give my (deep-work|hour-plus work|admin|health) blocks room[?.!\s]*$/)
  if (roomM) {
    const focusClass = roomM[1] === 'admin' ? 'admin' : roomM[1] === 'health' ? 'health' : 'deep'
    return { kind: 'giveRoom', focusClass }
  }

  /* "show me today" / "what's on this week" / "list my blocks" / "what do I
     have at 3?" — a read-only ask for the itemized calendar (#333): MEW's eyes.
     The same readout the list_blocks tool returns, rendered as a clean chat
     list. Placed ahead of the grammar so these never fall through to capture (a
     task called "what's on") or the clear broom; the day word picks the scope,
     defaulting to today. */
  if (
    /^(?:show|list|what(?:'s| is| do i have| have i got| do i have on)|whats)\b/.test(lower) &&
    /\b(on|today|tomorrow|this week|week|day|blocks?|schedule|calendar|agenda|plan(?:ned)?|have|going on|got)\b/.test(
      lower
    )
  ) {
    const day: number | 'week' = /\bweek\b/.test(lower)
      ? 'week'
      : /\btomorrow\b/.test(lower)
        ? 1
        : 0
    return { kind: 'list', list: { day } }
  }

  /* clear / start over: "cleanup my calendar so I can restart and plan" */
  if (
    /\b(clear|clean\s*up|cleanup|wipe|reset|start (over|fresh|again)|restart)\b/.test(lower) &&
    /\b(calendar|schedule|week|day|today|tomorrow|plan|everything|blocks?|all)\b/.test(lower)
  ) {
    const scope = /\btoday\b/.test(lower)
      ? ('today' as const)
      : /\btomorrow\b/.test(lower)
        ? ('tomorrow' as const)
        : /\b(this )?week\b/.test(lower)
          ? ('week' as const)
          : ('upcoming' as const)
    return { kind: 'clear', scope }
  }

  /* batch (#75) rides ahead of the single-block moves: "push everything after
     3pm back an hour" is a wide change, never a block called "everything" */
  const batchAsk = parseBatch(trimmed, now)
  if (batchAsk) return batchAsk

  /* relative move (#320): "move it 30 min earlier", "push it back an hour",
     "the deck 30 min later". A direction word + amount is the signal; gate off
     placement verbs so "block gym an hour later" stays a plan, not a move. */
  if (!/^(?:block|schedule|add|hold|plan|keep|free)\b/.test(lower)) {
    const shift = parseTimeShift(lower)
    if (shift != null) {
      const target = trimmed
        .replace(/^(?:move|push|shift|bring|pull|nudge)\s+/i, '')
        .replace(/\bby\s+/gi, ' ')
        .replace(/\d+(?:\.\d+)?\s*(?:h(?:ours?|r)?|m(?:in(?:utes?)?)?)\b/gi, ' ')
        .replace(
          /\b(half an hour|an hour|earlier|sooner|later|backwards?|back|forward|out|delayed?|up|minutes?|mins?|hours?)\b/gi,
          ' '
        )
        .replace(/\s+/g, ' ')
        .trim()
      const q = referentQuery(target) ?? (target ? cleanTitle(target) : REFERENT)
      return { kind: 'move', query: q, relStartMin: shift }
    }
    /* #335: a relative nudge WITHOUT an amount ("push it later", "to the next
       free slot", "to the next day") — the amount-carrying cases returned above. */
    const rel = parseRelmove(trimmed, now)
    if (rel) return rel
  }

  /* relative/absolute duration on a referent (#320): "make it 45", "make that
     90 min", "make it longer", "give it another 30". Named targets fall
     through to the durEdit grammar below (returns null here). */
  const refEdit = parseReferentEdit(trimmed)
  if (refEdit) return refEdit

  /* #335: a NAMED-target resize — "make the deck 30 min longer", "shorten the
     review by 15", "resize standup to 45". Runs after the referent edit (which
     owns "it/that") and before durEdit (which owns the plain "make X N min"
     absolute edit), so both of those stay byte-unchanged. */
  const resize = parseResize(trimmed)
  if (resize) return resize

  /* "start it at 2 [instead]" — an absolute retime of the referent (same day) */
  const startAt = lower.match(/^(?:start|begin)\s+(.+?)\s+(?:at|from)\s+(.+?)(?:\s+instead)?$/)
  if (startAt) {
    const q = referentQuery(startAt[1])
    const tm = startAt[2].trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
    if (q && tm) {
      let h = Number(tm[1])
      const min = tm[2] ? Number(tm[2]) : 0
      const ap = tm[3]?.toLowerCase()
      if (ap === 'pm' && h < 12) h += 12
      if (ap === 'am' && h === 12) h = 0
      if (!ap && h >= 1 && h <= 7) h += 12 // "at 2" reads pm in a 1pm world
      return { kind: 'move', query: q, toStartMin: h * 60 + min }
    }
  }

  /* rename: "rename the release to v1.2" · "rename the 19:45 release to X" (#334).
     A name+time handle ("at 19:45") pins which of several; the executor targets
     by title AND time. Keyless rename is new — the ambiguity chip reply uses it. */
  const renameM = lower.match(/^(?:rename|retitle)\s+(.+?)\s+to\s+(.+)$/)
  if (renameM) {
    const refQ = referentQuery(renameM[1])
    const { at, rest } = extractTargetAt(renameM[1])
    const title = cleanTitle(renameM[2].replace(/^["']|["']$/g, ''))
    if (title)
      return {
        kind: 'edit',
        query: refQ ?? cleanTitle(rest),
        edit: { title },
        ...(!refQ && at ? { at } : {}),
      }
  }

  /* edits: "make the release 45 mins" · "wake should be 6-6:30" · "shorten X to 30m" —
     a leading name+time ("make the release at 19:45 45 min") pins the target (#334) */
  const durEdit = lower.match(
    /^(?:make|set|change|shorten|extend|resize|update)\s+(.+?)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hours?)\b/
  )
  if (durEdit) {
    const n = Number(durEdit[2])
    const dur = /^h/.test(durEdit[3]) ? Math.round(n * 60) : Math.round(n)
    const refQ = referentQuery(durEdit[1])
    const { at, rest } = extractTargetAt(durEdit[1])
    return {
      kind: 'edit',
      query: refQ ?? cleanTitle(stripTimeWords(rest)),
      edit: { durationMin: dur },
      ...(!refQ && at ? { at } : {}),
    }
  }
  const rangeEdit = lower.match(
    /^(.+?)\s+(?:should be|is now|goes|runs)\s+(\d{1,2})(?::(\d{2}))?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\b/
  )
  if (rangeEdit) {
    const s1 = Number(rangeEdit[2]) * 60 + (rangeEdit[3] ? Number(rangeEdit[3]) : 0)
    let e1 = Number(rangeEdit[4]) * 60 + (rangeEdit[5] ? Number(rangeEdit[5]) : 0)
    if (e1 <= s1) e1 += 12 * 60 // "10-1:30" style pm wrap
    const refQ = referentQuery(rangeEdit[1])
    const { at, rest } = extractTargetAt(rangeEdit[1])
    return {
      kind: 'edit',
      query: refQ ?? cleanTitle(rest),
      edit: { startMin: s1, endMin: e1 },
      ...(!refQ && at ? { at } : {}),
    }
  }

  /* targeted removal: "drop the prod release" · "remove both doc reviews" ·
     "remove the sleep block 22:30-5" (a start time pins which of several) */
  const dropM = lower.match(/^(?:drop|remove|delete|cancel|scrap)\s+(.+)$/)
  if (dropM && !/\bfree\b/.test(dropM[1])) {
    /* "drop it" / "delete that one" / "remove the one after lunch" — a referent
       removal carries no time/all pins; hand the sentinel straight through */
    const refQ = referentQuery(dropM[1])
    if (refQ) return { kind: 'remove', query: refQ }
    const all = /\b(?:both|all|every|each)\b/i.test(dropM[1]) && !namesUnpinnedDay(dropM[1])
    /* a start time pins which of several same-named blocks. Read it with the
       same keyless clock grammar used elsewhere ("at 9", "at 9:30", "9am") and
       a bare "22:30", then hand resolveRemoval a canonical HH:MM string so its
       own parser (prefs.parseTimeValue) is the single authority on the value. */
    const bare = dropM[1].match(/\b(\d{1,2}):(\d{2})\b/)
    const atMin = parseTime(dropM[1]) ?? (bare ? Number(bare[1]) * 60 + Number(bare[2]) : null)
    const at =
      atMin != null ? `${Math.floor(atMin / 60)}:${String(atMin % 60).padStart(2, '0')}` : undefined
    const q = cleanTitle(
      stripTimeWords(stripRemoveDayPhrases(dropM[1]))
        .replace(/\b\d{1,2}:\d{2}\b(?:\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?)?/g, ' ') // bare clock / range
        .replace(/^(?:both|all|every|each|the|my)\s+/i, '')
        .replace(/\s+(?:blocks?|events?|tasks?)\s*$/i, '')
    )
    /* #62: a day phrase pins which day ("remove the lunch on thursday at 12:00") —
       the time alone can hit the same title on several days */
    const dayOffset = removeDayPin(dropM[1], now)
    if (q)
      return {
        kind: 'remove',
        query: q,
        ...(at || all || dayOffset != null
          ? {
              remove: {
                ...(at ? { at } : {}),
                ...(all ? { all: true } : {}),
                ...(dayOffset != null ? { dayOffset } : {}),
              },
            }
          : {}),
      }
  }

  /* completions: "done with the deck", "finished the walk", "done with it",
     "done with the release at 19:45" (a name+time handle pins which, #334) */
  const doneM = lower.match(/^(?:done(?:\s+with)?|finished?|completed?)\s+(.+)$/)
  if (doneM) {
    const refQ = referentQuery(doneM[1])
    const { at, rest } = extractTargetAt(doneM[1])
    return {
      kind: 'complete',
      query: refQ ?? cleanTitle(rest),
      ...(!refQ && at ? { at } : {}),
    }
  }

  /* split (#73): "split the deck around the 1pm call" · "split the deck around
     13:00-13:45" · "split the 12:00 deck around 1-1:45pm on friday". */
  const splitAsk = parseSplit(trimmed, now)
  if (splitAsk) return splitAsk
  /* merge (#74): "merge my two deck blocks" · "join the writing blocks tomorrow" ·
     "combine both gym blocks on thursday" · "merge the deck at 9:00 with the next
     one". "merge" always means this; "join"/"combine" only with a merge word
     (blocks / together / into one), so "join the standup at 9" and "join both
     calls" stay chat. A time pins the run's first block, a day word its day. */
  const mergeM =
    lower.match(/^merge\s+(.+)$/) ??
    (/^(?:join|combine)\s+/.test(lower) && /\b(?:blocks|together|into\s+one)\b/.test(lower)
      ? lower.match(/^(?:join|combine)\s+(.+)$/)
      : null)
  if (mergeM) {
    const day = parseDayOffset(mergeM[1], now)
    const { at, rest } = extractTargetAt(mergeM[1])
    const query = cleanTitle(
      stripTimeWords(rest)
        .replace(/\b(?:with|and)\s+(?:the\s+)?(?:next|other)\s+one\b/g, ' ')
        .replace(/\bblocks?\s+of\b/g, ' ') // "two blocks of deck", never the "of" inside a title
        .replace(/\b(?:together|into\s+one|blocks?|my|the|both|two|all|these|those|on)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    if (query)
      return {
        kind: 'merge',
        query,
        ...(at ? { at } : {}),
        merge: day ? { dayOffset: day.offset } : {},
      }
  }

  /* duplicate / copy (#335): "duplicate the deck to friday [at 9]" · "copy the
     standup to tomorrow" · "clone the release at 19:45 to monday". The original
     stays put; a fresh twin lands at the destination (or the source's clock /
     next free slot when no time is given). The source-time handle ("at 19:45")
     pins which of several, distinct from the destination after "to". */
  const dupM = lower.match(/^(?:duplicate|copy|clone)\s+(.+?)(?:\s+to\s+(.+))?$/)
  if (dupM) {
    const refQ = referentQuery(dupM[1])
    const { at, rest } = extractTargetAt(dupM[1])
    const query = refQ ?? cleanTitle(stripTimeWords(rest))
    if (query) {
      const dest = dupM[2] ?? ''
      const day = dest ? parseDayOffset(dest, now) : null
      const time = dest ? (parseDestTime(dest) ?? parsePart(dest)?.start ?? undefined) : undefined
      return {
        kind: 'duplicate',
        query,
        ...(!refQ && at ? { at } : {}),
        duplicate: {
          ...(day ? { toDayOffset: day.offset } : {}),
          ...(time != null ? { toStartMin: time } : {}),
        },
      }
    }
  }

  /* move: "move the deck to thursday [at 9]" · "move the one after lunch to 4pm" ·
     "move the release at 19:45 to friday" — the target time pins which (#334),
     distinct from the destination time after "to" */
  const moveM = lower.match(/^move\s+(.+?)\s+to\s+(.+)$/)
  if (moveM) {
    const day = parseDayOffset(moveM[2], now)
    const time = parseDestTime(moveM[2]) ?? parsePart(moveM[2])?.start ?? undefined
    const refQ = referentQuery(moveM[1])
    /* #160: the TARGET half reads its day with the SAME reader remove has used
       since #72 — removeDayPin to pin it, stripRemoveDayPhrases to lift it out
       of the title — rather than a second reader that could drift from it. So
       "move the gym on wednesday to 15:00" names Wednesday's gym, exactly as
       "remove the gym on wednesday" already did. The phrases both verbs read are
       the same set, which also means both EXCLUDE a weekday at the front of a
       title ("the friday demo"): that stays the title's, by #72's decision. */
    const fromDay = refQ ? null : removeDayPin(moveM[1], now)
    const targetText = refQ ? moveM[1] : stripRemoveDayPhrases(moveM[1])
    const { at, rest } = extractTargetAt(targetText)
    return {
      kind: 'move',
      query: refQ ?? cleanTitle(rest),
      toDayKey: day ? String(day.offset) : undefined, // offset; store resolves to key
      toStartMin: time,
      ...(fromDay != null ? { fromDayOffset: fromDay } : {}),
      ...(!refQ && at ? { at } : {}),
    }
  }

  const places: NonNullable<ScheduleIntent['places']> = []
  const frees: { dayOffset: number; startMin: number; endMin: number; label: string }[] = []

  for (const clause of clauses(trimmed)) {
    const cl = clause.toLowerCase()

    /* "keep friday afternoon free" / "keep friday free" */
    const freeM = cl.match(/^(?:keep|hold)\s+(.+?)\s+free$/)
    if (freeM) {
      const day = parseDayOffset(freeM[1], now)
      const part = parsePart(freeM[1]) ?? PARTS.afternoon
      if (day) {
        frees.push({
          dayOffset: day.offset,
          startMin: part.start,
          endMin: part.end,
          label: clause,
        })
        continue
      }
    }

    /* "block thursday morning for the deck" · "block 2h for X [tomorrow] [at 9]" · "schedule X thursday at 9"
       — and verb-less asks whose cues make the intent unmistakable:
       "swap iphone 3h in the background due 1pm" (duration + background/due) */
    const blockM = cl.match(/^(?:block|schedule|add|hold|plan)\s+(.+)$/)
    const cueM = !blockM && parseDuration(cl) != null && (BG_CUE.test(cl) || DUE_CUE.test(cl))
    if (blockM || cueM) {
      let rest = blockM ? blockM[1] : clause
      let title: string
      const forM = rest.match(/^(.*?)\s+for\s+(.+)$/)
      const eveningM = clause.match(EVENING_CUE)
      const unEvening = (s: string) => s.replace(new RegExp(EVENING_CUE.source, 'gi'), ' ')
      if (forM && blockM) {
        title = stripTimeWords(stripAttentionWords(unEvening(forM[2]))) // "spec review tomorrow at 9" → "spec review"
        rest = forM[1]
      } else {
        /* "schedule the deck thursday morning" — title is what's left after day/part/time words */
        title = stripTimeWords(stripAttentionWords(unEvening(rest)))
      }
      const day = parseDayOffset(clause, now)
      const time = parseTime(clause)
      /* an evening cue with no clock time is the evening window (#117) */
      const evening = eveningM != null && time == null
      const part = evening ? null : parsePart(clause)
      const due = parseDue(clause)
      const background = BG_CUE.test(clause)
      const dur = parseDuration(rest) ?? parseDuration(clause)
      title = cleanTitle(title)
      if (!title) continue
      places.push({
        title,
        tag: inferTag(title),
        /* unstated stays open (#293): a day the user never named must be
           distinguishable from an explicit "today" — the plan-mode route only
           fires on truly un-pinned items. Every consumer defaults absent to 0
           (runIntent `?? 0`), so classic placement is byte-unchanged. */
        dayOffset: day?.offset,
        startMin: time ?? part?.start,
        endMin: time != null || part == null ? undefined : part.end,
        durationMin: dur ?? (part && time == null ? part.end - part.start : undefined), // unstated stays open for duration prefs; place() still defaults 60
        protected: true,
        ...(background ? { attention: 'background' as const } : {}),
        ...(due != null ? { due } : {}),
        ...(evening ? { window: 'evening' as const } : {}),
        ...(evening && /after\s+dinner/i.test(eveningM![0]) ? { afterDinner: true } : {}),
      })
      continue
    }

    /* a trailing modifier clause — "…, must finish by 3pm" / "…, in the
       background" — carries no block of its own; it shapes the one before */
    if (places.length) {
      const due = parseDue(cl)
      const bg = BG_CUE.test(cl)
      const residue = cleanTitle(stripTimeWords(stripAttentionWords(clause)))
      if ((due != null || bg) && !residue) {
        const last = places[places.length - 1]
        if (due != null) last.due = due
        if (bg) last.attention = 'background'
        continue
      }
    }
  }

  if (places.length || frees.length) {
    return {
      kind: 'plan',
      places,
      frees: frees.map((f) => ({
        dayKey: String(f.dayOffset), // offset; store resolves
        startMin: f.startMin,
        endMin: f.endMin,
        label: f.label,
      })),
    }
  }

  /* conversation is conversation — greetings, acks, questions never become tasks */
  const conversational =
    /^(hi|hey|hello|yo|thanks?|thank you|ok(ay)?|cool|nice|great|good( morning| afternoon| evening| night)?|how|what|when|where|why|who|can you|could you|are you|is |do |does )/i
  if (conversational.test(trimmed) || /\?$/.test(trimmed)) {
    return { kind: 'chat' }
  }

  /* bare intention → capture ("call the bank") */
  if (/^[a-z]/i.test(trimmed) && trimmed.split(' ').length <= 8) {
    return { kind: 'capture', title: cleanTitle(trimmed) }
  }

  return { kind: 'chat' }
}
