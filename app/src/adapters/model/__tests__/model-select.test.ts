/* The model the user picks must reach the adapter. selectAdapters' job is to
   choose the provider and thread the chosen (or default) model id to the unified
   AI-SDK adapter factory; the SDK's job — id → request → wire — is covered by the
   wire pins (contract.test.ts) and the live smoke (smoke.live.test.ts), not by
   mocking SDK transport here. So we spy the factory and assert the wiring + the
   empty→stable-default fallback, for all three providers (#152). */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../../../domain/types'
import type { AiAdapterSpec } from '../aiAdapter'
import type { ConverseChunk, ToolExecutor, WeekContext } from '../types'

/* Spy the unified factory. vi.mock is hoisted, so it also intercepts the dynamic
   import('./aiAdapter') inside selectAdapters' lazy wrapper. The spy records the
   spec the wrapper forwards — provider, credential, model, and the pre-tool
   reasoning flag (#166) — so the impl only needs `provider` to mint a stub. */
const createAiAdapter = vi.fn((spec: AiAdapterSpec) => ({
  id: spec.provider,
  async *converse(): AsyncGenerator<ConverseChunk> {},
}))
vi.mock('../aiAdapter', () => ({
  createAiAdapter: (spec: AiAdapterSpec) => createAiAdapter(spec),
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
      settings({
        remoteProvider: 'anthropic',
        anthropicKey: 'sk-ant-x',
        anthropicModel: 'claude-custom-9',
      }),
      NOW
    )
    expect(adapter.id).toBe('anthropic')
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    // reasoning off by default ⇒ the flag rides as false (#166)
    expect(createAiAdapter).toHaveBeenCalledWith({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-custom-9',
      reasoning: false,
    })
  })

  it('Anthropic: empty model falls back to the stable default (not Fable)', async () => {
    const [adapter] = selectAdapters(
      settings({ remoteProvider: 'anthropic', anthropicKey: 'sk-ant-x', anthropicModel: '' }),
      NOW
    )
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(createAiAdapter).toHaveBeenCalledWith({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
      reasoning: false,
    })
  })

  it('OpenAI: the picked model id reaches the factory', async () => {
    const [adapter] = selectAdapters(
      settings({ remoteProvider: 'openai', openaiKey: 'sk-x', openaiModel: 'gpt-test-9' }),
      NOW
    )
    expect(adapter.id).toBe('openai')
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(createAiAdapter).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'sk-x',
      model: 'gpt-test-9',
      reasoning: false,
    })
  })

  it('OpenAI: empty model falls back to the current default', async () => {
    const [adapter] = selectAdapters(
      settings({ remoteProvider: 'openai', openaiKey: 'sk-x', openaiModel: '' }),
      NOW
    )
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(createAiAdapter).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'sk-x',
      model: 'gpt-5.4-mini',
      reasoning: false,
    })
  })

  it('the stable default ships in DEFAULT_SETTINGS', () => {
    expect(DEFAULT_SETTINGS.anthropicModel).toBe('claude-sonnet-4-6')
  })

  it('showReasoning threads through to the factory as the reasoning flag (#166)', async () => {
    const [adapter] = selectAdapters(
      settings({ remoteProvider: 'anthropic', anthropicKey: 'sk-ant-x', showReasoning: true }),
      NOW
    )
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(createAiAdapter).toHaveBeenCalledWith({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
      reasoning: true,
    })
  })
})

describe('Ollama routes through the same unified adapter (#152)', () => {
  it('local mode: the user URL + picked model reach the factory; rules floor follows', async () => {
    const chain = selectAdapters(
      settings({
        modelLocation: 'local',
        ollamaUrl: 'http://box.local:11434',
        ollamaModel: 'qwen3',
      }),
      NOW
    )
    expect(chain.map((a) => a.id)).toEqual(['ollama', 'rules'])
    await drain(chain[0].converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(createAiAdapter).toHaveBeenCalledWith({
      provider: 'ollama',
      baseUrl: 'http://box.local:11434',
      model: 'qwen3',
      reasoning: false,
    })
  })

  it('local mode: empty model falls back to the contract default', async () => {
    const [adapter] = selectAdapters(settings({ modelLocation: 'local', ollamaModel: '' }), NOW)
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(createAiAdapter).toHaveBeenCalledWith({
      provider: 'ollama',
      baseUrl: DEFAULT_SETTINGS.ollamaUrl,
      model: 'llama3.2',
      reasoning: false,
    })
  })
})
