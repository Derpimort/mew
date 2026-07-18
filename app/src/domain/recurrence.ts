/* RFC 5545 RRULE for user-created recurring blocks — pure, keyless, tested.
   The same bounded weekly/daily walk ics.ts uses to expand imported calendar
   series (§254–313), but in the domain's own vocabulary: day-keys and
   minutes-of-day, not epochs. User blocks are local-time and live one day at a
   time, so there is no zone/DST correction to make here — each occurrence keeps
   the anchor's wall-clock start on its own day. DAILY and WEEKLY only (monthly/
   yearly are skipped exactly as the importer skips them), capped at the same
   800 occurrences so a runaway rule can never flood the week. */

import { addDaysKey, fmtDow, fromDayKey } from './time'

export type RruleFreq = 'DAILY' | 'WEEKLY'
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

/** A standing recurrence the user stated, structured enough to expand later.
    Mirrors the RRULE fields ics.ts already parses (FREQ/INTERVAL/UNTIL/COUNT/
    BYDAY); monthly/yearly intentionally have no representation. */
export interface Rrule {
  freq: RruleFreq
  /** every N days/weeks; 1+ (an absent/garbage value behaves as 1). */
  interval: number
  /** inclusive last day (YYYY-MM-DD), local — the series stops after it. */
  until?: string
  /** stop after this many occurrences (counted from the anchor day). */
  count?: number
  /** WEEKLY: which weekdays fire; empty/absent ⇒ the anchor's own weekday. */
  byday?: Weekday[]
}

/** Mon=0 … Sun=6, matching ics.ts's BYDAY map and time.ts's week math. */
const BYDAY_INDEX: Record<Weekday, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 }
const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/** Same bound as the ICS importer (ics.ts line 283): a defensive ceiling on the
    day-walk so an open-ended rule (no UNTIL, no COUNT) can't run forever. */
export const RRULE_HARD_CAP = 800

/** How far ahead a user rule expands when it names no end: today + 52 weeks
    (the issue's window). UNTIL/COUNT still cut it shorter. */
export const RRULE_DEFAULT_WEEKS = 52

/** Mon=0 … Sun=6 for a day-key (local), the index BYDAY/INTERVAL math uses. */
function dowMon0(key: string): number {
  return (fromDayKey(key).getDay() + 6) % 7
}

/** Normalize the loose shape a model (or older save) might hand us into a clean
    Rrule, or null when it isn't a usable DAILY/WEEKLY rule. Pure: callers can
    trust the result without re-checking freq, interval, or byday. */
export function normalizeRrule(raw: unknown): Rrule | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const freq = typeof o.freq === 'string' ? o.freq.toUpperCase() : ''
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return null // monthly/yearly skipped, like ics.ts
  const interval =
    typeof o.interval === 'number' && Number.isFinite(o.interval)
      ? Math.max(1, Math.round(o.interval))
      : 1
  const out: Rrule = { freq: freq as RruleFreq, interval }
  if (typeof o.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.until)) out.until = o.until
  if (typeof o.count === 'number' && Number.isFinite(o.count) && o.count >= 1)
    out.count = Math.round(o.count)
  const byday = Array.isArray(o.byday)
    ? [
        ...new Set(
          o.byday
            .map((d) => String(d).trim().toUpperCase())
            .filter((d): d is Weekday => d in BYDAY_INDEX)
        ),
      ]
    : []
  if (byday.length) out.byday = byday
  return out
}

export interface Occurrence {
  dayKey: string
  startMin: number
  endMin: number
}

/** Expand a rule anchored at (anchorDayKey, startMin) of length durationMin into
    the concrete occurrences that fall within [fromDayKey, toDayKey] inclusive.
    Every occurrence keeps the anchor's wall-clock start on its own day.

    The walk mirrors ics.ts's expandRule exactly: step one local day at a time
    from the anchor, fire on the matching weekday/interval, stop at UNTIL, COUNT,
    the window end, or RRULE_HARD_CAP — whichever comes first. Pure and
    deterministic; the caller (execPlan) turns each occurrence into a block. */
