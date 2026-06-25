/* Ollama adapter — "Fully local": every word stays on the machine. One JSON
   intent per turn (small models can't run a reliable multi-step tool loop),
   executed through the same executor and composed with the shared templates.
   The sanitize guard + rules floor catch anything malformed. */

import type { ChatTurn, ModelPort, ToolExecutor, WeekContext } from './types'
import { contextBlock, MEW_VOICE } from './types'
import { runIntent, sanitizeIntent } from './rules'
import { withRetry } from './retry'
import { PROVIDER_CONTRACT } from './contract'

/* /api/chat takes no token-limit param (the server default governs); the only
   static header MEW sets comes from PROVIDER_CONTRACT, same source as the others. */
const OLLAMA_HEADERS = PROVIDER_CONTRACT.ollama.requiredHeaders

const INTENT_SPEC = `Decide what the user wants and respond ONLY with JSON matching:
{"kind":"plan|complete|move|capture|clear|remove|edit|remember|chat",
 "places":[{"title":str,"tag":"work|private|health|rest","dayOffset":int,"startMin":int?,"durationMin":int?,"protected":bool?,"attention":"focus|background"?,"dueMin":int?}],
 "frees":[{"dayOffset":int,"startMin":int,"endMin":int}],
 "query":str?,"toDayOffset":int?,"toStartMin":int?,"title":str?,"scope":"today|tomorrow|week|upcoming"?,"at":str?,"all":bool?,
 "edit":{"startMin":int?,"endMin":int?,"durationMin":int?,"title":str?,"attention":"focus|background"?,"dueMin":int?}?,"reply":str?}
kind="edit" to change an existing block's time/length/title in place ("make X 45 minutes","X should be 6:00-6:30").
dayOffset = days from today. startMin = minutes from midnight (9:00 = 540). "thursday morning" = that weekday's offset, startMin 540, durationMin 180.
attention="background" when it runs without the user ("in the background","while I work" — a 3h restore); dueMin when they state a hard deadline ("due by 1pm" = 780).
kind="remove" to drop/delete/cancel a specific named block (query = words from the title). When several share that title, set "at" to the one's start time ("22:30","10am"); set "all":true only on an explicit "both/all/every".
kind="clear" when they ask to clean up / wipe / reset the calendar or start over (scope default "upcoming").
kind="chat" for greetings/questions/anything conversational — put your short MEW-voice answer in "reply".
kind="capture" only for a task mentioned without a time.
kind="remember" when they state a standing rule or correction ("always","never","from now on","X means Y") — include "pref":{"kind":"time-default|duration-default|flexibility|ordering|fact","match":str,"value":str,"stated":str}. One-offs ("move gym today") are never remember.`

export function createOllamaAdapter(baseUrl: string, model: string): ModelPort {
  /* One non-streaming request per turn, nothing yielded until it returns — so
     the whole call (fetch + parse) is safely retryable on a transient blip: a
     local server reloading a model 503s, the socket flakes. The HTTP error
     carries `.status` so the shared classifier retries 5xx but not a 4xx, and
     a JSON parse of a 200 body is a logic failure, never retried. */
  async function chatOnce(
    system: string,
    turns: ChatTurn[],
    signal?: AbortSignal
  ): Promise<string> {
    return withRetry(async () => {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { ...OLLAMA_HEADERS },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          messages: [
            { role: 'system', content: system },
            ...turns.slice(-8).map((t) => ({ role: t.role, content: t.text })),
          ],
        }),
        /* the user's stop aborts the in-flight request; fetch rejects with an
           AbortError, which the store reads as a clean stop (never a failure →
           never the rules fallback). */
        signal,
      })
      if (!res.ok) throw Object.assign(new Error(`ollama ${res.status}`), { status: res.status })
      const data = (await res.json()) as { message?: { content?: string } }
      return data.message?.content ?? ''
    })
  }

  return {
    id: 'ollama',

    async *converse(
      thread: ChatTurn[],
      ctx: WeekContext,
      exec: ToolExecutor,
      signal?: AbortSignal
    ) {
      const raw = await chatOnce(
        [MEW_VOICE, '', INTENT_SPEC, '', contextBlock(ctx)].join('\n'),
        thread,
        signal
      )
      const intent = sanitizeIntent(JSON.parse(raw))
      if (!intent) throw new Error('local model returned no usable intent')
      const last = [...thread].reverse().find((t) => t.role === 'user')?.text ?? ''
      yield runIntent(intent, exec, ctx, last)
    },
  }
}
