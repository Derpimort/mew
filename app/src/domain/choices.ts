/* Clickable option chips (#254 · offer_choices) — pure chat-shape predicates.
   One home for "is this chip still live?", shared by the store's pick guard
   and the session log's inert rendering, so both always agree. Liveness is
   DERIVED from the chat itself (a picked flag, a newer user message), never
   stored — the same computed-not-stored law as liveNow. */

import type { ChatMessage } from './types'

/** True once any option on the message was picked. */
export function choicePicked(msg: ChatMessage): boolean {
  return (msg.choices ?? []).some((c) => c.picked)
}

/** Index of the newest user message, -1 when none. The one number a log needs
    to mark every older choices row superseded in a single pass (the session
    log computes it once per render and hands each row a boolean). */
export function lastUserIndex(chat: ChatMessage[]): number {
  for (let i = chat.length - 1; i >= 0; i--) if (chat[i].role === 'user') return i
  return -1
}

/** A choices message is superseded the moment any newer user message lands —
    typed or picked, the question below it has been answered or left behind.
    A message the chat does not hold is superseded by definition. */
export function choicesSuperseded(chat: ChatMessage[], msgId: string): boolean {
  const idx = chat.findIndex((m) => m.id === msgId)
  return idx < 0 || idx < lastUserIndex(chat)
}

/** Chips stay clickable only while the question is live: options exist, none
    picked yet, and no newer user message has landed. */
export function choicesActive(chat: ChatMessage[], msg: ChatMessage): boolean {
  return (msg.choices?.length ?? 0) > 0 && !choicePicked(msg) && !choicesSuperseded(chat, msg.id)
}

/* Plan-mode scenario cards (#293) ride the exact same grammar: one pick, a
   newer user message supersedes, liveness derived — never stored. Shared by
   the store's pickScenario guard and the session log's inert rendering. */

/** True once any scenario on the message was picked. */
export function scenarioPicked(msg: ChatMessage): boolean {
  return (msg.scenarios ?? []).some((s) => s.picked)
}

/** Scenario cards stay pickable only while the offer is live: scenarios exist,
    none picked yet, and no newer user message has landed. */
export function scenariosActive(chat: ChatMessage[], msg: ChatMessage): boolean {
  return (
    (msg.scenarios?.length ?? 0) > 0 && !scenarioPicked(msg) && !choicesSuperseded(chat, msg.id)
  )
}
