/* Guards on the model-provider contract, now pinned against the REAL wire (#148,
   #152). These are the checks that would have caught the shipped 400: OpenAI
   sent `max_tokens` on a model that requires a newer param name, so every turn
   fell to the rules floor. Mocks of the SDK can't catch a wrong param NAME (a
   mock echoes whatever the code sends) — so the wire pins below drive the
   shipping unified adapter through the REAL AI SDK against a stubbed fetch and
   inspect the actual outgoing request: URL, headers, and the token-cap field
   per provider. The stub answers 400 where only the request shape matters — the
   request is fully formed before any response is read. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROVIDER_CONTRACT, DEFAULT_MODEL_SETTING, type ProviderKey } from '../contract'
import { createAiAdapter, type AiAdapterSpec } from '../aiAdapter'
import { classifyFailure } from '../retry'
import { DEFAULT_SETTINGS } from '../../../domain/types'
import type { ConverseChunk, ToolExecutor, WeekContext } from '../types'

const ctx: WeekContext = {
  todayKey: '2026-06-18',
  todayLabel: 'Thursday, June 18',
  nowLabel: '9:40',
  weekSummary: ['today (2026-06-18): 9:00 Q3 deck [work]'],
  realisticBestH: 5.5,
  mewsToday: 2,
  recallLines: [],
  brainOn: false,
  prefLines: [],
  insightLines: [],
}
const exec = {} as ToolExecutor

const PROVIDERS = Object.keys(PROVIDER_CONTRACT) as ProviderKey[]

describe('PROVIDER_CONTRACT — default models', () => {
  it.each(PROVIDERS)('%s default model is non-empty', (p) => {
    expect(PROVIDER_CONTRACT[p].defaultModel.trim().length).toBeGreaterThan(0)
  })

  it.each(PROVIDERS)('%s default model matches DEFAULT_SETTINGS', (p) => {
    const field = DEFAULT_MODEL_SETTING[p]
    expect(PROVIDER_CONTRACT[p].defaultModel).toBe(DEFAULT_SETTINGS[field])
  })
})

describe('PROVIDER_CONTRACT — token ceilings', () => {
  it('Anthropic max_tokens stays within the safe ceiling and is not over the model cap', () => {
    const c = PROVIDER_CONTRACT.anthropic
    expect(c.tokenLimitParam).toBe('max_tokens')
    expect(c.tokenCeiling).not.toBeNull()
    // claude-sonnet-4-6 caps output at 64K; the ceiling must sit within it.
    expect(c.tokenCeiling!).toBeGreaterThan(0)
    expect(c.tokenCeiling!).toBeLessThanOrEqual(64000)
  })

  it('OpenAI (Responses API) uses max_output_tokens and NEVER the deprecated max_tokens', () => {
    expect(PROVIDER_CONTRACT.openai.tokenLimitParam).toBe('max_output_tokens')
    // the regression guard: the legacy field name must not reappear here.
    expect(PROVIDER_CONTRACT.openai.tokenLimitParam).not.toBe('max_tokens')
    expect(PROVIDER_CONTRACT.openai.tokenCeiling).not.toBeNull()
    expect(PROVIDER_CONTRACT.openai.tokenCeiling!).toBeGreaterThan(0)
  })

  it('Ollama declares no request token-limit param (server default governs)', () => {
    expect(PROVIDER_CONTRACT.ollama.tokenLimitParam).toBeNull()
    expect(PROVIDER_CONTRACT.ollama.tokenCeiling).toBeNull()
  })
})

/* ── the wire pins: the unified adapter through the REAL SDK ─────────────────
   One fetch stub per case; `drain` swallows the turn's failure when only the
   captured request matters. Every field asserted here is a live-API contract:
   if the SDK stops normalizing `maxOutputTokens` to the provider's real field,
   or a header stops flowing, these fail before a user ever sees a 400. */

interface Captured {
  url: string
  headers: Headers
  body: Record<string, unknown>
}

function captureFetch(respond: () => Response | Promise<Response>) {
  const captured: Captured[] = []
  const fetchSpy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(url),
      headers: new Headers(init?.headers as HeadersInit),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    })
    return respond()
  })
  vi.stubGlobal('fetch', fetchSpy)
  return { captured, fetchSpy }
}

