/* A dropped reply — the server answered 2xx, then the connection broke while the
   body streamed (a local model crashing mid-load, a laptop changing networks, a
   proxy cutting the socket). The SDK wraps it as APICallError 'Failed to process
   successful response' with the 2xx statusCode and the real transport error as
   its `cause`, so a status-first classifier read it as nothing in particular and
   the owner was told MEW "couldn't reach the model". Pinned two ways: a table of
   the error shapes the classifier must read (and the look-alikes it must not),
   then the REAL SDK against a stubbed fetch — the shape is what the SDK
   produces, and the no-retry call in retry.ts's header is proven, not assumed. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAiAdapter } from '../aiAdapter'
import { classifyFailure, isTransient, type FailureKind } from '../retry'
import type { ToolExecutor, WeekContext } from '../types'

/** the SDK's wrap of a failure while it read a response that had already begun */
function wrapped(cause: unknown, { isRetryable = false, statusCode = 200 } = {}): Error {
  const e = Object.assign(new Error('Failed to process successful response'), {
    statusCode,
    isRetryable,
    cause,
  })
  e.name = 'AI_APICallError'
  return e
}
const typeError = (message: string, cause?: unknown) =>
  cause === undefined ? new TypeError(message) : new TypeError(message, { cause })
/** undici's socket failure, as Node's fetch reports a peer closing mid-body */
const socketClosed = () =>
  typeError('terminated', Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }))
function retryError(lastError: unknown): Error {
  const e = Object.assign(new Error('retries exhausted'), { lastError })
  e.name = 'AI_RetryError'
  return e
}
/** a cause chain `depth` links long, with `bottom` at the end */
function chain(depth: number, bottom: unknown): unknown {
  let err = bottom
  for (let i = 0; i < depth; i++) err = new Error(`link ${i}`, { cause: err })
  return err
}
function cyclic(): Error {
  const a = new Error('a')
  const b = new Error('b', { cause: a })
  Object.assign(a, { cause: b })
  return a
}

describe('classifyFailure — a reply that began and then dropped', () => {
  const table: Array<[string, unknown, FailureKind]> = [
    [
      'browser: TypeError "network error" under the 200',
      wrapped(typeError('network error')),
      'dropped',
    ],
    ['Safari: TypeError "Load failed" under the 200', wrapped(typeError('Load failed')), 'dropped'],
    [
      'Node: undici "terminated" → UND_ERR_SOCKET, SDK-flagged retryable',
      wrapped(socketClosed(), { isRetryable: true }),
      'dropped',
    ],
    [
      'SDK-flagged retryable with a coded, non-TypeError cause',
      wrapped(Object.assign(new Error('closed'), { code: 'ConnectionClosed' }), {
        isRetryable: true,
      }),
      'dropped',
    ],
    [
      'the network error two links down the chain',
      wrapped(chain(2, typeError('network error'))),
      'dropped',
    ],
    [
      'any 2xx the body was streaming under',
      wrapped(typeError('network error'), { statusCode: 206 }),
      'dropped',
    ],
    ['inside the SDK retry wrapper', retryError(wrapped(typeError('network error'))), 'dropped'],
  ]
  it.each(table)('%s → %s', (_label, err, kind) => {
    expect(classifyFailure(err)).toBe(kind)
  })

  it('a drop is transient — the same ask could land moments later', () => {
    expect(isTransient(wrapped(typeError('network error')))).toBe(true)
    expect(isTransient(wrapped(socketClosed(), { isRetryable: true }))).toBe(true)
  })
})

