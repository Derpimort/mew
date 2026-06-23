/* The aurora is the only thing that pulls three.js into the app, and it is a
   deferrable ornament — so the one rule is: show it unless the user asked the OS
   for reduced motion. These tests pin that policy (pure, no DOM) and the reader's
   safe default (motion allowed when matchMedia is absent), so the heavy chunk is
   withheld only on an explicit signal, never by accident. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefersReducedMotion, shouldShowAurora } from '../auroraGate'

describe('shouldShowAurora — show unless reduced motion is requested', () => {
  it('shows the aurora when motion is welcome', () => {
    expect(shouldShowAurora({ reducedMotion: false })).toBe(true)
  })

  it('withholds the aurora (and its three.js chunk) under reduced motion', () => {
    expect(shouldShowAurora({ reducedMotion: true })).toBe(false)
  })
})

describe('prefersReducedMotion — safe default, honest read', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to false (motion allowed) when matchMedia is unavailable', () => {
    // node/SSR: no window.matchMedia — the aurora must remain the default.
    vi.stubGlobal('window', {})
    expect(prefersReducedMotion()).toBe(false)
  })

  it('reflects a positive reduced-motion match', () => {
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: q.includes('reduce'), media: q }),
    })
    expect(prefersReducedMotion()).toBe(true)
  })

  it('reflects a negative reduced-motion match', () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false, media: '' }),
    })
    expect(prefersReducedMotion()).toBe(false)
  })
})