const reject400 = () =>
  new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 400 })

function sseResponse(lines: string[]) {
  const enc = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(`data: ${l}\n\n`))
        c.enqueue(enc.encode('data: [DONE]\n\n'))
        c.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  )
}
const oaChunk = (text: string) =>
  JSON.stringify({
    id: '1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'm',
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })

async function drain(spec: AiAdapterSpec): Promise<{ out: string; err: unknown }> {
  const adapter = createAiAdapter(spec)
  let out = ''
  let err: unknown = null
  try {
    for await (const c of adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec)) {
      if (typeof c === 'string') out += c
    }
  } catch (e) {
    err = e
  }
  return { out, err }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('outgoing request — OpenAI through the unified adapter', () => {
  it('hits the Responses API with max_output_tokens at the ceiling — never max_tokens', async () => {
    const { captured } = captureFetch(reject400)
    await drain({ provider: 'openai', apiKey: 'sk-x', model: 'gpt-5.4-mini' })

    expect(captured).toHaveLength(1) // remote fails FAST: no SDK retry (#156)
    const req = captured[0]
    expect(req.url).toContain('api.openai.com/v1/responses')
    expect(req.headers.get('authorization')).toBe('Bearer sk-x')
    expect(req.body.max_output_tokens).toBe(PROVIDER_CONTRACT.openai.tokenCeiling)
    expect(req.body).not.toHaveProperty('max_tokens')
    expect(req.body).not.toHaveProperty('max_completion_tokens')
    /* the system prompt rides the v7 `instructions` path onto the wire —
       MEW's voice AND the live week context, or the model speaks as no one */
    const flat = JSON.stringify(req.body)
    expect(flat).toContain('You are MEW')
    expect(flat).toContain('<today>')
  })
})

