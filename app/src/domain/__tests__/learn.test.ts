import { describe, expect, it } from 'vitest'
import {
  candidateToRule,
  confirmedRulesFrom,
  detectTaskRules,
  dismissedMatchesFrom,
  offerPhrase,
  parseLearnedRule,
  type RuleCandidate,
} from '../learn'
import type { MemoryEvent } from '../types'
import type { LearnedRule } from '../prefs'

let seq = 0
/** a completed event with the canonical "deck" signature; override per test */
const done = (over: Partial<MemoryEvent> = {}): MemoryEvent => ({
  id: `e${seq++}`,
  ts: 0,
  kind: 'completed',
  dayKey: '2026-06-01',
  title: 'the deck',
  tag: 'work',
  plannedMin: 90,
  startMin: 9 * 60, // morning (windowOf < 12:00)
  ...over,
})

describe('detectTaskRules — support + variance', () => {
  it('a title placed 3× with a consistent signature yields exactly one candidate', () => {
    const cands = detectTaskRules([done(), done(), done()], [], [])
    expect(cands).toHaveLength(1)
    expect(cands[0]).toMatchObject({
      match: 'the deck',
      title: 'the deck',
      support: 3,
      dims: { durationMin: 90, tag: 'work', window: 'morning' },
    })
    expect(cands[0].dims.attention).toBeUndefined() // focus is the default — never surfaced
  })

  it('below the support threshold yields nothing', () => {
    expect(detectTaskRules([done(), done()], [], [])).toHaveLength(0)
  })

  it('a varying duration drops only that dim', () => {
    const evs = [done({ plannedMin: 60 }), done({ plannedMin: 90 }), done({ plannedMin: 120 })]
    const c = detectTaskRules(evs, [], [])[0]
    expect(c.dims.durationMin).toBeUndefined() // spread 60 > tolerance
    expect(c.dims.tag).toBe('work')
    expect(c.dims.window).toBe('morning')
  })

  it('a small duration spread is still consistent (median, 5-min granularity)', () => {
    const evs = [done({ plannedMin: 85 }), done({ plannedMin: 90 }), done({ plannedMin: 95 })]
    expect(detectTaskRules(evs, [], [])[0].dims.durationMin).toBe(90) // spread 10 ≤ 15
  })

  it('a varying tag drops only that dim', () => {
    const evs = [done({ tag: 'work' }), done({ tag: 'private' }), done({ tag: 'work' })]
    const c = detectTaskRules(evs, [], [])[0]
    expect(c.dims.tag).toBeUndefined()
    expect(c.dims.durationMin).toBe(90)
    expect(c.dims.window).toBe('morning')
  })

  it('a varying window drops only that dim', () => {
    const evs = [
      done({ startMin: 9 * 60 }),
      done({ startMin: 14 * 60 }),
      done({ startMin: 9 * 60 }),
    ]
    const c = detectTaskRules(evs, [], [])[0]
    expect(c.dims.window).toBeUndefined() // morning, afternoon, morning
    expect(c.dims.durationMin).toBe(90)
    expect(c.dims.tag).toBe('work')
  })

  it('unanimous background is surfaced; focus (the default) is not', () => {
    const bg = detectTaskRules(
      [
        done({ attention: 'background' }),
        done({ attention: 'background' }),
        done({ attention: 'background' }),
      ],
      [],
      []
    )[0]
    expect(bg.dims.attention).toBe('background')
    expect(detectTaskRules([done(), done(), done()], [], [])[0].dims.attention).toBeUndefined()
  })

  it('a varying attention drops that dim', () => {
    const evs = [done({ attention: 'background' }), done(), done({ attention: 'background' })]
    expect(detectTaskRules(evs, [], [])[0].dims.attention).toBeUndefined() // background/focus/background
  })

  it('when every dimension varies, no rule forms', () => {
    const evs = [
      done({ plannedMin: 30, tag: 'work', startMin: 9 * 60 }),
      done({ plannedMin: 90, tag: 'private', startMin: 14 * 60 }),
      done({ plannedMin: 150, tag: 'health', startMin: 19 * 60 }),
    ]
    expect(detectTaskRules(evs, [], [])).toHaveLength(0)
  })
})

