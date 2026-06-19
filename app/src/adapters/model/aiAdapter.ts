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
   are unchanged. Provider quirks (default model, token ceiling) read from the
   shared PROVIDER_CONTRACT (#149). */

import { streamText, tool, jsonSchema, stepCountIs } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { ChatTurn, ModelPort, ToolExecutor, WeekContext } from './types'
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

export function createAiAdapter(provider: RemoteProvider, apiKey: string, model: string): ModelPort {
  return {
    id: provider, // keep ids stable so the store's fallback chain + honest-error copy match
    async *converse(thread: ChatTurn[], ctx: WeekContext, exec: ToolExecutor, signal?: AbortSignal) {
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
      for await (const delta of result.textStream) {
        if (delta) yield delta
      }
      if (streamErr) throw streamErr
    },
  }
}
