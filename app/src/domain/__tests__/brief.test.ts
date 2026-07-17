/* The ritual composers (#285) — pure fixtures in, exact lines out. The voice
   law gets its own pins: {missed, failed, behind, overdue} must never appear,
   and rolled work always reads as "waiting". Keyless by construction: these
   are the same bytes the rules floor posts. */

import { describe, expect, it } from 'vitest'
import {
  buildWrapDebrief,
  composeEveningWrap,
  composeMorningBrief,
  pickKindObservation,
  pickMorningRisk,
} from '../nudges/brief'
import type { Insights } from '../insights'
import type { Block, MemoryEvent } from '../types'

const D = '2026-06-09'

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Q3 deck — deep work',
    tag: 'work',
    dayKey: D,
    startMin: 9 * 60,
    endMin: 11 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

const cold: Insights = {
  weekdayLoad: [],
  heaviestDow: null,
  bands: [],
  bestBand: null,
  worstBand: null,
  chronicRollers: [],
  latenessMin: null,
  estimateFactor: null,
  driftBand: null,
  lines: [],
}

const withBand: Insights = {
  ...cold,
  bestBand: {
    band: 'morning',
    label: 'mornings',
    completed: 5,
    attempted: 6,
    rate: 5 / 6,
  },
}

const doneEv = (title: string, plannedMin: number): MemoryEvent => ({
  id: Math.random().toString(36).slice(2),
  ts: Date.UTC(2026, 5, 9, 12),
  kind: 'completed',
  dayKey: D,
  title,
  plannedMin,
})

describe('composeMorningBrief — three lines: shape, first block, the one risk', () => {
  it('a full day: block count, first→last span, deep-work hours, first open block', () => {
    const blocks = [
      mk({ title: 'Deck polish — deep work', startMin: 9 * 60, endMin: 11 * 60 }),
      mk({ id: 'b2', title: 'Standup', startMin: 11.5 * 60, endMin: 12 * 60 }),
      mk({ id: 'b3', title: 'Reading', tag: 'private', startMin: 16 * 60, endMin: 17.5 * 60 }),
    ]
    const { body } = composeMorningBrief(blocks, D, cold)
    const lines = body.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('today: 3 blocks, 9:00–17:30 · 2h deep work')
    expect(lines[1]).toBe('first up: Deck polish at 9:00')
    expect(lines[2]).toBe('one thing: a clean runway — no overlaps, nothing due')
  })

  it('an empty day stays kind — a clean page, not a verdict', () => {
    const { body } = composeMorningBrief([], D, cold)
    const lines = body.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('today: a clean page — nothing on the books yet')
    expect(lines[1]).toBe('first up: whatever you choose — the page is yours')
    expect(lines[2]).toBe('one thing: a clean runway — no overlaps, nothing due')
  })

  it('an all-done day says so — first up is nothing, kindly', () => {
    const blocks = [
      mk({ status: 'done' }),
      mk({ id: 'b2', status: 'done', startMin: 13 * 60, endMin: 14 * 60 }),
    ]
    const { body } = composeMorningBrief(blocks, D, cold)
    expect(body.split('\n')[1]).toBe('first up: nothing — the day is already clear')
  })

  it('optional blocks hold no time: they shape neither the count nor the span', () => {
    const blocks = [mk({}), mk({ id: 'opt', optional: true, startMin: 6 * 60, endMin: 7 * 60 })]
    const { body } = composeMorningBrief(blocks, D, cold)
    expect(body.split('\n')[0]).toBe('today: 1 block, 9:00–11:00 · 2h deep work')
  })

  it('a clean runway with history leans on the winning band (insights present)', () => {
    const { body } = composeMorningBrief([mk({ endMin: 9 * 60 + 45 })], D, withBand)
    expect(body.split('\n')[2]).toBe(
      'one thing: a clean runway — no overlaps, nothing due. your mornings usually hold; use them well'
    )
  })
})

describe('pickMorningRisk — one risk, deterministic', () => {
  it('overlap pressure wins: the pair sharing the most minutes is the one thing', () => {
    const blocks = [
      mk({ title: 'Deck', startMin: 9 * 60, endMin: 11 * 60 }),
      mk({ id: 'b2', title: 'Sync', startMin: 10 * 60, endMin: 10.5 * 60 }), // 30 shared
      mk({ id: 'b3', title: 'Review', startMin: 10.5 * 60, endMin: 12 * 60 }), // 30 shared with Deck
      mk({ id: 'b4', title: 'Planning', startMin: 13 * 60, endMin: 15 * 60 }),
      mk({ id: 'b5', title: 'Audit', startMin: 13 * 60, endMin: 14.5 * 60 }), // 90 shared — busiest
    ]
    const risk = pickMorningRisk(blocks, D)!
    /* named in day order: Audit (13:00–14:30) sorts ahead of Planning (13:00–15:00) */
    expect(risk).toBe(
      'one thing: Audit and Planning share 90 minutes around 13:00 — one of them may need to drift'
    )
  })

  it('equal pressure breaks toward the earlier overlap — same day, same answer', () => {
    const blocks = [
      mk({ title: 'Deck', startMin: 9 * 60, endMin: 10 * 60 }),
      mk({ id: 'b2', title: 'Sync', startMin: 9.5 * 60, endMin: 10.5 * 60 }), // 30 @ 9:30
      mk({ id: 'b3', title: 'Review', startMin: 14 * 60, endMin: 15 * 60 }),
      mk({ id: 'b4', title: 'Audit', startMin: 14.5 * 60, endMin: 15.5 * 60 }), // 30 @ 14:30
    ]
    expect(pickMorningRisk(blocks, D)).toContain('Deck and Sync')
  })

  it('with no overlap, the earliest hard due is the one thing', () => {
    const blocks = [
      mk({ title: 'Filing — background', startMin: 9 * 60, endMin: 10 * 60, due: 15 * 60 }),
      mk({ id: 'b2', title: 'Submission', startMin: 11 * 60, endMin: 12 * 60, due: 14 * 60 }),
    ]
    expect(pickMorningRisk(blocks, D)).toBe(
      'one thing: Submission needs to land by 14:00 — the 11:00 block covers it'
    )
  })

  it('done and optional blocks carry no risk; a clear day returns null', () => {
    const blocks = [
      mk({ status: 'done', due: 14 * 60 }),
      mk({ id: 'b2', optional: true, startMin: 9 * 60, endMin: 11 * 60 }),
      mk({ id: 'b3', optional: true, startMin: 10 * 60, endMin: 12 * 60 }),
    ]
    expect(pickMorningRisk(blocks, D)).toBeNull()
    expect(pickMorningRisk([], D)).toBeNull()
  })

  it('background blocks hold the clock, not attention — they exert no overlap pressure', () => {
    const blocks = [
      mk({
        title: 'Restore — background',
        attention: 'background',
        startMin: 9 * 60,
        endMin: 12 * 60,
      }),
      mk({ id: 'b2', title: 'Deck', startMin: 9 * 60, endMin: 11 * 60 }),
    ]
    expect(pickMorningRisk(blocks, D)).toBeNull()
  })
})

