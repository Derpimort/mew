/* The retry helper is the line between "a 429 dropped my whole turn" and "i
   retried, then it worked." These pin the contract the adapters lean on:
   which failures are transient, the jittered-backoff schedule, Retry-After
   honored over the computed wait, and the give-up-after-max-attempts edge —
   all deterministic via injected sleep + rng. */

import { describe, expect, it, vi } from 'vitest'
import { classifyFailure, isTransient, retryAfterMs, withRetry } from '../retry'

/** An APIError-shaped failure: a numeric `.status`, optional headers. */
function httpError(status: number, headers?: Record<string, string>): Error {
  return Object.assign(new Error(`http ${status}`), { status, headers })
}
function named(name: string): Error {
  const e = new Error(name)
  e.name = name
  return e
}

describe('isTransient — what is worth retrying', () => {
  it('retries 429, 500, 502, 503, and 529 overloaded', () => {
    for (const s of [429, 500, 502, 503, 529]) {
      expect(isTransient(httpError(s))).toBe(true)
    }
  })

  it('classifies failures for honest fallback copy: auth / model / busy / unknown', () => {
    expect(classifyFailure(httpError(401))).toBe('auth')
    expect(classifyFailure(httpError(403))).toBe('auth')
    expect(classifyFailure(httpError(404))).toBe('model')
    expect(classifyFailure(httpError(429))).toBe('busy')
    expect(classifyFailure(httpError(503))).toBe('busy')
    expect(classifyFailure(named('APIConnectionError'))).toBe('busy') // network blip
    expect(classifyFailure(httpError(400))).toBe('unknown')
    expect(classifyFailure(named('AbortError'))).toBe('unknown') // a stop isn't a model failure
    expect(classifyFailure(null)).toBe('unknown')
  })

  it('does NOT retry 4xx the request would just re-earn', () => {
    for (const s of [400, 401, 403, 404, 422, 409]) {
      expect(isTransient(httpError(s))).toBe(false)
    }
  })

  it('retries network errors (SDK connection, browser fetch TypeError)', () => {
    expect(isTransient(named('APIConnectionError'))).toBe(true)
    expect(isTransient(named('APIConnectionTimeoutError'))).toBe(true)
    expect(isTransient(named('TypeError'))).toBe(true)
  })

  it('never retries a user abort, even though it has no status', () => {
    expect(isTransient(named('AbortError'))).toBe(false)
    expect(isTransient(named('APIUserAbortError'))).toBe(false)
  })

  it('treats a status-less logic error (parse, bad intent) as permanent', () => {
    expect(isTransient(new Error('local model returned no usable intent'))).toBe(false)
    expect(isTransient(named('SyntaxError'))).toBe(false)
    expect(isTransient('a string, not an error')).toBe(false)
    expect(isTransient(undefined)).toBe(false)
  })
})

describe('retryAfterMs — honor the server', () => {
  it('parses delay-seconds into ms', () => {
    expect(retryAfterMs(httpError(429, { 'retry-after': '2' }))).toBe(2000)
  })

  it('parses an HTTP-date relative to the injected now', () => {
    const now = Date.parse('2026-06-17T12:00:00Z')
    const at = 'Wed, 17 Jun 2026 12:00:03 GMT'
    expect(retryAfterMs(httpError(503, { 'retry-after': at }), () => now)).toBe(3000)
  })

  it('reads a real Headers object (case-insensitive get)', () => {
    const headers = new Headers({ 'Retry-After': '5' })
    expect(retryAfterMs(Object.assign(new Error('429'), { status: 429, headers }))).toBe(5000)
  })

  it('returns null when absent or unparseable', () => {
    expect(retryAfterMs(httpError(429))).toBeNull()
    expect(retryAfterMs(httpError(429, { 'retry-after': 'soon-ish' }))).toBeNull()
    expect(retryAfterMs(new Error('no headers'))).toBeNull()
  })
})

describe('withRetry — the retry loop', () => {
  /* rng→0 makes full-jitter deterministic: backoff floors to 0ms, so we read
     the SCHEDULE off the sleeps' presence/count, and the WAIT off rng=1. */
  const sleeps: number[] = []
  const collectSleep = async (ms: number) => void sleeps.push(ms)

  it('returns the first success without sleeping', async () => {
    const fn = vi.fn(async () => 'ok')
    const out = await withRetry(fn, { sleep: collectSleep, rng: () => 0 })
    expect(out).toBe('ok')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('retries a transient failure then succeeds (429 → ok)', async () => {
    const local: number[] = []
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls === 1) throw httpError(429)
      return 'recovered'
    })
    const out = await withRetry(fn, { sleep: async (ms) => void local.push(ms), rng: () => 0 })
    expect(out).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(local).toHaveLength(1) // one backoff between the two tries
  })

  it('gives up after the configured attempts and throws the last error', async () => {
    const local: number[] = []
    const err = httpError(503)
    const fn = vi.fn(async () => {
      throw err
    })
    await expect(
      withRetry(fn, { retries: 2, sleep: async (ms) => void local.push(ms), rng: () => 0 })
    ).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(3) // first + 2 retries
    expect(local).toHaveLength(2) // a sleep before each retry, none after the last
  })

  it('throws a permanent error immediately, no retry, no sleep', async () => {
    const local: number[] = []
    const err = httpError(401)
    const fn = vi.fn(async () => {
      throw err
    })
    await expect(withRetry(fn, { sleep: async (ms) => void local.push(ms) })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledOnce()
    expect(local).toHaveLength(0)
  })

  it('does not retry a user abort', async () => {
    const fn = vi.fn(async () => {
      throw named('AbortError')
    })
    await expect(withRetry(fn, { sleep: collectSleep })).rejects.toThrow('AbortError')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('grows the backoff ceiling exponentially (full jitter at rng=1)', async () => {
    const local: number[] = []
    let calls = 0
    const fn = async () => {
      if (++calls <= 3) throw httpError(500)
      return 'ok'
    }
    await withRetry(fn, {
      retries: 3,
      baseMs: 100,
      factor: 2,
      rng: () => 1,
      sleep: async (ms) => void local.push(ms),
    })
    /* rng=1 ⇒ wait = ceiling = base·2ⁿ: 100, 200, 400 */
    expect(local).toEqual([100, 200, 400])
  })

  it('honors Retry-After over the computed backoff, capped at maxDelayMs', async () => {
    const local: number[] = []
    let calls = 0
    const fn = async () => {
      if (++calls === 1) throw httpError(429, { 'retry-after': '999' }) // 999s
      return 'ok'
    }
    await withRetry(fn, {
      maxDelayMs: 5000,
      sleep: async (ms) => void local.push(ms),
      rng: () => 1,
    })
    expect(local).toEqual([5000]) // 999s clamped to the 5s ceiling
  })

  it('caps the computed backoff at maxDelayMs', async () => {
    const local: number[] = []
    let calls = 0
    const fn = async () => {
      if (++calls <= 1) throw httpError(500)
      return 'ok'
    }
    await withRetry(fn, {
      baseMs: 100000,
      rng: () => 1,
      maxDelayMs: 2000,
      sleep: async (ms) => void local.push(ms),
    })
    expect(local).toEqual([2000])
  })
})
