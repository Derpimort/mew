/* Transient-error resilience for the model adapters. A single network blip,
   a 429, an overloaded-529, or a 5xx would otherwise drop the whole turn to
   the rules floor; a short backoff usually clears it. Pure and injected
   (sleep + rng) so the schedule is deterministic under test.

   Scope: this wraps only stream/fetch *creation + first event* — the point
   before a token is yielded or a tool runs. Once a turn has spoken or acted,
   the caller must never replay it (store.ts honesty guard); retrying is the
   adapter's job strictly before that line. */

/** A user-initiated cancel must never be retried (cancellation is a sibling
    concern, #out-of-scope): an abort is the user's decision, not a blip. */
function isAbort(err: unknown): boolean {
  const name = (err as { name?: unknown })?.name
  return name === 'AbortError' || name === 'APIUserAbortError'
}

/** The HTTP status of a failed request, if the error carries one. Anthropic's
    APIError exposes `.status`; we also accept a plain `{ status }` so the
    Ollama fetch path can tag its own (`ollama 503` → 503) without importing
    any SDK. */
function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status
  return typeof s === 'number' ? s : undefined
}

/** Network-level failures surface with no HTTP status, identified by name:
    the SDK's APIConnectionError / APIConnectionTimeoutError, or a browser fetch
    rejecting with `TypeError: Failed to fetch`. Narrow on purpose — a
    status-less Error from elsewhere (a JSON parse, a malformed-intent guard) is
    a logic failure, not a blip, and replaying it only thrashes. */
function isNetworkError(err: unknown): boolean {
  if (statusOf(err) !== undefined) return false
  const name = (err as { name?: unknown })?.name
  return (
    name === 'APIConnectionError' || name === 'APIConnectionTimeoutError' || name === 'TypeError'
  )
}

/** Transient = worth retrying the same request, same key, same endpoint:
    network errors, 429 (rate limit), and 500/502/503/529 (overloaded / gateway
    / unavailable). Everything else — 400/401/403/404/422, an abort, a non-Error
    — is permanent: retrying only burns the user's quota on a request that will
    fail again. */
export function isTransient(err: unknown): boolean {
  if (isAbort(err)) return false
  const status = statusOf(err)
  if (status !== undefined) {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 529
  }
  return isNetworkError(err)
}

/** Why a model turn failed, for an honest, actionable fallback message. `auth`
    (401/403 — key rejected) and `model` (404 — model name not found) are
    PERMANENT and the user must fix them in Settings; `busy` is transient (was
    retried); `unknown` is anything else. Distinct from isTransient so the copy
    can stop calling a rejected key "busy". */
export type FailureKind = 'auth' | 'model' | 'busy' | 'unknown'
export function classifyFailure(err: unknown): FailureKind {
  if (isAbort(err)) return 'unknown' // an abort isn't a model failure
  const status = statusOf(err)
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'model'
  if (isTransient(err)) return 'busy'
  return 'unknown'
}

/** Reads HTTP `Retry-After` off the error's headers when the server set one,
    in ms. Supports the delay-seconds form (`Retry-After: 2`) and the HTTP-date
    form. Returns null when absent or unparseable so the caller falls back to
    its computed backoff. `now` is injected for deterministic date math. */
export function retryAfterMs(err: unknown, now: () => number = Date.now): number | null {
  const headers = (err as { headers?: unknown })?.headers
  if (!headers) return null
  let raw: string | null | undefined
  if (typeof (headers as Headers).get === 'function') {
    raw = (headers as Headers).get('retry-after')
  } else {
    const h = headers as Record<string, string>
    raw = h['retry-after'] ?? h['Retry-After']
  }
  if (raw == null || raw === '') return null

  const secs = Number(raw)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)

  const at = Date.parse(raw)
  if (Number.isFinite(at)) return Math.max(0, at - now())
  return null
}

export interface RetryOptions {
  /** Extra attempts after the first (so retries:2 ⇒ up to 3 tries total). */
  retries?: number
  /** First backoff before any exponential growth. */
  baseMs?: number
  /** Exponential growth per attempt. */
  factor?: number
  /** Hard ceiling on any single wait, including a server's Retry-After — one
      blip must never park a turn for minutes. */
  maxDelayMs?: number
  /** Injected for deterministic tests; defaults to real timers. */
  sleep?: (ms: number) => Promise<void>
  /** Injected [0,1) jitter source; defaults to Math.random. */
  rng?: () => number
}

const DEFAULTS: Required<Omit<RetryOptions, 'sleep' | 'rng'>> = {
  retries: 2,
  baseMs: 400,
  factor: 2,
  maxDelayMs: 8000,
}

/** Exponential backoff with full jitter for attempt `n` (0-based): a uniform
    point in [0, base·factorⁿ], capped. Full jitter (rather than fixed delay)
    spreads a fleet of clients off a shared 429 so they don't resynchronize. */
function backoffMs(
  n: number,
  opts: Required<Omit<RetryOptions, 'sleep' | 'rng'>>,
  rng: () => number
): number {
  const ceiling = Math.min(opts.baseMs * Math.pow(opts.factor, n), opts.maxDelayMs)
  return Math.floor(rng() * ceiling)
}

/** Runs `fn`; on a transient failure, waits (server Retry-After if given, else
    jittered exponential backoff — whichever, capped at maxDelayMs) and retries,
    up to `retries` extra attempts. A permanent error throws immediately; the
    last transient error throws once attempts are spent. The caller is
    responsible for only calling this before any output/mutation — withRetry
    cannot un-yield a token. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts = { ...DEFAULTS, ...options }
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const rng = options.rng ?? Math.random

  let lastErr: unknown
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === opts.retries || !isTransient(err)) throw err
      const after = retryAfterMs(err)
      const wait = after != null ? Math.min(after, opts.maxDelayMs) : backoffMs(attempt, opts, rng)
      await sleep(wait)
    }
  }
  throw lastErr // unreachable: the loop either returns or throws above
}
