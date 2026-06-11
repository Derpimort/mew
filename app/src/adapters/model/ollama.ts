/* Ollama adapter — "Fully local": every word stays on the machine. One JSON
   intent per turn (small models can't run a reliable multi-step tool loop),
   executed through the same executor and composed with the shared templates.
   The sanitize guard + rules floor catch anything malformed. */

import type { ChatTurn, ModelPort, ToolExecutor, WeekContext } from './types'
import { contextBlock, MEW_VOICE } from './types'
import { runIntent, sanitizeIntent } from './rules'

const INTENT_SPEC = `Decide what the user wants and respond ONLY with JSON matching:
{"kind":"plan|complete|move|capture|clear|edit|chat",
 "places":[{"title":str,"tag":"work|private|health|rest","dayOffset":int,"startMin":int?,"durationMin":int?,"protected":bool?}],
 "frees":[{"dayOffset":int,"startMin":int,"endMin":int}],
 "query":str?,"toDayOffset":int?,"toStartMin":int?,"title":str?,"scope":"today|tomorrow|week|upcoming"?,
 "edit":{"startMin":int?,"endMin":int?,"durationMin":int?,"title":str?}?,"reply":str?}
kind="edit" to change an existing block's time/length/title in place ("make X 45 minutes","X should be 6:00-6:30").
dayOffset = days from today. startMin = minutes from midnight (9:00 = 540). "thursday morning" = that weekday's offset, startMin 540, durationMin 180.
kind="clear" when they ask to clean up / wipe / reset the calendar or start over (scope default "upcoming").
kind="chat" for greetings/questions/anything conversational — put your short MEW-voice answer in "reply".
kind="capture" only for a task mentioned without a time.`

export function createOllamaAdapter(baseUrl: string, model: string): ModelPort {
  async function chatOnce(system: string, turns: ChatTurn[]): Promise<string> {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: system },
          ...turns.slice(-8).map((t) => ({ role: t.role, content: t.text })),
        ],
      }),
    })
    if (!res.ok) throw new Error(`ollama ${res.status}`)
    const data = (await res.json()) as { message?: { content?: string } }
    return data.message?.content ?? ''
  }

  return {
    id: 'ollama',

    async *converse(thread: ChatTurn[], ctx: WeekContext, exec: ToolExecutor) {
      const raw = await chatOnce(
        [MEW_VOICE, '', INTENT_SPEC, '', contextBlock(ctx)].join('\n'),
        thread,
      )
      const intent = sanitizeIntent(JSON.parse(raw))
      if (!intent) throw new Error('local model returned no usable intent')
      const last = [...thread].reverse().find((t) => t.role === 'user')?.text ?? ''
      yield runIntent(intent, exec, ctx, last)
    },
  }
}
