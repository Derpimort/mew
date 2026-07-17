/* ModelPort — one conversational seam, three adapters (Anthropic remote,
   Ollama local, deterministic rules). The adapter converses; the *executor*
   is the only thing allowed to touch the week. Tool results flow back to the
   model so replies are grounded in what actually happened, never guessed. */

import type { Insights } from '../../domain/insights'
import type { PrefPayload, Tag } from '../../domain/types'

export interface WeekContext {
  todayKey: string
  todayLabel: string // "Tuesday, June 9"
  nowLabel: string // "9:40"
  weekSummary: string[] // one compact line per day
  realisticBestH: number | null
  mewsToday: number
  /** Local pattern lines — the user's own history, computed on-device
      (domain/insights.ts). No brain I/O behind these, ever. */
  insightLines: string[]
  /** The full pattern set behind insightLines (same computation) — carried so
      the rules floor can render the shared insights-card presenter with the
      exact numbers the Settings card shows (#287). Optional: hand-built
      contexts stay valid; absent reads as "still learning". */
  insights?: Insights
  /** Hybrid recall from the connected brain (empty when off/unreachable). */
  recallLines: string[]
  /** Whether a brain (Settings opt-in or desktop sidecar) is connected. False
      renders an explicit off marker so the model never implies recall ran. */
  brainOn: boolean
  /** True when a brain is on but didn't answer this turn (timed out or
      errored). Renders an explicit degraded marker so the model treats the
      silence as missing recall, never as an empty history (#249). Optional:
      absent reads as false, so hand-built contexts stay valid. */
  recallDegraded?: boolean
  /** Standing preferences — always on, every turn, newest first. */
  prefLines: string[]
  /** The structured rulebook behind prefLines (#304): the keyless ritual
      route derives habit tasks from time-default rules. Optional — absent
      reads as none; contextBlock never renders it (prefLines already do). */
  prefs?: PrefPayload[]
  /** Open (unplaced) capture titles, oldest first (#304): the ritual route's
      standing "top priority" answers. Optional and never rendered into the
      model context — the capture rail already shows them to the user. */
  openCaptures?: string[]
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
  /** A standing recurrence (DAILY/WEEKLY): execPlan expands it into one block
      per occurrence, all linked by recurringBlockId (#159). */
  rrule?: import('../../domain/recurrence').Rrule
}
export interface FreeSpec {
  dayOffset: number
  startMin: number
  endMin: number
}

/** One tappable option for offerChoices (#254). `reply` is the complete user
    ask a pick posts as the next turn (runTool defaults it to the label). */
export interface ChoiceOption {
  label: string
  reply: string
}

/** One classified braindump item for proposeScenarios (#293). durationMin is
    optional on purpose: the executor fills it from the user's standing rules,
    then their own demonstrated medians, then the 60-min floor — the same
    precedence execPlan applies — so a keyless braindump still sizes honestly. */
export interface ScenarioTaskSpec {
  title: string
  tag: Tag
  durationMin?: number
  /** hard same-day deadline, minutes from midnight — must END by then */
  due?: number
  /** the user's STATED time of day; every scenario profile honors it */
  window?: 'morning' | 'afternoon' | 'evening'
}

/** Tool results beginning with this token mean the executor already posted the
    question as clickable chips (#254): a model should END its turn and say
    nothing more; the keyless floor yields nothing at all — the chips message
    IS the reply. One token, both paths, so the two can never disagree. */
