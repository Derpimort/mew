/* Rescue my afternoon (#286) — pure detection + one-tap re-plan options for
   inbound-meeting overlaps. When a calendar pull lands an external event on
   top of MEW's own planned work, this file decides (a) that it happened and
   (b) what MEW can honestly offer about it. The meeting is a fixed fact —
   every option moves MEW's OWN block around it, never the event. Posting,
   dedupe bookkeeping, and the executor live in the state layer; nothing here
   mutates anything. */

import type { Block, ChatChoice } from './types'
import { addDaysKey, dayWord, fmtShortDate, fmtTime } from './time'
import { DAY_START, conflictsWith, dayEndMin, duration, findFreeSlot, isFixedTime } from './week'

export interface RescueConflict {
  /** The inbound/updated external event — someone else's meeting, never moved. */
  meeting: Block
  /** MEW's own displaced work block — every option re-plans THIS one. */
  block: Block
}

function extKey(b: Block): string {
  return `${b.external!.calId}:${b.external!.eventId}`
}

/** Dedupe key for one landing of one event. The startMin (and day) are part
    of the key on purpose: the same event re-offered is noise, but the same
    event MOVING again is a fresh landing and must re-fire. */
export function rescueKey(c: RescueConflict): `rescue:${string}` {
  const m = c.meeting
  return `rescue:${m.external!.calId}:${m.external!.eventId}:${m.dayKey}:${m.startMin}`
}

/** Inbound/updated EXTERNAL blocks whose span now overlaps an open, mutable
    work block. Pure diff over a pull's before/after snapshots:
    — only external blocks that are new or changed since `prevBlocks` count
      (an untouched event re-pulled every 5 minutes is not a landing);
    — past days never rescue — the day is lived, not re-planned;
    — external-vs-external never rescues (two meetings are not MEW's to solve);
    — the displaced block must be something MEW may move: open, work-tagged,
      not from a calendar, not fixed-time (a 1:1 is scheduled around, never
      shifted). conflictsWith supplies the open/time-holding/non-background
      floor. One conflict per meeting: when an event lands across several
      blocks, the most-displaced one (largest cut) speaks for the landing. */
export function detectRescues(
  prevBlocks: Block[],
  nextBlocks: Block[],
  todayKey: string
): RescueConflict[] {
  const prev = new Map(prevBlocks.filter((b) => b.external).map((b) => [extKey(b), b]))
  const out: RescueConflict[] = []
  for (const ev of nextBlocks) {
    if (!ev.external || ev.dayKey < todayKey) continue
    const was = prev.get(extKey(ev))
    const changed =
      !was ||
      was.title !== ev.title ||
      was.dayKey !== ev.dayKey ||
      was.startMin !== ev.startMin ||
      was.endMin !== ev.endMin ||
      (was.optional ?? false) !== (ev.optional ?? false)
    if (!changed) continue
    const displaced = conflictsWith(nextBlocks, ev.dayKey, ev.startMin, ev.endMin, ev.id).filter(
      (b) => b.tag === 'work' && !b.external && !isFixedTime(b)
    )
    if (!displaced.length) continue
    const primary = displaced
      .map((b) => ({
        b,
        cut: Math.min(b.endMin, ev.endMin) - Math.max(b.startMin, ev.startMin),
      }))
      .sort((a, z) => z.cut - a.cut || a.b.startMin - z.b.startMin)[0].b
    out.push({ meeting: ev, block: primary })
  }
  return out.sort(
    (a, z) =>
      a.meeting.dayKey.localeCompare(z.meeting.dayKey) || a.meeting.startMin - z.meeting.startMin
  )
}

/** Whether the floor can name this day at all. Beyond the horizon no chip is
    offered — but detection is diff-based (a merged event never re-detects), so
    the state layer still posts the line WITHOUT chips: the user learns of a
    far-out landing exactly once, and nothing tappable is faked. */
export function withinDayWords(dayKey: string, todayKey: string): boolean {
  return dayWord(dayKey, todayKey) != null
}

const base = (b: Block): string => b.title.split('—')[0].trim()

/** The chat line for one landing. Positive-only by law: the meeting "landed",
    nothing "conflicts". Copy shape per #286; a day beyond the floor's day
    words is named by date so the line never reads as today. */
export function rescueLine(conflict: RescueConflict, todayKey: string): string {
  const m = conflict.meeting
  const day = dayWord(m.dayKey, todayKey)
  const suffix = day == null ? ` on ${fmtShortDate(m.dayKey)}` : day === 'today' ? '' : ` ${day}`
  return `heads up — ${base(m)} at ${fmtTime(m.startMin)}${suffix} landed on ${base(conflict.block)}. want me to make room?`
}

