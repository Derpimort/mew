/* #62 — a time-pinned remove never deletes across days. `resolveRemoval` used to
   keep every `at` hit, so "remove the lunch at 12:00" deleted each 12:00 Lunch
   from today on. A time pins a start MINUTE, not a day: hits on several days are
   candidates to ask about; a day pin (or an explicit all) says which. The parser
   keeps the day word on removes so a reply can name one occurrence. */
import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { resolveRemoval } from '../week'
import { parseCommand } from '../parse'

const TUE = '2026-06-09'
const WED = '2026-06-10'
const THU = '2026-06-11'
const NOW = new Date(2026, 5, 9, 9, 40) // Tuesday

const lunch = (id: string, dayKey: string, startMin = 12 * 60): Block => ({
  id,
  title: 'Lunch',
  tag: 'private',
  dayKey,
  startMin,
  endMin: startMin + 45,
  protected: false,
  status: 'open',
  calendarRefs: [],
  estimateSource: 'user',
})
const ids = (bs: Block[]) => bs.map((b) => b.id)

describe('resolveRemoval — a time pin stays on one day (#62)', () => {
  const week = [lunch('tue', TUE), lunch('wed', WED), lunch('thu', THU)]

  it('the same title at the same time on several days → ask, remove nothing', () => {
    const r = resolveRemoval(week, 'lunch', { at: '12:00' }, TUE)
    expect(r.remove).toEqual([])
    expect(ids(r.candidates)).toEqual(['tue', 'wed', 'thu'])
  })

  it('a day pin singles one out', () => {
    const r = resolveRemoval(week, 'lunch', { at: '12:00', day: THU }, TUE)
    expect(ids(r.remove)).toEqual(['thu'])
    expect(r.candidates).toEqual([])
  })

  it('a single 12:00 Lunch from today on is still removed directly', () => {
    const r = resolveRemoval(
      [lunch('tue', TUE), lunch('wed-late', WED, 13 * 60)],
      'lunch',
      { at: '12:00' },
      TUE
    )
    expect(ids(r.remove)).toEqual(['tue'])
  })

  it('an explicit all still removes every pinned match', () => {
    const r = resolveRemoval(week, 'lunch', { at: '12:00', all: true }, TUE)
    expect(ids(r.remove)).toEqual(['tue', 'wed', 'thu'])
  })

  it('a day pin with nothing on that day removes nothing', () => {
    const r = resolveRemoval(week, 'lunch', { at: '12:00', day: '2026-06-12' }, TUE)
    expect(r.remove).toEqual([])
    expect(r.candidates).toEqual([])
  })

  it('same day, different times: the time pin is still exact', () => {
    const r = resolveRemoval(
      [lunch('noon', TUE), lunch('one', TUE, 13 * 60)],
      'lunch',
      { at: '13:00' },
      TUE
    )
    expect(ids(r.remove)).toEqual(['one'])
  })
})

describe('parseCommand — removes keep the day word (#62)', () => {
  it('today / tomorrow / a weekday become a day offset beside the time', () => {
    expect(parseCommand('remove lunch today at 12:00', NOW)).toEqual({
      kind: 'remove',
      query: 'lunch',
      remove: { at: '12:00', dayOffset: 0 },
    })
    expect(parseCommand('remove the lunch tomorrow at 12:00', NOW)).toMatchObject({
      remove: { at: '12:00', dayOffset: 1 },
    })
    expect(parseCommand('remove the lunch on thursday at 12:00', NOW)).toEqual({
      kind: 'remove',
      query: 'lunch',
      remove: { at: '12:00', dayOffset: 2 },
    })
  })

  it('no day word → no day pin (byte-identical intent)', () => {
    expect(parseCommand('remove the lunch at 12:00', NOW)).toEqual({
      kind: 'remove',
      query: 'lunch',
      remove: { at: '12:00' },
    })
    expect(parseCommand('drop the prod release', NOW)).toEqual({
      kind: 'remove',
      query: 'prod release',
    })
  })
})

/* peer review of #66: a pin is a hard day filter, so it may only come from a day
   PHRASE — a weekday word inside a title names the block, never the day */
describe('parseCommand — only a day PHRASE pins a remove (#62 review)', () => {
  const pinOf = (text: string) => {
    const r = parseCommand(text, NOW) as { remove?: { dayOffset?: number } }
    return r.remove?.dayOffset
  }

  it.each([
    'remove the friday demo',
    'remove sun salutation',
    'remove the monday planning',
    'remove this friday demo',
    'remove the friday demo at 15:00',
    'remove all friday demo',
    'remove the lunch next thursday at 12:00',
  ])('"%s" → no day pin', (text) => {
    expect(pinOf(text)).toBeUndefined()
  })

  it.each([
    ['remove lunch today at 12:00', 0],
    ['remove friday demo tomorrow at 15:00', 1],
    ['remove friday demo on thursday at 15:00', 2],
    ["remove thursday's lunch at 12:00", 2],
    ['remove the lunch this thursday', 2],
    ['remove all lunch on thu', 2],
  ] as const)('"%s" → day %i', (text, offset) => {
    expect(pinOf(text)).toBe(offset)
  })

  it('the chips of a weekday-named title parse to exactly what they say', () => {
    expect(parseCommand('remove friday demo on thursday at 15:00', NOW)).toEqual({
      kind: 'remove',
      query: 'demo',
      remove: { at: '15:00', dayOffset: 2 },
    })
    // "both" sweeps every match — the title's weekday never narrows it to Friday
    expect(parseCommand('remove all friday demo', NOW)).toEqual({
      kind: 'remove',
      query: 'demo',
      remove: { all: true },
    })
  })
})
