/* The model the user picks must reach the wire. These drive the real
   selectAdapters → adapter → request path: Anthropic through a mocked SDK,
   OpenAI through a stubbed fetch, asserting both the chosen id and the
   empty → stable-default fallback. Guards the #model-picker wiring. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { selectAdapters } from '../index'
import { DEFAULT_SETTINGS, type Settings } from '../../../domain/types'
import type { ToolExecutor, WeekContext } from '../types'

const NOW = () => new Date(2026, 5, 9, 9, 40)

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

const exec = {} as ToolExecutor // no tool path is exercised here

async function drain(it: AsyncIterable<string>): Promise<void> {
  for await (const _ of it) void _
}

/* fetch stub typed so reading mock.calls[0][1].body type-checks */
function stubFetch() {
  const spy = vi.fn(async (_url: string, _init: { body: string }) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'hi', tool_calls: [] } }] }),
  }))
  vi.stubGlobal('fetch', spy)
  return spy
}

/* Anthropic SDK mock — capture the args handed to messages.stream and end the
   turn cleanly (no tool loop). vi.mock is hoisted, so it also intercepts the
   dynamic import inside the lazy Anthropic adapter. */
const streamSpy = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: (args: { model: string }) => {
        streamSpy(args)
        return {
          async *[Symbol.asyncIterator]() {},
          finalMessage: async () => ({ stop_reason: 'end_turn', content: [] }),
        }
      },
    }
  },
}))

function settings(patch: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, modelLocation: 'remote', ...patch }
}

afterEach(() => {
  streamSpy.mockClear()
  vi.unstubAllGlobals()
})

describe('selectAdapters threads the chosen model to the wire', () => {
  it('Anthropic: the picked model id reaches messages.stream', async () => {
    const [adapter] = selectAdapters(
      settings({ remoteProvider: 'anthropic', anthropicKey: 'sk-ant-x', anthropicModel: 'claude-custom-9' }),
      NOW,
    )
    expect(adapter.id).toBe('anthropic')
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(streamSpy).toHaveBeenCalledOnce()
    expect(streamSpy.mock.calls[0][0].model).toBe('claude-custom-9')
  })

  it('Anthropic: empty model falls back to the stable default (not Fable)', async () => {
    const [adapter] = selectAdapters(
      settings({ remoteProvider: 'anthropic', anthropicKey: 'sk-ant-x', anthropicModel: '' }),
      NOW,
    )
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(streamSpy.mock.calls[0][0].model).toBe('claude-sonnet-4-6')
  })

  it('OpenAI: the picked model id reaches the request body', async () => {
    const fetchSpy = stubFetch()
    const [adapter] = selectAdapters(
      settings({ remoteProvider: 'openai', openaiKey: 'sk-x', openaiModel: 'gpt-test-9' }),
      NOW,
    )
    expect(adapter.id).toBe('openai')
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.model).toBe('gpt-test-9')
  })

  it('OpenAI: empty model falls back to the current default', async () => {
    const fetchSpy = stubFetch()
    const [adapter] = selectAdapters(
      settings({ remoteProvider: 'openai', openaiKey: 'sk-x', openaiModel: '' }),
      NOW,
    )
    await drain(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.model).toBe('gpt-5.4-mini')
  })

  it('the stable default ships in DEFAULT_SETTINGS', () => {
    expect(DEFAULT_SETTINGS.anthropicModel).toBe('claude-sonnet-4-6')
  })
})
