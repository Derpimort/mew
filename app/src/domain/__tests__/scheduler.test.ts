import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { overlaps } from '../week'
import {
  candidateSlots,
  driftCollisions,
  moveBlockedBy,
  PACING_REST_MIN,
  restInsertion,
  scoreSlots,
} from '../scheduler'

const D = '2026-06-09' // Tuesday
const NOW = 8 * 60 // 08:00 — the working-day start

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'X',
    tag: 'work',
    dayKey: D,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  } as Block
}

describe('scheduler — candidateSlots (conflict-free enumeration)', () => {
  it('never overlaps an existing block', () => {
    const busy = mk({ title: 'Standup', startMin: 10 * 60, endMin: 11 * 60 })
    const cands = candidateSlots(
      [busy],
      { title: 'deep work', tag: 'work', durationMin: 60 },
      D,
      NOW
    )
    const today = cands.filter((c) => c.dayKey === D) // overlap is a same-day notion
    expect(today.length).toBeGreaterThan(0)
    for (const c of today)
      expect(overlaps(c.startMin, c.endMin, busy.startMin, busy.endMin)).toBe(false)
  })

  it('a due deadline confines candidates to today and gates anything ending late', () => {
    const cands = candidateSlots(
      [],
      { title: 'report', tag: 'work', durationMin: 60, due: 10 * 60 },
      D,
      NOW
    )
    expect(cands.length).toBeGreaterThan(0)
    for (const c of cands) {
      expect(c.dayKey).toBe(D)
      expect(c.endMin).toBeLessThanOrEqual(10 * 60)
    }
  })

  it('returns nothing when no gap fits the duration', () => {
    const full = mk({ title: 'All day', startMin: 8 * 60, endMin: 18 * 60 + 30 })
    expect(
      candidateSlots([full], { title: 'x', tag: 'work', durationMin: 60, due: 18 * 60 }, D, NOW)
    ).toEqual([])
  })

  it('spans multiple days when there is no due deadline', () => {
    const cands = candidateSlots([], { title: 'x', tag: 'work', durationMin: 60 }, D, NOW, 3)
    expect(new Set(cands.map((c) => c.dayKey)).size).toBeGreaterThan(1)
  })
})

describe('scheduler — #302 meeting buffer flows through candidateSlots + scoreSlots', () => {
  const meeting = mk({
    title: 'Client sync',
    startMin: 11 * 60,
    endMin: 12 * 60,
    external: { calId: 'work', eventId: 'ev1' },
  })
  const q = { title: 'deep work', tag: 'work' as const, durationMin: 60 }
  const clearsMargin = (c: { startMin: number; endMin: number }) =>
    c.endMin <= 11 * 60 - 15 || c.startMin >= 12 * 60 + 15 // outside the inflated [10:45,12:15]

  it('candidateSlots buffer 0 reproduces the no-buffer candidates byte-for-byte', () => {
    expect(candidateSlots([meeting], q, D, NOW, 0, undefined, 0)).toEqual(
      candidateSlots([meeting], q, D, NOW, 0)
    )
  })

  it('without a buffer a candidate abuts the meeting edge; with buffer 15 none does', () => {
    const bare = candidateSlots([meeting], q, D, NOW, 0).filter((c) => c.dayKey === D)
    expect(bare.some((c) => c.endMin === 11 * 60)).toBe(true) // 10:00–11:00 abuts the 11:00 start
    const buffered = candidateSlots([meeting], q, D, NOW, 0, undefined, 15).filter(
      (c) => c.dayKey === D
    )
    expect(buffered.length).toBeGreaterThan(0)
    expect(buffered.every(clearsMargin)).toBe(true)
  })

  it('scoreSlots (the plan/suggest_slots path) inherits the buffer for every ranked slot', () => {
    const ranked = scoreSlots([meeting], q, D, NOW, [], undefined, 0, undefined, 15).filter(
      (c) => c.dayKey === D
    )
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked.every(clearsMargin)).toBe(true)
  })
})

