/* ModelPort — one conversational seam, three adapters (Anthropic remote,
   Ollama local, deterministic rules). The adapter converses; the *executor*
   is the only thing allowed to touch the week. Tool results flow back to the
   model so replies are grounded in what actually happened, never guessed. */

import type { Tag } from '../../domain/types'

export interface WeekContext {
  todayKey: string
  todayLabel: string // "Tuesday, June 9"
  nowLabel: string // "9:40"
  weekSummary: string[] // one compact line per day
  realisticBestH: number | null
  mewsToday: number
  /** GBrain pattern lines — the user's own numbers (domain/insights.ts). */
  insightLines: string[]
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface PlaceSpec {
  title: string
  tag: Tag
  dayOffset: number
  startMin?: number
  durationMin?: number
  protected?: boolean
}
export interface FreeSpec {
  dayOffset: number
  startMin: number
  endMin: number
}

/** Executed against the live store; every method returns a short factual
    sentence describing what really happened (a tool_result, not a hope). */
export interface ToolExecutor {
  plan(places: PlaceSpec[], frees: FreeSpec[]): string
  complete(query: string): string
  move(query: string, toDayOffset?: number, toStartMin?: number): string
  capture(title: string): string
  /** Remove open MEW-placed blocks in scope. Done mews and external calendar
      events are never touched — positive-only, and not ours to delete. */
  clear(scope: import('../../domain/types').ClearScope): string
  /** Change an existing block in place: time, length, title, tag. */
  edit(
    query: string,
    patch: { startMin?: number; endMin?: number; durationMin?: number; title?: string; tag?: import('../../domain/types').Tag },
  ): string
}

export interface ModelPort {
  readonly id: 'anthropic' | 'openai' | 'ollama' | 'rules'
  /** Streams MEW's reply text; calls the executor for any actions. */
  converse(thread: ChatTurn[], ctx: WeekContext, exec: ToolExecutor): AsyncIterable<string>
}

export const MEW_VOICE = `You are MEW ("My Entire Week"), a calm companion that runs the user's week with them.
Voice: lowercase-friendly, short, warm, factual. First person, brief — 1–3 short sentences unless the user asks for more. Never imperative, never guilt.
Output renders in a terminal session log: plain text only — no markdown, no asterisks, no bullet lists, no headings.
Vocabulary (product law): a completed task is "a mew" — only a completion is ever called a mew; working the plan is "mewing away" / "mewmentum"; the companion is the user's mew (named Pixie by default); condition is "healthy" or "run-down" and reflects how sustainably they work, never how much.
Principles (absolute): positive only — never punish, never shame, no broken streaks; care, not blame; suggest, don't seize — propose, the user decides; act ONLY on what the user asked this turn and never call a tool they didn't ask for; the live week decides — answer "what is happening now" only from the week context given, never from memory of earlier turns.
When asked how the week looks or what you know: answer from the brain's pattern lines (the user's own numbers, 2–3 of them) — never dump the calendar; the Week view already shows it.
Tools are the only way anything changes. NEVER narrate an outcome the tool results don't show — no result, no claim. There is no recurrence: blocks exist per day; never say "every day" unless you placed each day. To change a block's time, length, or title use edit_block — don't re-create it.
Ordering constraints are sacred: when the user says X must come before/after Y, compute explicit times that satisfy it and pass startMin/endMin yourself (don't let auto-placement choose). After EVERY tool result, re-check the user's stated constraints against the returned times; if violated, fix it with another tool call, or say plainly that it didn't fit.
When you act, use the tools, then confirm in one short factual line (the tool result tells you what actually happened — repeat its facts, don't invent times). When you only talk, just talk.
No emoji. At most one exclamation mark, only in a celebration.`

export function contextBlock(ctx: WeekContext): string {
  return [
    `Today is ${ctx.todayLabel} (${ctx.todayKey}); the time is ${ctx.nowLabel}.`,
    `Mews today: ${ctx.mewsToday}.`,
    ctx.realisticBestH != null
      ? `The user's realistic best is about ${ctx.realisticBestH} hours of deep work per day (their own history).`
      : `No realistic-best estimate yet (not enough history).`,
    `The live week:`,
    ...ctx.weekSummary.map((l) => `  ${l}`),
    ...(ctx.insightLines.length
      ? [
          `What the brain knows from their history (use these numbers when relevant; history informs, the live week decides):`,
          ...ctx.insightLines.map((l) => `  · ${l}`),
        ]
      : []),
  ].join('\n')
}
