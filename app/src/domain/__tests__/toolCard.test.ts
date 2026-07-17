/* #282 — tool-card formatters: one executor invocation → { verb, target? }.
   Two laws under test: the voice (verbs match the executor's working-label
   family, targets are short human lines built from the call's own args) and
   totality (unknown tools, missing args, and hostile shapes degrade to
   verb-only — never a throw). Pure: day words come only from the todayKey the
   caller passes; there is no clock in here. */

import { describe, expect, it } from 'vitest'
import { toolCardLabel } from '../toolCard'

/** a Tuesday — offsets land on nameable weekdays (2 → thursday) */
const TODAY = '2026-06-09'

describe('#282 — per-tool verbs and targets', () => {
  it('plan: places → "placing blocks" with day + time range', () => {
    expect(
      toolCardLabel('plan', {
        todayKey: TODAY,
        places: [{ title: 'deck', dayOffset: 2, startMin: 540, durationMin: 180 }],
        frees: [],
      })
    ).toEqual({ verb: 'placing blocks', target: 'thursday 9:00–12:00' })
  })

  it("plan: duration defaults to the executor's own 60 for the range end", () => {
    expect(
      toolCardLabel('plan', { todayKey: TODAY, places: [{ dayOffset: 0, startMin: 600 }] })
    ).toEqual({ verb: 'placing blocks', target: 'today 10:00–11:00' })
  })

  it('plan: several places name the first and count the rest', () => {
    expect(
      toolCardLabel('plan', {
        todayKey: TODAY,
        places: [
          { dayOffset: 1, startMin: 540, durationMin: 60 },
          { dayOffset: 1, startMin: 780 },
          { dayOffset: 2 },
        ],
      })
    ).toEqual({ verb: 'placing blocks', target: 'tomorrow 9:00–10:00 +2 more' })
  })

  it('plan: auto-placed (no startMin) degrades to the day alone', () => {
    expect(toolCardLabel('plan', { todayKey: TODAY, places: [{ dayOffset: 2 }] })).toEqual({
      verb: 'placing blocks',
      target: 'thursday',
    })
  })

  it('plan: frees only reads as keeping time free', () => {
    expect(
      toolCardLabel('plan', {
        todayKey: TODAY,
        places: [],
        frees: [{ dayOffset: 3, startMin: 780, endMin: 1020 }],
      })
    ).toEqual({ verb: 'keeping time free', target: 'friday 13:00–17:00' })
  })

  it('complete / edit / remove carry the block query as the target', () => {
    expect(toolCardLabel('complete', { query: 'deck' })).toEqual({
      verb: 'marking it done',
      target: 'deck',
    })
    expect(toolCardLabel('edit', { query: 'prod release' })).toEqual({
      verb: 'reshaping it',
      target: 'prod release',
    })
    expect(toolCardLabel('remove', { query: 'gym' })).toEqual({
      verb: 'taking it off',
      target: 'gym',
    })
  })

  it('move: query → destination day and time', () => {
    expect(
      toolCardLabel('move', { todayKey: TODAY, query: 'deck', toDayOffset: 2, toStartMin: 840 })
    ).toEqual({ verb: 'moving it', target: 'deck → thursday 14:00' })
    // no destination given (auto-slot) — the query alone still names the act
    expect(toolCardLabel('move', { query: 'deck' })).toEqual({
      verb: 'moving it',
      target: 'deck',
    })
  })

  it("capture and remember speak the user's own words", () => {
    expect(toolCardLabel('capture', { title: 'call the bank' })).toEqual({
      verb: 'jotting it down',
      target: 'call the bank',
    })
    expect(toolCardLabel('remember', { match: 'gym', value: 'starts 07:00' })).toEqual({
      verb: 'remembering that',
      target: 'gym starts 07:00',
    })
  })

  it('clear names the scope in human words', () => {
    expect(toolCardLabel('clear', { scope: 'today' }).target).toBe('today')
    expect(toolCardLabel('clear', { scope: 'week' }).target).toBe('the rest of the week')
    expect(toolCardLabel('clear', { scope: 'upcoming' }).target).toBe('everything upcoming')
    expect(toolCardLabel('clear', { scope: 'nonsense' })).toEqual({ verb: 'clearing the time' })
  })

  it('analyze reads a day; findSlot restates the constraints', () => {
    expect(toolCardLabel('analyze', { todayKey: TODAY, dayOffset: 2 })).toEqual({
      verb: 'reading the day',
      target: 'thursday',
    })
    expect(toolCardLabel('analyze', { todayKey: TODAY })).toEqual({
      verb: 'reading the day',
      target: 'today',
    })
    expect(
      toolCardLabel('findSlot', { todayKey: TODAY, durationMin: 45, notAfterMin: 1020 })
    ).toEqual({ verb: 'finding a slot', target: '45 min today before 17:00' })
    expect(
      toolCardLabel('findSlot', {
        todayKey: TODAY,
        durationMin: 30,
        dayOffset: 1,
        notBeforeMin: 540,
      })
    ).toEqual({ verb: 'finding a slot', target: '30 min tomorrow after 9:00' })
  })

  it('suggestSlots and queryBrain name what they are looking for', () => {
    expect(toolCardLabel('suggestSlots', { title: 'deep work', durationMin: 90 })).toEqual({
      verb: 'finding a slot',
      target: 'deep work',
    })
    expect(toolCardLabel('queryBrain', { question: 'how were my gym sessions last week' })).toEqual(
      { verb: 'checking what I know', target: 'how were my gym sessions last week' }
    )
  })

  it('undoLast is verb-only — the card is the receipt of the reversal itself', () => {
    expect(toolCardLabel('undoLast')).toEqual({ verb: 'putting it back' })
  })
})