describe('scheduler — scoreSlots (ranking)', () => {
  it('every ranked candidate is conflict-free (the hard gate holds through scoring)', () => {
    const blocks = [
      mk({ title: 'AM mtg', startMin: 9 * 60, endMin: 10 * 60 }),
      mk({ title: 'PM mtg', startMin: 14 * 60, endMin: 15 * 60 }),
    ]
    const ranked = scoreSlots(blocks, { title: 'deep work', tag: 'work', durationMin: 60 }, D, NOW)
    expect(ranked.length).toBeGreaterThan(0)
    for (const c of ranked.filter((c) => c.dayKey === D))
      // the blocks are all on D
      for (const b of blocks)
        expect(overlaps(c.startMin, c.endMin, b.startMin, b.endMin)).toBe(false)
  })

  it('a work item prefers a morning slot over an afternoon one', () => {
    const blocks = [
      mk({ startMin: 9 * 60, endMin: 14 * 60 }),
      mk({ startMin: 15 * 60, endMin: 18 * 60 + 30 }),
    ]
    const top = scoreSlots(blocks, { title: 'deep work', tag: 'work', durationMin: 60 }, D, NOW)[0]
    expect(top.startMin).toBeLessThan(12 * 60)
  })

  it('penalises a back-to-back slot below a spaced one', () => {
    const blocks = [mk({ startMin: 10 * 60, endMin: 11 * 60 })]
    const onD = scoreSlots(
      blocks,
      { title: 'deep work', tag: 'work', durationMin: 60 },
      D,
      NOW
    ).filter((c) => c.dayKey === D)
    const backToBack = onD.find((c) => c.startMin === 11 * 60)! // right after the 10–11 block
    const spaced = onD.find((c) => c.startMin === 11 * 60 + 30)! // a gap before it
    expect(backToBack.score).toBeLessThan(spaced.score)
  })

  it('a time-default preference ranks its hour on top', () => {
    const prefs = [
      {
        kind: 'time-default' as const,
        match: 'deep work',
        value: 'starts 09:00',
        stated: 'deep work is 9am',
      },
    ]
    const top = scoreSlots(
      [],
      { title: 'deep work', tag: 'work', durationMin: 60 },
      D,
      NOW,
      prefs
    )[0]
    expect(top.startMin).toBe(9 * 60)
    expect(top.why).toContain('matches your rule')
  })

  it('is deterministic and keyless — same inputs, same ranking, scores in [0,1]', () => {
    const blocks = [mk({ startMin: 11 * 60, endMin: 12 * 60 })]
    const a = scoreSlots(blocks, { title: 'x', tag: 'work', durationMin: 60 }, D, NOW)
    const b = scoreSlots(blocks, { title: 'x', tag: 'work', durationMin: 60 }, D, NOW)
    expect(a).toEqual(b)
    expect(a.every((c) => c.score >= 0 && c.score <= 1)).toBe(true)
  })
})

