/* Tool-call activity cards (#282) — the per-tool formatters that turn one
   executor invocation into a card's human line: (toolName, args) → { verb,
   target? }. Verbs reuse the executor's working-label voice ("placing blocks",
   "checking what I know"); the target is a short line derived from the call's
   own args (day + time range for plan/move, the query for find_slot, the block
   title for complete/edit/remove…).

   Total by law: unknown tools, missing args, and hostile arg shapes degrade to
   verb-only — a formatter can never take a turn down. Pure: day words come
   from an optional `todayKey` the CALLER puts in args (no Date.now), and
   nothing here imports the store. */

import { addDaysKey, fmtDowLong, fmtTime } from './time'

export interface ToolCardLabel {
  verb: string
  target?: string
}

/** Positive-only settle line for a tool that threw (#282) — the card says what
    happened kindly; the raw error goes to the devtools log, never the card. */
export const TOOL_ERROR_NOTE = "couldn't finish this — nothing changed"

/** The quiet line an interrupted card renders under. Hydration sets no note —
    the running→interrupted mapping is mechanical; the voice lives here once. */
export const TOOL_INTERRUPTED_NOTE = 'stopped partway — the week shows what stands'

/** Targets stay one short human line — never a paragraph of tool args. */
const TARGET_MAX = 64

function clip(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > TARGET_MAX ? `${t.slice(0, TARGET_MAX - 1)}…` : t
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? clip(v) : undefined
}

function int(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : undefined
}

/** Minutes-from-midnight → "9:00", only for values a day can actually hold. */
function time(v: unknown): string | undefined {
  const n = int(v)
  return n != null && n >= 0 && n <= 1440 ? fmtTime(n) : undefined
}

/** "today" / "tomorrow" / a weekday word (needs todayKey) / a plain offset. */
function dayWord(offset: unknown, todayKey: unknown): string | undefined {
  const n = int(offset)
  if (n == null) return undefined
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  const key = typeof todayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(todayKey) ? todayKey : null
  if (key) return fmtDowLong(addDaysKey(key, n)).toLowerCase()
  return n > 1 ? `in ${n} days` : `${-n} days back`
}

/** "thursday 9:00–12:00" from a place/free-shaped record (duration defaults to
    the executor's own 60), degrading to just the day when times are absent. */
function dayAndRange(rec: Record<string, unknown>, todayKey: unknown): string | undefined {
  const day = dayWord(rec.dayOffset, todayKey)
  const start = time(rec.startMin)
  if (!start) return day
  const end =
    time(rec.endMin) ??
    (int(rec.startMin) != null
      ? time((int(rec.startMin) ?? 0) + (int(rec.durationMin) ?? 60))
      : undefined)
  const range = end ? `${start}–${end}` : start
  return day ? `${day} ${range}` : range
}

const CLEAR_SCOPE: Record<string, string> = {
  today: 'today',
  tomorrow: 'tomorrow',
  week: 'the rest of the week',
  upcoming: 'everything upcoming',
}

/** The degraded voice per tool — what a card says when its args tell it
    nothing. Also the safety net when a target builder trips on hostile args. */
const BASE_VERB: Record<string, string> = {
  plan: 'placing blocks',
  complete: 'marking it done',
  move: 'moving it',
  capture: 'jotting it down',
  clear: 'clearing the time',
  edit: 'reshaping it',
  remove: 'taking it off',
  analyze: 'reading the day',
  findSlot: 'finding a slot',
  suggestSlots: 'finding a slot',
  queryBrain: 'checking what I know',
  remember: 'remembering that',
  undoLast: 'putting it back',
}

/* One formatter per tool — variation as data: a new tool is a new row here,
   never an edit to the dispatch below. */
const FORMATTERS: Record<string, (a: Record<string, unknown>) => ToolCardLabel> = {
  plan: (a) => {
    const places = Array.isArray(a.places) ? a.places.filter(isRecord) : []
    const frees = Array.isArray(a.frees) ? a.frees.filter(isRecord) : []
    if (!places.length && frees.length) {
      return { verb: 'keeping time free', target: dayAndRange(frees[0], a.todayKey) }
    }
    const first = places[0]
    if (!first) return { verb: BASE_VERB.plan }
    const where = dayAndRange(first, a.todayKey)
    const more = places.length > 1 ? ` +${places.length - 1} more` : ''
    return { verb: BASE_VERB.plan, target: where ? `${where}${more}` : undefined }
  },
  complete: (a) => ({ verb: BASE_VERB.complete, target: str(a.query) }),
  move: (a) => {
    const what = str(a.query)
    const day = dayWord(a.toDayOffset, a.todayKey)
    const at = time(a.toStartMin)
    const to = [day, at].filter(Boolean).join(' ')
    return { verb: BASE_VERB.move, target: what ? (to ? `${what} → ${to}` : what) : undefined }
  },
  capture: (a) => ({ verb: BASE_VERB.capture, target: str(a.title) }),
  clear: (a) => ({
    verb: BASE_VERB.clear,
    target: typeof a.scope === 'string' ? CLEAR_SCOPE[a.scope] : undefined,
  }),
  edit: (a) => ({ verb: BASE_VERB.edit, target: str(a.query) }),
  remove: (a) => ({ verb: BASE_VERB.remove, target: str(a.query) }),
  analyze: (a) => ({ verb: BASE_VERB.analyze, target: dayWord(a.dayOffset ?? 0, a.todayKey) }),
  findSlot: (a) => {
    const dur = int(a.durationMin)
    const parts = [
      dur != null && dur > 0 ? `${dur} min` : undefined,
      dayWord(a.dayOffset ?? 0, a.todayKey),
      time(a.notBeforeMin) ? `after ${time(a.notBeforeMin)}` : undefined,
      time(a.notAfterMin) ? `before ${time(a.notAfterMin)}` : undefined,
    ].filter(Boolean)
    return { verb: BASE_VERB.findSlot, target: parts.length ? parts.join(' ') : undefined }
  },
  suggestSlots: (a) => ({ verb: BASE_VERB.suggestSlots, target: str(a.title) }),
  queryBrain: (a) => ({ verb: BASE_VERB.queryBrain, target: str(a.question) }),
  remember: (a) => {
    const match = str(a.match)
    const value = str(a.value)
    return {
      verb: BASE_VERB.remember,
      target: match && value ? clip(`${match} ${value}`) : (match ?? value),
    }
  },
  undoLast: () => ({ verb: BASE_VERB.undoLast }),
}

/** One executor invocation → the card's line. Total: every input shape returns
    a usable label — known tools fall back to their bare verb, unknown names to
    their own words — so the card seam can never throw into a turn. */
export function toolCardLabel(name: string, args?: unknown): ToolCardLabel {
  const format = FORMATTERS[name]
  if (format) {
    try {
      const label = format(isRecord(args) ? args : {})
      return label.target ? label : { verb: label.verb }
    } catch {
      return { verb: BASE_VERB[name] }
    }
  }
  const words = String(name ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()
  return { verb: words || 'working on it' }
}
