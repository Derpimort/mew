/* The week model — pure operations on blocks. The live week is the single
   source of truth; everything here is synchronous and side-effect free. */

import type { Block, Tag } from './types'
import { uid } from './time'

export const DAY_START = 8 * 60
export const DAY_END = 18 * 60 + 30
export const LOAD_SCALE_MIN = 10 * 60 // week-rail bars are % of a 10h day

export function blocksForDay(blocks: Block[], dayKey: string): Block[] {
  return blocks
    .filter((b) => b.dayKey === dayKey && b.status !== 'rolled')
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
}

export function duration(b: Block): number {
  return b.endMin - b.startMin
}

/** Deep work = a work block of an hour or more. Used for load math + realistic best. */
export function isDeep(b: Block): boolean {
  return b.tag === 'work' && duration(b) >= 60
}

/** Day load by rail segment (health rides with private in the bars; legend stays work/private/rest). */
export function loadBySegment(blocks: Block[], dayKey: string): { work: number; priv: number; rest: number } {
  const out = { work: 0, priv: 0, rest: 0 }
  for (const b of blocksForDay(blocks, dayKey)) {
    if (b.optional) continue // tentative time isn't load
    const d = duration(b)
    if (b.tag === 'work') out.work += d
    else if (b.tag === 'rest') out.rest += d
    else out.priv += d
  }
  return out
}

export function plannedDeepMin(blocks: Block[], dayKey: string): number {
  return blocksForDay(blocks, dayKey)
    .filter((b) => isDeep(b) && b.status !== 'rolled' && !b.optional)
    .reduce((s, b) => s + duration(b), 0)
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

/** First free slot of `durationMin` on `dayKey` within [windowStart, windowEnd). */
export function findFreeSlot(
  blocks: Block[],
  dayKey: string,
  durationMin: number,
  windowStart = DAY_START,
  windowEnd = DAY_END,
): { startMin: number; endMin: number } | null {
  const day = blocksForDay(blocks, dayKey).filter((b) => !b.optional) // optional events don't hold time
  let cursor = windowStart
  for (const b of day) {
    if (b.endMin <= cursor) continue
    if (b.startMin - cursor >= durationMin) break
    cursor = Math.max(cursor, b.endMin)
  }
  if (cursor + durationMin > windowEnd) return null
  return { startMin: cursor, endMin: cursor + durationMin }
}

export interface PlaceSpec {
  title: string
  tag: Tag
  dayKey: string
  startMin?: number
  endMin?: number
  durationMin?: number
  protected?: boolean
  estimateSource?: Block['estimateSource']
}

/** Place a block; when no explicit time, the first free slot wins. Returns null if the day is full. */
export function place(blocks: Block[], spec: PlaceSpec): Block | null {
  let startMin = spec.startMin
  let endMin = spec.endMin
  const dur = spec.durationMin ?? (startMin != null && endMin != null ? endMin - startMin : 60)
  if (startMin == null) {
    const slot = findFreeSlot(blocks, spec.dayKey, dur)
    if (!slot) return null
    startMin = slot.startMin
    endMin = slot.endMin
  }
  if (endMin == null) endMin = startMin + dur
  return {
    id: uid(),
    title: spec.title,
    tag: spec.tag,
    dayKey: spec.dayKey,
    startMin,
    endMin,
    protected: spec.protected ?? true,
    status: 'open',
    calendarRefs: [],
    estimateSource: spec.estimateSource ?? 'user',
  }
}

export function complete(blocks: Block[], id: string, now: number): Block[] {
  return blocks.map((b) => (b.id === id ? { ...b, status: 'done' as const, completedAt: now } : b))
}

export function uncomplete(blocks: Block[], id: string): Block[] {
  return blocks.map((b) => {
    if (b.id !== id) return b
    const { completedAt: _drop, ...rest } = b
    return { ...rest, status: 'open' as const }
  })
}

/** Graceful roll: original is kept (status 'rolled', linked), a fresh open block lands tomorrow. */
export function roll(
  blocks: Block[],
  id: string,
  toDayKey: string,
  toStartMin: number,
): { blocks: Block[]; rolled: Block | null } {
  const src = blocks.find((b) => b.id === id)
  if (!src) return { blocks, rolled: null }
  const next: Block = {
    ...src,
    id: uid(),
    dayKey: toDayKey,
    startMin: toStartMin,
    endMin: toStartMin + duration(src),
    status: 'open',
    estimateSource: 'mew',
  }
  return {
    blocks: blocks.map((b) => (b.id === id ? { ...b, status: 'rolled' as const, rolledToId: next.id } : b)).concat(next),
    rolled: next,
  }
}

export function move(blocks: Block[], id: string, toDayKey: string, toStartMin: number): Block[] {
  return blocks.map((b) =>
    b.id === id
      ? { ...b, dayKey: toDayKey, startMin: toStartMin, endMin: toStartMin + duration(b) }
      : b,
  )
}

/** Find a block by fuzzy title query (open blocks first, nearest day first). */
export function findByQuery(blocks: Block[], query: string, todayKey: string): Block | undefined {
  const q = query.toLowerCase().trim()
  if (!q) return undefined
  /* "lunch" must find "Lunch", not "Order lunch": exact base title beats
     prefix beats substring, and a tighter (shorter) title beats a looser one */
  const rank = (b: Block): number => {
    const base = b.title.split('—')[0].trim().toLowerCase()
    if (base === q) return 0
    if (base.startsWith(q)) return 1
    return 2
  }
  const candidates = blocks
    .filter((b) => b.status !== 'rolled' && b.title.toLowerCase().includes(q))
    .sort((a, b) => {
      const ar = rank(a)
      const br = rank(b)
      if (ar !== br) return ar - br
      const ao = a.status === 'open' ? 0 : 1
      const bo = b.status === 'open' ? 0 : 1
      if (ao !== bo) return ao - bo
      const al = a.title.length
      const bl = b.title.length
      if (al !== bl) return al - bl
      const ad = Math.abs(a.dayKey.localeCompare(todayKey))
      const bd = Math.abs(b.dayKey.localeCompare(todayKey))
      return ad - bd || a.startMin - b.startMin
    })
  return candidates[0]
}

/** All of the day's non-rest items are done → the day is clear, rest is earned. */
export function dayClear(blocks: Block[], dayKey: string): boolean {
  const day = blocksForDay(blocks, dayKey).filter((b) => b.tag !== 'rest' && !b.optional)
  return day.length > 0 && day.every((b) => b.status === 'done')
}

export function openItems(blocks: Block[], dayKey: string): Block[] {
  return blocksForDay(blocks, dayKey).filter(
    (b) => b.status === 'open' && b.tag !== 'rest' && !b.optional,
  )
}

/** The working day ends at the later of 18:30 and the last non-rest block. */
export function dayEndMin(blocks: Block[], dayKey: string): number {
  const day = blocksForDay(blocks, dayKey).filter((b) => b.tag !== 'rest')
  return Math.max(DAY_END, ...day.map((b) => b.endMin))
}