describe('scheduler — #328 a confirmed window is a FIRM preference, not a 0.25 nudge', () => {
  it('collapses off-window candidates (like the meal seam), so a confirmed morning wins', () => {
    // mornings and afternoons both wide open; only the firm window should decide
    const firm = scoreSlots(
      [],
      { title: 'deck', tag: 'work', durationMin: 60, window: 'morning', windowFirm: true },
      D,
      NOW
    )
    const top = firm[0]
    expect(top.startMin).toBeLessThan(12 * 60)
    expect(top.why).toContain('your usual morning')
    // an off-window afternoon candidate is collapsed to near-zero, never preferred
    const afternoon = firm.find((c) => c.dayKey === D && c.startMin >= 14 * 60)!
    expect(afternoon.why).toContain('outside your usual morning')
    expect(afternoon.score).toBeLessThan(0.1)
    expect(top.score - afternoon.score).toBeGreaterThan(0.5)
  })

  it('a firm window BEATS the soft tag default — the collapse is stronger than 0.4-vs-1', () => {
    // deep work already softly prefers mornings; make the firm window AFTERNOON
    // and confirm it overrides that soft pull (unreachable with the 0.25 nudge).
    const soft = scoreSlots([], { title: 'deck', tag: 'work', durationMin: 60 }, D, NOW)[0]
    expect(soft.startMin).toBeLessThan(12 * 60) // the tag default lands it in the morning
    const firm = scoreSlots(
      [],
      { title: 'deck', tag: 'work', durationMin: 60, window: 'afternoon', windowFirm: true },
      D,
      NOW
    )[0]
    expect(firm.startMin).toBeGreaterThanOrEqual(12 * 60)
    expect(firm.startMin).toBeLessThan(17 * 60)
  })

  it('an UN-firm window stays the soft term — byte-identical to today', () => {
    const soft = scoreSlots(
      [],
      { title: 'deck', tag: 'work', durationMin: 60, window: 'morning' },
      D,
      NOW
    )
    const bare = scoreSlots([], { title: 'deck', tag: 'work', durationMin: 60 }, D, NOW)
    // a morning window matches the work tag's own default, so the soft path is
    // unchanged; no "your usual" firmness wording appears without windowFirm
    expect(soft).toEqual(bare)
    expect(soft.every((c) => !c.why.includes('your usual'))).toBe(true)
  })
})

describe('scheduler — restInsertion (pacing rest in a long run, #103)', () => {
  it('a >90-min continuous run earns one short breather right after the stretch', () => {
    const run = mk({ title: 'Deep work', startMin: 9 * 60, endMin: 11 * 60 + 30 }) // 150 min, > cap
    const r = restInsertion([run], D)
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('place')
    expect(r!.startMin).toBe(11 * 60 + 30) // the air just after the run
    expect(r!.endMin - r!.startMin).toBe(PACING_REST_MIN)
  })

  it('a run built from back-to-back blocks (<15-min air) is one continuous stretch', () => {
    // 09:00–10:30 then 10:35–12:00: 5-min air doesn't break the run → 180 min total
    const blocks = [
      mk({ title: 'A', startMin: 9 * 60, endMin: 10 * 60 + 30 }),
      mk({ title: 'B', startMin: 10 * 60 + 35, endMin: 12 * 60 }),
    ]
    const r = restInsertion(blocks, D)
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('place')
    expect(r!.startMin).toBe(12 * 60) // after the whole stretch
  })

  it('a day already broken by a rest gets nothing added', () => {
    const blocks = [
      mk({ title: 'Morning', startMin: 9 * 60, endMin: 10 * 60 + 30 }),
      mk({ title: 'Lunch', tag: 'rest', startMin: 12 * 60, endMin: 13 * 60 }),
      mk({ title: 'Afternoon', startMin: 13 * 60, endMin: 14 * 60 + 30 }),
    ]
    expect(restInsertion(blocks, D)).toBeNull()
  })

  it('a run under the cap earns nothing', () => {
    const run = mk({ title: 'Short', startMin: 9 * 60, endMin: 10 * 60 + 15 }) // 75 min, < cap
    expect(restInsertion([run], D)).toBeNull()
  })

  it('is idempotent — re-running after the breather lands inserts no second rest', () => {
    const run = mk({ title: 'Deep work', startMin: 9 * 60, endMin: 11 * 60 + 30 })
    const r = restInsertion([run], D)!
    const breather = mk({
      title: 'Breather',
      tag: 'rest',
      startMin: r.startMin,
      endMin: r.endMin,
      protected: false,
    })
    expect(restInsertion([run, breather], D)).toBeNull()
  })

  it('only offers (suggest) when a wall-to-wall run leaves no room without displacing work', () => {
    // work fills the whole day to its end — no free seam at or after the run
    const run = mk({ title: 'All day', startMin: 8 * 60, endMin: 18 * 60 + 30 })
    const r = restInsertion([run], D)
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('suggest')
    expect(r!.startMin).toBe(8 * 60)
    expect(r!.endMin).toBe(18 * 60 + 30)
  })

  it('the inserted breather is short and absorbable (≤20 min)', () => {
    const run = mk({ title: 'Deep work', startMin: 9 * 60, endMin: 11 * 60 })
    const r = restInsertion([run], D)!
    expect(r.endMin - r.startMin).toBeLessThanOrEqual(20)
    expect(r.endMin - r.startMin).toBeGreaterThanOrEqual(10)
  })

  it('a background hold over the run is transparent — it neither forms nor breaks a run', () => {
    const blocks = [
      mk({ title: 'Deep work', startMin: 9 * 60, endMin: 11 * 60 + 30 }),
      mk({
        title: 'Spotify',
        tag: 'private',
        attention: 'background',
        startMin: 9 * 60,
        endMin: 12 * 60,
      }),
    ]
    const r = restInsertion(blocks, D)
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('place') // the background hold doesn't fill the seam
  })

  it('an optional (tentative) block neither counts as the run nor blocks the seam', () => {
    // 150-min run, then an OPTIONAL block sitting in the air after it
    const blocks = [
      mk({ title: 'Deep work', startMin: 9 * 60, endMin: 11 * 60 + 30 }),
      mk({ title: 'Maybe coffee', optional: true, startMin: 11 * 60 + 30, endMin: 12 * 60 }),
    ]
    const r = restInsertion(blocks, D)
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('place')
    expect(r!.startMin).toBe(11 * 60 + 30) // the optional block is transparent to the seam
  })
})

