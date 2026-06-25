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
  const subject = cleanTitle(text.split(/\s+(?:is|are|means|=)\s+/i)[0]).slice(0, 40)
  return { kind: 'fact', match: subject || 'note', value: text, stated }
}

export function parseCommand(text: string, now: Date): ScheduleIntent {
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

  /* edits: "make the release 45 mins" · "wake should be 6-6:30" · "shorten X to 30m" */
  const durEdit = lower.match(
    /^(?:make|set|change|shorten|extend|resize|update)\s+(.+?)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hours?)\b/
  )
  if (durEdit) {
    const n = Number(durEdit[2])
    const dur = /^h/.test(durEdit[3]) ? Math.round(n * 60) : Math.round(n)
    return {
      kind: 'edit',
      query: cleanTitle(stripTimeWords(durEdit[1])),
      edit: { durationMin: dur },
    }
  }
  const rangeEdit = lower.match(
    /^(.+?)\s+(?:should be|is now|goes|runs)\s+(\d{1,2})(?::(\d{2}))?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\b/
  )
  if (rangeEdit) {
    const s1 = Number(rangeEdit[2]) * 60 + (rangeEdit[3] ? Number(rangeEdit[3]) : 0)
    let e1 = Number(rangeEdit[4]) * 60 + (rangeEdit[5] ? Number(rangeEdit[5]) : 0)
    if (e1 <= s1) e1 += 12 * 60 // "10-1:30" style pm wrap
    return { kind: 'edit', query: cleanTitle(rangeEdit[1]), edit: { startMin: s1, endMin: e1 } }
  }

  /* targeted removal: "drop the prod release" · "remove both doc reviews" ·
     "remove the sleep block 22:30-5" (a start time pins which of several) */
  const dropM = lower.match(/^(?:drop|remove|delete|cancel|scrap)\s+(.+)$/)
  if (dropM && !/\bfree\b/.test(dropM[1])) {
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

  /* completions: "done with the deck", "finished the walk" */
  const doneM = lower.match(/^(?:done(?:\s+with)?|finished?|completed?)\s+(.+)$/)
  if (doneM) return { kind: 'complete', query: cleanTitle(doneM[1]) }

  /* move: "move the deck to thursday [at 9]" */
  const moveM = lower.match(/^move\s+(.+?)\s+to\s+(.+)$/)
  if (moveM) {
    const day = parseDayOffset(moveM[2], now)
    const time = parseTime(moveM[2]) ?? parsePart(moveM[2])?.start ?? undefined
    return {
      kind: 'move',
      query: cleanTitle(moveM[1]),
      toDayKey: day ? String(day.offset) : undefined, // offset; store resolves to key
      toStartMin: time,
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
        dayOffset: day?.offset ?? 0,
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
