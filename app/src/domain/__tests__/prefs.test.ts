import { describe, expect, it } from 'vitest'
import {
  batchAdminRule,
  deepWorkAnytime,
  flexOverride,
  matchesPref,
  parseDurationValue,
  parseTimeValue,
  resolveTaskSpec,
  type LearnedRule,
  type TaskSpec,
} from '../prefs'
import type { PrefPayload } from '../types'

const pref = (over: Partial<PrefPayload>): PrefPayload => ({
  kind: 'fact',
  match: 'gym',
  value: 'x',
  stated: 's',
  ...over,
})

describe('matchesPref — normalized phrase on token boundaries, base title only', () => {
  it('matches case-insensitively and inside the base half', () => {
    expect(matchesPref('Gym', 'gym')).toBe(true)
    expect(matchesPref('Morning gym session', 'gym')).toBe(true)
    expect(matchesPref('Q3 deck — gym metaphors', 'gym')).toBe(false) // detail half doesn't count
    expect(matchesPref('Standup', 'gym')).toBe(false)
    expect(matchesPref('anything', '')).toBe(false)
  })

  it('whole tokens only — a rule for "call" never hits "Recall budget"', () => {
    expect(matchesPref('Recall budget', 'call')).toBe(false)
    expect(matchesPref('Gymnastics', 'gym')).toBe(false)
    expect(matchesPref('Call with the bank', 'call')).toBe(true)
    expect(matchesPref('Weekly design sync', 'design sync')).toBe(true) // multi-word phrases still land
  })
})

describe('value parsing', () => {
  it('times: "starts 07:00", bare "7am"', () => {
    expect(parseTimeValue('starts 07:00')).toBe(420)
    expect(parseTimeValue('7am')).toBe(420)
    expect(parseTimeValue('6 pm')).toBe(18 * 60)
    expect(parseTimeValue('whenever')).toBeNull()
  })
  it('durations: "45m", "1.5h"', () => {
    expect(parseDurationValue('45m')).toBe(45)
    expect(parseDurationValue('1.5h')).toBe(90)
    expect(parseDurationValue('soon')).toBeNull()
  })
})

describe('resolveTaskSpec — stated rules fill defaults, explicit always wins', () => {
  const timePref = pref({ kind: 'time-default', value: 'starts 07:00' })
  const durPref = pref({ kind: 'duration-default', match: 'deploy', value: '45m' })

  it('fills a missing start from a time-default', () => {
    const { spec, applied } = resolveTaskSpec('gym', {}, [timePref])
    expect(spec.startMin).toBe(420)
    expect(applied).toEqual([timePref])
  })

  it('never touches an explicit start — even against the user’s own rule', () => {
    const { spec, applied } = resolveTaskSpec('gym', { startMin: 18 * 60 }, [timePref])
    expect(spec.startMin).toBe(18 * 60)
    expect(applied).toHaveLength(0)
  })

  it('fills duration; leaves stated durations and end-bounded specs alone', () => {
    expect(resolveTaskSpec('deploy api', {}, [durPref]).spec.durationMin).toBe(45)
    expect(resolveTaskSpec('deploy api', { durationMin: 90 }, [durPref]).spec.durationMin).toBe(90)
    expect(
      resolveTaskSpec('deploy api', { startMin: 600, endMin: 660 }, [durPref]).spec.durationMin
    ).toBeUndefined()
  })

  it('non-matching rules are inert — the spec is returned untouched', () => {
    const { spec, applied, learned, credit } = resolveTaskSpec('standup', {}, [timePref, durPref])
    expect(spec).toEqual({})
    expect(applied).toHaveLength(0)
    expect(learned).toBeNull()
    expect(credit).toBeNull()
  })
})

describe('resolveTaskSpec — a confirmed rule prefills the FULL spec (#328)', () => {
  const deckRule: LearnedRule = {
    match: 'deck',
    durationMin: 90,
    tag: 'work',
    window: 'morning',
    attention: 'focus',
    protected: true,
    stated: 'the deck is 90-min deep work in the morning',
  }

  it('fills duration + tag + firm window + attention + protected when all unstated', () => {
    const r = resolveTaskSpec('deck', {}, [], undefined, [deckRule])
    expect(r.spec.durationMin).toBe(90)
    expect(r.spec.tag).toBe('work')
    expect(r.spec.window).toBe('morning')
    expect(r.spec.windowFirm).toBe(true) // a confirmed window is FIRM, not a nudge
    expect(r.spec.attention).toBe('focus')
    expect(r.spec.protected).toBe(true)
    expect(r.learned).toBe(deckRule)
  })

  it('the reply names what memory filled, once', () => {
    // deep work (work tag, ≥60m) + the confirmed morning window
    expect(resolveTaskSpec('deck', {}, [], undefined, [deckRule]).credit).toBe(
      'deep work, your usual morning'
    )
    // a rule that only pins the window credits only that
    expect(
      resolveTaskSpec('walk', {}, [], undefined, [{ match: 'walk', window: 'evening' }]).credit
    ).toBe('your usual evening')
    // a short work block is not "deep work"
    expect(
      resolveTaskSpec('standup', {}, [], undefined, [
        { match: 'standup', tag: 'work', window: 'morning' },
      ]).credit
    ).toBe('your usual morning')
  })

  it('explicit words THIS TURN win over the confirmed rule, field by field', () => {
    const spec: TaskSpec = {
      startMin: 15 * 60,
      endMin: 15 * 60 + 30, // an explicit 30-min block at 3pm
      tag: 'private',
      attention: 'background',
      protected: false,
    }
    const r = resolveTaskSpec('deck', spec, [], undefined, [deckRule])
    expect(r.spec.durationMin).toBeUndefined() // end-bounded ⇒ explicit duration, rule stays out
    expect(r.spec.tag).toBe('private')
    expect(r.spec.attention).toBe('background')
    expect(r.spec.protected).toBe(false)
    expect(r.spec.window).toBeUndefined() // the user pinned an exact time; no firm window imposed
  })

  it('a stated PrefPayload outranks a learned rule for the same field', () => {
    const durPref = pref({ kind: 'duration-default', match: 'deck', value: '30m' })
    const r = resolveTaskSpec('deck', {}, [durPref], undefined, [deckRule])
    expect(r.spec.durationMin).toBe(30) // the user's stated 30m beats the learned 90m
    expect(r.applied).toEqual([durPref])
    expect(r.spec.window).toBe('morning') // other fields still fill from the learned rule
  })
})

