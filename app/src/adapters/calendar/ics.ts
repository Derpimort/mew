/* ICS import — consume an exported calendar (.ics) as external events through
   the same merge pipeline as live sync. Built against real Google exports:
   folded lines, TZID datetimes across zones, weekly/daily RRULEs with
   BYDAY/UNTIL/COUNT/INTERVAL, EXDATE, and RECURRENCE-ID instance overrides.
   All-day events and monthly/yearly rules are skipped (counted, reported). */

import { dayKey, minOfDay } from '../../domain/time'
import type { RemoteEvent } from './types'

/* ── line unfolding + property parsing ───────────────────────────── */

interface Prop {
  name: string
  params: Record<string, string>
  value: string
}

function unfold(text: string): string[] {
  const raw = text.split(/\r?\n/)
  const out: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1)
    } else if (line.length) {
      out.push(line)
    }
  }
  return out
}

function parseProp(line: string): Prop | null {
  const colon = line.indexOf(':')
  if (colon < 0) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const [name, ...paramParts] = head.split(';')
  const params: Record<string, string> = {}
  for (const p of paramParts) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase(), params, value }
}

/* ── zoned datetime → epoch (no TZ database: derive the zone's offset
      at that instant via Intl, then correct) ───────────────────────── */

interface DtParts {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  s: number
}

function parseDtValue(v: string): { parts: DtParts; utc: boolean; dateOnly: boolean } | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return null
  return {
    parts: {
      y: +m[1],
      mo: +m[2],
      d: +m[3],
      h: m[4] != null ? +m[4] : 0,
      mi: m[5] != null ? +m[5] : 0,
      s: m[6] != null ? +m[6] : 0,
    },
    utc: m[7] === 'Z',
    dateOnly: m[4] == null,
  }
}

const offsetCache = new Map<string, number>()

/** Minutes east of UTC for `tzid` at the given UTC instant. */
function zoneOffsetMin(tzid: string, utcMs: number): number {
  const key = `${tzid}|${Math.floor(utcMs / 900000)}` // 15-min buckets
  const hit = offsetCache.get(key)
  if (hit != null) return hit
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tzid,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const p: Record<string, number> = {}
  for (const part of dtf.formatToParts(utcMs)) {
    if (part.type !== 'literal') p[part.type] = +part.value
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  const off = Math.round((asUtc - Math.floor(utcMs / 60000) * 60000) / 60000)
  offsetCache.set(key, off)
  return off
}

/** Epoch ms for wall-clock `parts` in `tzid` (undefined tzid = device-local). */
export function partsToEpoch(parts: DtParts, tzid: string | undefined, utc: boolean): number {
  if (utc) return Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s)
  if (!tzid) return new Date(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s).getTime()
  const guess = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s)
  try {
    let off = zoneOffsetMin(tzid, guess)
    let epoch = guess - off * 60000
    // re-derive once in case the first guess straddled a DST transition
    off = zoneOffsetMin(tzid, epoch)
    epoch = guess - off * 60000
    return epoch
  } catch {
    return new Date(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s).getTime()
  }
}

function propToEpoch(p: Prop): { epoch: number; dateOnly: boolean } | null {
  if (p.params.VALUE === 'DATE') {
    const dv = parseDtValue(p.value)
    return dv ? { epoch: partsToEpoch(dv.parts, undefined, false), dateOnly: true } : null
  }
  const dv = parseDtValue(p.value)
  if (!dv) return null
  return {
    epoch: partsToEpoch(dv.parts, dv.dateOnly ? undefined : p.params.TZID, dv.utc),
    dateOnly: dv.dateOnly,
  }
}

/* ── VEVENT model ─────────────────────────────────────────────────── */

interface VEvent {
  uid: string
  summary: string
  start: number
  end: number
  dateOnly: boolean
  cancelled: boolean
  declined: boolean
  optional: boolean
  rrule: Record<string, string> | null
  exdates: number[]
  recurrenceId: number | null
  /* for RRULE expansion we re-derive each occurrence's wall-clock time */
  startProp: Prop
  durationMs: number
}

