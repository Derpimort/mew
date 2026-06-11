/* Anthropic adapter — BYO key, browser-direct (the key lives on this device
   and is sent only to api.anthropic.com).

   A real agentic loop: conversation history + live week context, strict-schema
   tools from the shared registry, factual tool results fed back, streamed
   replies grounded in what actually happened — never the model's assumption. */

import Anthropic from '@anthropic-ai/sdk'
import type { ChatTurn, ModelPort, ToolExecutor, WeekContext } from './types'
import { contextBlock, MEW_VOICE } from './types'
import { MEW_TOOLS, runTool } from './tools'

const MODEL = 'claude-opus-4-8'
const MAX_LOOP = 6

const TOOLS: Anthropic.Tool[] = MEW_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  strict: true,
  input_schema: t.parameters as Anthropic.Tool['input_schema'],
}))

export function createAnthropicAdapter(apiKey: string): ModelPort {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

  return {
    id: 'anthropic',

    async *converse(thread: ChatTurn[], ctx: WeekContext, exec: ToolExecutor) {
      /* history: first message must be user; consecutive same-role is fine */
      const firstUser = thread.findIndex((t) => t.role === 'user')
      const messages: Anthropic.MessageParam[] = thread
        .slice(firstUser < 0 ? thread.length : firstUser)
        .slice(-16)
        .map((t) => ({ role: t.role, content: t.text }))

      /* prompt caching (prefix match): tools are deterministic and MEW_VOICE is
         frozen — the breakpoint on the voice block caches tools+voice together.
         The context block (clock, week, insights) changes per call, so it sits
         AFTER the breakpoint. The top-level cache_control auto-marks the last
         message, so history + the intra-turn tool loop reuse the whole prefix
         on every round trip. */
      const system: Anthropic.TextBlockParam[] = [
        { type: 'text', text: MEW_VOICE, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: contextBlock(ctx) },
      ]

      let yieldedText = false
      for (let i = 0; i < MAX_LOOP; i++) {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 2048,
          cache_control: { type: 'ephemeral' },
          system,
          tools: TOOLS,
          messages,
        })

        for await (const event of stream) {
          if (event.type === 'content_block_start' && event.content_block.type === 'text' && yieldedText) {
            yield '\n' // a fresh thought after acting gets its own line
          }
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            if (event.delta.text) yieldedText = true
            yield event.delta.text
          }
        }
        const message = await stream.finalMessage()

        if (message.stop_reason === 'pause_turn') {
          messages.push({ role: 'assistant', content: message.content })
          continue
        }
        if (message.stop_reason !== 'tool_use') return

        messages.push({ role: 'assistant', content: message.content })
        const results: Anthropic.ToolResultBlockParam[] = []
        for (const block of message.content) {
          if (block.type !== 'tool_use') continue
          let out: string
          try {
            out = runTool(block.name, block.input, exec)
          } catch (e) {
            results.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `error: ${e instanceof Error ? e.message : 'tool failed'}`,
              is_error: true,
            })
            continue
          }
          results.push({ type: 'tool_result', tool_use_id: block.id, content: out })
        }
        messages.push({ role: 'user', content: results })
      }
    },
  }
}
