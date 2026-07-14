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
  it('brain off → an explicit off marker, never a recall block', () => {
    const out = contextBlock(base)
    expect(out).toContain('<brain-recall off note="no brain is connected — recall did not run"/>')
    expect(out).not.toContain('</brain-recall>')
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

  it("brain on but it didn't answer → an explicit degraded marker (silence ≠ empty history)", () => {
    const out = contextBlock({ ...base, brainOn: true, recallDegraded: true })
    expect(out).toContain(
      `<brain-recall degraded note="the brain didn't answer this turn — recall is missing, not empty"/>`
    )
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
})
