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

/* ── a remove ask answered in words (#131) ─────────────────────────────
   The remove ask says "Tell me which, or say "both"/"all of them"", so a typed
   answer must do what the chip would. While the newest live chips message is a
   remove ask (every option removes), a typed reply that names one chip resolves
   to it: its label, the all-chip's words ("both", "all", "all of them",
   "remove all of them"), a day ("the thursday one", "thursday's") or a time
   ("the 12:00"), each only when it points at exactly one chip. Anything else is
   null, so it's an ordinary message exactly as before. */

const DAY_WORDS = 'today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday'
/* the all-chip in words: "all"-words fit any count, "both" only two, "all N"
   only N; a count word that doesn't fit is answered, never acted on */
const ALL_WORDS = /^(?:(?:remove|drop|delete)\s+)?(?:all(?:\s+of\s+them)?|them\s+all)$/
const BOTH_WORDS = /^(?:(?:remove|drop|delete)\s+)?both(?:\s+of\s+them)?$/
const ALL_N_WORDS =
  /^(?:(?:remove|drop|delete)\s+)?all\s+(two|three|four|five|six|seven|eight|\d+)(?:\s+of\s+them)?$/
const COUNT_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
}

export function typedRemoveAnswer(
  chat: ChatMessage[],
  text: string
): { msgId: string; choiceId: string } | { clarify: string } | null {
  let ask: ChatMessage | undefined
  for (let i = chat.length - 1; i >= 0; i--) {
    if ((chat[i].choices?.length ?? 0) > 0) {
      ask = chat[i]
      break
    }
  }
  if (!ask || !choicesActive(chat, ask)) return null
  const options = ask.choices!
  if (!options.every((c) => /^remove\s/i.test(c.reply))) return null
  const pick = (c: { id: string } | undefined) => (c ? { msgId: ask!.id, choiceId: c.id } : null)
  const one = <T>(xs: T[]): T | undefined => (xs.length === 1 ? xs[0] : undefined)

  const said = text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ')
  const bare = said.replace(/^(?:remove|drop|delete)\s+/, '')
  const label = (c: { label: string }) => c.label.toLowerCase()

  const exact = one(options.filter((c) => label(c) === said || label(c) === bare))
  if (exact) return pick(exact)
  const allChip = one(options.filter((c) => /^remove\s+all\s/i.test(c.reply)))
  if (allChip && (ALL_WORDS.test(said) || BOTH_WORDS.test(said) || ALL_N_WORDS.test(said))) {
    /* how many the ask is about: its line leads with the count ("3 "lunch" blocks") */
    const count = Number(ask.body.match(/^(\d+)\s/)?.[1] ?? options.length - 1)
    const n = said.match(ALL_N_WORDS)?.[1]
    const named = BOTH_WORDS.test(said) ? 2 : n ? (COUNT_WORDS[n] ?? Number(n)) : count
    if (named === count) return pick(allChip)
    const base = allChip.reply.replace(/^remove\s+all\s+/i, '')
    return {
      clarify: `There are ${count} "${base}" blocks — say "remove all ${base}" to drop all ${count}, or name the day of the one to drop.`,
    }
  }
  const day = bare.match(
    new RegExp(`^(?:the\\s+)?(?:one\\s+(?:on\\s+)?)?(${DAY_WORDS})(?:'s|’s)?(?:\\s+one)?$`)
  )
  if (day) return pick(one(options.filter((c) => label(c).split(' ')[0] === day[1])))
  const time = bare.match(/^(?:the\s+)?(?:one\s+at\s+)?(\d{1,2}:\d{2})(?:\s+one)?$/)
  if (time) return pick(one(options.filter((c) => label(c).endsWith(time[1]))))
  return null
}