describe('composeEveningWrap — done, waiting, one kind observation', () => {
  it('a lived day: done count + hours, the one waiting item, the winning band', () => {
    const debrief = buildWrapDebrief(
      [mk({ title: 'Budget pass — deep work' })],
      [doneEv('Deck', 90), doneEv('Standup', 30)],
      D
    )
    const { body } = composeEveningWrap(debrief, withBand)
    const lines = body.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('done: 2 blocks · 2h')
    expect(lines[1]).toBe('waiting for tomorrow: Budget pass')
    expect(lines[2]).toBe(
      'noticed: your mornings keep winning — 5/6 finished there, worth protecting'
    )
  })

  it('an all-done day: the slate is clean', () => {
    const debrief = buildWrapDebrief([mk({ status: 'done' })], [doneEv('Deck', 120)], D)
    const { body } = composeEveningWrap(debrief, cold)
    expect(body.split('\n')[1]).toBe('nothing waiting for tomorrow — the slate is clean')
  })

  it('an empty day stays quiet and kind', () => {
    const { body } = composeEveningWrap(buildWrapDebrief([], [], D), cold)
    const lines = body.split('\n')
    expect(lines[0]).toBe('a quiet day — nothing was on the books')
    expect(lines[1]).toBe('nothing waiting for tomorrow — the slate is clean')
  })

  it('an over-packed day names one waiting item and spells the rest', () => {
    const blocks = [
      mk({ title: 'Budget pass', startMin: 9 * 60 }),
      mk({ id: 'b2', title: 'Spec review', startMin: 11 * 60, endMin: 12 * 60 }),
      mk({ id: 'b3', title: 'Inbox sweep', startMin: 13 * 60, endMin: 14 * 60 }),
    ]
    const { body } = composeEveningWrap(buildWrapDebrief(blocks, [], D), cold)
    const lines = body.split('\n')
    expect(lines[0]).toBe('a slower day — nothing checked off yet, and that is okay')
    expect(lines[1]).toBe('waiting for tomorrow: Budget pass and two more')
  })

  it('external events never wait on us — not ours to carry forward', () => {
    const blocks = [
      mk({ title: 'Board sync', external: { calId: 'c1', eventId: 'e1' } }),
      mk({ id: 'b2', title: 'Budget pass', startMin: 13 * 60, endMin: 14 * 60 }),
    ]
    const debrief = buildWrapDebrief(blocks, [], D)
    expect(debrief.waiting).toEqual(['Budget pass'])
  })

  it('cold start (no insights yet): a kind, honest observation — no invented numbers', () => {
    expect(pickKindObservation(cold)).toBe(
      'noticed: the wrap gets sharper as the weeks fill in — see you tomorrow'
    )
    expect(pickKindObservation(withBand)).toContain('5/6 finished there')
  })
})

describe('the voice law — {missed, failed, behind, overdue} never appear', () => {
  const BANNED = /\b(missed|failed|behind|overdue)\b/i

  it('holds across every day shape the composers can meet', () => {
    const days: Block[][] = [
      [], // empty day
      [mk({ status: 'done' })], // all done
      [
        mk({}),
        mk({ id: 'b2', startMin: 9 * 60, endMin: 12 * 60, title: 'Clash — deep work' }),
        mk({ id: 'b3', startMin: 13 * 60, endMin: 14 * 60, due: 13.5 * 60 }),
      ], // over-packed, overlapping, with a hard due
      [mk({ title: 'Rolled thing', startMin: 8 * 60, endMin: 9 * 60 })], // still open at wrap time
    ]
    for (const blocks of days) {
      for (const insights of [cold, withBand]) {
        expect(composeMorningBrief(blocks, D, insights).body).not.toMatch(BANNED)
        const wrap = composeEveningWrap(buildWrapDebrief(blocks, [doneEv('Deck', 60)], D), insights)
        expect(wrap.body).not.toMatch(BANNED)
        const dry = composeEveningWrap(buildWrapDebrief(blocks, [], D), insights)
        expect(dry.body).not.toMatch(BANNED)
      }
    }
  })

  it('open work at day end reads as waiting — a promise, not a verdict', () => {
    const { body } = composeEveningWrap(
      buildWrapDebrief([mk({ title: 'Budget pass' })], [], D),
      cold
    )
    expect(body).toContain('waiting for tomorrow')
  })
})