export interface IcsParseResult {
  calName: string | null
  events: VEvent[]
  skippedAllDay: number
  skippedRules: number
}

export function parseIcs(text: string, ownerEmail?: string): IcsParseResult {
  const lines = unfold(text)
  let calName: string | null = null
  const events: VEvent[] = []
  let skippedAllDay = 0
  let skippedRules = 0
  let cur: Prop[] | null = null

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = []
      continue
    }
    if (line === 'END:VEVENT') {
      if (cur) {
        const get = (n: string) => cur!.find((p) => p.name === n)
        const uid = get('UID')?.value ?? ''
        const startP = get('DTSTART')
        const endP = get('DTEND')
        const start = startP ? propToEpoch(startP) : null
        if (!startP || !start) {
          cur = null
          continue
        }
        if (start.dateOnly) {
          skippedAllDay++
          cur = null
          continue
        }
        const end = endP ? propToEpoch(endP) : null
        const endEpoch = end && !end.dateOnly ? end.epoch : start.epoch + 30 * 60000
        const rruleP = get('RRULE')
        let rrule: Record<string, string> | null = null
        if (rruleP) {
          rrule = {}
          for (const part of rruleP.value.split(';')) {
            const eq = part.indexOf('=')
            if (eq > 0) rrule[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1)
          }
          if (rrule.FREQ !== 'WEEKLY' && rrule.FREQ !== 'DAILY') {
            skippedRules++
            cur = null
            continue
          }
        }
        const exdates: number[] = []
        for (const p of cur) {
          if (p.name !== 'EXDATE') continue
          for (const v of p.value.split(',')) {
            const dv = parseDtValue(v.trim())
            if (dv) exdates.push(partsToEpoch(dv.parts, p.params.TZID, dv.utc))
          }
        }
        const recP = get('RECURRENCE-ID')
        const rec = recP ? propToEpoch(recP) : null
        /* the user's own RSVP decides how hard the block is:
           declined → not their event; tentative/needs-action or shows-as-free → optional */
        const owner = ownerEmail?.toLowerCase()
        const myAttendee = owner
          ? cur.find((p) => p.name === 'ATTENDEE' && p.value.toLowerCase().includes(owner))
          : undefined
        const partstat = myAttendee?.params.PARTSTAT?.toUpperCase()
        const declined = partstat === 'DECLINED'
        const optional =
          get('TRANSP')?.value === 'TRANSPARENT' ||
          partstat === 'TENTATIVE' ||
          partstat === 'NEEDS-ACTION'
        events.push({
          uid,
          summary: get('SUMMARY')?.value.replace(/\\([,;nN])/g, (_, c) => (c === ',' || c === ';' ? c : '\n')).replace(/\\\\/g, '\\') ?? '(untitled)',
          start: start.epoch,
          end: endEpoch,
          dateOnly: false,
          cancelled: get('STATUS')?.value === 'CANCELLED',
          declined,
          optional,
          rrule,
          exdates,
          recurrenceId: rec ? rec.epoch : null,
          startProp: startP,
          durationMs: Math.max(endEpoch - start.epoch, 5 * 60000),
        })
      }
      cur = null
      continue
    }
    if (cur) {
      const p = parseProp(line)
      if (p) cur.push(p)
      continue
    }
    if (line.startsWith('X-WR-CALNAME:')) calName = line.slice('X-WR-CALNAME:'.length).trim()
  }

  return { calName, events, skippedAllDay, skippedRules }
}

/* ── RRULE expansion within a window ──────────────────────────────── */

const BYDAY: Record<string, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 }
const DAY_MS = 86400000

