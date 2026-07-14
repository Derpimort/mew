/* The failure classifier is the line between honest copy and a lie: "your key
   was rejected" must never render as "the model was busy". The backoff schedule
   itself moved into the AI SDK (#152 — streamText maxRetries; engagement proven
   in contract.test.ts against the stubbed wire), so what's pinned here is the
   classification contract across every error shape that can reach the store:
   MEW's own `{ status }` fetch tags, the SDK's APICallError (`statusCode`), the
   SDK's RetryError wrapper, browser network failures, and user aborts. */

import { describe, expect, it } from 'vitest'
import { classifyFailure, isTransient } from '../retry'

/** MEW's own plain-fetch shape: a numeric `.status` tagged onto the error
    (validate.ts key probe). */
function httpError(status: number): Error {
  return Object.assign(new Error(`http ${status}`), { status })
}
/** The AI SDK's APICallError shape: name + `statusCode` (+ isRetryable). */
function sdkError(statusCode?: number, isRetryable = false): Error {
  const e = Object.assign(new Error(`sdk ${statusCode ?? 'network'}`), {
    statusCode,
    isRetryable,
  })
  e.name = 'AI_APICallError'
  return e
}
/** The SDK's wrapper once its own retries are spent: the cause is lastError. */
function retryError(lastError: unknown): Error {
  const e = Object.assign(new Error('retries exhausted'), { lastError })
  e.name = 'AI_RetryError'
  return e
}
function named(name: string): Error {
  const e = new Error(name)
  e.name = name
  return e
}

describe('isTransient — what could have succeeded moments later', () => {
  it('429, 500, 502, 503, and 529 overloaded are transient', () => {
    for (const s of [429, 500, 502, 503, 529]) {
      expect(isTransient(httpError(s))).toBe(true)
      expect(isTransient(sdkError(s))).toBe(true)
    }
  })

  it('4xx the request would just re-earn is NOT transient', () => {
    for (const s of [400, 401, 403, 404, 422, 409]) {
      expect(isTransient(httpError(s))).toBe(false)
      expect(isTransient(sdkError(s))).toBe(false)
    }
  })

  it('network failures are transient: browser fetch TypeError, status-less retryable SDK error', () => {
    expect(isTransient(named('TypeError'))).toBe(true)
    expect(isTransient(sdkError(undefined, true))).toBe(true)
  })

  it('never a user abort, even though it has no status', () => {
    expect(isTransient(named('AbortError'))).toBe(false)
  })

  it('a status-less logic error (parse, bad intent) is permanent', () => {
    expect(isTransient(new Error('local model returned no usable intent'))).toBe(false)
    expect(isTransient(named('SyntaxError'))).toBe(false)
    expect(isTransient(sdkError(undefined, false))).toBe(false) // SDK says not retryable
    expect(isTransient('a string, not an error')).toBe(false)
    expect(isTransient(undefined)).toBe(false)
  })
})

describe('classifyFailure — honest fallback copy per cause', () => {
  it('maps each class from MEW plain-fetch `.status` errors', () => {
    expect(classifyFailure(httpError(401))).toBe('auth')
    expect(classifyFailure(httpError(403))).toBe('auth')
    expect(classifyFailure(httpError(404))).toBe('model')
    expect(classifyFailure(httpError(429))).toBe('busy')
    expect(classifyFailure(httpError(503))).toBe('busy')
    expect(classifyFailure(httpError(400))).toBe('rejected')
    expect(classifyFailure(httpError(422))).toBe('rejected')
  })

  it('maps each class from the SDK APICallError `statusCode` (#152)', () => {
    expect(classifyFailure(sdkError(401))).toBe('auth')
    expect(classifyFailure(sdkError(403))).toBe('auth')
    expect(classifyFailure(sdkError(404))).toBe('model')
    expect(classifyFailure(sdkError(429))).toBe('busy')
    expect(classifyFailure(sdkError(529))).toBe('busy')
    expect(classifyFailure(sdkError(400))).toBe('rejected') // the model refused (#153)
    expect(classifyFailure(sdkError(undefined, true))).toBe('busy') // network blip
  })

  it('unwraps the SDK RetryError to its lastError — exhausted retries stay honest', () => {
    expect(classifyFailure(retryError(sdkError(503)))).toBe('busy')
    expect(classifyFailure(retryError(sdkError(401)))).toBe('auth')
    // a wrapper with nothing inside stays unknown rather than guessing
    expect(classifyFailure(retryError(undefined))).toBe('unknown')
    // a non-SDK object carrying `lastError` is NOT unwrapped
    expect(
      classifyFailure(Object.assign(new Error('impostor'), { lastError: httpError(401) }))
    ).toBe('unknown')
  })

  it('an abort is the user, never a model failure', () => {
    expect(classifyFailure(named('AbortError'))).toBe('unknown')
    expect(isTransient(named('AbortError'))).toBe(false)
  })

  it('anything unrecognizable stays unknown', () => {
    expect(classifyFailure(null)).toBe('unknown')
    expect(classifyFailure(new Error('mystery'))).toBe('unknown')
  })
})