describe('duration precedence — explicit > stated rule > learned rule > your usual > the floor', () => {
  const HIST = new Map([['interview prep', { median: 40, n: 3 }]])
  const durPref = pref({ kind: 'duration-default', match: 'interview prep', value: '45m' })
  const durRule: LearnedRule = { match: 'interview prep', durationMin: 75 }

  it('level 1 — an explicit duration silences everything below it', () => {
    const r = resolveTaskSpec('Interview prep', { durationMin: 90 }, [durPref], HIST, [durRule])
    expect(r.spec.durationMin).toBe(90)
    expect(r.applied).toHaveLength(0)
    expect(r.usual).toBeNull()
  })

  it('level 2a — a stated rule outranks a learned rule and history', () => {
    const r = resolveTaskSpec('Interview prep', {}, [durPref], HIST, [durRule])
    expect(r.spec.durationMin).toBe(45)
    expect(r.applied).toEqual([durPref])
    expect(r.usual).toBeNull()
  })

  it('level 2b — a learned rule outranks history', () => {
    const r = resolveTaskSpec('Interview prep', {}, [], HIST, [durRule])
    expect(r.spec.durationMin).toBe(75)
    expect(r.usual).toBeNull()
  })

  it('level 3 — with no rule, the real median sizes the block and is credited', () => {
    const r = resolveTaskSpec('Interview prep — Mira', {}, [], HIST)
    expect(r.spec.durationMin).toBe(40)
    expect(r.usual).toEqual({ median: 40, n: 3 })
  })

  it('level 4 — no signal anywhere leaves the field for the 60-min floor downstream', () => {
    const r = resolveTaskSpec('Brand new thing', {}, [], HIST)
    expect(r.spec.durationMin).toBeUndefined()
    expect(r.usual).toBeNull()
  })

  it('an explicit end time is an explicit duration — rules and history stay out', () => {
    const r = resolveTaskSpec('Interview prep', { startMin: 540, endMin: 600 }, [], HIST, [durRule])
    expect(r.spec.durationMin).toBeUndefined()
    expect(r.usual).toBeNull()
  })

  it('n<3 means no map entry means clean fall-through', () => {
    const r = resolveTaskSpec('Interview prep', {}, [], new Map())
    expect(r.spec.durationMin).toBeUndefined()
    expect(r.usual).toBeNull()
  })
})

describe('resolveTaskSpec — no rule + no history is byte-identical to the input spec', () => {
  it('returns the spec untouched with empty/ null metadata', () => {
    const spec: TaskSpec = { startMin: 9 * 60, durationMin: 60, tag: 'work' }
    const r = resolveTaskSpec('Brand new thing', spec, [], new Map(), [])
    expect(r.spec).toEqual(spec)
    expect(r.applied).toEqual([])
    expect(r.usual).toBeNull()
    expect(r.learned).toBeNull()
    expect(r.credit).toBeNull()
  })
})

describe('flexOverride — the user’s rule outranks the word heuristic', () => {
  it('reads both directions and stays null without a matching rule', () => {
    expect(
      flexOverride('Team sync', [
        pref({ kind: 'flexibility', match: 'sync', value: 'can always move' }),
      ])
    ).toBe('flexible')
    expect(
      flexOverride('Morning pages', [
        pref({ kind: 'flexibility', match: 'pages', value: 'never moves' }),
      ])
    ).toBe('fixed')
    expect(
      flexOverride('Team sync', [
        pref({ kind: 'flexibility', match: 'standup', value: 'never moves' }),
      ])
    ).toBeNull()
    expect(flexOverride('Team sync', [])).toBeNull()
  })
})

describe('energy-fit standing rules (#321) — stated word outranks the learned profile', () => {
  const p = (over: Partial<PrefPayload>): PrefPayload => ({
    kind: 'fact',
    match: '',
    value: '',
    stated: '',
    ...over,
  })

  it('deepWorkAnytime recognizes the canonical "deep work → anytime" flexibility rule', () => {
    expect(
      deepWorkAnytime([p({ kind: 'flexibility', match: 'deep work', value: 'anytime' })])
    ).toBe(true)
    // unrelated flexibility rules do not trip it
    expect(deepWorkAnytime([p({ kind: 'flexibility', match: 'gym', value: 'never moves' })])).toBe(
      false
    )
    expect(deepWorkAnytime([])).toBe(false)
  })

  it('batchAdminRule recognizes the canonical "admin → batch" ordering rule', () => {
    expect(batchAdminRule([p({ kind: 'ordering', match: 'admin', value: 'batch' })])).toBe(true)
    // an ordinary ordering rule is not a batch instruction
    expect(
      batchAdminRule([p({ kind: 'ordering', match: 'review', value: 'before standup' })])
    ).toBe(false)
    expect(batchAdminRule([])).toBe(false)
  })
})