export function expandRrule(
  rule: Rrule,
  anchorDayKey: string,
  startMin: number,
  durationMin: number,
  fromDayKey: string,
  toDayKey: string
): Occurrence[] {
  const interval = Math.max(1, rule.interval || 1)
  const endMin = startMin + durationMin
  /* WEEKLY with BYDAY fires on the named weekdays; absent ⇒ the anchor's own
     weekday (RFC 5545: BYDAY defaults to the DTSTART weekday). DAILY ignores it. */
  const wanted =
    rule.freq === 'WEEKLY'
      ? rule.byday && rule.byday.length
        ? rule.byday.map((d) => BYDAY_INDEX[d])
        : [dowMon0(anchorDayKey)]
      : null
  const anchorDow = dowMon0(anchorDayKey)

  const out: Occurrence[] = []
  let occIndex = 0
  const cap = rule.count != null ? Math.min(rule.count, RRULE_HARD_CAP) : RRULE_HARD_CAP
  for (let i = 0; i < RRULE_HARD_CAP; i++) {
    const key = addDaysKey(anchorDayKey, i)
    if (rule.until && key > rule.until) break
    if (key > toDayKey && rule.count == null) break // past the window with no count to chase

    let hit: boolean
    if (rule.freq === 'DAILY') {
      hit = i % interval === 0
    } else {
      const dow = dowMon0(key)
      const weeksFromAnchor = Math.floor((i + anchorDow) / 7)
      hit = wanted!.includes(dow) && weeksFromAnchor % interval === 0
    }
    if (!hit) continue

    occIndex++
    if (occIndex > cap) break
    /* the occurrence counts toward COUNT even when it sits before the window;
       it only lands in the output if it's inside [fromDayKey, toDayKey]. */
    if (key >= fromDayKey && key <= toDayKey) out.push({ dayKey: key, startMin, endMin })
  }
  return out
}

/** One-line human summary of a rule's cadence ("Monday & Wednesday", "every
    2 days"), for the chat confirmation. Pure; takes the anchor so a BYDAY-less
    weekly rule can name the anchor's weekday. */
export function describeRrule(rule: Rrule, anchorDayKey: string): string {
  const dayName = (w: Weekday): string => fmtDow(anchorKeyForWeekday(w, anchorDayKey))
  if (rule.freq === 'DAILY') {
    return rule.interval > 1 ? `every ${rule.interval} days` : 'every day'
  }
  const days = rule.byday && rule.byday.length ? rule.byday : [WEEKDAYS[dowMon0(anchorDayKey)]]
  const ordered = [...days].sort((a, b) => BYDAY_INDEX[a] - BYDAY_INDEX[b])
  const names = ordered.map(dayName)
  const joined =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
  return rule.interval > 1 ? `${joined} every ${rule.interval} weeks` : joined
}

/** A day-key in the anchor's week whose weekday is `w` — purely so describeRrule
    can render full weekday names through fmtDow without its own name table. */
function anchorKeyForWeekday(w: Weekday, anchorDayKey: string): string {
  return addDaysKey(anchorDayKey, BYDAY_INDEX[w] - dowMon0(anchorDayKey))
}

/** The two rules a "this & following" split produces (#343): the `head` keeps
    the original cadence but ends the day before the split, and the `tail` carries
    that same cadence forward from the split day to seed a new series. */
export interface SeriesSplit {
  head: Rrule
  tail: Rrule
}

/** Split a recurring rule at a day boundary for a "this & following" edit (#343):
    bound the existing rule the day BEFORE `fromDayKey` (a tighter UNTIL), and
    return a fresh tail rule that begins at `fromDayKey`. The two rules share the
    cadence (freq/interval/byday) — this never changes WHICH weekdays fire, only
    where the series divides — so the caller re-links the tail occurrences under a
    new id with the edit applied. Returns null for a one-off (no rule): the caller
    then treats the block as a single occurrence, no split.

    COUNT can't survive a split cleanly (the tail's remaining count is unknown
    without expanding), so a counted rule's head/tail drop COUNT and lean on the
    date bounds; an open-ended tail then expands within RRULE_DEFAULT_WEEKS,
    capped at RRULE_HARD_CAP, exactly as a fresh rule would. Pure. */
export function splitSeriesFrom(
  rule: Rrule | null | undefined,
  fromDayKey: string
): SeriesSplit | null {
  if (!rule) return null
  const interval = Math.max(1, rule.interval || 1)
  const byday = rule.byday && rule.byday.length ? { byday: [...rule.byday] } : {}
  const dayBefore = addDaysKey(fromDayKey, -1)
  /* the head stops the day before the split — or earlier, if the rule's own
     UNTIL already lands before that (a split past the series' end leaves the
     whole thing as the head, an empty tail). */
  const headUntil = rule.until && rule.until < dayBefore ? rule.until : dayBefore
  const head: Rrule = { freq: rule.freq, interval, ...byday, until: headUntil }
  /* the tail keeps the rule's own UNTIL only when it still lies at/after the
     split (a split before the end); otherwise it runs open-ended and the
     expander's window/cap bound it. */
  const tail: Rrule = {
    freq: rule.freq,
    interval,
    ...byday,
    ...(rule.until && rule.until >= fromDayKey ? { until: rule.until } : {}),
  }
  return { head, tail }
}
