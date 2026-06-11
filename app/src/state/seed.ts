/* First-run seed — a lived-in week anchored to the real today, plus three
   weeks of memory so MEW has honest numbers (realistic best ≈ 5.5h) from day
   one. Created only when storage is empty. */

import type { Block, ChatMessage, ConnectedCalendar, MemoryEvent, RoutingMatrix, Settings, Tag } from '../domain/types'
import { DEFAULT_SETTINGS } from '../domain/types'
import { addDaysKey, dayKey, fromDayKey, minOfDay, uid, weekKeys } from '../domain/time'

interface DayPlan {
  title: string
  tag: Tag
  start: number // hours
  end: number
  protected?: boolean
}

const H = (h: number) => Math.round(h * 60)

function planFor(offsetFromToday: number): DayPlan[] {
  switch (offsetFromToday) {
    case 0:
      return [
        { title: 'Q3 deck — deep work', tag: 'work', start: 9, end: 11.5, protected: true },
        { title: 'Team standup', tag: 'work', start: 11.5, end: 12 },
        { title: 'Lunch, away from screen', tag: 'private', start: 13, end: 13.75 },
        { title: 'Reply to Sam', tag: 'work', start: 14.5, end: 15 },
        { title: 'Walk', tag: 'private', start: 16, end: 17, protected: true },
        { title: 'Rest — earned', tag: 'rest', start: 18, end: 19, protected: true },
      ]
    case 1: // tomorrow looks heavy on purpose — the right-size teaser has something true to say
      return [
        { title: 'Spec review — deep work', tag: 'work', start: 8, end: 12, protected: true },
        { title: 'Q3 deck v2 — deep work', tag: 'work', start: 13, end: 17, protected: true },
        { title: 'Stretch', tag: 'private', start: 17.5, end: 18 },
      ]
    case 2:
      return [
        { title: 'Roadmap draft — deep work', tag: 'work', start: 9, end: 12, protected: true },
        { title: '1:1 with Dana', tag: 'work', start: 13, end: 13.5 },
        { title: 'Gym', tag: 'private', start: 17, end: 18.5, protected: true },
      ]
    case 3:
      return [
        { title: 'Inbox sweep', tag: 'work', start: 9, end: 10 },
        { title: 'Q3 deck — polish', tag: 'work', start: 10, end: 12, protected: true },
        { title: 'Walk', tag: 'private', start: 16, end: 17.5, protected: true },
      ]
    case 4:
      return [
        { title: 'Groceries', tag: 'private', start: 10, end: 11.5 },
        { title: 'Reading', tag: 'private', start: 15, end: 16 },
      ]
    case 5:
      return [{ title: 'Rest — a whole one', tag: 'rest', start: 10, end: 12, protected: true }]
    default:
      // past days this week — a believable mix, mostly finished
      return [
        { title: 'Sprint planning', tag: 'work', start: 9, end: 10 },
        { title: 'Feature work — deep work', tag: 'work', start: 10, end: 13, protected: true },
        { title: 'Code review', tag: 'work', start: 14, end: 16 },
        { title: 'Run', tag: 'private', start: 17, end: 18, protected: true },
      ]
  }
}

export interface SeedResult {
  blocks: Block[]
  memory: MemoryEvent[]
  chat: ChatMessage[]
  settings: Settings
}

