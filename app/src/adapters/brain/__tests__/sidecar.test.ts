/* The sidecar handshake is module state with one ranking rule; the rule is
   pure, so it gets pinned here: explicit Settings opt-in > live sidecar >
   the keyless floor. The status machine (#249) is pinned below it: the shell
   reports lifecycle beats, and only a credentialed handshake may claim
   'connected' — Settings renders this, so a dead brain is visibly dead. */

import { afterEach, describe, expect, it } from 'vitest'
import {
  adoptSidecarSnapshot,
  effectiveBrain,
  effectiveBrainKey,
  setSidecarBrain,
  setSidecarStatus,
  sidecarBrain,
  sidecarStatus,
} from '../sidecar'

const OFF = { brainEnabled: false, brainUrl: 'http://localhost:3131', brainToken: '' }
const MINE = { brainEnabled: true, brainUrl: 'http://my-brain:9999', brainToken: 'gbrain_mine' }

afterEach(() => setSidecarBrain(null))

describe('effectiveBrain ranking', () => {
  it('default: no opt-in, no sidecar — the brain is off', () => {
    expect(effectiveBrain(OFF)).toEqual({ url: OFF.brainUrl, token: '', on: false })
  })

  it('a sidecar handshake turns the brain on without touching Settings', () => {
    setSidecarBrain({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh' })
    expect(effectiveBrain(OFF)).toEqual({
      url: 'http://127.0.0.1:43217',
      token: 'gbrain_fresh',
      on: true,
    })
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

describe('effectiveBrainKey — the backfill ledger identity (#249)', () => {
  it('a Settings endpoint is identified by its URL, trailing slashes normalized', () => {
    expect(effectiveBrainKey(MINE)).toBe('endpoint:http://my-brain:9999')
    expect(effectiveBrainKey({ ...MINE, brainUrl: 'http://my-brain:9999/' })).toBe(
      'endpoint:http://my-brain:9999'
    )
  })

  it('the sidecar gets ONE stable key — its port and token change every launch', () => {
    setSidecarBrain({ url: 'http://127.0.0.1:1000', token: 'gbrain_a' })
    const first = effectiveBrainKey(OFF)
    setSidecarBrain({ url: 'http://127.0.0.1:2000', token: 'gbrain_b' })
    expect(effectiveBrainKey(OFF)).toBe(first)
    expect(first).toBe('sidecar')
  })

  it('the key follows the same ranking as effectiveBrain — opt-in outranks the sidecar', () => {
    setSidecarBrain({ url: 'http://127.0.0.1:1000', token: 'gbrain_a' })
    expect(effectiveBrainKey(MINE)).toBe('endpoint:http://my-brain:9999')
  })
})

describe('sidecar status — the lifecycle the shell reports (#249)', () => {
  it('off until the first beat; a healthy launch walks starting → connected', () => {
    expect(sidecarStatus()).toBe('off')
    setSidecarStatus('starting')
    expect(sidecarStatus()).toBe('starting')
    setSidecarBrain({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh' })
    expect(sidecarStatus()).toBe('connected')
  })

  it('a death is visible: retrying between spawns, unavailable at give-up', () => {
    setSidecarBrain({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh' })
    setSidecarStatus('retrying')
    expect(sidecarStatus()).toBe('retrying')
    setSidecarStatus('starting') // the respawn attempt
    setSidecarStatus('retrying')
    setSidecarStatus('unavailable') // MAX_RESTARTS spent — the shell gave up
    expect(sidecarStatus()).toBe('unavailable')
  })

  it("'retrying' keeps the credentials — a respawn with fresh ones is imminent", () => {
    setSidecarBrain({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh' })
    setSidecarStatus('retrying')
    expect(sidecarBrain()).not.toBeNull()
    expect(effectiveBrain(OFF).on).toBe(true)
  })

  it("'unavailable' hands back the floor: the dead credentials are cleared", () => {
    setSidecarBrain({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh' })
    setSidecarStatus('unavailable')
    expect(sidecarStatus()).toBe('unavailable')
    /* the manager thread returned for the session — recall must not keep
       racing a dead port, and the prompt must get <brain-recall off/> */
    expect(sidecarBrain()).toBeNull()
    expect(effectiveBrain(OFF).on).toBe(false)
  })

  it("a status string alone can't claim connected — only a credentialed handshake may", () => {
    setSidecarStatus('connected')
    expect(sidecarStatus()).toBe('off')
    setSidecarStatus('starting')
    setSidecarStatus('connected')
    expect(sidecarStatus()).toBe('starting')
  })

  it('an unknown beat from a newer shell is ignored, never corrupting the state', () => {
    setSidecarStatus('starting')
    setSidecarStatus('hibernating')
    expect(sidecarStatus()).toBe('starting')
  })
})

describe('adoptSidecarSnapshot — the pull that recovers missed beats', () => {
  it('credentials outrank the beat string: an endpoint means connected', () => {
    adoptSidecarSnapshot({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh' }, 'starting')
    expect(sidecarStatus()).toBe('connected')
    expect(effectiveBrain(OFF).on).toBe(true)
  })

  it("a reload after the give-up recovers 'unavailable' — no beat will ever re-fire", () => {
    adoptSidecarSnapshot(null, 'unavailable')
    expect(sidecarStatus()).toBe('unavailable')
    expect(effectiveBrain(OFF).on).toBe(false)
  })

  it("a late-mounting webview recovers 'starting' from the first-boot window", () => {
    adoptSidecarSnapshot(null, 'starting')
    expect(sidecarStatus()).toBe('starting')
  })

  it('a snapshot never downgrades a live handshake that landed while it was in flight', () => {
    setSidecarBrain({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh' })
    adoptSidecarSnapshot(null, 'starting') // stale pull from before the handshake
    expect(sidecarStatus()).toBe('connected')
    expect(sidecarBrain()).not.toBeNull()
  })

  it('nothing pulled, nothing changed — the web stays off', () => {
    adoptSidecarSnapshot(null, null)
    expect(sidecarStatus()).toBe('off')
    expect(sidecarBrain()).toBeNull()
  })
})
