/* Pre-tool reasoning snapshot (#166). The Vercel AI SDK surfaces Anthropic's
   extended thinking as `reasoning-*` parts on `fullStream`; this proves the
   adapter (a) only asks for thinking when opted in, (b) emits the model's plan
   as a single `{ reasoning }` chunk BEFORE the first tool runs and before the
   reply text, and (c) keeps it short. The SDK transport itself is covered by the
   live smoke; here we drive a programmable fake `streamText` so the wiring is
   deterministic and key-free. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConverseChunk, ToolExecutor, WeekContext } from '../types'

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

/* A fullStream part is the SDK's streamed event; we only build the variants the
   adapter reads. `text` carries both text-delta and reasoning-delta payloads. */
type Part =
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; text: string }
  | { type: 'reasoning-end'; id: string }
  | { type: 'text-delta'; id: string; text: string }
  | { type: 'tool-call'; toolName: string }
  | { type: 'error'; error: unknown }

/* The programmable fake: each test sets `parts`, the next streamText returns them
   as fullStream (and a text-only textStream for the reasoning-off path). The last
   options handed to streamText are captured so we can assert request shape. */
const scripted = { parts: [] as Part[], lastOptions: undefined as unknown }

async function* gen(parts: Part[]) {
  for (const p of parts) yield p
}

vi.mock('ai', () => ({
  streamText: (options: unknown) => {
    scripted.lastOptions = options
    return {
      get fullStream() {
        return gen(scripted.parts)
      },
      get textStream() {
        // the real SDK textStream yields plain reply strings, not stream parts
        const texts = scripted.parts
          .filter((p): p is Extract<Part, { type: 'text-delta' }> => p.type === 'text-delta')
          .map((p) => p.text)
        return (async function* () {
          for (const t of texts) yield t
        })()
      },
    }
  },
  // the adapter calls these but their behavior is irrelevant to reasoning wiring
  tool: (def: unknown) => def,
  jsonSchema: (s: unknown) => s,
  stepCountIs: (n: number) => n,
}))
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => () => ({ id: 'mock-anthropic-model' }),
}))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: () => () => ({ id: 'mock-openai-model' }) }))

let createAiAdapter: typeof import('../aiAdapter').createAiAdapter
beforeEach(async () => {
  ;({ createAiAdapter } = await import('../aiAdapter'))
})
afterEach(() => {
  scripted.parts = []
  scripted.lastOptions = undefined
  vi.clearAllMocks()
})

const exec = {} as ToolExecutor

async function collect(it: AsyncIterable<ConverseChunk>): Promise<ConverseChunk[]> {
  const out: ConverseChunk[] = []
  for await (const c of it) out.push(c)
  return out
}

function optionsHasThinking(o: unknown): boolean {
  const po = (o as { providerOptions?: { anthropic?: { thinking?: { type?: string } } } })
    .providerOptions
  return po?.anthropic?.thinking?.type === 'enabled'
}

describe('reasoning OFF (default) — no thinking requested, no reasoning chunk', () => {
  it('streams reply text only and never sets providerOptions.thinking', async () => {
    scripted.parts = [
      { type: 'text-delta', id: 't', text: 'done — ' },
      { type: 'text-delta', id: 't', text: 'thursday is held.' },
    ]
    const adapter = createAiAdapter('anthropic', 'sk-ant-x', 'claude-sonnet-4-6') // reasoning defaults false
    const chunks = await collect(
      adapter.converse([{ role: 'user', text: 'block thursday' }], ctx, exec)
    )

    expect(chunks).toEqual(['done — ', 'thursday is held.'])
    expect(chunks.every((c) => typeof c === 'string')).toBe(true)
    expect(optionsHasThinking(scripted.lastOptions)).toBe(false)
  })
})

