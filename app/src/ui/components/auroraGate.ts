/* Whether to mount the ambient aurora. The aurora is a deferrable ornament —
   pure ambience behind the dial — and it drags in three.js + @react-three/fiber,
   which are lazy-loaded (see MainPage's React.lazy). Gating the *mount* (not just
   the import) means a reduced-motion session never fetches that chunk at all:
   the heaviest dependency in the app stays off the wire for the people who have
   asked the system for less motion. Numbers in, boolean out — no DOM, so the
   decision is unit-testable; the thin reader below is the only DOM touch. */

export interface AuroraGate {
  /** The user has asked the OS for reduced motion (prefers-reduced-motion). */
  reducedMotion: boolean
}

/**
 * Show the aurora unless the user prefers reduced motion. Decoupled from the
 * DOM so the policy is testable in isolation; the only reason the aurora (and
 * its three.js chunk) is ever withheld is an explicit reduced-motion signal,
 * never a guess.
 */
export function shouldShowAurora({ reducedMotion }: AuroraGate): boolean {
  return !reducedMotion
}

/**
 * Read the live `prefers-reduced-motion` signal. Defaults to `false` (motion
 * allowed) when `matchMedia` is unavailable — SSR, the test runner, ancient
 * engines — so the aurora is the default experience and only an explicit user
 * preference removes it. This is the one DOM-touching line; keep policy in
 * `shouldShowAurora`.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
