/* Ollama's one non-streaming request is wholly retryable (#116): a local server
   reloading a model 503s, the socket flakes — backoff clears it before anything
   yields. A 4xx or a malformed-200 body is a logic failure and is not retried. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOllamaAdapter } from '../ollama'
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

/* The intent runIntent will accept and turn into a confirmation line. */
const CHAT_INTENT = JSON.stringify({ kind: 'chat', reply: 'all set' })

function okResponse(content: string) {
  return { ok: true, status: 200, json: async () => ({ message: { content } }) }
}
function errResponse(status: number) {
  return { ok: false, status, json: async () => ({}) }
}

const exec = {} as ToolExecutor

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = ''
  for await (const c of it) out += c
  return out
}

/* withRetry with the wait removed — keep the loop, lose the timers. */
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

describe('ollama adapter — transient resilience', () => {
  it('retries a 503 from the local server, then succeeds', async () => {
    let calls = 0
    const fetchSpy = vi.fn(async () => {
      calls++
      return calls === 1 ? errResponse(503) : okResponse(CHAT_INTENT)
    })
    vi.stubGlobal('fetch', fetchSpy)
    const adapter = createOllamaAdapter('http://localhost:11434', 'llama3')
    const out = await collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(calls).toBe(2)
    expect(out).toContain('all set')
  })

  it('retries a network error (fetch TypeError), then succeeds', async () => {
    let calls = 0
    const fetchSpy = vi.fn(async () => {
      calls++
      if (calls === 1) throw new TypeError('Failed to fetch')
      return okResponse(CHAT_INTENT)
    })
    vi.stubGlobal('fetch', fetchSpy)
    const adapter = createOllamaAdapter('http://localhost:11434', 'llama3')
    const out = await collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(calls).toBe(2)
    expect(out).toContain('all set')
  })

  it('does NOT retry a 400 from the local server', async () => {
    const fetchSpy = vi.fn(async () => errResponse(400))
    vi.stubGlobal('fetch', fetchSpy)
    const adapter = createOllamaAdapter('http://localhost:11434', 'llama3')
    await expect(collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))).rejects.toThrow('ollama 400')
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('does NOT retry a malformed 200 body (logic failure, not a blip)', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ message: { content: 'not json' } }) }))
    vi.stubGlobal('fetch', fetchSpy)
    const adapter = createOllamaAdapter('http://localhost:11434', 'llama3')
    await expect(collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))).rejects.toBeTruthy()
    expect(fetchSpy).toHaveBeenCalledOnce()
  })
})