describe('reasoning ON (Anthropic) — plan captured before the reply', () => {
  it('requests thinking and emits one { reasoning } chunk ahead of the text', async () => {
    scripted.parts = [
      { type: 'reasoning-start', id: 'r' },
      { type: 'reasoning-delta', id: 'r', text: 'the user wants thursday morning. ' },
      { type: 'reasoning-delta', id: 'r', text: 'no fixed blocks clash, so 9–12 is clear.' },
      { type: 'reasoning-end', id: 'r' },
      { type: 'text-delta', id: 't', text: 'done — thursday 9 to 12 is held.' },
    ]
    const adapter = createAiAdapter('anthropic', 'sk-ant-x', 'claude-sonnet-4-6', true)
    const chunks = await collect(
      adapter.converse([{ role: 'user', text: 'block thursday morning' }], ctx, exec)
    )

    // the request asked Claude to think first
    expect(optionsHasThinking(scripted.lastOptions)).toBe(true)
    // exactly one reasoning chunk, and it leads
    const reasoningChunks = chunks.filter((c) => typeof c !== 'string')
    expect(reasoningChunks).toHaveLength(1)
    expect(chunks[0]).toEqual({
      reasoning: 'the user wants thursday morning. no fixed blocks clash, so 9–12 is clear.',
    })
    // the reply text follows
    expect(chunks.slice(1)).toEqual(['done — thursday 9 to 12 is held.'])
  })

  it('emits the plan BEFORE the first tool-call, even with no preceding text', async () => {
    /* the model thinks, then goes straight to a tool (no text first) — the
       snapshot must still land before the mutation, satisfying the AC. */
    scripted.parts = [
      { type: 'reasoning-delta', id: 'r', text: 'place the deck, then free friday.' },
      { type: 'tool-call', toolName: 'plan_blocks' },
      { type: 'text-delta', id: 't', text: 'done.' },
    ]
    const adapter = createAiAdapter('anthropic', 'sk-ant-x', 'claude-sonnet-4-6', true)
    const chunks = await collect(
      adapter.converse([{ role: 'user', text: 'plan my day' }], ctx, exec)
    )

    expect(chunks[0]).toEqual({ reasoning: 'place the deck, then free friday.' })
    // only one reasoning chunk despite reasoning-end never arriving before the tool
    expect(chunks.filter((c) => typeof c !== 'string')).toHaveLength(1)
  })

  it('caps a long plan to the contract displayChars with an ellipsis', async () => {
    const long = 'x'.repeat(2000)
    scripted.parts = [
      { type: 'reasoning-delta', id: 'r', text: long },
      { type: 'reasoning-end', id: 'r' },
      { type: 'text-delta', id: 't', text: 'ok.' },
    ]
    const adapter = createAiAdapter('anthropic', 'sk-ant-x', 'claude-sonnet-4-6', true)
    const chunks = await collect(
      adapter.converse([{ role: 'user', text: 'plan a lot' }], ctx, exec)
    )

    const first = chunks[0] as { reasoning: string }
    expect(typeof first.reasoning).toBe('string')
    expect(first.reasoning.length).toBeLessThanOrEqual(601) // 600 cap + ellipsis
    expect(first.reasoning.endsWith('…')).toBe(true)
  })

  it('a thinking-only turn (no text, no tool) still surfaces its plan', async () => {
    scripted.parts = [
      { type: 'reasoning-delta', id: 'r', text: 'nothing to change here.' },
      { type: 'reasoning-end', id: 'r' },
    ]
    const adapter = createAiAdapter('anthropic', 'sk-ant-x', 'claude-sonnet-4-6', true)
    const chunks = await collect(adapter.converse([{ role: 'user', text: 'hmm' }], ctx, exec))
    expect(chunks).toEqual([{ reasoning: 'nothing to change here.' }])
  })

  it('a stream error after reasoning still rethrows (honest failover preserved)', async () => {
    scripted.parts = [
      { type: 'reasoning-delta', id: 'r', text: 'planning…' },
      { type: 'reasoning-end', id: 'r' },
      { type: 'error', error: new Error('529 overloaded') },
    ]
    const adapter = createAiAdapter('anthropic', 'sk-ant-x', 'claude-sonnet-4-6', true)
    const it = adapter.converse([{ role: 'user', text: 'plan' }], ctx, exec)[Symbol.asyncIterator]()
    // first chunk is the reasoning snapshot
    await it.next()
    // the captured error surfaces as a throw so the store's chain can fail over
    await expect(it.next()).rejects.toThrow('529 overloaded')
  })
})

describe('reasoning ON but provider has no reasoning budget (OpenAI) — no-op', () => {
  it('does not request thinking and never emits a reasoning chunk', async () => {
    scripted.parts = [
      // even if a provider somehow streamed reasoning, the off-path ignores it
      { type: 'reasoning-delta', id: 'r', text: 'should be ignored' },
      { type: 'text-delta', id: 't', text: 'all set.' },
    ]
    const adapter = createAiAdapter('openai', 'sk-x', 'gpt-5.4-mini', true) // asked on, but contract.reasoning is null
    const chunks = await collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))

    expect(optionsHasThinking(scripted.lastOptions)).toBe(false)
    expect(chunks).toEqual(['all set.']) // textStream path, reasoning ignored
  })
})