describe('detectTaskRules — skips + ordering', () => {
  it('skips a title already covered by a confirmed rule or stated pref', () => {
    const evs = [done(), done(), done()]
    expect(detectTaskRules(evs, ['deck'], [])).toHaveLength(0) // "deck" ⊂ "the deck"
    expect(detectTaskRules(evs, ['standup'], [])).toHaveLength(1) // unrelated coverage is inert
  })

  it('never re-offers a dismissed pattern', () => {
    const evs = [done(), done(), done()]
    expect(detectTaskRules(evs, [], ['the deck'])).toHaveLength(0)
  })

  it('orders strongest support first — one candidate is offered at a time', () => {
    const evs = [
      done({ title: 'gym', tag: 'health' }),
      done({ title: 'gym', tag: 'health' }),
      done({ title: 'gym', tag: 'health' }),
      done({ title: 'the deck' }),
      done({ title: 'the deck' }),
      done({ title: 'the deck' }),
      done({ title: 'the deck' }),
    ]
    expect(detectTaskRules(evs, [], []).map((c) => c.match)).toEqual(['the deck', 'gym'])
  })
})

describe('candidateToRule — the confirmed flat rule (#328 input)', () => {
  it('flattens only the consistent dims and records provenance', () => {
    const c: RuleCandidate = {
      match: 'the deck',
      title: 'the deck',
      support: 3,
      dims: { durationMin: 90, tag: 'work', window: 'morning' },
    }
    expect(candidateToRule(c)).toEqual({
      match: 'the deck',
      durationMin: 90,
      tag: 'work',
      window: 'morning',
      stated: 'the deck — learned from what you do',
    })
  })
})

describe('offerPhrase — positive voice, names what you do, asks once', () => {
  it('the canonical deck offer', () => {
    const c: RuleCandidate = {
      match: 'q3 deck',
      title: 'Q3 deck',
      support: 3,
      dims: { durationMin: 90, tag: 'work', window: 'morning' },
    }
    expect(offerPhrase(c)).toBe(
      'you\'ve been blocking "Q3 deck" as 90 min of deep work in the morning a few times — want me to just do that from now on?'
    )
  })

  it('a short background block reads naturally', () => {
    const c: RuleCandidate = {
      match: 'inbox',
      title: 'inbox',
      support: 3,
      dims: { durationMin: 30, tag: 'work', window: 'afternoon', attention: 'background' },
    }
    expect(offerPhrase(c)).toBe(
      'you\'ve been blocking "inbox" as 30 min of work in the afternoon in the background a few times — want me to just do that from now on?'
    )
  })

  it('never blames — no missed/failed/always/should', () => {
    const c: RuleCandidate = { match: 'gym', title: 'gym', support: 5, dims: { window: 'evening' } }
    const p = offerPhrase(c)
    expect(p).toBe(
      'you\'ve been blocking "gym" in the evening a few times — want me to just do that from now on?'
    )
    expect(p).not.toMatch(/miss|fail|always|never|should/i)
  })
})

describe('reading confirmed + dismissed rules back from memory', () => {
  const rule: LearnedRule = { match: 'the deck', durationMin: 90, tag: 'work', window: 'morning' }

  it('confirmedRulesFrom returns learned_rule events, newest per match wins', () => {
    const mem: MemoryEvent[] = [
      {
        id: 'a',
        ts: 1,
        kind: 'learned_rule',
        dayKey: '2026-06-01',
        rule: { ...rule, durationMin: 60 },
      },
      { id: 'b', ts: 2, kind: 'learned_rule', dayKey: '2026-06-02', rule },
      { id: 'c', ts: 3, kind: 'completed', dayKey: '2026-06-02', title: 'x' },
    ]
    expect(confirmedRulesFrom(mem)).toEqual([rule]) // deduped by match, newest confirmation
  })

  it('dismissedMatchesFrom returns the rejected matches', () => {
    const mem: MemoryEvent[] = [
      { id: 'a', ts: 1, kind: 'dismissed_rule', dayKey: '2026-06-01', rule: { match: 'standup' } },
      { id: 'b', ts: 2, kind: 'completed', dayKey: '2026-06-01', title: 'standup' },
    ]
    expect(dismissedMatchesFrom(mem)).toEqual(['standup'])
  })
})

describe('parseLearnedRule — chip payload round-trip', () => {
  it('round-trips a serialized rule and rejects junk', () => {
    const rule: LearnedRule = { match: 'the deck', durationMin: 90 }
    expect(parseLearnedRule(JSON.stringify(rule))).toEqual(rule)
    expect(parseLearnedRule('not json')).toBeNull()
    expect(parseLearnedRule('{}')).toBeNull() // no match
    expect(parseLearnedRule('{"match":""}')).toBeNull()
  })
})
