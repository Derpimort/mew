/* Pre-tool reasoning snapshot (#166). The Vercel AI SDK surfaces Anthropic's
   extended thinking as `reasoning-*` parts on the full stream; this proves the
   adapter (a) only asks for thinking when opted in, (b) emits the model's plan
   as a single `{ reasoning }` chunk BEFORE the first tool runs and before the
   reply text, and (c) keeps it short. The SDK transport itself is covered by the
   live smoke; here we drive a programmable fake `streamText` so the wiring is
   deterministic and key-free. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLoggerSink } from '../../logger'
import type { ConverseChunk, ToolExecutor, WeekContext } from '../types'

const ctx: WeekContext = {
  todayKey: '2026-06-09',
  todayLabel: 'Tuesday, June 9',
  nowLabel: '9:40',
  weekSummary: ['today (2026-06-09): 9:00 Q3 deck [work]'],
  realisticBestH: 5.5,
  mewsToday: 2,
  recallLines: [],
  brainOn: false,
  prefLines: [],
  insightLines: [],
}

/* A stream part is the SDK's streamed event; we only build the variants the
   adapter reads. `text` carries both text-delta and reasoning-delta payloads. */
type Part =
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; text: string }
  | { type: 'reasoning-end'; id: string }
  | { type: 'text-delta'; id: string; text: string }
  | { type: 'tool-call'; toolName: string }
  | { type: 'error'; error: unknown }
  | { type: 'finish'; finishReason: string }

/* The programmable fake: each test sets `parts`, the next streamText returns them
   as `stream` (and a text-only textStream for the reasoning-off path). The last
   options handed to streamText are captured so we can assert request shape. */
const scripted = { parts: [] as Part[], lastOptions: undefined as unknown }

async function* gen(parts: Part[]) {
  for (const p of parts) yield p
}

