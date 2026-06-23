/* Adapter selection + graceful fallback. The configured adapter is tried
   first; any failure (no key, network, malformed output) falls through to the
   deterministic rules floor — never a blocking error (PRD §9). */

import type { Settings } from '../../domain/types'
import type { RemoteProvider } from './aiAdapter'
import { PROVIDER_CONTRACT } from './contract'
import { createOllamaAdapter } from './ollama'
import { createRulesAdapter } from './rules'
import type { ChatTurn, ModelPort, ToolExecutor, WeekContext } from './types'

export type { ChatTurn, ModelPort, ToolExecutor, WeekContext, PlaceSpec, FreeSpec } from './types'
export { classifyFailure, type FailureKind } from './retry'

/* The Vercel AI SDK + its provider packages load lazily — the app must not pay
   for them until a remote key exists; a zero-key session stays on the rules
   floor and never imports them. Both remote providers run through the one
   unified adapter (#150). */
function createLazyAi(provider: RemoteProvider, apiKey: string, model: string, reasoning: boolean): ModelPort {
  let real: Promise<ModelPort> | null = null
  const get = () => {
    real ??= import('./aiAdapter').then((m) => m.createAiAdapter(provider, apiKey, model, reasoning))
    return real
  }
  return {
    id: provider,
    async *converse(thread: ChatTurn[], ctx: WeekContext, exec: ToolExecutor, signal?: AbortSignal) {
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
      chain.push(createLazyAi('openai', settings.openaiKey.trim(), settings.openaiModel || PROVIDER_CONTRACT.openai.defaultModel, reasoning))
    } else if (settings.remoteProvider !== 'openai' && settings.anthropicKey.trim()) {
      chain.push(createLazyAi('anthropic', settings.anthropicKey.trim(), settings.anthropicModel || PROVIDER_CONTRACT.anthropic.defaultModel, reasoning))
    }
  }
  if (settings.modelLocation === 'local') {
    chain.push(createOllamaAdapter(settings.ollamaUrl, settings.ollamaModel))
  }
  chain.push(createRulesAdapter(now))
  return chain
}
