/* #81 — the scenario quote carries "the owner stated this length". Pure pins on
   generateScenarios: every profile's places (the classic set AND energy-fit, which
   builds its own) carry durationStated for a stated task and nothing for the rest,
   so a plan with no stated lengths stays byte-identical, and "always" pre-sizing
   leaves a stated length exactly as asked. The store pins live in
   state/__tests__/picker-stated-length.test.ts. */
import { describe, expect, it } from 'vitest'
import { generateScenarios, type ScenarioTask } from '../scenarios'
import type { EnergyProfile, FocusClass } from '../energy'

const D = '2026-06-09'
const OPTS = { nowMin: 8 * 60, todayKey: D, horizonDays: 6 }
function counter(): () => string {
  let n = 0
  return () => `sc-${++n}`
}

const TASKS: ScenarioTask[] = [
  { title: 'Deck', tag: 'work', durationMin: 90, durationStated: true },
  { title: 'Model', tag: 'work', durationMin: 60 },
  { title: 'Spec', tag: 'work', durationMin: 60 },
  { title: 'Inbox', tag: 'private', durationMin: 30, durationStated: true },
  { title: 'Groceries', tag: 'private', durationMin: 30 },
]
const STATED = new Set(['Deck', 'Inbox'])

/* a flat deep-work rhythm — enough for energy-fit to join the set */
const zero = () => ({ completed: 0, attempted: 0, rate: null as number | null })
const deepOnly = (rate: number): Record<FocusClass, ReturnType<typeof zero>> => ({
  deep: { completed: Math.round(rate * 10), attempted: 10, rate },
  admin: zero(),
  health: zero(),
})
const FLAT: EnergyProfile = {
  cells: {
    morning: deepOnly(0.8),
    midday: deepOnly(0.8),
    late: deepOnly(0.8),
    evening: deepOnly(0.8),
  },
}

const gen = (tasks: ScenarioTask[], extra: object = {}) =>
  generateScenarios([], tasks, { ...OPTS, ...extra, ids: counter() })

describe('the quote carries the stated flag through every profile (#81)', () => {
  it('classic profiles and energy-fit: stated places say so, the rest carry no key', () => {
    const all = gen(TASKS, { energyProfile: FLAT, batchAdmin: true })
    expect(all.some((s) => s.name === 'energy-fit')).toBe(true)
    for (const s of all)
      for (const p of s.places) {
        if (STATED.has(p.title)) expect(p.durationStated).toBe(true)
        else expect(Object.keys(p)).not.toContain('durationStated')
      }
  })

  it('no stated task → no place carries the key (byte-identical quotes)', () => {
    const plain = TASKS.map(({ durationStated: _drop, ...t }) => t)
    for (const s of gen(plain, { energyProfile: FLAT }))
      for (const p of s.places) expect(Object.keys(p)).not.toContain('durationStated')
  })

  it('"always" pre-size leaves a stated length as asked and grows the unstated', () => {
    const sized = gen(TASKS, { estimateFactor: { deep: 1.2, admin: null, health: null } })
    for (const s of sized) {
      const deck = s.places.find((p) => p.title === 'Deck')
      const model = s.places.find((p) => p.title === 'Model')
      if (deck) expect(deck.durationMin).toBe(90)
      if (model) expect(model.durationMin).toBe(70)
    }
  })
})
