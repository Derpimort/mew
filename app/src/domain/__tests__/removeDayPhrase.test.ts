/* #72 — a remove's day phrase is the DAY, not part of the title. #66 (#62) taught
   the keyless remove grammar to pin a day from "this <weekday>" and
   "<weekday>'s", but the words around the weekday stayed in the query ("lunch
   this", "'s lunch"), so the resolver couldn't find the block and nothing was
   removed. The phrase is now lifted out whole — "next <weekday>" too, which
   still never pins — while a weekday word that belongs to a TITLE stays exactly
   as #66 pinned it. */
import { describe, expect, it } from 'vitest'
import { parseCommand } from '../parse'

const NOW = new Date(2026, 5, 9, 9, 40) // Tuesday; Thursday is +2

const read = (text: string) =>
  parseCommand(text, NOW) as { kind: string; query?: string; remove?: Record<string, unknown> }

describe('remove — the day phrase leaves the query (#72)', () => {
  it.each([
    ['remove the lunch this thursday at 12:00', 'lunch', { at: '12:00', dayOffset: 2 }],
    ['remove the lunch this thursday', 'lunch', { dayOffset: 2 }],
    ["remove thursday's lunch", 'lunch', { dayOffset: 2 }],
    ['remove thursday’s lunch', 'lunch', { dayOffset: 2 }], // a typographic apostrophe pins too
    ['remove all lunch this thursday', 'lunch', { all: true, dayOffset: 2 }],
    ["remove friday's retro", 'retro', { dayOffset: 3 }],
  ])('"%s" → "%s", pinned %o', (text, query, remove) => {
    expect(read(text)).toEqual({ kind: 'remove', query, remove })
  })

  it('"next <weekday>" leaves the query too, and still never pins (the day chips ask)', () => {
    expect(read('remove the lunch next thursday at 12:00')).toEqual({
      kind: 'remove',
      query: 'lunch',
      remove: { at: '12:00' },
    })
  })

  it('"on <weekday>" reads exactly as before', () => {
    expect(read('remove the lunch on thursday at 12:00')).toEqual({
      kind: 'remove',
      query: 'lunch',
      remove: { at: '12:00', dayOffset: 2 },
    })
  })
})

describe('remove — a weekday inside a title is still the title (#66 unchanged)', () => {
  it.each([
    ['remove the friday demo', 'demo'],
    ['remove sun salutation', 'salutation'],
    ['remove the monday planning', 'planning'],
  ])('"%s" → "%s", no day pin', (text, query) => {
    expect(read(text)).toEqual({ kind: 'remove', query })
  })

  it("the chips' own replies for a weekday-named title parse as before", () => {
    expect(read('remove Friday demo on thursday at 15:00')).toEqual({
      kind: 'remove',
      query: 'demo',
      remove: { at: '15:00', dayOffset: 2 },
    })
    expect(read('remove all Friday demo')).toEqual({
      kind: 'remove',
      query: 'demo',
      remove: { all: true },
    })
  })
})
