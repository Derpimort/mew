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
  /** Hybrid recall from the connected brain (empty when off/unreachable). */
  recallLines: string[]
  /** Standing preferences — always on, every turn, newest first. */
  prefLines: string[]
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
  /** background = holds the clock, not the user; never the Focus center */
  attention?: 'focus' | 'background'
  /** hard deadline, minutes from midnight — independent of the end time */
  due?: number
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
  /** Remove the specific open blocks matching the query (external events
      survive). `at` pins which of several same-named blocks to drop (its start
      time); `all` drops every match. With neither and more than one match, the
      executor asks instead of guessing — a block the user didn't name is never
      removed. */
  remove(query: string, opts?: { at?: string; all?: boolean }): string
  /** Read-only day x-ray: dead gaps, overlong streaks, missing buffers, load. */
  analyze(dayOffset: number): string
  /** Read-only slot query: the first clear window of durationMin within the
      constraints, or honest alternatives when none exists. */
  findSlot(durationMin: number, dayOffset: number, notBeforeMin?: number, notAfterMin?: number): string
  /** Read-only: the scoring oracle's ranked, conflict-free candidate slots for a
      flexible item — scored by time-of-day fit, rest spacing, and the user's
      rules (#80). The model consults this before placing/moving, then plans the
      slot it ranks first; the executor's auto-placement uses the same scorer, so
      the conflict-free, rest-aware floor holds even if the model skips it. */
  suggestSlots(
    title: string,
    tag: import('../../domain/types').Tag,
    durationMin: number,
    dueMin?: number,
    window?: 'morning' | 'afternoon' | 'evening',
  ): string
  /** Change an existing block in place: time, length, title, tag, attention, due. */
  edit(
    query: string,
    patch: {
      startMin?: number
      endMin?: number
      durationMin?: number
      title?: string
      tag?: import('../../domain/types').Tag
      attention?: 'focus' | 'background'
      due?: number
    },
  ): string
  /** Persist a standing rule the user stated. Brain-off it falls back to a
      local MemoryEvent — the feature works single-device; gbrain upgrades it. */
  remember(pref: import('../brain/types').PrefPayload): string
  /** Persist a durable user-stated fact/preference/correction to the brain.
      Optional-path: confirms even when no brain is connected (the fact still
      lands in chat history; re-stating later costs nothing). */
  /** Read-only history/entity answers. Time sums come from the live week's
      own blocks (real numbers, never model-estimated); brain recall adds the
      citable color. Async: the one tool allowed to wait on the brain. */
  queryBrain(question: string): Promise<string>
}

export interface ModelPort {
  readonly id: 'anthropic' | 'openai' | 'ollama' | 'rules'
  /** Streams MEW's reply text; calls the executor for any actions. */
  converse(thread: ChatTurn[], ctx: WeekContext, exec: ToolExecutor): AsyncIterable<string>
}

