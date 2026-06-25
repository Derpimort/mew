/* The desktop shell's managed gbrain — the brain that ships invisibly.
   After every spawn (launch or health-restart) the shell hands the webview
   a fresh {url, token}; it lives only in module state, never in Settings —
   the port and token change each launch, and persisting them would turn an
   ephemeral handshake into stale config. Explicit Settings config always
   outranks the sidecar: a user who pointed MEW at their own brain meant it. */

export interface SidecarEndpoint {
  url: string
  token: string
}

let current: SidecarEndpoint | null = null

export function setSidecarBrain(e: SidecarEndpoint | null): void {
  current = e
}

export function sidecarBrain(): SidecarEndpoint | null {
  return current
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