describe('scheduler — driftCollisions (own-vs-own drift #324)', () => {
  const push = (over: Partial<Block> = {}) =>
    mk({ title: 'STG push', tag: 'work', startMin: 12 * 60, endMin: 13 * 60, ...over })
  const driftOf = (r: ReturnType<typeof driftCollisions>, name: string) =>
    r.drifts.find((d) => d.block.title.toLowerCase().startsWith(name))!

  it('the transcript: a work push clears own lunch + errand in one pass, none left overlapping', () => {
    const lunch = mk({ title: 'Lunch', tag: 'private', startMin: 12 * 60, endMin: 12 * 60 + 45 })
    const errand = mk({
      title: 'groceries order',
      tag: 'private',
      startMin: 12 * 60 + 15,
      endMin: 12 * 60 + 45,
    })
    const work = push()
    const blocks = [lunch, errand, work]

    const r = driftCollisions(blocks, work, D, NOW)
    expect(r.fixed).toEqual([])
    expect(r.stuck).toEqual([])
    expect(r.drifts).toHaveLength(2)

    // lunch re-anchors through the circadian scorer, back inside its noon window
    const l = driftOf(r, 'lunch')
    expect(l.viaScorer).toBe(true)
    expect(l.toStartMin).toBe(13 * 60) // "moved lunch to 13:00 to clear the STG push"
    expect(l.toStartMin).toBeGreaterThanOrEqual(12 * 60)
    expect(l.toEndMin).toBeLessThanOrEqual(14 * 60)

    // the errand takes the nearest later gap (not the scorer), never earlier
    const e = driftOf(r, 'groceries')
    expect(e.viaScorer).toBe(false)
    expect(e.toStartMin).toBeGreaterThanOrEqual(work.endMin)

    // apply the plan → nothing the push touches still overlaps it
    let after = blocks
    for (const d of r.drifts)
      after = after.map((b) =>
        b.id === d.block.id ? { ...b, startMin: d.toStartMin, endMin: d.toEndMin } : b
      )
    const stillOver = after.filter(
      (b) => b.id !== work.id && overlaps(b.startMin, b.endMin, work.startMin, work.endMin)
    )
    expect(stillOver).toEqual([])
  })

  it('external and fixed blocks are never moved — an honest overlap note, not a drift', () => {
    const meeting = mk({
      title: 'Board meeting',
      external: { calId: 'work', eventId: 'b1' },
      startMin: 12 * 60,
      endMin: 13 * 60,
    })
    const interview = mk({ title: 'Interview with Sam', startMin: 12 * 60, endMin: 13 * 60 })
    const work = push()
    const r = driftCollisions([meeting, interview, work], work, D, NOW)
    expect(r.drifts).toEqual([])
    expect(r.stuck).toEqual([])
    expect(r.fixed.map((b) => b.id).sort()).toEqual([interview.id, meeting.id].sort())
  })

  it('sacred rest is left to the protect-rest flow — never auto-drifted here', () => {
    const rest = mk({ title: 'Rest — earned', tag: 'rest', startMin: 12 * 60, endMin: 13 * 60 })
    const work = push()
    const r = driftCollisions([rest, work], work, D, NOW)
    expect(r.drifts).toEqual([])
    expect(r.fixed).toEqual([])
    expect(r.stuck).toEqual([]) // neither drifted nor offered — protect-rest owns it
  })

  it('no clean slot → the flexible block is stuck (the offer_choices fallback), not silently overlapped', () => {
    // an external all-day block leaves the day with no free air for the meal
    const allDay = mk({
      title: 'Conference',
      external: { calId: 'work', eventId: 'c1' },
      startMin: 8 * 60,
      endMin: 22 * 60 + 30,
    })
    const lunch = mk({ title: 'Lunch', tag: 'private', startMin: 12 * 60, endMin: 12 * 60 + 45 })
    const work = push({ startMin: 12 * 60, endMin: 12 * 60 + 45 })
    const r = driftCollisions([allDay, lunch, work], work, D, NOW)
    expect(r.drifts).toEqual([])
    expect(r.fixed.map((b) => b.id)).toEqual([allDay.id]) // the conference stays put
    expect(r.stuck.map((b) => b.id)).toEqual([lunch.id]) // nowhere clean → offer, not overlap
  })

  it('a background hold shares the clock, not the slot — it clears nothing', () => {
    const lunch = mk({ title: 'Lunch', tag: 'private', startMin: 12 * 60, endMin: 12 * 60 + 45 })
    const bg = push({ attention: 'background' })
    const r = driftCollisions([lunch, bg], bg, D, NOW)
    expect(r).toEqual({ drifts: [], fixed: [], stuck: [] })
  })
})

