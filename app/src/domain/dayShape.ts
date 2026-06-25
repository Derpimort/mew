/* Day-shape analysis — the x-ray MEW reads before optimizing a day.
   Pure domain; the analyze_day tool surfaces these findings to the model,
   which then fixes them with the placement tools. Research anchors:
   sustained focus degrades past ~90 minutes and micro-breaks restore it
   (Albulescu et al. 2022, meta-analysis); back-to-back meetings keep stress
   elevated until a short buffer resets the brain (Microsoft Human Factors
   Lab, 2021); unfinished mental threads intrude until written down
   (Zeigarnik 1927; Masicampo & Baumeister 2011). */

import type { Block } from './types'
import { fmtTime } from './time'
import { blocksForDay, duration, isFixedTime } from './week'

export interface DayShape {
  /** Longest run of non-rest blocks with <15 min of air between them. */
  longestStreak: { startMin: number; endMin: number } | null
  /** Dead air ≥20 min between consecutive blocks (no block, no rest). */
  gaps: { startMin: number; endMin: number }[]
  /** Fixed events ≥45 min whose following 15 minutes hold no rest/review. */
  missingBuffers: Block[]
  /** Findings in plain words, ready for a model or a human. */
  lines: string[]
}

export function dayShape(blocks: Block[], dayKey: string, fromMin = 0): DayShape {
  const day = blocksForDay(blocks, dayKey).filter(
    (b) => !b.optional && b.status !== 'rolled' && b.endMin > fromMin
  )
  const lines: string[] = []
  const gaps: DayShape['gaps'] = []
  let longestStreak: DayShape['longestStreak'] = null

  for (let i = 1; i < day.length; i++) {
    const air = day[i].startMin - day[i - 1].endMin
    if (air >= 20) gaps.push({ startMin: day[i - 1].endMin, endMin: day[i].startMin })
  }

  let runStart: number | null = null
  let runEnd = 0
  const closeRun = () => {
    if (
      runStart != null &&
      (!longestStreak || runEnd - runStart > longestStreak.endMin - longestStreak.startMin)
    ) {
      longestStreak = { startMin: runStart, endMin: runEnd }
    }
    runStart = null
  }
  for (const b of day) {
    if (b.tag === 'rest' && duration(b) >= 10) {
      closeRun()
      continue
    }
    if (runStart == null) {
      runStart = b.startMin
      runEnd = b.endMin
    } else if (b.startMin - runEnd < 15) {
      runEnd = Math.max(runEnd, b.endMin)
    } else {
      closeRun()
      runStart = b.startMin
      runEnd = b.endMin
    }
  }
  closeRun()

  const missingBuffers = day.filter((b) => {
    if (b.status !== 'open' || !isFixedTime(b) || duration(b) < 45) return false
    const cushion = day.find(
      (n) =>
        n.id !== b.id &&
        n.startMin >= b.endMin &&
        n.startMin <= b.endMin + 15 &&
        (n.tag === 'rest' || /review|notes|debrief|buffer/i.test(n.title))
    )
    return !cushion
  })

  const streak = longestStreak as DayShape['longestStreak']
  if (streak && streak.endMin - streak.startMin >= 110) {
    lines.push(
      `unbroken stretch ${fmtTime(streak.startMin)}–${fmtTime(streak.endMin)} (${streak.endMin - streak.startMin} min) — focus degrades past ~90 min; a 10–15 min rest inside it restores output`
    )
  }
  for (const g of gaps.slice(0, 4)) {
    lines.push(
      `dead air ${fmtTime(g.startMin)}–${fmtTime(g.endMin)} (${g.endMin - g.startMin} min) — pull blocks together or name it as rest`
    )
  }
  for (const b of missingBuffers.slice(0, 3)) {
    lines.push(
      `${b.title.split('—')[0].trim()} ends ${fmtTime(b.endMin)} with no buffer — 15 min of review/notes right after keeps the decisions and resets stress`
    )
  }
  if (!lines.length) {
    lines.push('the shape reads well: rests where needed, no dead air, buffers in place')
  }
  return { longestStreak, gaps, missingBuffers, lines }
}
