/* OpenAI adapter — the org's BE dev credentials path. Same agentic contract
   as the Anthropic adapter: shared tool registry, executor-grounded results,
   history, bounded loop. Plain REST (chat completions + function tools);
   browser-direct, key stays on-device and goes only to api.openai.com. */

import type { ChatTurn, ModelPort, ToolExecutor, WeekContext } from './types'
import { contextBlock, MEW_VOICE } from './types'
import { MEW_TOOLS, runTool } from './tools'
import { withRetry } from './retry'

const MAX_LOOP = 6

interface OaToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
interface OaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OaToolCall[]
  tool_call_id?: string
}

const TOOLS = MEW_TOOLS.map((t) => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.parameters },
}))

export function createOpenAIAdapter(apiKey: string, model: string, baseUrl = 'https://api.openai.com'): ModelPort {
  /* One buffered round-trip per round of the loop, nothing yielded until it
     returns — so the whole call (fetch + parse) is safely retryable on a
     transient blip (a 429, a 5xx, a network drop) before any token reaches the
     caller. The non-OK throw carries `.status` so the shared classifier retries
     429/5xx but not a 4xx; a JSON parse of a 200 body is a logic failure, never
     retried. Each loop round creates a fresh request, so retry wraps strictly
     before that round's first yield — it can never replay a turn that already
     spoke or acted (store.ts honesty guard). An AbortError isn't transient, so a
     user cancel propagates through unchanged. */
  async function complete(messages: OaMessage[]): Promise<OaMessage> {
    return withRetry(async () => {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          tools: TOOLS,
          tool_choice: 'auto',
          max_tokens: 1024,
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw Object.assign(new Error(`openai ${res.status}${body ? `: ${body.slice(0, 140)}` : ''}`), {
          status: res.status,
        })
      }
      const data = (await res.json()) as { choices?: { message?: OaMessage }[] }
      const msg = data.choices?.[0]?.message
      if (!msg) throw new Error('openai returned no message')
      return msg
    })
  }

  return {
    id: 'openai',

    async *converse(thread: ChatTurn[], ctx: WeekContext, exec: ToolExecutor) {
      const messages: OaMessage[] = [
        { role: 'system', content: [MEW_VOICE, '', contextBlock(ctx)].join('\n') },
        ...thread.slice(-16).map((t) => ({ role: t.role, content: t.text }) as OaMessage),
      ]

      let yieldedText = false
      for (let i = 0; i < MAX_LOOP; i++) {
        const msg = await complete(messages)

        if (msg.content) {
          if (yieldedText) yield '\n'
          yieldedText = true
          yield msg.content
        }

        if (!msg.tool_calls?.length) return

        messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls })
        for (const call of msg.tool_calls) {
          let out: string
          try {
            out = await runTool(call.function.name, JSON.parse(call.function.arguments || '{}'), exec)
          } catch (e) {
            out = `error: ${e instanceof Error ? e.message : 'tool failed'}`
          }
          messages.push({ role: 'tool', content: out, tool_call_id: call.id })
        }
      }
    },
  }
}
