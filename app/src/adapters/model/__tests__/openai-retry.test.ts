/* OpenAI's buffered round-trip is wholly retryable (#131, parity with #116): a
   429 or a 5xx or a network drop before any token reaches the caller clears on
   backoff. A 4xx or a malformed-200 body is a logic failure and is not retried;
   a user-initiated abort is the user's decision, not a blip, so it is never
   retried either. The honesty guard holds: a turn that already streamed a token
   is never replayed — only a not-yet-spoken round's request retries. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenAIAdapter } from '../openai'
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

/* A plain text reply (no tool calls) — converse yields the content and returns. */
function okResponse(content: string) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: 'assistant', content } }] }) }
}
function errResponse(status: number) {
  return { ok: false, status, text: async () => '', json: async () => ({}) }
}

const exec = {} as ToolExecutor

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = ''
  for await (const c of it) out += c
  return out
}

/* withRetry with the wait removed — keep the loop, lose the timers, so a
   "retries then succeeds" assertion runs instantly and deterministically. */
vi.mock('../retry', async () => {
  const actual = await vi.importActual<typeof import('../retry')>('../retry')
  const orig = actual.withRetry
  return {
    ...actual,
    withRetry: <T>(fn: () => Promise<T>, options = {}) =>
      orig(fn, { ...options, sleep: async () => {}, rng: () => 0 }),
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('openai adapter — transient resilience', () => {
  it('retries a 429, then succeeds (one retry)', async () => {
    let calls = 0
    const fetchSpy = vi.fn(async () => {
      calls++
      return calls === 1 ? errResponse(429) : okResponse('all set')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const adapter = createOpenAIAdapter('sk-x', 'gpt-x')
    const out = await collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(calls).toBe(2)
    expect(out).toBe('all set')
  })

  it('retries a 503, then succeeds', async () => {
    let calls = 0
    const fetchSpy = vi.fn(async () => {
      calls++
      return calls === 1 ? errResponse(503) : okResponse('ok')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const adapter = createOpenAIAdapter('sk-x', 'gpt-x')
    const out = await collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(calls).toBe(2)
    expect(out).toBe('ok')
  })

  it('retries a network error (fetch TypeError), then succeeds', async () => {
    let calls = 0
    const fetchSpy = vi.fn(async () => {
      calls++
      if (calls === 1) throw new TypeError('Failed to fetch')
      return okResponse('recovered')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const adapter = createOpenAIAdapter('sk-x', 'gpt-x')
    const out = await collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(calls).toBe(2)
    expect(out).toBe('recovered')
  })

  it('does NOT retry a 400 — straight to the rules floor', async () => {
    const fetchSpy = vi.fn(async () => errResponse(400))
    vi.stubGlobal('fetch', fetchSpy)
    const adapter = createOpenAIAdapter('sk-x', 'gpt-x')
    await expect(collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))).rejects.toThrow('openai 400')
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('does NOT retry a 401 — a bad key is permanent, not a blip', async () => {
    const fetchSpy = vi.fn(async () => errResponse(401))
    vi.stubGlobal('fetch', fetchSpy)
    const adapter = createOpenAIAdapter('sk-x', 'gpt-x')
    await expect(collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))).rejects.toThrow('openai 401')
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('gives up after the attempt budget on a persistent 429 (1 + 2 retries)', async () => {
    const fetchSpy = vi.fn(async () => errResponse(429))
    vi.stubGlobal('fetch', fetchSpy)
    const adapter = createOpenAIAdapter('sk-x', 'gpt-x')
    await expect(collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))).rejects.toThrow('openai 429')
    expect(fetchSpy).toHaveBeenCalledTimes(3) // initial + retries:2
  })

  it('does NOT retry an aborted request — a cancel propagates as a cancel', async () => {
    const fetchSpy = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })
    vi.stubGlobal('fetch', fetchSpy)
    const adapter = createOpenAIAdapter('sk-x', 'gpt-x')
    await expect(collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))).rejects.toThrow('aborted')
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('does NOT replay a turn that already streamed a token (honesty guard)', async () => {
    /* First round: a tool call that yields a text preamble and runs a tool —
       the turn has now SPOKEN. Second round: a transient 503. Because retry
       wraps each round's request independently and the first round already
       yielded, the 503 surfaces without ever replaying the spoken first round. */
    let calls = 0
    const fetchSpy = vi.fn(async () => {
      calls++
      if (calls === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'on it',
                  tool_calls: [
                    { id: 't1', type: 'function', function: { name: 'analyze_day', arguments: '{}' } },
                  ],
                },
              },
            ],
          }),
        }
      }
      return errResponse(503)
    })
    vi.stubGlobal('fetch', fetchSpy)
    const toolExec = { analyze: () => 'Day shape (offset 0).' } as unknown as ToolExecutor
    const adapter = createOpenAIAdapter('sk-x', 'gpt-x')
    let streamed = ''
    await expect(
      (async () => {
        for await (const c of adapter.converse([{ role: 'user', text: 'plan my day' }], ctx, toolExec)) streamed += c
      })(),
    ).rejects.toThrow('openai 503')
    /* round 1 fired once (not replayed) + round 2's three exhausted attempts */
    expect(calls).toBe(4)
    expect(streamed).toBe('on it') // the token that did stream is kept; the store handles the throw
  })
})
