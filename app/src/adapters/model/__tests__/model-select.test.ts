/* The model the user picks must reach the adapter. selectAdapters' job is to
   choose the provider and thread the chosen (or default) model id to the unified
   AI-SDK adapter factory; the SDK's job — id → request → wire — is covered by the
   live smoke (smoke.live.test.ts), not by mocking SDK transport here. So we spy
   the factory and assert the wiring + the empty→stable-default fallback. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../../../domain/types'
import type { ConverseChunk, ToolExecutor, WeekContext } from '../types'

/* Spy the unified factory. vi.mock is hoisted, so it also intercepts the dynamic
   import('./aiAdapter') inside selectAdapters' lazy wrapper. The spy records every
   arg the wrapper forwards — provider, key, model, and the pre-tool reasoning flag
   (#166) — so the impl only needs `provider` to mint a stub adapter. */
const createAiAdapter = vi.fn((provider: string, apiKey: string, model: string, reasoning?: boolean) => {
  void apiKey
  void model
  void reasoning // recorded by the spy; the stub only needs `provider`
  return { id: provider, async *converse(): AsyncGenerator<ConverseChunk> {} }
})
vi.mock('../aiAdapter', () => ({
  createAiAdapter: (provider: string, apiKey: string, model: string, reasoning?: boolean) =>
    createAiAdapter(provider, apiKey, model, reasoning),
}))

const { selectAdapters } = await import('../index')

const NOW = () => new Date(2026, 5, 9, 9, 40)
const ctx = {} as WeekContext
const exec = {} as ToolExecutor

function settings(patch: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, modelLocation: 'remote', ...patch }
}

/* the adapter is lazy — createAiAdapter only fires on the first converse, so
   drain a turn to trigger the dynamic import before asserting. */
async function drain(it: AsyncIterable<ConverseChunk>): Promise<void> {
  for await (const _ of it) void _
}

afterEach(() => createAiAdapter.mockClear())

describe('selectAdapters threads the chosen model to the unified adapter', () => {
  it('Anthropic: the picked model id reaches the factory', async () => {
    const [adapter] = selectAdapters(
      settings({ remoteProvider: 'anthropic', anthropicKey: 'sk-ant-x', anthropicModel: 'claude-custom-9' }),
      NOW,
    )
    expect(adapter.id).toBe('anthropic')
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    // reasoning off by default ⇒ the 4th arg is false (#166)
    expect(createAiAdapter).toHaveBeenCalledWith('anthropic', 'sk-ant-x', 'claude-custom-9', false)
  })

  it('Anthropic: empty model falls back to the stable default (not Fable)', async () => {
    const [adapter] = selectAdapters(
      settings({ remoteProvider: 'anthropic', anthropicKey: 'sk-ant-x', anthropicModel: '' }),
      NOW,
    )
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(createAiAdapter).toHaveBeenCalledWith('anthropic', 'sk-ant-x', 'claude-sonnet-4-6', false)
  })

  it('OpenAI: the picked model id reaches the factory', async () => {
    const [adapter] = selectAdapters(
      settings({ remoteProvider: 'openai', openaiKey: 'sk-x', openaiModel: 'gpt-test-9' }),
      NOW,
    )
    expect(adapter.id).toBe('openai')
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(createAiAdapter).toHaveBeenCalledWith('openai', 'sk-x', 'gpt-test-9', false)
  })

  it('OpenAI: empty model falls back to the current default', async () => {
    const [adapter] = selectAdapters(settings({ remoteProvider: 'openai', openaiKey: 'sk-x', openaiModel: '' }), NOW)
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(createAiAdapter).toHaveBeenCalledWith('openai', 'sk-x', 'gpt-5.4-mini', false)
  })

  it('the stable default ships in DEFAULT_SETTINGS', () => {
    expect(DEFAULT_SETTINGS.anthropicModel).toBe('claude-sonnet-4-6')
  })

  it('showReasoning threads through to the factory as the reasoning flag (#166)', async () => {
    const [adapter] = selectAdapters(
      settings({ remoteProvider: 'anthropic', anthropicKey: 'sk-ant-x', showReasoning: true }),
      NOW,
    )
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(createAiAdapter).toHaveBeenCalledWith('anthropic', 'sk-ant-x', 'claude-sonnet-4-6', true)
  })
})