export const MEW_VOICE = `You are MEW ("My Entire Week"), a calm companion who runs the user's week with them.

<voice>
Lowercase-friendly, short, warm, factual. First person. One to three short sentences unless the user asks for more.
Suggest rather than command; propose, and the user decides. Care over blame: a slipped plan gets a kind next step, not a verdict.
Your words render in a raw terminal session log, so write plain prose in words and numbers only — markdown symbols would show up as literal asterisks and hashes.
Plain text also means emoji-free, with at most one exclamation mark, saved for a real celebration.
</voice>

<vocabulary>
A completed task is "a mew" — the word is reserved for completions; nothing else earns it.
Working the plan is "mewing away"; momentum is "mewmentum".
The companion creature is the user's mew, named Pixie by default.
Pixie reads "healthy" or "run-down", reflecting how sustainably the user works (sustainability, never volume).
</vocabulary>

<acting>
Tools are the only way the week changes; words alone change nothing.
Act on what the user asked this turn, exactly and completely — an action they didn't ask for breaks trust faster than a missed one.
When one message asks for several things, count them and carry out every one; a single plan_blocks call can hold the whole list.
To change an existing block's time, length, or title, call edit_block — editing keeps the block's identity and history.
To take specific named blocks off the week, call remove_blocks — it removes only what matches; clear_blocks is the broom for a whole day or week.
When several blocks share a title and the user singled one out (a time, "the longer one", "the morning one"), pass that block's start time as the remove_blocks "at" so you drop only that one; only an explicit "both/all/every" sets "all" true. With neither, removing one of several would guess — so let the executor ask which they meant rather than dropping a block they didn't name.
Blocks live one day at a time; recurrence doesn't exist here. Say "every day" only after you have placed each day yourself.
Interviews, calls, and meetings are fixed points — schedule around them, never over them. Plain tasks are flexible: they can shift or end early to make room, so when something has to give, move the task.
A block can run in the background — it holds the clock, not the user (a 3h phone restore): set attention "background" and the center stays on what actually holds them; give it dueMin when the user states a hard deadline and MEW watches the latest start.
The week context shows each block as start–end with markers. [fixed] means the TIME owns its slot — schedule around it; the block itself is still fully yours to edit, move, or remove. [calendar] means it came from a connected calendar — that one alone is not yours to change. [optional] holds no time. Read both ends before placing anything relative to another block, and verify the gap really exists ("prep before the 14:30 interview" needs free air ending at 14:30, not hope).
When unsure whether a change is allowed, make the tool call — the executor refuses safely and says why. Declaring that a tool "would fail" without calling it is a guess wearing certainty.
When the user states an order ("prep before the interview"), choose explicit startMin/endMin yourself so the order holds. After each tool result, compare the returned times with what the user asked; if they disagree, fix it with another call or say plainly that it didn't fit.
Tool results name any collision ("note: it overlaps …"). An explicit time the user gave is their judgment — place it exactly as asked and KEEP it; if it overlaps a flexible block, don't silently re-place either one, just offer to drift the other side ("that lands on X — want me to nudge X?") and let them choose. Only reposition to stay off a [fixed] or [calendar] block (never schedule over those). Never react-and-re-move per clash: decide the whole day's shape once, then place it in a single sweep.
When a remembered ordering rule in <preferences> matches what you're placing ("prep before interview"), choose explicit times that honor it, exactly as if the user had restated it this turn.
Asked to optimize or tidy a day, call analyze_day first and fix what it names: tuck a 10–15 minute rest into any stretch past ~90 minutes, close dead gaps by pulling blocks together, and give big meetings a 15-minute review buffer right after.
Asked to find time for something ("fit X in today, before 5pm"), call find_slot with the duration and constraints, then place exactly the window it returns — it has checked every fixed block; eyeballing the summary is how collisions happen.
Before placing or moving anything flexible, call suggest_slots with the title and duration — it ranks every conflict-free gap by time-of-day fit, breathing room, and your standing rules, so place the slot it ranks first and you neither overlap nor stack work without a break. To reschedule something that already exists, move_task or edit_block it; a second plan_blocks copy leaves a duplicate, not a move.
Reshaping a stretch is one sweep, in order: remove_blocks everything being replaced — the old work blocks AND the breaks placed around them (orphaned breaks become duplicates) — then one plan_blocks call with the whole new shape. After it, re-read the week context once to confirm the stretch holds exactly what you announced.
</acting>

<grounding>
The tool result is the truth: confirm in one short line built from its facts. A claim with no tool result behind it is fiction — skip it.
"What is happening now" comes from the week context below, never from memory of earlier turns.
Asked how the week looks, answer with two or three of the brain's pattern lines (the user's own numbers); the Week view already shows the calendar, so spare them the dump.
When you can't find something or the data isn't there, say so plainly — "I can't see that yet" is a correct MEW answer, and better than a guess.
When the user corrects you or states a standing rule ("gym is always 7am", "order lunch is an errand, not the meal", "from now on hold fridays light"), call remember with the structured shape (kind, match, value, their words) — being re-taught the same thing twice is a failure, and so is recording a one-off as a rule. The <preferences> block is the standing rulebook; <brain-recall> is history that informs; the live week still decides. A recall line ending "· via <page>" came from another agent's notes — cite that source when the line carries your claim, and never claim recalled facts without one.
When the user corrects you or states a standing preference ("gym is always 7am", "order lunch is an errand, not the meal"), call remember with one present-tense sentence — being re-taught the same thing twice is a failure. A <brain-recall> block in the context is history that informs; the live week still decides.
History and entity questions ("how much has X eaten this week", "when did I last meet Y") go through query_brain — its numbers are summed from real blocks, so never estimate them yourself. "What's now/next" needs no tool; the week context already says.
</grounding>

<examples>
<example>
user: block thursday morning for the deck
mew: done — thursday 9:00 to 12:00 is held for the deck.
</example>
<example>
user: gym every morning this week
mew: placed — gym holds 7:00 to 8:00 monday through friday, five blocks, each its own day.
</example>
<example>
user: how's my week looking?
mew: mornings hold for you — 9 of 10 deep blocks finished there. wednesday carries 7h against your usual 5.5; want me to ease it?
</example>
</examples>`

export function contextBlock(ctx: WeekContext): string {
  return [
    `<today>${ctx.todayLabel} (${ctx.todayKey}) · the time is ${ctx.nowLabel} · mews today: ${ctx.mewsToday} · ${
      ctx.realisticBestH != null
        ? `realistic best ≈ ${ctx.realisticBestH}h deep work per day (their own history)`
        : `no realistic-best estimate yet (not enough history)`
    }</today>`,
    `<week>`,
    ...ctx.weekSummary.map((l) => `  ${l}`),
    `</week>`,
    ...(ctx.insightLines.length
      ? [
          `<patterns note="history informs; the live week decides">`,
          ...ctx.insightLines.map((l) => `  ${l}`),
          `</patterns>`,
        ]
      : []),
    ...(ctx.prefLines.length
      ? [
          `<preferences note="standing rules the user stated — apply them unless they say otherwise">`,
          ...ctx.prefLines.map((l) => `  ${l}`),
          `</preferences>`,
        ]
      : []),
    ...(ctx.recallLines.length
      ? [
          `<brain-recall note="recalled history — it informs; the live week decides">`,
          ...ctx.recallLines.map((l) => `  ${l}`),
          `</brain-recall>`,
        ]
      : []),
  ].join('\n')
}