vi.mock('ai', () => ({
  streamText: (options: unknown) => {
    scripted.lastOptions = options
    return {
      get stream() {
        return gen(scripted.parts)
      },
    }
  },
  // the adapter builds the word-smoothing transform and hands it to streamText;
  // the fake above ignores options, so a callable stub is all the wiring needs
  // (the real smoothStream is pinned against the installed SDK in smoothing.test.ts)
  smoothStream: () => () => undefined,
  // the adapter calls these but their behavior is irrelevant to reasoning wiring
  tool: (def: unknown) => def,
  jsonSchema: (s: unknown) => s,
  isStepCount: (n: number) => n,
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

/* "was thinking requested at all" — the exact per-generation shape (adaptive
   vs budget_tokens) is pinned against the real wire in contract.test.ts. */
function optionsHasThinking(o: unknown): boolean {
  const po = (o as { providerOptions?: { anthropic?: { thinking?: { type?: string } } } })
    .providerOptions
  return typeof po?.anthropic?.thinking?.type === 'string'
}

type SystemMsg = { role: string; content: string; providerOptions?: Record<string, unknown> }
function instructionsOf(o: unknown): string | SystemMsg[] {
  return (o as { instructions: string | SystemMsg[] }).instructions
}

describe('reasoning OFF (default) — no thinking requested, no reasoning chunk', () => {
  it('streams reply text only and never sets providerOptions.thinking', async () => {
    scripted.parts = [
      { type: 'text-delta', id: 't', text: 'done — ' },
      { type: 'text-delta', id: 't', text: 'thursday is held.' },
    ]
    const adapter = createAiAdapter({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
    }) // reasoning defaults off
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
    const adapter = createAiAdapter({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
      reasoning: true,
    })
    const chunks = await collect(
      adapter.converse([{ role: 'user', text: 'block thursday morning' }], ctx, exec)
    )

    // the request asked Claude to think first
    expect(optionsHasThinking(scripted.lastOptions)).toBe(true)
    /* the silent window announces itself the instant thinking starts (#281),
       then exactly one reasoning note follows — ahead of the reply text */
    expect(chunks[0]).toEqual({ activity: 'thinking it through…' })
    const reasoningChunks = chunks.filter((c) => typeof c !== 'string' && 'reasoning' in c)
    expect(reasoningChunks).toHaveLength(1)
    expect(chunks[1]).toEqual({
      reasoning: 'the user wants thursday morning. no fixed blocks clash, so 9–12 is clear.',
    })
    // the reply text follows
    expect(chunks.slice(2)).toEqual(['done — thursday 9 to 12 is held.'])
  })

  it('emits the plan BEFORE the first tool-call, even with no preceding text', async () => {
    /* the model thinks, then goes straight to a tool (no text first) — the
       snapshot must still land before the mutation, satisfying the AC. */
    scripted.parts = [
      { type: 'reasoning-delta', id: 'r', text: 'place the deck, then free friday.' },
      { type: 'tool-call', toolName: 'plan_blocks' },
      { type: 'text-delta', id: 't', text: 'done.' },
    ]
    const adapter = createAiAdapter({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
      reasoning: true,
    })
    const chunks = await collect(
      adapter.converse([{ role: 'user', text: 'plan my day' }], ctx, exec)
    )

    expect(chunks[0]).toEqual({ activity: 'thinking it through…' })
    expect(chunks[1]).toEqual({ reasoning: 'place the deck, then free friday.' })
    // only one reasoning chunk despite reasoning-end never arriving before the tool
    expect(chunks.filter((c) => typeof c !== 'string' && 'reasoning' in c)).toHaveLength(1)
  })

  it('caps a long plan to the contract displayChars with an ellipsis', async () => {
    const long = 'x'.repeat(2000)
    scripted.parts = [
      { type: 'reasoning-delta', id: 'r', text: long },
      { type: 'reasoning-end', id: 'r' },
      { type: 'text-delta', id: 't', text: 'ok.' },
    ]
    const adapter = createAiAdapter({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
      reasoning: true,
    })
    const chunks = await collect(
      adapter.converse([{ role: 'user', text: 'plan a lot' }], ctx, exec)
    )

    const note = chunks[1] as { reasoning: string } // chunks[0] is the activity label
    expect(typeof note.reasoning).toBe('string')
    expect(note.reasoning.length).toBeLessThanOrEqual(601) // 600 cap + ellipsis
    expect(note.reasoning.endsWith('…')).toBe(true)
  })

  it('a thinking-only turn (no text, no tool) still surfaces its plan', async () => {
    scripted.parts = [
      { type: 'reasoning-delta', id: 'r', text: 'nothing to change here.' },
      { type: 'reasoning-end', id: 'r' },
    ]
    const adapter = createAiAdapter({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
      reasoning: true,
    })
    const chunks = await collect(adapter.converse([{ role: 'user', text: 'hmm' }], ctx, exec))
    expect(chunks).toEqual([
      { activity: 'thinking it through…' },
      { reasoning: 'nothing to change here.' },
    ])
  })

  it('a stream error after reasoning still rethrows (honest failover preserved)', async () => {
    scripted.parts = [
      { type: 'reasoning-delta', id: 'r', text: 'planning…' },
      { type: 'reasoning-end', id: 'r' },
      { type: 'error', error: new Error('529 overloaded') },
    ]
    const adapter = createAiAdapter({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
      reasoning: true,
    })
    const it = adapter.converse([{ role: 'user', text: 'plan' }], ctx, exec)[Symbol.asyncIterator]()
    // first the activity label, then the reasoning snapshot
    await it.next()
    await it.next()
    // the captured error surfaces as a throw so the store's chain can fail over
    await expect(it.next()).rejects.toThrow('529 overloaded')
  })
})

describe('reasoning ON but provider has no reasoning budget (OpenAI) — no-op', () => {
  it('does not request thinking and never emits a reasoning note', async () => {
    scripted.parts = [
      /* a provider may stream reasoning parts UNREQUESTED — the fast path no
         longer drops the window silently (#281): it surfaces one honest
         activity label, but the note capture stays reasoning-cfg-only */
      { type: 'reasoning-delta', id: 'r', text: 'never captured as a note' },
      { type: 'text-delta', id: 't', text: 'all set.' },
    ]
    const adapter = createAiAdapter({
      provider: 'openai',
      apiKey: 'sk-x',
      model: 'gpt-5.4-mini',
      reasoning: true,
    }) // asked on, but contract.reasoning is null
    const chunks = await collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))

    expect(optionsHasThinking(scripted.lastOptions)).toBe(false)
    expect(chunks).toEqual([{ activity: 'thinking it through…' }, 'all set.'])
    expect(chunks.some((c) => typeof c !== 'string' && 'reasoning' in c)).toBe(false)
  })
})

/* ── #281: honest activity for UNREQUESTED thinking + the paint pipeline ────
   5-family models run adaptive thinking whether or not MEW asks; the fast
   (no-reasoning-config) loop used to drop those parts, so the user watched
   bare dots for the whole window. These pin the new contract: one activity
   chunk per silent window, deduped in the adapter, before any text. */

describe('adaptive thinking on the no-reasoning path (#281) — honest activity, no note', () => {
  const spec = { provider: 'anthropic', apiKey: 'sk-ant-x', model: 'claude-sonnet-5' } as const

  it('a silent thinking window yields exactly one { activity } before the first text chunk', async () => {
    scripted.parts = [
      { type: 'reasoning-start', id: 'r' },
      { type: 'reasoning-delta', id: 'r', text: 'weighing the morning…' },
      { type: 'reasoning-delta', id: 'r', text: 'thursday is clear.' },
      { type: 'reasoning-end', id: 'r' },
      { type: 'text-delta', id: 't', text: 'on ' },
      { type: 'text-delta', id: 't', text: 'it.' },
    ]
    const adapter = createAiAdapter(spec) // reasoning defaults off — the fast path
    const chunks = await collect(adapter.converse([{ role: 'user', text: 'hold thu' }], ctx, exec))

    // no thinking was requested — the parts arrived on the API's own initiative
    expect(optionsHasThinking(scripted.lastOptions)).toBe(false)
    // one honest label for the whole window (deduped across its deltas), text streams through
    expect(chunks).toEqual([{ activity: 'thinking it through…' }, 'on ', 'it.'])
    // never a captured note on this path — the #166 opt-in alone carries those
    expect(chunks.some((c) => typeof c !== 'string' && 'reasoning' in c)).toBe(false)
  })

  it('a second silent window (the next tool round) announces itself again', async () => {
    scripted.parts = [
      { type: 'reasoning-delta', id: 'r1', text: 'plan first.' },
      { type: 'tool-call', toolName: 'plan_blocks' },
      { type: 'reasoning-delta', id: 'r2', text: 'now confirm.' },
      { type: 'text-delta', id: 't', text: 'done.' },
    ]
    const adapter = createAiAdapter(spec)
    const chunks = await collect(adapter.converse([{ role: 'user', text: 'plan' }], ctx, exec))

    expect(chunks).toEqual([
      { activity: 'thinking it through…' },
      { activity: 'thinking it through…' },
      'done.',
    ])
  })

  it('a text-only stream yields no activity at all — no fake shimmer', async () => {
    scripted.parts = [
      { type: 'text-delta', id: 't', text: 'right ' },
      { type: 'text-delta', id: 't', text: 'away.' },
    ]
    const adapter = createAiAdapter(spec)
    const chunks = await collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))
    expect(chunks).toEqual(['right ', 'away.'])
  })
})