/** The one-tap options for a landing, most-preferred first, each with its
    viability computed here at post time. Every `reply` is a plain user ask the
    RULES FLOOR executes verbatim (parse.ts `move`, rescue's own split ask), so
    the tap re-plans keylessly; a keyed model reads the same words. Labels
    carry the concrete target — the tap is informed consent.
    — shift: a same-day free slot fits the WHOLE block. findFreeSlot only ever
      returns clear air, so protected/fixed/external blocks are never displaced
      to make room (scheduled around, never over).
    — split: the block is ≥50 min and the meeting cuts it into two ≥25-min
      pieces, with the tail's air still clear (a second landing there is its
      own rescue, not this one's collateral).
    — roll: the day after has room — always last resort. */
export function rescueOptions(
  blocks: Block[],
  conflict: RescueConflict,
  todayKey: string,
  nowMin: number
): ChatChoice[] {
  const { meeting, block } = conflict
  const day = dayWord(block.dayKey, todayKey)
  if (!day) return [] // beyond the floor's day words — nothing honestly tappable
  const q = base(block)
  const dur = duration(block)
  const out: ChatChoice[] = []

  const others = blocks.filter((b) => b.id !== block.id)
  const from =
    block.dayKey === todayKey ? Math.max(DAY_START, Math.ceil(nowMin / 5) * 5) : DAY_START
  const slot = findFreeSlot(others, block.dayKey, dur, from, dayEndMin(blocks, block.dayKey))
  if (slot) {
    out.push({
      id: 'shift',
      label: `shift to ${fmtTime(slot.startMin)}`,
      reply: `move the ${q} to ${day} at ${fmtTime(slot.startMin)}`,
    })
  }

  const head = meeting.startMin - block.startMin
  const tail = block.endMin - meeting.endMin
  if (
    dur >= 50 &&
    head >= 25 &&
    tail >= 25 &&
    conflictsWith(blocks, block.dayKey, meeting.endMin, block.endMin, block.id).length === 0
  ) {
    out.push({
      id: 'split',
      label: 'split around it',
      reply: splitReply(q, meeting.startMin, meeting.endMin, tail, day),
    })
  }

  const rollKey = addDaysKey(block.dayKey, 1)
  const rollDay = dayWord(rollKey, todayKey)
  if (rollDay && findFreeSlot(blocks, rollKey, dur, 9 * 60)) {
    out.push({
      id: 'roll',
      label: `roll to ${rollDay}`,
      reply: `move the ${q} to ${rollDay}`,
    })
  }

  return out
}

/* ── the split ask, producer + recognizer in one home ─────────────────────
   The floor's grammar (parse.ts) has no single intent that can shrink a block
   AND place its remainder, so a split rides a rescue-shaped ask that carries
   every concrete number: the gap to vacate, the tail to keep, the day. The
   rules adapter recognizes it and composes the two EXISTING tools (edit +
   plan) — exactly the calls a keyed model makes from the same words — so no
   new mutation path exists. Producer and recognizer live side by side so the
   phrase can never drift apart. */

export interface SplitAsk {
  query: string
  gapStartMin: number
  gapEndMin: number
  tailMin: number
  /** 'tomorrow' | weekday word | null (= today) */
  dayWord: string | null
}

/** A plain, human-typable ask: "split the deck around 13:00-13:45, keep 45m after". */
export function splitReply(
  query: string,
  gapStartMin: number,
  gapEndMin: number,
  tailMin: number,
  day: string
): string {
  const suffix = day === 'today' ? '' : day === 'tomorrow' ? ' tomorrow' : ` on ${day}`
  return `split the ${query} around ${fmtTime(gapStartMin)}-${fmtTime(gapEndMin)}${suffix}, keep ${tailMin}m after`
}

const SPLIT_ASK =
  /^split\s+(.+?)\s+around\s+(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})(?:\s+on\s+([a-z]+)|\s+(tomorrow))?\s*,\s*keep\s+(\d+)\s*m(?:in(?:ute)?s?)?\s+after\.?$/i

export function parseSplitAsk(text: string): SplitAsk | null {
  const m = text.trim().match(SPLIT_ASK)
  if (!m) return null
  const query = m[1].replace(/^(the|my)\s+/i, '').trim()
  const gapStartMin = Number(m[2]) * 60 + Number(m[3])
  const gapEndMin = Number(m[4]) * 60 + Number(m[5])
  const tailMin = Number(m[8])
  if (!query || gapEndMin <= gapStartMin || tailMin <= 0) return null
  return {
    query,
    gapStartMin,
    gapEndMin,
    tailMin,
    dayWord: m[7] ? 'tomorrow' : (m[6]?.toLowerCase() ?? null),
  }
}
