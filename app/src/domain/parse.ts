/* Deterministic talk-to-schedule parser — the no-key floor under the model
   adapters (PRD §9: everything degrades gracefully). The Claude adapter
   produces the same ScheduleIntent through strict tool use. */

import type { ScheduleIntent, Tag } from './types'
import { weekdayOffset } from './time'

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

export function parseCommand(text: string, now: Date): ScheduleIntent {
  /* #343: lift any recurring-edit scope word off the top so it can't pollute the
     grammar below, then attach it to an edit/remove result — the ONLY kinds a
     scope reaches (a scope word on anything else is ignored, harmlessly). */
  const { scope, text: scoped } = extractSeriesScope(text)
  const cmd = parseCommandInner(scoped, now)
  return scope && (cmd.kind === 'edit' || cmd.kind === 'remove' || cmd.kind === 'resize')
    ? { ...cmd, seriesScope: scope }
    : cmd
}

function parseCommandInner(text: string, now: Date): ScheduleIntent {
  const trimmed = text.trim()
  if (!trimmed) return { kind: 'chat', reply: '' }
  const lower = trimmed.toLowerCase()

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

  /* "give my deep-work blocks room" (#322) — the "give them room?" chip's ask,
     resizing the just-placed blocks of one kind up to how it really runs. A
     dedicated intent so both floors (keyless here, keyed via the give_room tool)
     answer the offer identically. Placed ahead of the grammar so it never falls
     through to capture as a task called "give my blocks". */
  const roomM = lower.match(/^give my (deep-work|admin|health) blocks room[?.!\s]*$/)
  if (roomM) {
    const focusClass = roomM[1] === 'deep-work' ? 'deep' : roomM[1] === 'admin' ? 'admin' : 'health'
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
    const all = /\b(?:both|all|every|each)\b/i.test(dropM[1])
    /* a start time pins which of several same-named blocks. Read it with the
       same keyless clock grammar used elsewhere ("at 9", "at 9:30", "9am") and
       a bare "22:30", then hand resolveRemoval a canonical HH:MM string so its
       own parser (prefs.parseTimeValue) is the single authority on the value. */
    const bare = dropM[1].match(/\b(\d{1,2}):(\d{2})\b/)
    const atMin = parseTime(dropM[1]) ?? (bare ? Number(bare[1]) * 60 + Number(bare[2]) : null)
    const at =
      atMin != null ? `${Math.floor(atMin / 60)}:${String(atMin % 60).padStart(2, '0')}` : undefined
    const q = cleanTitle(
      stripTimeWords(dropM[1])
        .replace(/\b\d{1,2}:\d{2}\b(?:\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?)?/g, ' ') // bare clock / range
        .replace(/^(?:both|all|every|each|the|my)\s+/i, '')
        .replace(/\s+(?:blocks?|events?|tasks?)\s*$/i, '')
    )
    if (q)
      return {
        kind: 'remove',
        query: q,
        ...(at || all ? { remove: { ...(at ? { at } : {}), ...(all ? { all: true } : {}) } } : {}),
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
    const { at, rest } = extractTargetAt(moveM[1])
    return {
      kind: 'move',
      query: refQ ?? cleanTitle(rest),
      toDayKey: day ? String(day.offset) : undefined, // offset; store resolves to key
      toStartMin: time,
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
      if (forM && blockM) {
        title = stripTimeWords(stripAttentionWords(forM[2])) // "spec review tomorrow at 9" → "spec review"
        rest = forM[1]
      } else {
        /* "schedule the deck thursday morning" — title is what's left after day/part/time words */
        title = stripTimeWords(stripAttentionWords(rest))
      }
      const day = parseDayOffset(clause, now)
      const part = parsePart(clause)
      const time = parseTime(clause)
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