describe('#282 — day words stay pure', () => {
  it('0 is today, 1 is tomorrow, further offsets need todayKey for a weekday name', () => {
    expect(toolCardLabel('analyze', { dayOffset: 0 }).target).toBe('today')
    expect(toolCardLabel('analyze', { dayOffset: 1 }).target).toBe('tomorrow')
    expect(toolCardLabel('analyze', { todayKey: TODAY, dayOffset: 3 }).target).toBe('friday')
    // no clock to fall back on — an offset without todayKey stays honest
    expect(toolCardLabel('analyze', { dayOffset: 3 }).target).toBe('in 3 days')
  })

  it('a malformed todayKey degrades the day word, never the call', () => {
    expect(toolCardLabel('analyze', { todayKey: 'not-a-key', dayOffset: 2 }).target).toBe(
      'in 2 days'
    )
  })
})

describe('#282 — total by law', () => {
  const HOSTILE: unknown[] = [
    undefined,
    null,
    42,
    'a string',
    [],
    {},
    { places: 'not-an-array' },
    { places: [null, 7, 'x'] },
    { query: { nested: true } },
    { durationMin: Number.NaN, dayOffset: Number.POSITIVE_INFINITY },
  ]
  const TOOLS = [
    'plan',
    'complete',
    'move',
    'capture',
    'clear',
    'edit',
    'remove',
    'analyze',
    'findSlot',
    'suggestSlots',
    'queryBrain',
    'remember',
    'undoLast',
  ]

  it('every known tool returns a non-empty verb for every hostile arg shape', () => {
    for (const name of TOOLS) {
      for (const args of HOSTILE) {
        const label = toolCardLabel(name, args)
        expect(label.verb.length).toBeGreaterThan(0)
      }
    }
  })

  it("args whose getters throw still land on the tool's bare verb", () => {
    const bomb = {}
    Object.defineProperty(bomb, 'places', {
      enumerable: true,
      get() {
        throw new Error('boom')
      },
    })
    expect(toolCardLabel('plan', bomb)).toEqual({ verb: 'placing blocks' })
  })

  it('an unknown tool degrades to its own words, never a throw', () => {
    expect(toolCardLabel('sync_calendar')).toEqual({ verb: 'sync calendar' })
    expect(toolCardLabel('doThing')).toEqual({ verb: 'do thing' })
    expect(toolCardLabel('')).toEqual({ verb: 'working on it' })
  })

  it('targets are clipped to one short line', () => {
    const long = 'x'.repeat(200)
    const { target } = toolCardLabel('queryBrain', { question: long })
    expect(target!.length).toBeLessThanOrEqual(64)
    expect(target!.endsWith('…')).toBe(true)
  })
})
