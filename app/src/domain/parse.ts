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
  const m = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/)
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
    .replace(/\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|morning|afternoon|evening)\b/gi, ' ')
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

export function parseCommand(text: string, now: Date): ScheduleIntent {
  const trimmed = text.trim()
  if (!trimmed) return { kind: 'chat', reply: '' }
  const lower = trimmed.toLowerCase()

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
    /^(?:make|set|change|shorten|extend|resize|update)\s+(.+?)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hours?)\b/,
  )
  if (durEdit) {
    const n = Number(durEdit[2])
    const dur = /^h/.test(durEdit[3]) ? Math.round(n * 60) : Math.round(n)
    return { kind: 'edit', query: cleanTitle(stripTimeWords(durEdit[1])), edit: { durationMin: dur } }
  }
  const rangeEdit = lower.match(
    /^(.+?)\s+(?:should be|is now|goes|runs)\s+(\d{1,2})(?::(\d{2}))?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\b/,
  )
  if (rangeEdit) {
    const s1 = Number(rangeEdit[2]) * 60 + (rangeEdit[3] ? Number(rangeEdit[3]) : 0)
    let e1 = Number(rangeEdit[4]) * 60 + (rangeEdit[5] ? Number(rangeEdit[5]) : 0)
    if (e1 <= s1) e1 += 12 * 60 // "10-1:30" style pm wrap
    return { kind: 'edit', query: cleanTitle(rangeEdit[1]), edit: { startMin: s1, endMin: e1 } }
  }

  /* targeted removal: "drop the prod release" · "remove both doc reviews" */
  const dropM = lower.match(/^(?:drop|remove|delete|cancel|scrap)\s+(.+)$/)
  if (dropM && !/\bfree\b/.test(dropM[1])) {
    const q = cleanTitle(
      stripTimeWords(dropM[1])
        .replace(/^(?:both|all|the|my)\s+/i, '')
        .replace(/\s+(?:blocks?|events?|tasks?)\s*$/i, ''),
    )
    if (q) return { kind: 'remove', query: q }
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

    /* "block thursday morning for the deck" · "block 2h for X [tomorrow] [at 9]" · "schedule X thursday at 9" */
    const blockM = cl.match(/^(?:block|schedule|add|hold|plan)\s+(.+)$/)
    if (blockM) {
      let rest = blockM[1]
      let title = ''
      const forM = rest.match(/^(.*?)\s+for\s+(.+)$/)
      if (forM) {
        title = stripTimeWords(forM[2]) // "spec review tomorrow at 9" → "spec review"
        rest = forM[1]
      } else {
        /* "schedule the deck thursday morning" — title is what's left after day/part/time words */
        title = stripTimeWords(rest)
      }
      const day = parseDayOffset(clause, now)
      const part = parsePart(clause)
      const time = parseTime(clause)
      const dur = parseDuration(rest) ?? parseDuration(clause)
      title = cleanTitle(title)
      if (!title) continue
      places.push({
        title,
        tag: inferTag(title),
        dayOffset: day?.offset ?? 0,
        startMin: time ?? part?.start,
        endMin: time != null || part == null ? undefined : part.end,
        durationMin: dur ?? (part && time == null ? part.end - part.start : 60),
        protected: true,
      })
      continue
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
