/* The sidecar handshake is module state with one ranking rule; the rule is
   pure, so it gets pinned here: explicit Settings opt-in > live sidecar >
   the keyless floor. */

import { afterEach, describe, expect, it } from 'vitest'
import { effectiveBrain, setSidecarBrain, sidecarBrain } from '../sidecar'

const OFF = { brainEnabled: false, brainUrl: 'http://localhost:3131', brainToken: '' }
const MINE = { brainEnabled: true, brainUrl: 'http://my-brain:9999', brainToken: 'gbrain_mine' }

afterEach(() => setSidecarBrain(null))

describe('effectiveBrain ranking', () => {
  it('default: no opt-in, no sidecar — the brain is off', () => {
    expect(effectiveBrain(OFF)).toEqual({ url: OFF.brainUrl, token: '', on: false })
  })

  it('a sidecar handshake turns the brain on without touching Settings', () => {
    setSidecarBrain({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh' })
    expect(effectiveBrain(OFF)).toEqual({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh', on: true })
  })

  it('explicit Settings config outranks the sidecar — the user meant it', () => {
    setSidecarBrain({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh' })
    expect(effectiveBrain(MINE)).toEqual({ url: MINE.brainUrl, token: MINE.brainToken, on: true })
  })

  it('a restart hands over fresh credentials; a final crash hands back the floor', () => {
    setSidecarBrain({ url: 'http://127.0.0.1:1000', token: 'gbrain_a' })
    setSidecarBrain({ url: 'http://127.0.0.1:2000', token: 'gbrain_b' })
    expect(effectiveBrain(OFF).url).toBe('http://127.0.0.1:2000')
    setSidecarBrain(null)
    expect(sidecarBrain()).toBeNull()
    expect(effectiveBrain(OFF).on).toBe(false)
  })
})
