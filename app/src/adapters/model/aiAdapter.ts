/* Unified model adapter on the Vercel AI SDK (#150) — one code path for EVERY
   conversational provider (Anthropic, OpenAI, and local Ollama; #152 retired the
   hand-rolled anthropic.ts / openai.ts / ollama.ts). The SDK owns the parts we
   kept getting wrong by hand:
     · request-param normalization — `maxOutputTokens` maps to each provider's
       real field, so the `max_tokens` vs `max_completion_tokens` 400 cannot recur;
     · streaming (`textStream`) and the multi-step tool loop (`stopWhen`);
     · retries on transient blips (local only — see maxRetries below).
   It still runs IN-BROWSER (key stays on-device; Ollama never leaves localhost)
   and keeps MEW's seams: tools bridge to the in-app executor via `runTool` (the
   only mutation path), and the adapter ids stay 'anthropic'/'openai'/'ollama' so
   selectAdapters + classifyFailure copy are unchanged. Provider quirks (default
   model, token ceiling, reasoning) read from the shared PROVIDER_CONTRACT
   (#149, #166). */

import { streamText, tool, jsonSchema, isStepCount } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ChatTurn, ConverseChunk, ModelPort, ToolExecutor, WeekContext } from './types'
import { contextBlock, MEW_VOICE } from './types'
import { MEW_TOOLS, runTool } from './tools'
import { PROVIDER_CONTRACT, anthropicThinking } from './contract'

export type RemoteProvider = 'anthropic' | 'openai'

/** Everything the factory needs to reach one provider. A remote provider is a
    BYO key; Ollama is a keyless local server, so its credential IS the endpoint
    — the discriminated union keeps "which field authorizes this call" a
    compile-time fact instead of an overloaded string parameter. */
export type AiAdapterSpec = { model: string; reasoning?: boolean } & (
  { provider: RemoteProvider; apiKey: string } | { provider: 'ollama'; baseUrl: string }
)

/** One upfront sweep should place a day in ≤2 rounds (#102); 14 is headroom for a
    genuinely large plan, not room to thrash. The SDK enforces it via stopWhen. */
const MAX_STEPS = 14

/* The step cap hit mid-plan — pause gracefully with progress kept, never a dead
   stop (#153, word-for-word parity with the retired adapter's MAX_LOOP tail).
   Honest by construction: the SDK finishes the capped step's tool calls before
   stopping, so everything the message claims is saved really is. */
const STEP_CAP_PAUSE = `\n(that's a full turn of changes — everything I placed is saved and your plan's intact, I just paused here so nothing's half-done. say "keep going" and I'll pick the plan up right where I left off.)`

function buildModel(spec: AiAdapterSpec) {
  switch (spec.provider) {
    case 'openai':
      return createOpenAI({ apiKey: spec.apiKey })(spec.model)
    case 'ollama':
      /* Ollama's OpenAI-compatible surface (`/v1`) through the official
         @ai-sdk/openai-compatible provider — maintained in the vercel/ai
         monorepo, versioned in lockstep with the SDK, no third-party maintainer
         risk (#152). Tools + streaming ride the same unified loop as the remote
         providers; a model that can't run them fails the turn and the store's
         chain lands on the rules floor, never a blocking error. */
      return createOpenAICompatible({
        name: 'ollama',
        baseURL: `${spec.baseUrl.replace(/\/$/, '')}/v1`,
      })(spec.model)
    default:
      // browser-direct: Anthropic requires this header (from the contract) to
      // allow a web-origin call
      return createAnthropic({
        apiKey: spec.apiKey,
        headers: { ...PROVIDER_CONTRACT.anthropic.requiredHeaders },
      })(spec.model)
  }
}

/** Tidy a raw thinking dump into one short, human-readable line and cap it (#166).
    The model's internal reasoning can run long and chatty; the user sees a brief
    plan, not a transcript — collapse whitespace, trim, and clip to the contract's
    displayChars at a word boundary with an ellipsis when it overruns. */