describe('scheduler — moveBlockedBy (direct-manip drop validity #347)', () => {
  // the block being dragged, dropped onto [12:00, 13:00) on day D
  const dropAt = (blocks: Block[]) => moveBlockedBy(blocks, D, 12 * 60, 13 * 60, 'dragged')
  const dragged = () =>
    mk({ id: 'dragged', title: 'Reply', protected: false, startMin: 15 * 60, endMin: 15 * 60 + 30 })

  it('an external calendar block in the drop bounces it — a fact, scheduled around', () => {
    const meeting = mk({
      title: 'Board sync',
      external: { calId: 'work', eventId: 'b1' },
      startMin: 12 * 60,
      endMin: 13 * 60,
    })
    expect(dropAt([meeting, dragged()]).map((b) => b.id)).toEqual([meeting.id])
  })

  it('a fixed-time (meeting-word) block bounces the drop even when it is not protected', () => {
    const interview = mk({
      title: 'Interview with Dana',
      protected: false,
      startMin: 12 * 60,
      endMin: 13 * 60,
    })
    expect(dropAt([interview, dragged()]).map((b) => b.id)).toEqual([interview.id])
  })

  it('a protected block bounces the drop — a stray gesture never shoves what the owner held', () => {
    const held = mk({ title: 'Deep work', protected: true, startMin: 12 * 60, endMin: 13 * 60 })
    expect(dropAt([held, dragged()]).map((b) => b.id)).toEqual([held.id])
  })

  it('an unprotected own-flexible block is NOT a blocker — it drifts (#324), so the move commits', () => {
    const flexible = mk({
      title: 'Lunch',
      tag: 'private',
      protected: false,
      startMin: 12 * 60,
      endMin: 13 * 60,
    })
    expect(dropAt([flexible, dragged()])).toEqual([])
  })

  it('a clear drop has no blockers', () => {
    const elsewhere = mk({ title: 'Standup', startMin: 9 * 60, endMin: 10 * 60 })
    expect(dropAt([elsewhere, dragged()])).toEqual([])
  })
})
