/* Anthropic adapter — BYO key, browser-direct (the key lives on this device
   and is sent only to api.anthropic.com).

   A real agentic loop: conversation history + live week context, strict-schema
   tools from the shared registry, factual tool results fed back, streamed
   replies grounded in what actually happened — never the model's assumption. */

import Anthropic from '@anthropic-ai/sdk'
import type { ChatTurn, ModelPort, ToolExecutor, WeekContext } from './types'
import { contextBlock, MEW_VOICE } from './types'
import { MEW_TOOLS, runTool } from './tools'
import { withRetry } from './retry'
import { PROVIDER_CONTRACT } from './contract'

/* one upfront sweep should place a day in ≤2 rounds (#102); 14 is headroom for a
   genuinely large multi-item plan, not room to thrash clash-by-clash */
const MAX_LOOP = 14

/* The Messages API requires `max_tokens`; the ceiling lives in PROVIDER_CONTRACT
   (within claude-sonnet-4-6's 64K output cap) so it can't silently drift past
   the model limit and 400. */
const MAX_TOKENS = PROVIDER_CONTRACT.anthropic.tokenCeiling ?? 32000

const TOOLS: Anthropic.Tool[] = MEW_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  strict: true,
  input_schema: t.parameters as Anthropic.Tool['input_schema'],
}))

export function createAnthropicAdapter(apiKey: string, model: string): ModelPort {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

  return {
    id: 'anthropic',

    async *converse(thread: ChatTurn[], ctx: WeekContext, exec: ToolExecutor, signal?: AbortSignal) {
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
        const open = () =>
          client.messages.stream(
            {
              model,
              /* required by the API — streaming delivers tokens live but every call
                 still declares a ceiling. The contract's ceiling is unreachable for a
                 MEW turn (the voice is 1–3 sentences); it exists purely as the
                 runaway-cost guard on the user's own key, with the continuation
                 handler below as the never-end-mid-word backstop. */
              max_tokens: MAX_TOKENS,
              cache_control: { type: 'ephemeral' },
              system,
              tools: TOOLS,
              messages,
            },
            /* the user's stop aborts the live request; the SDK rejects the
               stream with an APIUserAbortError, which the store reads as a
               clean stop (never a failure → never the rules fallback). */
            { signal },
          )

        /* Retry only stream-creation + the first event — a transient 429 / 529 /
           5xx / network blip before any token here is safely replayable; once a
           token streams below, `yieldedText` is set and a later failure must not
           replay the turn (the store's `acted || buffer` honesty guard). The
           request fires on the first awaited event, so connectivity failures
           surface here, inside withRetry, not at the synchronous create. */
        const { stream, first } = await withRetry(async () => {
          const raw = open()
          const it = raw[Symbol.asyncIterator]()
          const first = await it.next()
          return { stream: { it, raw }, first }
        })

        for (let step = first; !step.done; step = await stream.it.next()) {
          const event = step.value
          if (event.type === 'content_block_start' && event.content_block.type === 'text' && yieldedText) {
            yield '\n' // a fresh thought after acting gets its own line
          }
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            if (event.delta.text) yieldedText = true
            yield event.delta.text
          }
        }
        const message = await stream.raw.finalMessage()

        if (message.stop_reason === 'pause_turn') {
          messages.push({ role: 'assistant', content: message.content })
          continue
        }
        if (message.stop_reason === 'max_tokens') {
          /* never end mid-word: continue the turn (stop-reasons protocol). A
             truncated tool_use can't go back into history — regenerate instead. */
          const last = message.content[message.content.length - 1]
          if (last?.type === 'tool_use') {
            yield '\n'
            continue
          }
          messages.push({ role: 'assistant', content: message.content })
          messages.push({
            role: 'user',
            content:
              'Your reply was cut off mid-stream. Continue exactly where you left off — finish any remaining tool calls and the sentence. Repeat nothing.',
          })
          continue
        }
        if (message.stop_reason !== 'tool_use') return

        messages.push({ role: 'assistant', content: message.content })
        const results: Anthropic.ToolResultBlockParam[] = []
        for (const block of message.content) {
          if (block.type !== 'tool_use') continue
          let out: string
          try {
            out = await runTool(block.name, block.input, exec)
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
      /* the loop cap hit mid-flow — pause gracefully with progress kept, not a
         dead "say continue" stop (#102): everything placed is already saved */
      yield `\n(that's a full turn of changes — everything I placed is saved and your plan's intact, I just paused here so nothing's half-done. say "keep going" and I'll pick the plan up right where I left off.)`
    },
  }
}
