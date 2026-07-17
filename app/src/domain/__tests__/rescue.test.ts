/* Rescue my afternoon (#286) — the pure brain: what counts as a landing, and
   what MEW may honestly offer about it. The floor-executability contract is
   pinned here too: every chip reply must parse into the intent the label
   promises, or a keyless one-tap would lie. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import {
  detectRescues,
  parseSplitAsk,
  rescueKey,
  rescueLine,
  rescueOptions,
  splitReply,
  withinDayWords,
} from '../rescue'
import { parseCommand } from '../parse'

const TODAY = '2026-06-09' // Tuesday
const NOW = new Date(2026, 5, 9, 9, 40)

function mk(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Deck polish',
    tag: 'work',
    dayKey: TODAY,
    startMin: 540,
    endMin: 660,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

function meeting(over: Partial<Block>): Block {
  return mk({
    id: over.id ?? 'm1',
    title: 'Design sync',
    startMin: 570,
    endMin: 615,
    protected: false,
    external: { calId: 'work@acme', eventId: over.id ?? 'ev1' },
    ...over,
  })
}

describe('detectRescues — what counts as a landing', () => {
  it('an added external event overlapping an open work block is a conflict', () => {
    const block = mk({})
    const m = meeting({})
    const out = detectRescues([block], [block, m], TODAY)
    expect(out).toHaveLength(1)
    expect(out[0].meeting.id).toBe(m.id)
    expect(out[0].block.id).toBe(block.id)
  })

  it('an empty day rescues nothing', () => {
    expect(detectRescues([], [meeting({})], TODAY)).toHaveLength(0)
  })

  it('an unchanged event re-pulled is not a landing', () => {
    const block = mk({})
    const m = meeting({})
    expect(detectRescues([block, m], [block, m], TODAY)).toHaveLength(0)
  })

  it('the same event moved to a new span is a fresh landing with a fresh key', () => {
    const block = mk({})
    const before = meeting({})
    const after = { ...before, startMin: 600, endMin: 645 }
    const out = detectRescues([block, before], [block, after], TODAY)
    expect(out).toHaveLength(1)
    expect(rescueKey(out[0])).not.toBe(rescueKey({ meeting: before, block }))
  })

  it('a title-only change re-detects but keeps the SAME key (the dedupe layer owns it)', () => {
    const block = mk({})
    const before = meeting({})
    const after = { ...before, title: 'Design sync — renamed' }
    const out = detectRescues([block, before], [block, after], TODAY)
    expect(out).toHaveLength(1)
    expect(rescueKey(out[0])).toBe(rescueKey({ meeting: before, block }))
  })

  it('external-vs-external never rescues', () => {
    const other = meeting({ id: 'ev0', startMin: 555, endMin: 645 })
    const m = meeting({})
    expect(detectRescues([other], [other, m], TODAY)).toHaveLength(0)
  })

  it('past days never rescue', () => {
    const block = mk({ dayKey: '2026-06-08' })
    const m = meeting({ dayKey: '2026-06-08' })
    expect(detectRescues([block], [block, m], TODAY)).toHaveLength(0)
  })

  it('done, rest-tagged, optional, and fixed-time blocks are not rescue targets', () => {
    const done = mk({ id: 'd', status: 'done' })
    const rest = mk({ id: 'r', tag: 'rest' })
    const opt = mk({ id: 'o', optional: true })
    const fixed = mk({ id: 'f', title: 'Client call' }) // fixed-time: scheduled around, never shifted
    const m = meeting({})
    expect(
      detectRescues([done, rest, opt, fixed], [done, rest, opt, fixed, m], TODAY)
    ).toHaveLength(0)
  })

  it('a multi-conflict pull yields one conflict per meeting, in day order', () => {
    const a = mk({ id: 'a', startMin: 540, endMin: 660 })
    const b = mk({ id: 'b', startMin: 780, endMin: 900 })
    const c = mk({ id: 'c', dayKey: '2026-06-10', startMin: 540, endMin: 660 })
    const m1 = meeting({ id: 'ev1', startMin: 570, endMin: 615 })
    const m2 = meeting({ id: 'ev2', startMin: 800, endMin: 845 })
    const m3 = meeting({ id: 'ev3', dayKey: '2026-06-10', startMin: 560, endMin: 605 })
    const out = detectRescues([a, b, c], [a, b, c, m3, m2, m1], TODAY)
    expect(out.map((x) => x.meeting.id)).toEqual(['ev1', 'ev2', 'ev3'])
    expect(out.map((x) => x.block.id)).toEqual(['a', 'b', 'c'])
  })

  it('one meeting across two blocks names the most-displaced block once', () => {
    const grazed = mk({ id: 'g', startMin: 540, endMin: 600 }) // 15 min cut
    const cut = mk({ id: 'c', startMin: 600, endMin: 720 }) // 45 min cut
    const m = meeting({ startMin: 585, endMin: 645 })
    const out = detectRescues([grazed, cut], [grazed, cut, m], TODAY)
    expect(out).toHaveLength(1)
    expect(out[0].block.id).toBe('c')
  })
})

describe('rescueOptions — viability, computed at post time', () => {
  const nowMin = 9 * 60 + 40

  it('a clear day offers all three, shift first and roll last', () => {
    const block = mk({})
    const m = meeting({})
    const blocks = [block, m]
    const opts = rescueOptions(blocks, { meeting: m, block }, TODAY, nowMin)
    expect(opts.map((o) => o.id)).toEqual(['shift', 'split', 'roll'])
    /* labels carry the concrete target — the tap is informed consent */
    expect(opts[0].label).toBe('shift to 10:15')
    expect(opts[0].reply).toBe('move the Deck polish to today at 10:15')
    expect(opts[1].label).toBe('split around it')
    expect(opts[2].label).toBe('roll to tomorrow')
    expect(opts[2].reply).toBe('move the Deck polish to tomorrow')
  })

  it('no-viable-shift: a day with no free air its size still offers split + roll', () => {
    const block = mk({}) // 120 min
    const m = meeting({})
    const wall = mk({ id: 'w', title: 'Wall to wall', startMin: 660, endMin: 18 * 60 + 30 })
    const blocks = [block, m, wall]
    const opts = rescueOptions(blocks, { meeting: m, block }, TODAY, nowMin)
    expect(opts.map((o) => o.id)).toEqual(['split', 'roll'])
  })

  it('split-too-small: under 50 minutes (or a thin piece) never splits', () => {
    const small = mk({ startMin: 570, endMin: 615 }) // 45 min
    const m1 = meeting({ startMin: 585, endMin: 600 })
    expect(
      rescueOptions([small, m1], { meeting: m1, block: small }, TODAY, nowMin).map((o) => o.id)
    ).not.toContain('split')

    const thinTail = mk({ startMin: 540, endMin: 660 })
    const late = meeting({ startMin: 600, endMin: 645 }) // tail 15 < 25
    expect(
      rescueOptions([thinTail, late], { meeting: late, block: thinTail }, TODAY, nowMin).map(
        (o) => o.id
      )
    ).not.toContain('split')
  })

  it('a meeting covering the head cannot split (nothing before it survives)', () => {
    const block = mk({})
    const m = meeting({ startMin: 530, endMin: 600 })
    expect(
      rescueOptions([block, m], { meeting: m, block }, TODAY, nowMin).map((o) => o.id)
    ).not.toContain('split')
  })

  it('protected/fixed blocks are scheduled around, never displaced: the shift slot avoids them', () => {
    const block = mk({}) // 120 min, 9:00–11:00
    const m = meeting({})
    const call = mk({ id: 'k', title: 'Client call', startMin: 700, endMin: 760, protected: true })
    const opts = rescueOptions([block, m, call], { meeting: m, block }, TODAY, nowMin)
    const shift = opts.find((o) => o.id === 'shift')!
    const start = 12 * 60 + 40 // after the call — 10:15+120 would overlap it
    expect(shift.label).toBe(`shift to 12:40`)
    expect(start + 120).toBeLessThanOrEqual(18 * 60 + 30)
  })

  it('roll goes quiet when the next day has no room', () => {
    const block = mk({})
    const m = meeting({})
    const fullTomorrow = mk({
      id: 'ft',
      dayKey: '2026-06-10',
      startMin: 8 * 60,
      endMin: 18 * 60 + 30,
    })
    const opts = rescueOptions([block, m, fullTomorrow], { meeting: m, block }, TODAY, nowMin)
    expect(opts.map((o) => o.id)).not.toContain('roll')
  })

  it('beyond the floor’s day words (7+ days out) nothing is offered — a wrong-day tap is worse than none', () => {
    const far = '2026-06-16'
    const block = mk({ dayKey: far })
    const m = meeting({ dayKey: far })
    expect(rescueOptions([block, m], { meeting: m, block }, TODAY, nowMin)).toHaveLength(0)
  })

  it('a future-day conflict phrases with the weekday word', () => {
    const fri = '2026-06-12'
    const block = mk({ dayKey: fri })
    const m = meeting({ dayKey: fri })
    const opts = rescueOptions([block, m], { meeting: m, block }, TODAY, nowMin)
    expect(opts.find((o) => o.id === 'shift')!.reply).toMatch(/^move the Deck polish to friday at /)
    expect(opts.find((o) => o.id === 'roll')!.reply).toBe('move the Deck polish to saturday')
  })

  it('every option moves MEW’s own block — no reply ever names the meeting as the thing to move', () => {
    const block = mk({})
    const m = meeting({})
    for (const o of rescueOptions([block, m], { meeting: m, block }, TODAY, nowMin)) {
      expect(o.reply).not.toMatch(/design sync/i)
    }
  })
})