describe('the paint pipeline request shape (#281)', () => {
  it('both stream paths hand streamText the word-smoothing transform', async () => {
    scripted.parts = [{ type: 'text-delta', id: 't', text: 'ok.' }]
    const transformOf = (o: unknown) =>
      (o as { experimental_transform?: unknown }).experimental_transform

    await collect(
      createAiAdapter({ provider: 'anthropic', apiKey: 'sk-ant-x', model: 'claude-sonnet-5' }) // fast path
        .converse([{ role: 'user', text: 'hi' }], ctx, exec)
    )
    expect(typeof transformOf(scripted.lastOptions)).toBe('function')

    await collect(
      createAiAdapter({
        provider: 'anthropic',
        apiKey: 'sk-ant-x',
        model: 'claude-sonnet-5',
        reasoning: true, // the #166 path rides the same call site
      }).converse([{ role: 'user', text: 'hi' }], ctx, exec)
    )
    expect(typeof transformOf(scripted.lastOptions)).toBe('function')
  })

  it('one dev timing line per turn: request start → first part → first text delta', async () => {
    const debugLines: unknown[][] = []
    setLoggerSink({
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: (...args: unknown[]) => debugLines.push(args),
    })
    try {
      scripted.parts = [
        { type: 'reasoning-delta', id: 'r', text: 'hm.' },
        { type: 'text-delta', id: 't', text: 'done ' },
        { type: 'text-delta', id: 't', text: '— held.' },
      ]
      const adapter = createAiAdapter({
        provider: 'anthropic',
        apiKey: 'sk-ant-x',
        model: 'claude-sonnet-5',
      })
      await collect(adapter.converse([{ role: 'user', text: 'hold thu' }], ctx, exec))

      const timing = debugLines.filter((args) => String(args[0]).includes('model/stream-timing'))
      expect(timing).toHaveLength(1) // once per turn, on the FIRST text delta
      const ctx2 = timing[0][1] as { provider: string; firstPartMs: number; firstTextMs: number }
      expect(ctx2.provider).toBe('anthropic')
      // both marks are on the record and ordered — (a) vs (b) stays attributable
      expect(ctx2.firstPartMs).toBeGreaterThanOrEqual(0)
      expect(ctx2.firstTextMs).toBeGreaterThanOrEqual(ctx2.firstPartMs)
    } finally {
      setLoggerSink(null)
    }
  })
})

