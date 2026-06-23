/* Unified model adapter on the Vercel AI SDK (#150) — one code path for every
   remote provider, replacing the hand-rolled anthropic.ts / openai.ts. The SDK
   owns the parts we kept getting wrong by hand:
     · request-param normalization — `maxOutputTokens` maps to each provider's
       real field, so the `max_tokens` vs `max_completion_tokens` 400 cannot recur;
     · streaming (`textStream`) and the multi-step tool loop (`stopWhen`);
     · retries on transient blips.
   It still runs IN-BROWSER (key stays on-device) and keeps MEW's seams: tools
   bridge to the in-app executor via `runTool` (the only mutation path), and the
   adapter id stays 'anthropic'/'openai' so selectAdapters + classifyFailure copy
   are unchanged. Provider quirks (default model, token ceiling, reasoning) read
   from the shared PROVIDER_CONTRACT (#149, #166). */

import { streamText, tool, jsonSchema, stepCountIs } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { ChatTurn, ConverseChunk, ModelPort, ToolExecutor, WeekContext } from './types'
import { contextBlock, MEW_VOICE } from './types'
import { MEW_TOOLS, runTool } from './tools'
import { PROVIDER_CONTRACT } from './contract'

export type RemoteProvider = 'anthropic' | 'openai'

/** One upfront sweep should place a day in ≤2 rounds (#102); 14 is headroom for a
    genuinely large plan, not room to thrash. The SDK enforces it via stopWhen. */
const MAX_STEPS = 14

function buildModel(provider: RemoteProvider, apiKey: string, model: string) {
  if (provider === 'openai') return createOpenAI({ apiKey })(model)
  // browser-direct: Anthropic requires this header to allow a web-origin call
  return createAnthropic({ apiKey, headers: { 'anthropic-dangerous-direct-browser-access': 'true' } })(model)
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
export function createAiAdapter(
  provider: RemoteProvider,
  apiKey: string,
  model: string,
  reasoning = false,
): ModelPort {
  const reasoningCfg = reasoning ? PROVIDER_CONTRACT[provider].reasoning : null

  return {
    id: provider, // keep ids stable so the store's fallback chain + honest-error copy match
    async *converse(
      thread: ChatTurn[],
      ctx: WeekContext,
      exec: ToolExecutor,
      signal?: AbortSignal,
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
        ]),
      )
      // v6 routes stream errors to onError and ends textStream WITHOUT throwing.
      // Capture it and rethrow after the stream so the store's chain sees the
      // failure (honest classification + failover) — never a silent empty turn.
      let streamErr: unknown = null
      const result = streamText({
        model: buildModel(provider, apiKey, model),
        system: `${MEW_VOICE}\n\n${contextBlock(ctx)}`,
        messages: thread.map((t) => ({ role: t.role, content: t.text })),
        tools,
        stopWhen: stepCountIs(MAX_STEPS),
        // normalized by the SDK to each provider's real field — no max_tokens vs
        // max_completion_tokens. Ceiling from the shared contract (#149).
        maxOutputTokens: PROVIDER_CONTRACT[provider].tokenCeiling ?? 8192,
        // extended thinking — only when opted in AND the provider supports it
        // (#166). The SDK maps this to Anthropic's `thinking` block and surfaces
        // the result as reasoning parts on fullStream. Absent ⇒ identical request
        // to before, so a reasoning-off turn carries no extra cost.
        ...(reasoningCfg
          ? {
              providerOptions: {
                anthropic: { thinking: { type: 'enabled', budgetTokens: reasoningCfg.budgetTokens } },
              },
            }
          : {}),
        // resilience is the STORE's job — its fallback chain (remote → local →
        // rules floor) owns transient handling. The SDK's own retry is off so we
        // don't double-retry, and so a failure fails FAST to the next adapter
        // instead of parking the turn on a backoff timer (which also breaks
        // deterministic fake-timer tests). One source of resilience, not two.
        maxRetries: 0,
        abortSignal: signal,
        onError: (e: { error: unknown }) => {
          streamErr = e.error
        },
      })

      if (!reasoningCfg) {
        /* the original, untouched path: stream reply text only. */
        for await (const delta of result.textStream) {
          if (delta) yield delta
        }
        if (streamErr) throw streamErr
        return
      }

      /* reasoning ON: walk fullStream so we can pull the model's thinking BEFORE
         any tool runs or any reply text shows. We accumulate reasoning deltas and
         flush the captured plan exactly once — at the latest, the instant the
         model stops thinking and starts acting/speaking — so the snapshot always
         lands ahead of the first mutation, satisfying "what did it plan?" (#166). */
      let reasoningBuf = ''
      let flushed = false
      const flushReasoning = function* (): Generator<ConverseChunk> {
        if (flushed) return
        flushed = true
        const snap = trimReasoning(reasoningBuf, reasoningCfg.displayChars)
        if (snap) yield { reasoning: snap }
      }

      for await (const part of result.fullStream) {
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
        }
      }
      // a thinking-only turn (no text, no tool) still surfaces its plan
      yield* flushReasoning()
      if (streamErr) throw streamErr
    },
  }
}