describe('the chip replies execute on the keyless floor (the contract behind one-tap)', () => {
  it('shift parses to a move with the exact day and minute', () => {
    const intent = parseCommand('move the Deck polish to today at 10:15', NOW)
    expect(intent).toMatchObject({
      kind: 'move',
      query: 'deck polish',
      toDayKey: '0',
      toStartMin: 615,
    })
  })

  it('roll parses to a move to the next day (oracle picks the slot)', () => {
    const intent = parseCommand('move the Deck polish to tomorrow', NOW)
    expect(intent).toMatchObject({ kind: 'move', query: 'deck polish', toDayKey: '1' })
    expect(intent.toStartMin).toBeUndefined()
  })

  it('the split ask round-trips producer → recognizer, today and future-day', () => {
    expect(parseSplitAsk(splitReply('Deck polish', 570, 615, 45, 'today'))).toEqual({
      query: 'Deck polish',
      gapStartMin: 570,
      gapEndMin: 615,
      tailMin: 45,
      dayWord: null,
    })
    expect(parseSplitAsk(splitReply('Deck polish', 570, 615, 45, 'tomorrow'))).toMatchObject({
      dayWord: 'tomorrow',
    })
    expect(parseSplitAsk(splitReply('Deck polish', 570, 615, 45, 'friday'))).toMatchObject({
      dayWord: 'friday',
    })
  })

  it('ordinary talk never trips the split recognizer', () => {
    expect(parseSplitAsk('split the bill with sam')).toBeNull()
    expect(parseSplitAsk('block thursday morning for the deck')).toBeNull()
    expect(parseSplitAsk('split the deck around lunchtime')).toBeNull()
  })
})

describe('the copy stays positive-only', () => {
  it('names the landing, never a conflict/problem/collision', () => {
    const block = mk({})
    const m = meeting({})
    const line = rescueLine({ meeting: m, block }, TODAY)
    expect(line).toBe('heads up — Design sync at 9:30 landed on Deck polish. want me to make room?')
    expect(line).not.toMatch(/conflict|problem|collision/i)
  })

  it('a non-today landing names its day', () => {
    const fri = '2026-06-12'
    const line = rescueLine(
      { meeting: meeting({ dayKey: fri }), block: mk({ dayKey: fri }) },
      TODAY
    )
    expect(line).toContain('at 9:30 friday landed on')
  })

  it('a landing beyond the day words names its date — the prose-only heads-up never reads as today', () => {
    const far = '2026-06-20'
    const line = rescueLine(
      { meeting: meeting({ dayKey: far }), block: mk({ dayKey: far }) },
      TODAY
    )
    expect(line).toContain('at 9:30 on Jun 20 landed on Deck polish')
    expect(withinDayWords(far, TODAY)).toBe(false)
    expect(withinDayWords('2026-06-15', TODAY)).toBe(true) // day 6 — the last word the floor has
  })
})
