/* The context block is the model's only window onto brain state (#249). Two
   honesty rules get pinned: a brain that is OFF must say so explicitly — a
   silent absence reads as "nothing recalled", and the model then presents
   local patterns as memory — and pattern lines are always framed as computed
   on-device, never as "the brain". */

import { describe, expect, it } from 'vitest'
import { contextBlock, MEW_VOICE, type WeekContext } from '../types'

const base: WeekContext = {
  todayKey: '2026-06-09',
  todayLabel: 'Tuesday, June 9',
  nowLabel: '9:40',
  weekSummary: ['today (2026-06-09): 9:00 Q3 deck [work]'],
  realisticBestH: 5.5,
  mewsToday: 2,
  insightLines: ['mornings hold: 9/10 finished there'],
  recallLines: [],
  brainOn: false,
  prefLines: [],
}

describe('contextBlock — brain-recall honesty', () => {
  it('brain off → an explicit off marker framed on-device, never a recall block', () => {
    const out = contextBlock(base)
    expect(out).toContain(
      '<brain-recall off note="no brain connected — running on on-device memory; recall did not run"/>'
    )
    expect(out).not.toContain('</brain-recall>')
  })

  it('the off marker frames the floor as on-device, not broken (#329)', () => {
    expect(contextBlock(base)).toContain('running on on-device memory')
  })

  it('brain on with recall → the recall block, no off marker', () => {
    const out = contextBlock({
      ...base,
      brainOn: true,
      recallLines: ['task/q3-deck — rolled twice last week'],
    })
    expect(out).toContain('<brain-recall note=')
    expect(out).toContain('task/q3-deck — rolled twice last week')
    expect(out).not.toContain('<brain-recall off')
  })

  it('brain on, nothing recalled this turn → silence (absence ≠ off)', () => {
    const out = contextBlock({ ...base, brainOn: true })
    expect(out).not.toContain('<brain-recall')
  })

  it("brain on but it didn't answer → an explicit degraded marker framed on-device (silence ≠ empty history)", () => {
    const out = contextBlock({ ...base, brainOn: true, recallDegraded: true })
    expect(out).toContain(
      `<brain-recall degraded note="brain didn't answer this turn — running on on-device memory; recall is missing, not empty"/>`
    )
    expect(out).toContain('running on on-device memory') // still-helpful, not broken (#329)
    expect(out).not.toContain('<brain-recall off')
  })

  it('real lines outrank the degraded marker — an answer that arrived is an answer', () => {
    const out = contextBlock({
      ...base,
      brainOn: true,
      recallDegraded: true,
      recallLines: ['task/q3-deck — rolled twice last week'],
    })
    expect(out).toContain('</brain-recall>')
    expect(out).not.toContain('degraded')
  })

  it('off outranks degraded — a brain that is not there cannot also be slow', () => {
    const out = contextBlock({ ...base, brainOn: false, recallDegraded: true })
    expect(out).toContain('<brain-recall off')
    expect(out).not.toContain('degraded')
  })
})

describe('patterns framing — on-device history, never "the brain"', () => {
  it('the <patterns> note names its on-device origin', () => {
    expect(contextBlock(base)).toContain(
      `<patterns note="computed on-device from the user's own history`
    )
  })

  it('MEW_VOICE never attributes the pattern lines to the brain', () => {
    expect(MEW_VOICE).not.toMatch(/brain's pattern lines/)
  })

  it('MEW_VOICE tells the model what the off marker means', () => {
    expect(MEW_VOICE).toContain('<brain-recall off/>')
    expect(MEW_VOICE).toMatch(/never imply recall ran/)
  })

  it('MEW_VOICE tells the model what the degraded marker means (#249)', () => {
    expect(MEW_VOICE).toContain('<brain-recall degraded/>')
    expect(MEW_VOICE).toMatch(/never an empty history/)
  })

  it('MEW_VOICE reframes off/degraded recall as on-device, not broken (#329)', () => {
    /* the model must present a silent/absent brain as still-helpful — "running
       on what you know on-device" — rather than reporting a failure */
    expect(MEW_VOICE).toMatch(/running on what you know on-device/)
  })
})

/* the weekly ritual recipe (#304) — a keyed model must run the same shape the
   keyless route runs, inside the #102 budget: read-only sweep, chip questions
   one per turn, ONE propose_scenarios, the pick is the one apply. */
describe('the weekly ritual recipe (#304)', () => {
  it('names the ritual and its trigger words', () => {
    expect(MEW_VOICE).toContain('"plan my week"')
    expect(MEW_VOICE).toMatch(/weekly shaping ritual/)
  })

  it('caps the questions and the per-round tool budget (#102)', () => {
    expect(MEW_VOICE).toMatch(/at most three shaping questions/)
    expect(MEW_VOICE).toMatch(/at most two tool calls in any question round/)
  })

  it('one propose call closes the ritual; generation stays read-only', () => {
    expect(MEW_VOICE).toMatch(/ONE propose_scenarios call/)
    expect(MEW_VOICE).toMatch(/Generation is read-only/)
    expect(MEW_VOICE).toMatch(/the user's pick is the one apply/)
  })
})

/* conversational referents (#320) — the keyed side of parity: naming the
   last-touched block in the context is what lets a keyed model resolve
   "it / that / the one after lunch" the SAME way the keyless floor does. */
describe('conversational referent — the keyed context names it (#320)', () => {
  it('a referent renders as a <just-touched> line the model can read', () => {
    const out = contextBlock({ ...base, referent: 'Q3 deck — thu 9:00' })
    expect(out).toContain('<just-touched')
    expect(out).toContain('Q3 deck — thu 9:00')
  })

  it('no referent → no just-touched line (nothing touched yet this session)', () => {
    expect(contextBlock(base)).not.toContain('<just-touched')
  })

  it('MEW_VOICE tells the model what <just-touched> means and to ask when unsure', () => {
    expect(MEW_VOICE).toContain('<just-touched>')
    expect(MEW_VOICE).toMatch(/wrong-block change breaks trust/i)
  })
})
