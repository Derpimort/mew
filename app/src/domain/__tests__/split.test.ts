/* #73: the split op's pure pieces. The geometry every door shares (the typed
   ask, the keyed split_block tool, the rescue chip), the part-2 title, the
   typed clock range, and the keyless grammar that reads "split X around …". */
import { describe, expect, it } from 'vitest'
import { nextPartTitle, parseClockRange, splitGeometry, SPLIT_MIN_PIECE } from '../split'
import { parseCommand } from '../parse'

const DECK = { startMin: 12 * 60, endMin: 15 * 60 } // 12:00–15:00, 180 min
const TUE = new Date(2026, 5, 9, 8, 0) // Tuesday, June 9

describe('splitGeometry', () => {
  it('around the 1pm call: the first piece ends where the gap opens, part 2 keeps the rest of the length', () => {
    expect(splitGeometry(DECK, 13 * 60, 13 * 60 + 45)).toEqual({
      ok: true,
      head: { startMin: 720, endMin: 780 },
      tail: { startMin: 825, endMin: 945 }, // 60 + 120 = the deck's 180 min
    })
  })

  it("the rescue chip's explicit length wins: keep 45m after", () => {
    expect(splitGeometry({ startMin: 540, endMin: 660 }, 570, 615, 45)).toEqual({
      ok: true,
      head: { startMin: 540, endMin: 570 },
      tail: { startMin: 615, endMin: 660 },
    })
  })

  it('a gap that closes past the block still splits; part 2 starts after it', () => {
    expect(splitGeometry({ startMin: 720, endMin: 810 }, 780, 840)).toEqual({
      ok: true,
      head: { startMin: 720, endMin: 780 },
      tail: { startMin: 840, endMin: 870 },
    })
  })

  it('asks instead of guessing: a gap outside the block, or opening at its very edge', () => {
    expect(splitGeometry(DECK, 16 * 60, 16 * 60 + 30)).toEqual({ ok: false, reason: 'outside' })
    expect(splitGeometry(DECK, 11 * 60, 12 * 60 + 30)).toEqual({ ok: false, reason: 'outside' })
    expect(splitGeometry(DECK, 12 * 60, 12 * 60 + 30)).toEqual({ ok: false, reason: 'outside' })
    expect(splitGeometry(DECK, 15 * 60, 15 * 60 + 30)).toEqual({ ok: false, reason: 'outside' })
    expect(splitGeometry(DECK, 13 * 60, 13 * 60)).toEqual({ ok: false, reason: 'outside' })
  })

  it(`a piece under ${SPLIT_MIN_PIECE} min asks; exactly ${SPLIT_MIN_PIECE} splits`, () => {
    expect(splitGeometry(DECK, 12 * 60 + 10, 12 * 60 + 30)).toEqual({
      ok: false,
      reason: 'short-head',
    })
    expect(splitGeometry(DECK, 12 * 60 + 15, 12 * 60 + 30).ok).toBe(true)
    expect(splitGeometry(DECK, 13 * 60, 13 * 60 + 30, 10)).toEqual({
      ok: false,
      reason: 'short-tail',
    })
    expect(splitGeometry(DECK, 13 * 60, 13 * 60 + 30, 15).ok).toBe(true)
  })

  it('part 2 never runs past midnight (splitting across days is out of scope)', () => {
    expect(splitGeometry({ startMin: 21 * 60, endMin: 23 * 60 + 30 }, 22 * 60, 23 * 60)).toEqual({
      ok: false,
      reason: 'past-midnight',
    })
  })
})

describe('nextPartTitle', () => {
  it('names part 2, and a piece split again counts on', () => {
    expect(nextPartTitle('Deck polish')).toBe('Deck polish (part 2)')
    expect(nextPartTitle('Deck polish (part 2)')).toBe('Deck polish (part 3)')
  })
})

describe('parseClockRange', () => {
  it('reads 24h ranges and am/pm ranges, inheriting the end meridiem where it fits', () => {
    expect(parseClockRange('13:00-13:45')).toEqual({ startMin: 780, endMin: 825 })
    expect(parseClockRange('9:30 - 10:15')).toEqual({ startMin: 570, endMin: 615 })
    expect(parseClockRange('1-1:45pm')).toEqual({ startMin: 780, endMin: 825 })
    expect(parseClockRange('12:30pm to 1:15pm')).toEqual({ startMin: 750, endMin: 795 })
    expect(parseClockRange('11-1pm')).toEqual({ startMin: 660, endMin: 780 })
    expect(parseClockRange('13-14')).toEqual({ startMin: 780, endMin: 840 })
  })

  it('leaves out what it cannot read honestly', () => {
    expect(parseClockRange('1-2')).toBeNull() // 1am or 1pm?
    expect(parseClockRange('11pm-1am')).toBeNull() // across midnight
    expect(parseClockRange('the 1pm call')).toBeNull()
    expect(parseClockRange('14:00-13:00')).toBeNull()
  })
})

describe('parseCommand: the typed split ask', () => {
  it('"split the deck around the 1pm call" names the block to split around, and its time', () => {
    expect(parseCommand('split the deck around the 1pm call', TUE)).toEqual({
      kind: 'split',
      query: 'deck',
      split: { aroundQuery: 'call', aroundAt: '13:00' },
    })
  })

  it('a clock gap, a pinned target time and a day', () => {
    expect(parseCommand('split the 12:00 deck around 13:00-13:45 on friday', TUE)).toEqual({
      kind: 'split',
      query: 'deck',
      at: '12:00',
      split: { gapStartMin: 780, gapEndMin: 825, dayOffset: 3 },
    })
    expect(parseCommand('split my focus block around 1-1:30pm tomorrow', TUE)).toMatchObject({
      kind: 'split',
      split: { gapStartMin: 780, gapEndMin: 810, dayOffset: 1 },
    })
  })

  it('a split chip re-ask carries its target time, kept length, day and scope', () => {
    expect(
      parseCommand(
        'split standup at 9:00 around 9:30-9:45, keep 45m after today this and following',
        TUE
      )
    ).toEqual({
      kind: 'split',
      query: 'standup',
      at: '9:00',
      seriesScope: 'following',
      split: { gapStartMin: 570, gapEndMin: 585, dayOffset: 0, tailMin: 45 },
    })
  })

  it('"split it around …" reaches the referent, and nothing to split around reads as no split', () => {
    expect(parseCommand('split it around the standup', TUE)).toMatchObject({
      kind: 'split',
      split: { aroundQuery: 'standup' },
    })
    expect(parseCommand('split the deck', TUE).kind).not.toBe('split')
  })
})
