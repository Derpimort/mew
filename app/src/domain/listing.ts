/* The itemized calendar readout (#333) — MEW's eyes on the week. Pure: turns
   the live blocks of a day (or the week ahead) into an addressable, itemized
   list the model reads back and edits from, and the keyless floor shows
   verbatim. Read-only by construction — it returns a description, never a
   mutation, and takes no snapshot.

   A done block is a mew: it is LISTED, marked with a ✓, never hidden — the
   transcript's invisible-done-block confusion (a "gone" block that was only
   finished) must not recur. The exact title + start time on each line are the
   handle edit_block / move_task / remove_blocks target by (query + at), so a
   readout is enough to act on the right block instead of fuzzy-guessing. */

import type { Block, Tag } from './types'
import { addDaysKey, fmtDowLong, fmtTime } from './time'
import { blocksForDay, isBackground, isFixedTime } from './week'

export interface ListingScope {
  /** The days to itemize, in display order (execListBlocks resolves offsets). */
  dayKeys: string[]
  todayKey: string
  /** Optional single-tag filter — list only blocks of this tag. */
  tag?: Tag
}

/** How a block reads beyond its time + title: the tag, then the flags that
    decide whether/how it can be targeted — `calendar` isn't the user's to
    change, `fixed` owns its slot, `optional` holds no time, `background` holds
    the clock not the user, plus a due time when set. Deliberately mirrors the
    vocabulary of week.contextMarkers (the week-context dump the model already
    reads) so a block looks the same in both places; status is the one thing it
    omits, because the readout carries that as the ✓ on the line. */
function descriptor(b: Block): string {
  const parts: string[] = [b.tag]
  if (b.external) parts.push('calendar')
  else if (isFixedTime(b)) parts.push('fixed')
  if (b.optional) parts.push('optional')
  if (isBackground(b)) parts.push('background')
  if (b.due != null) parts.push(`due ${fmtTime(b.due)}`)
  return parts.join(', ')
}

/** One block → its list line: exact start–end, exact title, the descriptor, and
    a trailing ✓ when the block is done (a done block is still listed). */
function line(b: Block): string {
  const done = b.status === 'done' ? ' ✓' : ''
  return `- ${fmtTime(b.startMin)}–${fmtTime(b.endMin)} ${b.title} [${descriptor(b)}]${done}`
}

function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return 'today'
  if (key === addDaysKey(todayKey, 1)) return 'tomorrow'
  return fmtDowLong(key).toLowerCase()
}

/** Build the itemized readout. A single day → a lead line + that day's blocks,
    or a clear-day line; the week → a lead line + a labelled section per
    non-empty day (empty days are skipped; an all-clear week says so). Positive
    voice throughout — a clear day is open space, never a lack. */
export function listReadout(blocks: Block[], scope: ListingScope): string {
  const { dayKeys, todayKey, tag } = scope
  const tagNote = tag ? ` tagged ${tag}` : ''
  const forDay = (key: string): Block[] => {
    const day = blocksForDay(blocks, key)
    return tag ? day.filter((b) => b.tag === tag) : day
  }

  if (dayKeys.length === 1) {
    const key = dayKeys[0]
    const label = dayLabel(key, todayKey)
    const day = forDay(key)
    if (!day.length) return `${label} is clear — nothing on the calendar${tagNote} yet.`
    return [`here's ${label}${tagNote}:`, ...day.map(line)].join('\n')
  }

  const sections: string[] = []
  for (const key of dayKeys) {
    const day = forDay(key)
    if (!day.length) continue
    sections.push(`${dayLabel(key, todayKey)}:`, ...day.map(line))
  }
  if (!sections.length) return `your week is clear — nothing scheduled${tagNote} yet.`
  return [`here's your week${tagNote}:`, ...sections].join('\n')
}