export const CHOICES_POSTED = 'The options are on screen as clickable chips'

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
  findSlot(
    durationMin: number,
    dayOffset: number,
    notBeforeMin?: number,
    notAfterMin?: number
  ): string
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
    window?: 'morning' | 'afternoon' | 'evening'
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
    }
  ): string
  /** Persist a standing rule the user stated. Brain-off it falls back to a
      local MemoryEvent — the feature works single-device; gbrain upgrades it. */
  remember(pref: import('../brain/types').PrefPayload): string
  /** Chat-only (#254): post `prompt` as a mew message carrying clickable
      choice chips — MEW's ask-a-question and suggestions engine in one. It
      mutates NOTHING on the week; a pick posts the option's reply as an
      ordinary user turn through the normal message path. The result string
      (CHOICES_POSTED…) tells the model the options are on screen and the
      turn should end. */
  offerChoices(prompt: string, options: ChoiceOption[]): string
  /** Chat-only plan mode (#293): run the scenario engine over the classified
      tasks and post ONE mew message carrying named week-placement cards — the
      human picks, and the pick (pickScenario, store-side) applies the stored
      places byte-exactly through the plan executor. Proposing mutates NOTHING
      (#254 precedent); the result string leads with CHOICES_POSTED so a model
      ends its turn and the keyless floor stays quiet. One scenario falls
      through to a plain suggestion line — no picker theater. */
  proposeScenarios(prompt: string, tasks: ScenarioTaskSpec[]): string
  /** Persist a durable user-stated fact/preference/correction to the brain.
      Optional-path: confirms even when no brain is connected (the fact still
      lands in chat history; re-stating later costs nothing). */
  /** Read-only history/entity answers. Time sums come from the live week's
      own blocks (real numbers, never model-estimated); brain recall adds the
      citable color. Async: the one tool allowed to wait on the brain. */
  queryBrain(question: string): Promise<string>
  /** Reverse the LAST tool-driven mutation of this turn — the graceful "undo
      that" recovery for a misclick or a wrong placement. The store snapshots
      the week (blocks/captures/memory) just before each mutating tool runs and
      restores that snapshot here, then clears it so a second undo is a no-op.
      Read-only when nothing has changed this turn ("nothing to undo yet"). Chat
      is untouched — the reply about the undone action stays as context. */
  undoLast(): string
}

/** What `converse` yields. A plain string is a reply-text delta (the common
    case — every adapter emits these). A `{ reasoning }` chunk is the model's
    pre-action plan, captured BEFORE any tool ran and emitted once, ahead of the
    first text/tool (#166). An `{ activity }` chunk is a short MEW-voiced label
    for what the model is doing right now while nothing visible streams (#281,
    e.g. a silent thinking window) — the store shows it as the working status,
    never as a chat message; the label is deliberately generic so future
    activity kinds (tool cards) ride the same variant. All three ride the same
    stream so the seam stays single: the store routes a string to the visible
    reply, a reasoning chunk to the message's collapsible note, and an activity
    chunk to the status line. Adapters that can't surface thinking simply never
    emit the object variants, so widening this is backward-compatible. */
export type ConverseChunk = string | { reasoning: string } | { activity: string }

export interface ModelPort {
  readonly id: 'anthropic' | 'openai' | 'ollama' | 'rules'
  /** Streams MEW's reply text; calls the executor for any actions. `signal`,
      when given, cancels an in-flight turn: the adapter wires it into its
      stream/fetch so a user 'stop' ends the turn within a beat. An abort is the
      user's decision, never a model failure — work already committed stays.
      May also yield a single `{ reasoning }` chunk first (see ConverseChunk). */
  converse(
    thread: ChatTurn[],
    ctx: WeekContext,
    exec: ToolExecutor,
    signal?: AbortSignal
  ): AsyncIterable<ConverseChunk>
}