export function seed(now: Date): SeedResult {
  const todayKey = dayKey(now)
  const nowMin = minOfDay(now)
  const week = weekKeys(now)
  const blocks: Block[] = []
  const memory: MemoryEvent[] = []

  const mkBlock = (key: string, p: DayPlan, status: Block['status'], completedAt?: number): Block => ({
    id: uid(),
    title: p.title,
    tag: p.tag,
    dayKey: key,
    startMin: H(p.start),
    endMin: H(p.end),
    protected: p.protected ?? false,
    status,
    calendarRefs: [],
    estimateSource: 'user',
    ...(completedAt != null ? { completedAt } : {}),
  })

  const tsAt = (key: string, hour: number) => {
    const d = fromDayKey(key)
    d.setHours(hour, 0, 0, 0)
    return d.getTime()
  }

  /* this week */
  for (const key of week) {
    const offset = Math.round((fromDayKey(key).getTime() - fromDayKey(todayKey).getTime()) / 86400000)
    if (offset < 0) {
      for (const p of planFor(99)) {
        const done = !(p.tag === 'work' && p.start >= 14) // afternoons sometimes slipped
        const b = mkBlock(key, p, done ? 'done' : 'rolled', done ? tsAt(key, p.end) : undefined)
        blocks.push(b)
        memory.push({
          id: uid(),
          ts: tsAt(key, p.end),
          kind: done ? 'completed' : 'rolled',
          dayKey: key,
          tag: p.tag,
          plannedMin: H(p.end - p.start),
          deep: p.tag === 'work' && p.end - p.start >= 1,
        })
        if (p.tag === 'private' || p.tag === 'rest') {
          memory.push({ id: uid(), ts: tsAt(key, 21), kind: 'rest_kept', dayKey: key })
        }
      }
    } else {
      for (const p of planFor(offset)) {
        const past = offset === 0 && H(p.end) <= nowMin
        const b = mkBlock(key, p, past ? 'done' : 'open', past ? tsAt(key, p.end) : undefined)
        blocks.push(b)
        if (past) {
          memory.push({
            id: uid(),
            ts: tsAt(key, p.end),
            kind: 'completed',
            dayKey: key,
            tag: p.tag,
            plannedMin: H(p.end - p.start),
            deep: p.tag === 'work' && p.end - p.start >= 1,
          })
        }
      }
    }
  }

  /* three earlier weeks of history → realistic best ≈ 5.5h, light carry-over,
     rest mostly kept — and enough texture for the brain's pattern analyses:
     mornings hold, late afternoons slip, "inbox sweep" keeps rolling,
     blocks finish ~20 min past their end, drift clusters late. */
  const tsAtMin = (key: string, min: number) => {
    const d = fromDayKey(key)
    d.setHours(0, min, 0, 0)
    return d.getTime()
  }
  const deepHours = [5, 5.5, 6, 5.5, 5] // Mon–Fri actually-completed deep work
  for (let w = 1; w <= 3; w++) {
    const mon = addDaysKey(week[0], -7 * w)
    for (let d = 0; d < 5; d++) {
      const key = addDaysKey(mon, d)
      const deepStart = 9 * 60
      const deepEnd = deepStart + H(deepHours[d])
      memory.push({
        id: uid(),
        ts: tsAtMin(key, deepEnd + 20), // honest lateness: ~20 min past the block
        kind: 'completed',
        dayKey: key,
        tag: 'work',
        plannedMin: H(deepHours[d]),
        deep: true,
        title: 'Deep work',
        startMin: deepStart,
        endMin: deepEnd,
      })
      /* the late-afternoon slot: holds early-week, slips late-week */
      const lateHolds = d <= 1
      memory.push({
        id: uid(),
        ts: tsAtMin(key, lateHolds ? 16 * 60 + 15 : 18 * 60),
        kind: lateHolds ? 'completed' : 'rolled',
        dayKey: key,
        tag: 'work',
        plannedMin: 45,
        deep: false,
        title: d === 4 ? 'Q3 deck — polish' : 'Inbox sweep',
        startMin: 15 * 60 + 30,
        endMin: 16 * 60 + 15,
      })
      if (d >= 2) {
        memory.push({ id: uid(), ts: tsAtMin(key, 15 * 60 + 40), kind: 'drift', dayKey: key })
      }
      memory.push({
        id: uid(),
        ts: tsAt(key, 21),
        kind: d === 2 && w === 1 ? 'rest_skipped' : 'rest_kept',
        dayKey: key,
      })
    }
  }

  /* settings: the design's three connected calendars + routing matrix */
  const calendars: ConnectedCalendar[] = [
    { id: 'gwork', name: 'Google · Work', who: 'acme.com', provider: 'google' },
    { id: 'gpersonal', name: 'Google · Personal', who: 'gmail.com', provider: 'google' },
    { id: 'oteam', name: 'Outlook · Acme Team', who: 'shared', provider: 'outlook' },
  ]
  const matrix: RoutingMatrix = {
    gwork: { work: 'details', private: 'busy', health: 'busy' },
    gpersonal: { work: 'busy', private: 'details', health: 'details' },
    oteam: { work: 'busy', private: 'busy', health: 'hidden' },
  }
  const settings: Settings = { ...DEFAULT_SETTINGS, calendars, matrix }

  const chat: ChatMessage[] = [
    {
      id: uid(),
      role: 'mew',
      ts: now.getTime() - 1000,
      body: `Morning. Focus shows the now; Week shows the shape — talk to me to change either. "block thursday morning for the deck" works; so does just telling me what's on your mind.`,
    },
  ]

  return { blocks, memory, chat, settings }
}
