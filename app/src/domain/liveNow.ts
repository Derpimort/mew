/* liveNow — the single source of truth for "right now". Derived on every tick
   and every mutation from (blocks, clock); never stored, so never stale. */

import type { Block } from './types'
import { blocksForDay, dayClear, isBackground } from './week'
import { fmtTime } from './time'

export interface LiveNow {
  current?: Block
  next?: Block
  headline: string
  meta: string[]
  minutesLeft?: number
  mewsToday: number
  openToday: number
  doneToday: number
  segments: boolean[] // the 7-segment day-progress strip
  resting: boolean
}

const VERB_LED =
  /^(reply|call|walk|run|read|write|review|plan|rest|lunch|dinner|email|send|book|pick|buy|fix|ship|clean|stretch|meet|prep|practice|finish)/i

function headlineFor(b: Block): string {
  const base = b.title.split('—')[0].trim()
  if (b.tag === 'rest') return 'Rest — earned.'
  if (b.tag !== 'work' || VERB_LED.test(base)) return base.replace(/\.?$/, '.')
  return `Finish ${base}.`
}

export function liveNow(blocks: Block[], todayKey: string, nowMin: number): LiveNow {
  const day = blocksForDay(blocks, todayKey)
  // optional events aren't commitments: they never drive the headline, and an
  // open optional doesn't count against the day (a completed one is still a mew)
  const tasks = day.filter((b) => b.tag !== 'rest' && (!b.optional || b.status === 'done'))
  const done = tasks.filter((b) => b.status === 'done')
  const open = tasks.filter((b) => b.status === 'open')
  const mewsToday = done.length

  /* background never drives the center: it holds the clock, not the user */
  const current = day.find(
    (b) =>
      b.status === 'open' &&
      !b.optional &&
      !isBackground(b) &&
      b.startMin <= nowMin &&
      nowMin < b.endMin
  )
  const next = day.find(
    (b) => b.status === 'open' && !b.optional && !isBackground(b) && b.startMin > nowMin
  )
  const backgroundLive = day.some(
    (b) => b.status === 'open' && isBackground(b) && b.startMin <= nowMin && nowMin < b.endMin
  )

  const total = Math.max(tasks.length, 1)
  const filled = Math.round((done.length / total) * 7)
  const segments = Array.from({ length: 7 }, (_, i) => i < filled)

  const resting = dayClear(blocks, todayKey)

  let headline: string
  const meta: string[] = []
  let minutesLeft: number | undefined

  if (current) {
    headline = headlineFor(current)
    minutesLeft = current.endMin - nowMin
    meta.push(`${minutesLeft} min left in this block`)
    if (current.protected) meta.push(`protected until ${fmtTime(current.endMin)}`)
  } else if (backgroundLive) {
    /* only background runs right now — nothing holds the user (§3 center) */
    headline = 'Nothing holds you.'
    meta.push(
      `everything is running on its own${next ? ` · next: ${next.title.split('—')[0].trim()} ${fmtTime(next.startMin)}` : ''}`
    )
  } else if (resting) {
    headline = 'Resting — the good kind of tired.'
    meta.push("day's items done")
  } else if (next) {
    headline = `Next: ${next.title.split('—')[0].trim()}.`
    meta.push(`starts at ${fmtTime(next.startMin)}`)
  } else if (open.length > 0) {
    headline = 'Nothing on the clock.'
    meta.push(`${open.length} open item${open.length === 1 ? '' : 's'} to place`)
  } else {
    headline = 'A clear stretch.'
    meta.push('capture something, or let it stay clear')
  }
  meta.push(`${mewsToday} mew${mewsToday === 1 ? '' : 's'} today`)

  return {
    current,
    next,
    headline,
    meta,
    minutesLeft,
    mewsToday,
    openToday: open.length,
    doneToday: done.length,
    segments,
    resting,
  }
}