describe('classifyFailure — look-alikes that are NOT a dropped reply', () => {
  const table: Array<[string, unknown, FailureKind]> = [
    [
      'a 2xx wrap caused by a parse failure',
      wrapped(new SyntaxError('Unexpected token < in JSON')),
      'unknown',
    ],
    ['a 2xx wrap with no cause and no retry flag', wrapped(undefined), 'unknown'],
    [
      'a network error past the depth bound',
      wrapped(chain(4, typeError('network error'))),
      'unknown',
    ],
    ['a cyclic cause chain (terminates, invents nothing)', wrapped(cyclic()), 'unknown'],
    [
      'the same fields on an error that is not the SDK’s',
      Object.assign(new Error('x'), { statusCode: 200, cause: typeError('network error') }),
      'unknown',
    ],
    [
      'a 503 with a network cause — the status decides: busy',
      wrapped(typeError('network error'), { statusCode: 503 }),
      'busy',
    ],
    [
      'a 401 with a network cause — still the key: auth',
      wrapped(typeError('network error'), { statusCode: 401 }),
      'auth',
    ],
    [
      'a 3xx is not a started reply',
      wrapped(typeError('network error'), { statusCode: 304 }),
      'unknown',
    ],
    [
      'a user abort is never a failure',
      Object.assign(new Error('stopped'), {
        name: 'AbortError',
        cause: typeError('network error'),
      }),
      'unknown',
    ],
  ]
  it.each(table)('%s → %s', (_label, err, kind) => {
    expect(classifyFailure(err)).toBe(kind)
  })
})

/* ── the real SDK: what a dropped Ollama stream actually throws ─────────────── */

const ctx: WeekContext = {
  todayKey: '2026-06-18',
  todayLabel: 'Thursday, June 18',
  nowLabel: '9:40',
  weekSummary: [],
  realisticBestH: 5.5,
  mewsToday: 2,
  recallLines: [],
  brainOn: false,
  prefLines: [],
  insightLines: [],
}
const exec = {} as ToolExecutor
const oaChunk = (text: string) =>
  JSON.stringify({
    id: '1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'm',
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })

/** a 200 SSE reply that streams `chunks`, pauses, then loses its connection */
function droppingReply(chunks: string[], drop: () => unknown): Response {
  const enc = new TextEncoder()
  let i = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(c) {
        if (i < chunks.length) return c.enqueue(enc.encode(`data: ${oaChunk(chunks[i++])}\n\n`))
        await new Promise((r) => setTimeout(r, 50)) // the text paints before the socket goes
        c.error(drop())
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  )
}

async function turn(drop: () => unknown, chunks: string[] = []) {
  let calls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      calls++
      return droppingReply(chunks, drop)
    })
  )
  const adapter = createAiAdapter({
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2',
  })
  let out = ''
  let err: unknown = null
  const run = (async () => {
    try {
      for await (const c of adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec)) {
        if (typeof c === 'string') out += c
      }
    } catch (e) {
      err = e
    }
  })()
  /* ride out the SDK's whole jittered backoff window — the Ollama adapter runs
     maxRetries 2, so if the SDK retried a started stream, calls would read 3 */
  await vi.advanceTimersByTimeAsync(30_000)
  await run
  return { out, err, calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a dropped Ollama stream through the real SDK', () => {
  it('arrives as the 2xx wrap with the network error as its cause — and classifies as dropped', async () => {
    vi.useFakeTimers()
    const { err } = await turn(() => typeError('network error'))
    expect(err).toMatchObject({
      name: 'AI_APICallError',
      message: 'Failed to process successful response',
      statusCode: 200,
      cause: { name: 'TypeError' },
    })
    expect(classifyFailure(err)).toBe('dropped')
  })

  it('is never retried — one request, even when the SDK flags the drop retryable', async () => {
    vi.useFakeTimers()
    const browser = await turn(() => typeError('network error'))
    expect(browser.calls).toBe(1)
    const node = await turn(socketClosed)
    expect((node.err as { isRetryable?: unknown }).isRetryable).toBe(true)
    expect(node.calls).toBe(1) // the SDK's backoff wraps the request, never a started stream
    expect(classifyFailure(node.err)).toBe('dropped')
  })

  it('text that streamed before the drop is delivered first, then the honest throw', async () => {
    vi.useFakeTimers()
    const { out, err, calls } = await turn(() => typeError('network error'), ['all ', 'set. '])
    expect(out).toBe('all set. ') // the store keeps this and says "hiccuped mid-thought"
    expect(classifyFailure(err)).toBe('dropped')
    expect(calls).toBe(1)
  })
})