/* ── #153: the cacheable prompt split + the graceful step-cap ─────────────── */

describe('Anthropic prompt caching (#153) — the frozen prefix carries the breakpoint', () => {
  it('splits instructions: MEW_VOICE marked ephemeral, per-turn context unmarked', async () => {
    scripted.parts = [{ type: 'text-delta', id: 't', text: 'ok.' }]
    const adapter = createAiAdapter({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
    })
    await collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))

    const instructions = instructionsOf(scripted.lastOptions)
    expect(Array.isArray(instructions)).toBe(true)
    const [voice, context] = instructions as SystemMsg[]
    // the frozen voice block is the breakpoint: everything up to it (tools
    // included, on Anthropic's wire) caches across the intra-turn loop
    expect(voice.content.startsWith('You are MEW')).toBe(true)
    expect(voice.providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    })
    // the per-turn context (clock, week, insights) sits AFTER it, uncached
    expect(context.content).toContain('<today>')
    expect(context.providerOptions).toBeUndefined()
    // and the call-level option auto-marks the last message for the loop
    const po = (
      scripted.lastOptions as {
        providerOptions?: { anthropic?: { cacheControl?: { type?: string } } }
      }
    ).providerOptions
    expect(po?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })
  })

  it('non-Anthropic providers keep the plain single-string prompt, no anthropic options', async () => {
    scripted.parts = [{ type: 'text-delta', id: 't', text: 'ok.' }]
    const adapter = createAiAdapter({ provider: 'openai', apiKey: 'sk-x', model: 'gpt-5.4-mini' })
    await collect(adapter.converse([{ role: 'user', text: 'hi' }], ctx, exec))

    const instructions = instructionsOf(scripted.lastOptions)
    expect(typeof instructions).toBe('string')
    expect(instructions as string).toContain('You are MEW')
    expect((scripted.lastOptions as { providerOptions?: unknown }).providerOptions).toBeUndefined()
  })
})

describe('graceful step-cap (#153) — a capped turn pauses kindly, never dead-stops', () => {
  it("finishReason 'tool-calls' at stream end yields the pause message after the reply", async () => {
    scripted.parts = [
      { type: 'text-delta', id: 't', text: 'placing the last of it…' },
      { type: 'finish', finishReason: 'tool-calls' },
    ]
    const adapter = createAiAdapter({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
    })
    const chunks = await collect(
      adapter.converse([{ role: 'user', text: 'plan it all' }], ctx, exec)
    )

    const last = chunks[chunks.length - 1]
    expect(typeof last).toBe('string')
    expect(last as string).toContain('say "keep going"')
    expect(last as string).toContain("nothing's half-done")
  })

  it('a normally finished turn adds nothing', async () => {
    scripted.parts = [
      { type: 'text-delta', id: 't', text: 'done — thursday is held.' },
      { type: 'finish', finishReason: 'stop' },
    ]
    const adapter = createAiAdapter({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
    })
    const chunks = await collect(
      adapter.converse([{ role: 'user', text: 'block thursday' }], ctx, exec)
    )
    expect(chunks).toEqual(['done — thursday is held.'])
  })

  it('the pause also lands on the reasoning path, after the plan and the reply', async () => {
    scripted.parts = [
      { type: 'reasoning-delta', id: 'r', text: 'fourteen placements needed.' },
      { type: 'reasoning-end', id: 'r' },
      { type: 'text-delta', id: 't', text: 'working through it…' },
      { type: 'finish', finishReason: 'tool-calls' },
    ]
    const adapter = createAiAdapter({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
      reasoning: true,
    })
    const chunks = await collect(
      adapter.converse([{ role: 'user', text: 'plan everything' }], ctx, exec)
    )

    expect(chunks[0]).toEqual({ activity: 'thinking it through…' })
    expect(chunks[1]).toEqual({ reasoning: 'fourteen placements needed.' })
    expect(chunks[2]).toBe('working through it…')
    expect(String(chunks[3])).toContain('keep going')
  })

  it('a captured stream error outranks the pause — failover stays honest', async () => {
    scripted.parts = [
      { type: 'error', error: new Error('529 overloaded') },
      { type: 'finish', finishReason: 'tool-calls' },
    ]
    const adapter = createAiAdapter({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
    })
    await expect(
      collect(adapter.converse([{ role: 'user', text: 'plan' }], ctx, exec))
    ).rejects.toThrow('529 overloaded')
  })
})