function trimReasoning(raw: string, max: number): string {
  const clean = raw.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/* `reasoning` opts the turn into pre-tool thinking capture (#166). Off (the
   default) the adapter runs exactly as before — the plain textStream path, no
   thinking requested, so no cost/latency change. On, AND only for a provider
   whose contract declares a reasoning budget, we ask the model to think first
   and stream that plan back ahead of the reply. */
export function createAiAdapter(spec: AiAdapterSpec): ModelPort {
  const reasoningCfg = spec.reasoning ? PROVIDER_CONTRACT[spec.provider].reasoning : null

  return {
    id: spec.provider, // keep ids stable so the store's fallback chain + honest-error copy match
    async *converse(
      thread: ChatTurn[],
      ctx: WeekContext,
      exec: ToolExecutor,
      signal?: AbortSignal
    ): AsyncIterable<ConverseChunk> {
      /* MEW tools → SDK tools. `execute` runs in-browser and calls the store
         executor (the ONLY mutation path); the SDK drives the multi-step loop. */
      const tools = Object.fromEntries(
        MEW_TOOLS.map((t) => [
          t.name,
          tool({
            description: t.description,
            inputSchema: jsonSchema(t.parameters as Parameters<typeof jsonSchema>[0]),
            execute: (args: unknown) => runTool(t.name, args, exec),
          }),
        ])
      )
      // v7 routes stream errors to onError and ends the stream WITHOUT throwing.
      // Capture it and rethrow after the stream so the store's chain sees the
      // failure (honest classification + failover) — never a silent empty turn.
      let streamErr: unknown = null
      /* the last step's finish reason: 'tool-calls' at stream end means the
         step cap cut the loop while the model still wanted to act (#153). */
      let finishReason: string | null = null
      const result = streamText({
        model: buildModel(spec),
        /* Anthropic prompt caching (#153): the frozen MEW_VOICE gets the cache
           breakpoint — on Anthropic's wire the prefix INCLUDING the tool
           definitions up to that block is cached, and the per-turn context
           block sits after it, uncached. Other providers take the same prompt
           as one plain string; only Anthropic needs the split, because the
           breakpoint must land between frozen and per-turn content. */
        instructions:
          spec.provider === 'anthropic'
            ? [
                {
                  role: 'system',
                  content: MEW_VOICE,
                  providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
                },
                { role: 'system', content: contextBlock(ctx) },
              ]
            : `${MEW_VOICE}\n\n${contextBlock(ctx)}`,
        messages: thread.map((t) => ({ role: t.role, content: t.text })),
        tools,
        stopWhen: isStepCount(MAX_STEPS),
        // normalized by the SDK to each provider's real field — no max_tokens vs
        // max_completion_tokens. Ceiling from the shared contract (#149); Ollama
        // declares none (contract null), so the local server default governs,
        // exactly as the retired hand-rolled adapter left it.
        maxOutputTokens: PROVIDER_CONTRACT[spec.provider].tokenCeiling ?? undefined,
        /* Anthropic-only request options (namespaced; other providers get none):
           · cacheControl at the call level → the request's top-level
             cache_control, which auto-marks the last message — so history and
             the intra-turn tool loop reuse the whole prefix on every round
             trip (#153, parity with the retired adapter's two breakpoints);
           · thinking — extended reasoning, only when opted in (#166); the SDK
             surfaces the result as reasoning parts on the stream. The SHAPE is
             model-dependent (contract): 4.6+/5-family take {type:'adaptive'}
             and 400 on a budget; pre-4.6 still require the explicit budget.
             Reasoning off ⇒ no thinking field, so MEW adds no extra cost. */
        ...(spec.provider === 'anthropic'
          ? {
              providerOptions: {
                anthropic: {
                  cacheControl: { type: 'ephemeral' },
                  ...(reasoningCfg ? { thinking: anthropicThinking(spec.model) } : {}),
                },
              },
            }
          : {}),
        /* Two retry policies, split by what stands behind the adapter (#152):
           · remote (anthropic/openai) — OFF. Resilience is the store's chain
             (remote → local → rules floor); failing FAST hands the turn to the
             next adapter instead of parking it on a backoff timer (the slice-1
             decision, PR #156). One source of resilience, not two.
           · ollama — the SDK's own jittered exponential backoff (2 retries,
             the retired withRetry's schedule). The only thing behind the local
             model is the deterministic rules floor, and a local server reloading
             a model 503s routinely: one blip should clear on a retry, not
             degrade the turn (#116 behavior, preserved). */
        maxRetries: spec.provider === 'ollama' ? 2 : 0,
        abortSignal: signal,
        onError: (e: { error: unknown }) => {
          streamErr = e.error
        },
      })

      /* How every turn ends, whichever path streamed it. Order is the honesty
         order: a captured failure first (the store's chain must see it — never
         a silent empty turn), then the user's stop (v7 ends the stream CLEANLY
         on abort; the store's contract is a rejection it reads against
         signal.aborted for the "(stopped — what's above stands.)" copy, #117 —
         so an aborted turn always throws, as the hand-rolled adapters did),
         and only a turn that truly ran out of steps mid-plan gets the pause. */
      const epilogue = function* (): Generator<ConverseChunk> {
        if (streamErr) throw streamErr
        if (signal?.aborted) throw new DOMException('the user stopped this turn', 'AbortError')
        if (finishReason === 'tool-calls') yield STEP_CAP_PAUSE
      }

      if (!reasoningCfg) {
        /* the reply-text path: yield deltas; reasoning parts can't occur here
           (thinking was not requested), the rest is loop bookkeeping. */
        for await (const part of result.stream) {
          switch (part.type) {
            case 'text-delta':
              if (part.text) yield part.text
              break
            case 'error':
              streamErr = part.error
              break
            case 'finish':
              finishReason = part.finishReason
              break
          }
        }
        yield* epilogue()
        return
      }

      /* reasoning ON: walk the full stream so we can pull the model's thinking
         BEFORE any tool runs or any reply text shows. We accumulate reasoning
         deltas and flush the captured plan exactly once — at the latest, the
         instant the model stops thinking and starts acting/speaking — so the
         snapshot always lands ahead of the first mutation, satisfying "what did
         it plan?" (#166). */
      let reasoningBuf = ''
      let flushed = false
      const flushReasoning = function* (): Generator<ConverseChunk> {
        if (flushed) return
        flushed = true
        const snap = trimReasoning(reasoningBuf, reasoningCfg.displayChars)
        if (snap) yield { reasoning: snap }
      }

      for await (const part of result.stream) {
        switch (part.type) {
          case 'reasoning-delta':
            reasoningBuf += part.text
            break
          case 'reasoning-end':
            yield* flushReasoning()
            break
          case 'text-delta':
            // first visible token: the plan is settled — emit it before the reply
            yield* flushReasoning()
            if (part.text) yield part.text
            break
          case 'tool-call':
            // a tool is about to run: the plan must be on the record first
            yield* flushReasoning()
            break
          case 'error':
            streamErr = part.error
            break
          case 'finish':
            finishReason = part.finishReason
            break
        }
      }
      // a thinking-only turn (no text, no tool) still surfaces its plan
      yield* flushReasoning()
      yield* epilogue()
    },
  }
}
