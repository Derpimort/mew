/* Static guards on the model-adapter contract. These are the unit-time checks
   that would have caught the shipped 400: OpenAI sent `max_tokens` on a model
   that requires `max_completion_tokens`, so every turn fell to the rules floor.
   Mocks can't catch a wrong param NAME (the mock echoes whatever the code sends)
   — so these assertions inspect the param name directly, both on the contract
   and on the real outgoing OpenAI request body. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROVIDER_CONTRACT, DEFAULT_MODEL_SETTING, type ProviderKey } from '../contract'
import { createOpenAIAdapter } from '../openai'
import { DEFAULT_SETTINGS } from '../../../domain/types'
import type { ToolExecutor, WeekContext } from '../types'

const ctx: WeekContext = {
  todayKey: '2026-06-18',
  todayLabel: 'Thursday, June 18',
  nowLabel: '9:40',
  weekSummary: ['today (2026-06-18): 9:00 Q3 deck [work]'],
  realisticBestH: 5.5,
  mewsToday: 2,
  recallLines: [],
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

  it('OpenAI uses max_completion_tokens and NEVER max_tokens', () => {
    expect(PROVIDER_CONTRACT.openai.tokenLimitParam).toBe('max_completion_tokens')
    // the regression guard: the legacy field name must not reappear here.
    expect(PROVIDER_CONTRACT.openai.tokenLimitParam).not.toBe('max_tokens')
    expect(PROVIDER_CONTRACT.openai.tokenCeiling).not.toBeNull()
    expect(PROVIDER_CONTRACT.openai.tokenCeiling!).toBeGreaterThan(0)
  })

  it('Ollama declares no request token-limit param', () => {
    expect(PROVIDER_CONTRACT.ollama.tokenLimitParam).toBeNull()
    expect(PROVIDER_CONTRACT.ollama.tokenCeiling).toBeNull()
  })
})

/* The real outgoing request body — the check that closes the mock gap. A unit
   mock proves the code RUNS; this proves the code sends the field a live OpenAI
   model actually accepts. If anyone reverts the body to `max_tokens`, this fails. */
describe('OpenAI adapter — outgoing request body', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  async function captureBody(): Promise<Record<string, unknown>> {
    let captured: Record<string, unknown> = {}
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body ?? '{}'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
        text: async () => '',
      }
    })
    vi.stubGlobal('fetch', fetchSpy)
    const adapter = createOpenAIAdapter('sk-x', 'gpt-5.4-mini')
    // drain the generator so the request actually fires
    for await (const _ of adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec)) void _
    return captured
  }

  it('sends max_completion_tokens and never max_tokens', async () => {
    const body = await captureBody()
    expect(body).toHaveProperty('max_completion_tokens')
    expect(body).not.toHaveProperty('max_tokens')
    expect(body.max_completion_tokens).toBe(PROVIDER_CONTRACT.openai.tokenCeiling)
  })

  it('caps tokens within the contract ceiling', async () => {
    const body = await captureBody()
    expect(body.max_completion_tokens as number).toBeLessThanOrEqual(PROVIDER_CONTRACT.openai.tokenCeiling!)
  })
})
