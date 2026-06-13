import { describe, expect, it } from 'vitest'
import { applyPrefs, flexOverride, matchesPref, parseDurationValue, parseTimeValue } from '../prefs'
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

describe('applyPrefs — rules fill defaults, explicit always wins', () => {
  const timePref = pref({ kind: 'time-default', value: 'starts 07:00' })
  const durPref = pref({ kind: 'duration-default', match: 'deploy', value: '45m' })

  it('fills a missing start from a time-default', () => {
    const { spec, applied } = applyPrefs({ title: 'gym' }, [timePref])
    expect(spec.startMin).toBe(420)
    expect(applied).toEqual([timePref])
  })

  it('never touches an explicit start — even against the user’s own rule', () => {
    const { spec, applied } = applyPrefs({ title: 'gym', startMin: 18 * 60 }, [timePref])
    expect(spec.startMin).toBe(18 * 60)
    expect(applied).toHaveLength(0)
  })

  it('fills duration; leaves stated durations and end-bounded specs alone', () => {
    expect(applyPrefs({ title: 'deploy api' }, [durPref]).spec.durationMin).toBe(45)
    expect(applyPrefs({ title: 'deploy api', durationMin: 90 }, [durPref]).spec.durationMin).toBe(90)
    expect(applyPrefs({ title: 'deploy api', startMin: 600, endMin: 660 }, [durPref]).spec.durationMin).toBeUndefined()
  })

  it('non-matching rules are inert', () => {
    const { spec, applied } = applyPrefs({ title: 'standup' }, [timePref, durPref])
    expect(spec).toEqual({ title: 'standup' })
    expect(applied).toHaveLength(0)
  })
})

describe('flexOverride — the user’s rule outranks the word heuristic', () => {
  it('reads both directions and stays null without a matching rule', () => {
    expect(flexOverride('Team sync', [pref({ kind: 'flexibility', match: 'sync', value: 'can always move' })])).toBe('flexible')
    expect(flexOverride('Morning pages', [pref({ kind: 'flexibility', match: 'pages', value: 'never moves' })])).toBe('fixed')
    expect(flexOverride('Team sync', [pref({ kind: 'flexibility', match: 'standup', value: 'never moves' })])).toBeNull()
    expect(flexOverride('Team sync', [])).toBeNull()
  })
})
