/* Adapter selection + graceful fallback. The configured adapter is tried
   first; any failure (no key, network, malformed output) falls through to the
   deterministic rules floor — never a blocking error (PRD §9). */

import type { Settings } from '../../domain/types'
import type { AiAdapterSpec } from './aiAdapter'
import { PROVIDER_CONTRACT } from './contract'
import { createRulesAdapter } from './rules'
import type { ChatTurn, ModelPort, ToolExecutor, WeekContext } from './types'

export type {
  ChatTurn,
  ModelPort,
  ToolExecutor,
  WeekContext,
  PlaceSpec,
  FreeSpec,
  ChoiceOption,
} from './types'
export { CHOICES_POSTED } from './types'
export { classifyFailure, type FailureKind } from './retry'
export type { RemoteProvider } from './aiAdapter'
/* The guided-setup key probe (#161) — plain fetch, no SDK, so importing it never
   drags the lazy AI bundle into a zero-key session. */
export { validateKey, consoleUrl, probeMessage, defaultModelFor, type KeyProbe } from './validate'

/* The Vercel AI SDK + its provider packages load lazily — the app must not pay
   for them until a conversational model is actually spoken to; a zero-key
   session stays on the rules floor and never imports them. Every non-rules
   provider (Anthropic, OpenAI, local Ollama) runs through the one unified
   adapter (#150, #152). */
function createLazyAi(spec: AiAdapterSpec): ModelPort {
  let real: Promise<ModelPort> | null = null
  const get = () => {
    real ??= import('./aiAdapter').then((m) => m.createAiAdapter(spec))
    return real
  }
  return {
    id: spec.provider,
    async *converse(
      thread: ChatTurn[],
      ctx: WeekContext,
      exec: ToolExecutor,
      signal?: AbortSignal
    ) {
      yield* (await get()).converse(thread, ctx, exec, signal)
    },
  }
}

export function selectAdapters(settings: Settings, now: () => Date): ModelPort[] {
  const chain: ModelPort[] = []
  /* pre-tool reasoning capture is opt-in (#166); the adapter further no-ops it
     for any provider whose contract has no reasoning budget, so this flag is
     safe to pass through unconditionally. */
  const reasoning = settings.showReasoning
  if (settings.modelLocation === 'remote') {
    if (settings.remoteProvider === 'openai' && settings.openaiKey.trim()) {
      chain.push(
        createLazyAi({
          provider: 'openai',
          apiKey: settings.openaiKey.trim(),
          model: settings.openaiModel || PROVIDER_CONTRACT.openai.defaultModel,
          reasoning,
        })
      )
    } else if (settings.remoteProvider !== 'openai' && settings.anthropicKey.trim()) {
      chain.push(
        createLazyAi({
          provider: 'anthropic',
          apiKey: settings.anthropicKey.trim(),
          model: settings.anthropicModel || PROVIDER_CONTRACT.anthropic.defaultModel,
          reasoning,
        })
      )
    }
  }
  if (settings.modelLocation === 'local') {
    chain.push(
      createLazyAi({
        provider: 'ollama',
        baseUrl: settings.ollamaUrl,
        /* parity with the remote branches (#152): an emptied model field falls
           back to the contract default instead of riding an empty id to the
           server. */
        model: settings.ollamaModel || PROVIDER_CONTRACT.ollama.defaultModel,
        reasoning,
      })
    )
  }
  chain.push(createRulesAdapter(now))
  return chain
}
