/* The honesty contract under transient failure (#116): a 429/503/529 on
   stream-create retries and the turn succeeds without falling back; a failure
   that lands AFTER a token has streamed is NOT replayed (the store's
   `acted || buffer` guard depends on the adapter never re-running a turn that
   already spoke). Drives the real adapter through a programmable SDK mock. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolExecutor, WeekContext } from '../types'

const ctx: WeekContext = {
  todayKey: '2026-06-09',
  todayLabel: 'Tuesday, June 9',
  nowLabel: '9:40',
  weekSummary: ['today (2026-06-09): 9:00 Q3 deck [work]'],
  realisticBestH: 5.5,
  mewsToday: 2,
  recallLines: [],
  prefLines: [],
  insightLines: [],
}
const exec = {} as ToolExecutor

function httpError(status: number): Error {
  return Object.assign(new Error(`anthropic ${status}`), { status })
}

/* A MessageStream stand-in: an async iterator of the given events, then a
   final message. `failFirstNext` rejects the first `.next()` (the create+first-
   event window withRetry guards) `failTimes` times before yielding for real. */
function fakeStream(events: unknown[], opts: { failFirstNext?: number; error?: Error } = {}) {
  let failsLeft = opts.failFirstNext ?? 0
  let idx = 0
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (failsLeft > 0) {
            failsLeft--
            throw opts.error ?? httpError(429)
          }
          if (idx < events.length) return { value: events[idx++], done: false }
          return { value: undefined, done: true }
        },
      }
    },
    finalMessage: async () => ({ stop_reason: 'end_turn', content: [] }),
  }
}

/* Programmable per-test: tests set `streamFactory` before importing the adapter
   path. vi.mock is hoisted, so the factory is read lazily at call time. */
const state: { streamFactory: () => unknown } = { streamFactory: () => fakeStream([]) }
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: () => state.streamFactory() }
  },
}))

/* Override withRetry's real timers — keep the loop, drop the wait, so a test
   asserting "retries then succeeds" runs instantly and deterministically. */
vi.mock('../retry', async () => {
  const actual = await vi.importActual<typeof import('../retry')>('../retry')
  const orig = actual.withRetry
  return {
    ...actual,
    withRetry: <T>(fn: () => Promise<T>, options = {}) =>
      orig(fn, { ...options, sleep: async () => {}, rng: () => 0 }),
  }
})

const textEvent = (t: string) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = ''
  for await (const c of it) out += c
  return out
}

let createAnthropicAdapter: typeof import('../anthropic').createAnthropicAdapter
beforeEach(async () => {
  ;({ createAnthropicAdapter } = await import('../anthropic'))
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('anthropic adapter — transient resilience', () => {
  it('retries a 429 on stream-create and streams the recovered reply', async () => {
    let attempt = 0
    state.streamFactory = () => {
      attempt++
      // first attempt: reject the first event (429); second: real tokens
      return attempt === 1
        ? fakeStream([], { failFirstNext: 1, error: httpError(429) })
        : fakeStream([textEvent('all set')])
    }
    const adapter = createAnthropicAdapter('sk-ant-x', 'claude-x')
    const out = await collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(attempt).toBe(2) // it retried once
    expect(out).toBe('all set') // ...and the turn succeeded, no fallback throw
  })

  it.each([503, 529])('retries a %i on stream-create and recovers', async (status) => {
    let attempt = 0
    state.streamFactory = () => {
      attempt++
      return attempt === 1 ? fakeStream([], { failFirstNext: 1, error: httpError(status) }) : fakeStream([textEvent('ok')])
    }
    const adapter = createAnthropicAdapter('sk-ant-x', 'claude-x')
    const out = await collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(attempt).toBe(2)
    expect(out).toBe('ok')
  })

  it('does NOT replay a turn that already streamed a token (honesty guard)', async () => {
    let attempt = 0
    /* stream one real token, THEN drop mid-stream — the 503 lands on the event
       AFTER the create+first-event window, so withRetry is already done and the
       failure surfaces in the consume loop, never replayed. */
    state.streamFactory = () => {
      attempt++
      let idx = 0
      return {
        [Symbol.asyncIterator]() {
          return {
            next: async () => {
              if (idx === 0) {
                idx++
                return { value: textEvent('partial answer'), done: false }
              }
              throw httpError(503)
            },
          }
        },
        finalMessage: async () => ({ stop_reason: 'end_turn', content: [] }),
      }
    }
    const adapter = createAnthropicAdapter('sk-ant-x', 'claude-x')
    let streamed = ''
    await expect(
      (async () => {
        for await (const c of adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec)) streamed += c
      })(),
    ).rejects.toThrow('503')
    expect(attempt).toBe(1) // created exactly once — never replayed
    expect(streamed).toBe('partial answer') // the token that did stream is kept; the store handles the throw
  })

  it('throws a permanent 401 without retrying', async () => {
    let attempt = 0
    state.streamFactory = () => {
      attempt++
      return fakeStream([], { failFirstNext: 1, error: httpError(401) })
    }
    const adapter = createAnthropicAdapter('sk-ant-x', 'claude-x')
    await expect(collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))).rejects.toThrow('401')
    expect(attempt).toBe(1)
  })
})