function expandRule(ev: VEvent, windowStartMs: number, windowEndMs: number): number[] {
  const r = ev.rrule!
  const interval = Math.max(1, +(r.INTERVAL ?? 1) || 1)
  const count = r.COUNT ? +r.COUNT : null
  let untilMs = Infinity
  if (r.UNTIL) {
    const dv = parseDtValue(r.UNTIL)
    if (dv) untilMs = partsToEpoch(dv.parts, undefined, dv.utc || !dv.dateOnly === false)
  }
  const tzid = ev.startProp.params.TZID
  const baseParts = parseDtValue(ev.startProp.value)!.parts
  const baseUtcFlag = parseDtValue(ev.startProp.value)!.utc

  const days =
    r.FREQ === 'WEEKLY'
      ? (r.BYDAY ? r.BYDAY.split(',').map((d) => BYDAY[d.trim()]).filter((d) => d != null) : null)
      : null

  const startDay = new Date(ev.start)
  startDay.setHours(0, 0, 0, 0)
  const baseDow = (new Date(ev.start).getDay() + 6) % 7
  const wanted = days && days.length ? days : [baseDow]

  const out: number[] = []
  let occIndex = 0
  const hardStop = 800 // bounded walk (~2.2 years of days)
  for (let i = 0; i < hardStop; i++) {
    const dayMs = startDay.getTime() + i * DAY_MS
    if (dayMs > windowEndMs && (count == null || occIndex >= count)) break
    const d = new Date(dayMs)
    const dow = (d.getDay() + 6) % 7

    let hit = false
    if (r.FREQ === 'DAILY') {
      hit = i % interval === 0
    } else {
      const weeksFromStart = Math.floor((i + baseDow) / 7)
      hit = wanted.includes(dow) && weeksFromStart % interval === 0
    }
    if (!hit) continue

    /* occurrence keeps the series' wall-clock time in its own zone (DST-safe) */
    const occEpoch = partsToEpoch(
      { ...baseParts, y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate() },
      tzid,
      baseUtcFlag,
    )
    if (occEpoch < ev.start - 60000) continue
    if (occEpoch > untilMs) break
    occIndex++
    if (count != null && occIndex > count) break
    if (occEpoch >= windowStartMs && occEpoch <= windowEndMs) out.push(occEpoch)
    if (occEpoch > windowEndMs && count == null) break
  }
  return out
}

/* ── to RemoteEvents (the live-sync wire shape) ───────────────────── */

export interface IcsImport {
  calName: string | null
  events: RemoteEvent[]
  skippedAllDay: number
  skippedRules: number
}

export function icsToRemoteEvents(
  text: string,
  calId: string,
  windowStart: Date,
  windowEnd: Date,
  ownerEmail?: string,
): IcsImport {
  const parsed = parseIcs(text, ownerEmail ?? undefined)
  const ws = windowStart.getTime()
  const we = windowEnd.getTime()
  const out: RemoteEvent[] = []

  /* overrides: uid + original occurrence epoch → replacement event */
  const overrides = new Map<string, VEvent>()
  for (const ev of parsed.events) {
    if (ev.recurrenceId != null) overrides.set(`${ev.uid}|${ev.recurrenceId}`, ev)
  }

  const push = (ev: VEvent, startMs: number, idSuffix: string) => {
    if (ev.cancelled || ev.declined) return
    const endMs = startMs + ev.durationMs
    if (endMs <= ws || startMs >= we) return
    const s = new Date(startMs)
    const e = new Date(endMs)
    const sKey = dayKey(s)
    out.push({
      eventId: `${ev.uid}${idSuffix}`,
      calId,
      title: ev.summary,
      dayKey: sKey,
      startMin: minOfDay(s),
      endMin: dayKey(e) === sKey ? Math.max(minOfDay(e), minOfDay(s) + 5) : 23 * 60 + 59,
      ...(ev.optional ? { optional: true } : {}),
    })
  }

  for (const ev of parsed.events) {
    if (ev.recurrenceId != null) {
      push(ev, ev.start, `|${ev.recurrenceId}`) // the moved instance stands alone
      continue
    }
    if (!ev.rrule) {
      push(ev, ev.start, '')
      continue
    }
    for (const occ of expandRule(ev, ws, we)) {
      if (ev.exdates.some((x) => Math.abs(x - occ) < 60000)) continue
      if (overrides.has(`${ev.uid}|${occ}`)) continue // replaced by its override
      push(ev, occ, `|${occ}`)
    }
  }

  return { calName: parsed.calName, events: out, skippedAllDay: parsed.skippedAllDay, skippedRules: parsed.skippedRules }
}
