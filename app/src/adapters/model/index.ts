/* Adapter selection + graceful fallback. The configured adapter is tried
   first; any failure (no key, network, malformed output) falls through to the
   deterministic rules floor — never a blocking error (PRD §9). */

import type { Settings } from '../../domain/types'
import { createOllamaAdapter } from './ollama'
import { createOpenAIAdapter } from './openai'
import { createRulesAdapter } from './rules'
import type { ChatTurn, ModelPort, ToolExecutor, WeekContext } from './types'

export type { ChatTurn, ModelPort, ToolExecutor, WeekContext, PlaceSpec, FreeSpec } from './types'

/* The Anthropic SDK loads lazily — the app must not pay for it until a key exists. */
function createLazyAnthropic(apiKey: string): ModelPort {
  let real: Promise<ModelPort> | null = null
  const get = () => {
    real ??= import('./anthropic').then((m) => m.createAnthropicAdapter(apiKey))
    return real
  }
  return {
    id: 'anthropic',
    async *converse(thread: ChatTurn[], ctx: WeekContext, exec: ToolExecutor) {
      yield* (await get()).converse(thread, ctx, exec)
    },
  }
}

export function selectAdapters(settings: Settings, now: () => Date): ModelPort[] {
  const chain: ModelPort[] = []
  if (settings.modelLocation === 'remote') {
    if (settings.remoteProvider === 'openai' && settings.openaiKey.trim()) {
      chain.push(createOpenAIAdapter(settings.openaiKey.trim(), settings.openaiModel || 'gpt-4o-mini'))
    } else if (settings.remoteProvider !== 'openai' && settings.anthropicKey.trim()) {
      chain.push(createLazyAnthropic(settings.anthropicKey.trim()))
    }
  }
  if (settings.modelLocation === 'local') {
    chain.push(createOllamaAdapter(settings.ollamaUrl, settings.ollamaModel))
  }
  chain.push(createRulesAdapter(now))
  return chain
}
