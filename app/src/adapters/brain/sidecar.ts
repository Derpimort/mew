/* The desktop shell's managed gbrain — the brain that ships built-in, with
   zero setup but never invisible state: the shell reports every lifecycle
   beat so the UI can always answer "is my brain on?" (#249). After every
   spawn (launch or health-restart) the shell hands the webview a fresh
   {url, token}; it lives only in module state, never in Settings — the port
   and token change each launch, and persisting them would turn an ephemeral
   handshake into stale config. Explicit Settings config always outranks the
   sidecar: a user who pointed MEW at their own brain meant it. */

export interface SidecarEndpoint {
  url: string
  token: string
}

/** The sidecar's lifecycle, as the shell reports it (#249): 'off' outside the
    desktop shell (or before its first beat), then starting → connected, with
    retrying between deaths and unavailable once the shell gives up. */
export type SidecarStatus = 'off' | 'starting' | 'retrying' | 'connected' | 'unavailable'

let current: SidecarEndpoint | null = null
let status: SidecarStatus = 'off'

export function setSidecarBrain(e: SidecarEndpoint | null): void {
  current = e
  status = e ? 'connected' : 'off'
}

/** Shell beats from mew://brain-status. 'connected' is deliberately not
    accepted here — only a real handshake (setSidecarBrain, which carries
    credentials) may claim it. Unknown strings from a newer shell are ignored
    rather than corrupting the state. The final give-up also hands back the
    floor: 'unavailable' means the manager thread returned for the session,
    so the parked credentials point at a dead port forever — clearing them
    flips effectiveBrain off, recall stops racing a corpse to silent [], and
    the prompt gets its honest <brain-recall off/> marker. 'retrying' keeps
    them: a respawn with fresh credentials is imminent, and a downgrade there
    would flap the brain off/on per death. */
export function setSidecarStatus(s: string): void {
  if (s === 'starting' || s === 'retrying') status = s
  else if (s === 'unavailable') {
    status = 'unavailable'
    current = null
  }
}

/** Adopt the shell's pulled snapshot — recovery for beats that fired before
    this webview listened (first boot: "starting" is emitted while React is
    still mounting; reload after give-up: the manager thread is gone and will
    never beat again). Credentials outrank the beat string, and a snapshot
    never downgrades fresher event-driven truth (a live handshake that landed
    while the pull was in flight wins). */
export function adoptSidecarSnapshot(e: SidecarEndpoint | null, beat: string | null): void {
  if (e) setSidecarBrain(e)
  else if (beat && !current) setSidecarStatus(beat)
}

export function sidecarStatus(): SidecarStatus {
  return status
}

export function sidecarBrain(): SidecarEndpoint | null {
  return current
}

/** The ledger identity of whatever brain effectiveBrain picks — the key for
    the backfill watermark (#249). The sidecar's port and token change every
    launch but its store is the same on-disk PGLite, so it gets ONE stable
    key; a Settings endpoint is identified by its URL (same ranking as
    effectiveBrain: the opt-in outranks the sidecar). Per-brain keys are what
    make a brain switch replay-complete: each brain is offered exactly the
    events it never saw. */
export function effectiveBrainKey(s: { brainEnabled: boolean; brainUrl: string }): string {
  return s.brainEnabled ? `endpoint:${s.brainUrl.replace(/\/+$/, '')}` : 'sidecar'
}

/** Where MEW's brain actually points: the user's configured endpoint when
    they opted in, else the shell's sidecar when one announced itself, else
    nowhere (the keyless floor carries the week). */
export function effectiveBrain(s: {
  brainEnabled: boolean
  brainUrl: string
  brainToken: string
}): {
  url: string
  token: string
  on: boolean
} {
  if (s.brainEnabled) return { url: s.brainUrl, token: s.brainToken, on: true }
  if (current) return { url: current.url, token: current.token, on: true }
  return { url: s.brainUrl, token: s.brainToken, on: false }
}