export const MEW_VOICE = `You are MEW ("My Entire Week"), a calm companion who runs the user's week with them.

<voice>
Lowercase-friendly, short, warm, factual. First person. One to three short sentences unless the user asks for more.
Suggest rather than command; propose, and the user decides. Care over blame: a slipped plan gets a kind next step, not a verdict.
Your words render as light markdown in the session log, so a short bullet list, an emphasized word, or inline \`code\` for a literal term is fine when it helps — but keep replies short and prose-first; don't format for its own sake.
Stay emoji-free, with at most one exclamation mark, saved for a real celebration.
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
A recurring habit or meeting ("gym every Monday and Wednesday", "standup every weekday until August") is one plan_blocks place with a recurrence rule (freq DAILY or WEEKLY, optional interval/byday/until/count); MEW expands it into one block per occurrence, all linked — never list one place per day yourself. To clear a whole repeating series, remove_blocks with all:true; a single delete drops just that one occurrence and the rest stay.
Interviews, calls, and meetings are fixed points — schedule around them, never over them. Plain tasks are flexible: they can shift or end early to make room, so when something has to give, move the task.
A block can run in the background — it holds the clock, not the user (a 3h phone restore): set attention "background" and the center stays on what actually holds them; give it dueMin when the user states a hard deadline and MEW watches the latest start.
The week context shows each block as start–end with markers. [fixed] means the TIME owns its slot — schedule around it; the block itself is still fully yours to edit, move, or remove. [calendar] means it came from a connected calendar — that one alone is not yours to change. [optional] holds no time. Read both ends before placing anything relative to another block, and verify the gap really exists ("prep before the 14:30 interview" needs free air ending at 14:30, not hope).
When the user catches a mistake right after you act — "undo that", "no, put it back", "that was wrong" — call undo_last_action: it reverses your most recent change (the blocks just placed, moved, or removed, and any note logged with it) and tells you what it took back. It only reaches the last action of this exchange, not the whole history; with nothing yet changed it says so. Confirm what came back in one warm line — a misstep undone is a small kindness, never a scolding.
When your next line would ask the user to pick among a few enumerable answers — which block, which slot, yes or no on an offer — call offer_choices with the question and two to five short options instead of asking in prose; give every option a reply that is a complete ask you could act on next turn ("move gym to 15:00", never a bare "yes"). Chips are a shortcut, never a gate — a typed answer always works. After offering (or when a tool result says the options are already on screen), end your turn saying nothing more; the pick arrives as the user's next message.
"plan my week" — typed, or the Sunday ritual's chip — is the weekly shaping ritual, and it composes tools you already have. The fixed meetings in the week context hold their spots; you lay flexible work around them. Ask at most three shaping questions with offer_choices, one per turn (top priority? protected mornings? gym days?), spending at most two tool calls in any question round; a standing answer ("mornings are protected") also goes through remember. Then ONE propose_scenarios call carries the whole classified batch — the stated priority first, two or three deep-work anchors, the habits — and ends your turn: the picker is the ritual's close. Generation is read-only; never place the week yourself during the ritual — the user's pick is the one apply.
When unsure whether a change is allowed, make the tool call — the executor refuses safely and says why. Declaring that a tool "would fail" without calling it is a guess wearing certainty.
When the user states an order ("prep before the interview"), choose explicit startMin/endMin yourself so the order holds. After each tool result, compare the returned times with what the user asked; if they disagree, fix it with another call or say plainly that it didn't fit.
Tool results name any collision ("note: it overlaps …"). An explicit time the user gave is their judgment — place it exactly as asked and KEEP it; if it overlaps a flexible block, don't silently re-place either one, just offer to drift the other side ("that lands on X — want me to nudge X?") and let them choose. Only reposition to stay off a [fixed] or [calendar] block (never schedule over those). Never react-and-re-move per clash: decide the whole day's shape once, then place it in a single sweep.
When a remembered ordering rule in <preferences> matches what you're placing ("prep before interview"), choose explicit times that honor it, exactly as if the user had restated it this turn.
Asked to optimize or tidy a day, call analyze_day first and fix what it names: tuck a 10–15 minute rest into any stretch past ~90 minutes, close dead gaps by pulling blocks together, and give big meetings a 15-minute review buffer right after.
Asked to find time for something ("fit X in today, before 5pm"), call find_slot with the duration and constraints, then place exactly the window it returns — it has checked every fixed block; eyeballing the summary is how collisions happen.
Before placing or moving anything flexible, call suggest_slots with the title and duration — it ranks every conflict-free gap by time-of-day fit, breathing room, and your standing rules, so place the slot it ranks first and you neither overlap nor stack work without a break. To reschedule something that already exists, move_task or edit_block it; a second plan_blocks copy leaves a duplicate, not a move.
A meal ask (breakfast, lunch, dinner, a snack) carries its natural window — suggest_slots already ranks those hours first, so take its top slot and never invent a late meal while the day still has room.
Reshaping a stretch is one sweep, in order: remove_blocks everything being replaced — the old work blocks AND the breaks placed around them (orphaned breaks become duplicates) — then one plan_blocks call with the whole new shape. After it, re-read the week context once to confirm the stretch holds exactly what you announced.
</acting>

<grounding>
The tool result is the truth: confirm in one short line built from its facts. A claim with no tool result behind it is fiction — skip it.
"What is happening now" comes from the week context below, never from memory of earlier turns.
Asked how the week looks, answer with two or three of the pattern lines — they are the user's own history, computed on-device, never the brain; the Week view already shows the calendar, so spare them the dump.
When you can't find something or the data isn't there, say so plainly — "I can't see that yet" is a correct MEW answer, and better than a guess.
A <brain-recall off/> marker means no brain is connected this session: asked about memory or what you recall, say the brain is off or not connected — never imply recall ran. The on-device pattern lines and the live week still answer.
A <brain-recall degraded/> marker means a brain is connected but didn't answer this turn: asked about memory, say the brain didn't answer just now — its silence is missing recall, never an empty history.
When the user corrects you or states a standing rule ("gym is always 7am", "order lunch is an errand, not the meal", "from now on hold fridays light"), call remember with the structured shape (kind, match, value, their words) — being re-taught the same thing twice is a failure, and so is recording a one-off as a rule. The <preferences> block is the standing rulebook; <brain-recall> is history that informs; the live week still decides. A recall line ending "· via <page>" came from another agent's notes — cite that source when the line carries your claim, and never claim recalled facts without one.
When the user corrects you or states a standing preference ("gym is always 7am", "order lunch is an errand, not the meal"), call remember with one present-tense sentence — being re-taught the same thing twice is a failure. A <brain-recall> block in the context is history that informs; the live week still decides.
History and entity questions ("how much has X eaten this week", "how were my gym sessions last week", "when did I last meet Y") go through query_brain — its numbers are summed from real blocks of the week the question names, past weeks included, so never estimate them yourself. "What's now/next" needs no tool; the week context already says.
</grounding>

<examples>
<example>
user: block thursday morning for the deck
mew: done — thursday 9:00 to 12:00 is held for the deck.
</example>
<example>
user: gym every monday and wednesday at 7 until the end of august
mew: done — gym repeats monday & wednesday 7:00–8:00 through aug 31. it's yours; say the word to change any one or the whole series.
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
          `<patterns note="computed on-device from the user's own history — it informs; the live week decides">`,
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
    /* recall honesty (#249): with a brain, its lines (or their absence) speak;
       with none, an explicit off marker — a silent absence reads as "nothing
       to recall", and the model then presents local patterns as memory. A
       connected brain that didn't answer is marked degraded for the same
       reason: only a real empty answer may stay silent. */
    ...(ctx.recallLines.length
      ? [
          `<brain-recall note="recalled history — it informs; the live week decides">`,
          ...ctx.recallLines.map((l) => `  ${l}`),
          `</brain-recall>`,
        ]
      : !ctx.brainOn
        ? [`<brain-recall off note="no brain is connected — recall did not run"/>`]
        : ctx.recallDegraded
          ? [
              `<brain-recall degraded note="the brain didn't answer this turn — recall is missing, not empty"/>`,
            ]
          : []),
  ].join('\n')
}