describe('outgoing request — Anthropic through the unified adapter', () => {
  it('hits the Messages API with the contract ceiling, key, and the browser-direct opt-in', async () => {
    const { captured } = captureFetch(reject400)
    await drain({ provider: 'anthropic', apiKey: 'sk-ant-x', model: 'claude-sonnet-4-6' })

    expect(captured).toHaveLength(1)
    const req = captured[0]
    expect(req.url).toContain('api.anthropic.com/v1/messages')
    expect(req.headers.get('x-api-key')).toBe('sk-ant-x')
    // the one static header MEW itself must add for a web-origin call
    expect(req.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')
    expect(req.body.max_tokens).toBe(PROVIDER_CONTRACT.anthropic.tokenCeiling)
    // the shared tool registry rides the wire — tools are how the week changes
    const tools = req.body.tools as { name: string }[]
    expect(tools.map((t) => t.name)).toContain('plan_blocks')
    /* the system prompt rides the v7 `instructions` path onto the wire —
       MEW's voice AND the live week context, or the model speaks as no one */
    const system = JSON.stringify(req.body.system)
    expect(system).toContain('You are MEW')
    expect(system).toContain('<today>')
  })

  it('carries the prompt-cache breakpoints: frozen voice marked, per-turn context not (#153)', async () => {
    const { captured } = captureFetch(reject400)
    await drain({ provider: 'anthropic', apiKey: 'sk-ant-x', model: 'claude-sonnet-4-6' })

    const body = captured[0].body
    /* system is the two-block split: the frozen MEW_VOICE carries the
       cache_control breakpoint (on Anthropic's wire this caches the prefix
       INCLUDING the tool definitions), the per-turn context block after it
       stays uncached so a new clock tick can't poison the cache. */
    const system = body.system as { text: string; cache_control?: { type: string } }[]
    expect(Array.isArray(system)).toBe(true)
    expect(system[0].text.startsWith('You are MEW')).toBe(true)
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(system[1].text).toContain('<today>')
    expect(system[1].cache_control).toBeUndefined()
    // the top-level request option auto-marks the last message, so history +
    // the intra-turn tool loop reuse the whole prefix each round trip
    expect(body.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('the cached prefix clears the minimum-cacheable floor — a short prefix silently no-ops (#153)', async () => {
    const { captured } = captureFetch(reject400)
    await drain({ provider: 'anthropic', apiKey: 'sk-ant-x', model: 'claude-sonnet-4-6' })

    const body = captured[0].body
    const system = body.system as { text: string }[]
    /* Anthropic ignores cache_control below a model-dependent minimum prefix
       length (1024 tokens Sonnet/Opus-class, 2048 Haiku-class) — no error, no
       cache, just full price every turn. The prefix behind MEW's breakpoint is
       the serialized tools + the frozen voice block; assert its ~4-chars/token
       estimate clears the LARGER floor so caching works whichever family the
       user types into Settings. */
    const prefixChars = JSON.stringify(body.tools).length + system[0].text.length
    expect(prefixChars / 4).toBeGreaterThanOrEqual(2048)
  })
})

describe('outgoing request — Ollama through the unified adapter', () => {
  it("hits the user's server on /v1/chat/completions with tools and NO token cap", async () => {
    const { captured } = captureFetch(reject400)
    await drain({ provider: 'ollama', baseUrl: 'http://box.local:11434/', model: 'llama3.2' })

    const req = captured[0]
    // trailing slash on the user's URL must not double up
    expect(req.url).toBe('http://box.local:11434/v1/chat/completions')
    expect(req.body.model).toBe('llama3.2')
    expect(req.body.stream).toBe(true)
    // contract: no cap param of any spelling — the server default governs
    expect(req.body).not.toHaveProperty('max_tokens')
    expect(req.body).not.toHaveProperty('max_output_tokens')
    expect(req.body).not.toHaveProperty('max_completion_tokens')
    const tools = req.body.tools as { function: { name: string } }[]
    expect(tools.map((t) => t.function.name)).toContain('plan_blocks')
    /* the system prompt rides the v7 `instructions` path onto the wire —
       MEW's voice AND the live week context, or the model speaks as no one */
    const messages = req.body.messages as { role: string; content: string }[]
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('You are MEW')
    expect(messages[0].content).toContain('<today>')
  })
})

describe('retry policy on the SDK path (#152)', () => {
  it('Ollama: a transient 503 retries and the turn recovers without falling through (#116)', async () => {
    vi.useFakeTimers()
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++
        if (calls === 1) return new Response('overloaded', { status: 503 })
        return sseResponse([oaChunk('recovered.')])
      })
    )
    const turn = drain({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3.2' })
    await vi.advanceTimersByTimeAsync(30_000) // ride out the SDK's jittered backoff
    const { out, err } = await turn

    expect(calls).toBe(2)
    expect(err).toBeNull()
    expect(out).toBe('recovered.')
  })

  it('Ollama: a 400 is a logic failure — one request, no retry, an honest throw', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++
        return new Response(
          JSON.stringify({ error: { message: 'model does not support tools' } }),
          {
            status: 400,
          }
        )
      })
    )
    const { err } = await drain({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'no-tools',
    })

    expect(calls).toBe(1)
    expect(err).not.toBeNull() // the store's chain sees it and lands on the rules floor
  })

  it('remote fails FAST — a 429 is thrown to the chain after one request, classified busy', async () => {
    const { fetchSpy } = captureFetch(
      () => new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 })
    )
    const { err } = await drain({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(classifyFailure(err)).toBe('busy')
  })
})

describe('SDK failures reach classifyFailure with a usable status (#152)', () => {
  const cases: [number, ReturnType<typeof classifyFailure>][] = [
    [401, 'auth'],
    [403, 'auth'],
    [404, 'model'],
    [429, 'busy'],
    [400, 'rejected'],
  ]
  it.each(cases)('a live %d classifies as %s end-to-end', async (status, kind) => {
    captureFetch(
      () => new Response(JSON.stringify({ error: { message: `http ${status}` } }), { status })
    )
    const { err } = await drain({ provider: 'openai', apiKey: 'sk-x', model: 'gpt-5.4-mini' })
    expect(err).not.toBeNull()
    expect(classifyFailure(err)).toBe(kind)
  })
})

async function collect(it: AsyncIterable<ConverseChunk>): Promise<string> {
  let out = ''
  for await (const c of it) if (typeof c === 'string') out += c
  return out
}

describe('streamed text flows end-to-end on the SDK path', () => {
  it('Ollama: SSE deltas arrive as reply text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([oaChunk('all '), oaChunk('set.')]))
    )
    const adapter = createAiAdapter({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2',
    })
    const out = await collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(out).toBe('all set.')
  })
})
