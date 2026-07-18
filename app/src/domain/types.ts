/* Core domain types. Product law is encoded here: a block can be open, done,
   or rolled — there is no failed/overdue/missed state anywhere in the system. */

import type { Rrule } from './recurrence'
import type { Scenario } from './scenarios'
import type { LearnedRule } from './prefs'

export type Tag = 'work' | 'private' | 'health' | 'rest'
export type BlockStatus = 'open' | 'done' | 'rolled'
export type Visibility = 'details' | 'busy' | 'hidden'
export type VisibleTag = Exclude<Tag, 'rest'>
/** A time-of-day band. The scheduler scores placement against it; a CONFIRMED
    rule (or the user's explicit ask) makes it FIRM (off-window collapses, like
    the meal seam), an inferred tag default stays the soft scorer term. Owned
    here so the resolver (prefs.ts) and the scorer (scheduler.ts) share it. */
export type TimeWindow = 'morning' | 'afternoon' | 'evening'

export interface Block {
  id: string
  title: string
  tag: Tag
  dayKey: string // YYYY-MM-DD (local)
  startMin: number // minutes from local midnight
  endMin: number
  protected: boolean
  status: BlockStatus
  calendarRefs: string[]
  estimateSource: 'user' | 'mew' | 'history'
  rolledToId?: string
  completedAt?: number
  /** Set by "Start now" — a started block completes or gets interrupted; it
      never silently re-starts. */
  startedAt?: number
  /** Set when this block came IN from a connected calendar. External blocks are
      never pushed back out, and MEW never reschedules them (not ours to move). */
  external?: { calId: string; eventId: string }
  /** Optional events don't hard-block time: invisible to free-slot search,
      load math, the now-headline and close-the-loop; rendered as a thin tint. */
  optional?: boolean
  /** Does the block hold YOU, or just hold the clock (a 3h phone restore)?
      undefined ⇒ focus. Background never occupies the Focus center and is
      transparent to slot search — a different axis from optional, which
      holds no time at all. */
  attention?: 'focus' | 'background'
  /** Optional hard deadline (minutes from midnight), independent of endMin.
      With duration it yields latest-start math for the start-by nudge. */
  due?: number
  /** Links every block expanded from one user-created recurring rule (#159), so
      the whole series can be removed together while a single occurrence still
      deletes alone. Absent ⇒ a one-off block. */
  recurringBlockId?: string
  /** The rule that generated this occurrence — kept on each block so a
      save/load cycle preserves the series and a UI can show "repeats weekly".
      DAILY/WEEKLY only; recurrence is MEW's, never pushed to a calendar. */
  rrule?: Rrule
}

export interface Capture {
  id: string
  title: string
  createdAt: number
  status: 'open' | 'placed' | 'done'
  placedBlockId?: string
  /** #348 inbox hints — the owner's optional shape for a captured intent that
      holds no time. `tag`/`durationMin` size the placement offer and pick the
      energy match; `energy` names the focus class outright when the owner knows
      it (else it's derived from tag+duration via #321). All optional: a bare
      "call the bank" carries none and behaves exactly as a #171 quick-capture. */
  tag?: Tag
  durationMin?: number
  /** the focus class hint, mirroring energy.FocusClass — kept inline so the core
      types file never cycles with energy.ts. undefined ⇒ fitOffers derives it. */
  energy?: 'deep' | 'admin' | 'health'
  /** #348 offer dedupe: the dayKey gbrain last OFFERED a slot for this item, so a
      proactive offer fires at most once per item per day. "not now" sets it too —
      a dismissal keeps the item waiting without re-nagging the same day. */
  lastOfferedDay?: string
}

/** #348: the inbox's name for a captured intent that holds no time (MEW law:
    optional/unscheduled events hold no time). An inbox item IS a Capture — the
    #171 substrate, so the same table, lifecycle, persistence, and export carry
    it with no new storage seam; #348 enriches it with the hints above and adds
    the deterministic, owner-confirmed placement offer (domain/inbox.fitOffers).
    Placed, it becomes an ordinary block and the mew is its completion. */
export type InboxItem = Capture

export type NudgeId =
  | 'right-size'
  | 'drift'
  | 'guard'
  | 'celebrate'
  | 'close-loop'
  | 'when-where'
  | 'protect-rest'
  | 'kinder-plan'
  | 'fresh-start'
  | 'break-smaller'
  | 'post-buffer'
  | 'next-up'
  | 'micro-break'
  | 'update' // system offer (desktop update staged), not an engine nudge
  | 'restore' // system offer (desktop backup found on first boot), not an engine nudge
  | 'start-by'
  | 'pref-drift'
  | 'delegate'
  | 'debrief'
  | 'heads-up'
  | 'morning-brief'
  | 'evening-wrap'
  | 'weekly-ritual'
  | 'learn-offer' // gbrain Pillar 1 (#327): a learned-rule offer — a store ritual, not an engine nudge
  | 'remove-done' // #334: an explicit done-block delete → a one-tap confirm (mews aren't walled off), not an engine nudge
  | 'weekly-review' // #346: the once-a-week "want your week in review?" offer — a store ritual, not an engine nudge
  | 'inbox-offer' // #348: gbrain OFFERS a fitting slot for a waiting inbox item — a store ritual (fitOffers), owner-confirmed, never auto-scheduled
  | 'estimate' // #322: the once-a-day plan-time "give them room?" offer — a store ritual, keyed by the day it fired on
  | 'scaffold-week' // #349: the once-a-week "rough out next week your usual way?" offer — a store ritual, keyed by the coming week

/** What can occupy a lastFired slot: an engine nudge id, the sustenance
    scaffold's daily pass (#299 — a store ritual, not an engine nudge), one
    rescue landing (#286) — `rescue:<calId>:<eventId>:<dayKey>:<startMin>`,
    one slot per landing so several live conflicts dedupe independently, one
    day-load guard (#301) — `dayload:<dayKey>`, its `key` holding the todayKey
    it fired on, so the same over-line day speaks at most once per calendar day
    — or a back-to-back meeting observation (#302) — `buffer:<dayKey>`, one per
    day so a re-pull of the same tight pair never re-observes it. */
export type FiredKey =
  NudgeId | 'sustenance' | `rescue:${string}` | `dayload:${string}` | `buffer:${string}`

/** Per-slot last-fired marker (ts + contextual key). The engine's dedupe
    state, persisted through `Settings.nudgeLastFired` so once-per-day rituals
    (morning brief, evening wrap) hold across a restart. Rescue slots ride the
    same map (and thus the same mirror): small, TTL-swept by offerRescues. */
export type NudgeFiredMap = Partial<Record<FiredKey, { ts: number; key?: string }>>

export interface NudgeAction {
  id: string
  label: string
  kind: 'primary' | 'secondary'
}

/** A clickable option chip on a mew message (#254 · offer_choices). A pick
    posts `reply` as the user's next turn — the chips never touch the week
    themselves. `picked` persists with the message so chips rehydrate inert. */
export interface ChatChoice {
  id: string
  label: string
  reply: string
  picked?: boolean
}

/** A plan scenario as chat carries it (#293 · propose_scenarios): the engine's
    Scenario (an exact placement quote — id, name, line, todayKey, places,
    dayLoad) plus the pick state. `picked` persists with the message so the
    picker rehydrates settled — chips-pattern (#254): render never re-validates;
    staleness is checked at pick time against the live week. Type-only import
    of the engine shape, so persistence and the engine can never drift. */
export interface StoredScenario extends Scenario {
  picked?: boolean
}

/** A tool card's lifecycle (#282). `running` is only ever live — hydration maps
    any stored `running` to `interrupted`, so history can never wear a shimmer. */
export type ToolCardState = 'running' | 'done' | 'error' | 'interrupted'

/** The receipt of ONE executor tool invocation (#282), rendered as a compact
    activity card in the session log. Born at the executor seam in store.ts —
    the only place tools run — so a card always records real activity, never a
    model stream event. `verb`/`target` come from domain/toolCard.ts; `note` is
    the wrapper's short MEW-voiced settle line (error/interrupted). */
export interface ToolCard {
  name: string
  verb: string
  target?: string
  state: ToolCardState
  note?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'mew' | 'nudge' | 'tool'
  body: string
  ts: number
  /* tool messages (#282): the executor receipt this row renders as a card */
  tool?: ToolCard
  /* mew messages: optional muted observation line */
  observation?: string
  /* mew messages: the model's pre-action reasoning snapshot — what it planned
     before any tool ran (#166). Captured only when the model exposes a thinking
     stream and the user opted in (Settings.showReasoning); a short, human-readable
     slice rendered as a collapsible note. Absent on every keyless/local turn. */
  reasoning?: string
  /* mew messages: clickable option chips (#254) — MEW's enumerable questions
     and offers, answerable with one tap. Chat-only by law: a pick posts the
     choice's reply as an ordinary user turn; the week changes only via tools. */
  choices?: ChatChoice[]
  /* mew messages: plan-mode scenario cards (#293) — named week-placements the
     user picks among. Chat-only data: proposing mutates nothing; the pick
     applies the stored places byte-exactly through the plan executor. */
  scenarios?: StoredScenario[]
  /* nudge messages */
  nudgeType?: NudgeId
  nudgeLabel?: string
  footnote?: string
  actions?: NudgeAction[]
  resolved?: string // label of the action taken
  payload?: Record<string, string | number> // action context (blockId, dayKey, …)
}

/** A standing rule the user stated, structured enough to apply later. */
export type PrefKind = 'time-default' | 'duration-default' | 'flexibility' | 'ordering' | 'fact'
export interface PrefPayload {
  kind: PrefKind
  /** what the rule is about — "gym", "order lunch", "deep work" */
  match: string
  /** the rule itself — "starts 07:00", "45m", "never moves" */
  value: string
  /** the user's own words, kept verbatim */
  stated: string
}

export type MemoryKind =
  | 'completed'
  | 'rolled'
  | 'drift'
  | 'interruption'
  | 'nudge_outcome'
  | 'rest_kept'
  | 'rest_skipped'
  | 'preference' // a stated standing rule (the brain-off home for remember)
  | 'learned_rule' // gbrain Pillar 1 (#327): a rule confirmed from repetition — state, never ages out
  | 'dismissed_rule' // #327: a candidate the user rejected — never offered again
  | 'weekly_summary' // consolidation artifact — old raw events compacted per ISO week

export interface MemoryEvent {
  id: string
  ts: number
  kind: MemoryKind
  dayKey: string
  tag?: Tag
  plannedMin?: number
  deep?: boolean
  /* pattern fuel (GBrain): which block, when it sat in the day */
  title?: string
  startMin?: number
  endMin?: number
  /** whether the completed block held your focus or ran in the background —
      the fourth signal repetition-learning reads (#327). undefined ⇒ focus. */
  attention?: 'focus' | 'background'
  nudgeType?: NudgeId
  outcome?: 'accepted' | 'declined' | 'ignored'
  /* preference payload (kind:'preference') */
  pref?: PrefPayload
  /* the confirmed/dismissed learned rule (kind:'learned_rule'|'dismissed_rule',
     #327). A dismissal carries only `match`; a confirmation the full rule. */
  rule?: LearnedRule
  /* weekly_summary payload */
  summary?: {
    completed: number
    rolled: number
    deepMin: number
    restKept: number
    restSkipped: number
    drifts: number
  }
}

export interface ConnectedCalendar {
  id: string
  name: string
  who: string
  provider: 'google' | 'outlook' | 'caldav' | 'ics'
  /** 'live' syncs two-way; 'import' is an .ics snapshot; demo rows are 'simulated'. */
  kind?: 'live' | 'simulated' | 'import'
  /** Inbound events land in the week under this tag (PRD §4). */
  defaultTag?: VisibleTag
  /** We pull from read-only calendars but never push. */
  readOnly?: boolean
}

export type RoutingMatrix = Record<string, Record<VisibleTag, Visibility>>

/** The meals the standing scaffold owns (#299, v0.5 16b). Breakfast and
    snacks stay the user's own asks — the scaffold covers the two meals the
    morning instruction kept repeating. */
export type ScaffoldMealId = 'lunch' | 'dinner'
/** Per-meal scaffold knobs: the window the meal may land in (minutes from
    midnight) and how long it holds. A remembered pref recenters the window;
    these govern otherwise. */
export interface ScaffoldMealPlan {
  startMin: number
  endMin: number
  durationMin: number
}
/** Window defaults mirror the circadian anchors (sustenance.MEAL_WINDOWS —
    a test pins them equal); durations are kind defaults, not prescriptions. */
export const DEFAULT_SUSTENANCE_MEALS: Record<ScaffoldMealId, ScaffoldMealPlan> = {
  lunch: { startMin: 12 * 60, endMin: 14 * 60, durationMin: 45 },
  dinner: { startMin: 18 * 60 + 30, endMin: 20 * 60 + 30, durationMin: 60 },
}

export type PetId = 'cat' | 'dog' | 'fox' | 'bunny' | 'bird'

/** Plan mode's auto-offer gear (#293) — see Settings.planMode. */
export type PlanMode = 'auto' | 'always' | 'off'

export interface Settings {
  calendars: ConnectedCalendar[]
  matrix: RoutingMatrix
  /** `calId:eventId` of imported events the user deleted or took ownership of
      (moved/edited). A re-sync must not resurrect them. Optional — absent ⇒ []. */
  dismissedEvents?: string[]
  /** Theme follows pet (PRD §3b): the pet swaps only the accent pair. */
  pet: PetId
  themeMode: 'carbon' | 'white'
  /** Interface (prose/sans) font — drives `--font-sans` only. Mono and numerals
      stay JetBrains Mono regardless. Default 'hanken', so existing users see no
      change; all options are self-hosted (no network fetch). */
  uiFont: 'hanken' | 'open-sans' | 'system'
  browserMirror: boolean
  quietHours: { startMin: number; endMin: number } // 18:30–08:30 default, wraps midnight
  /** Once-a-day ritual times, minutes from midnight (#285). The morning brief
      posts at briefMin (default 8:30 — exactly where default quiet hours end,
      so the boundary resolves to "posts at 8:30"); the evening wrap at wrapMin
      (default 17:30). The engine owns the once-per-day key; the quiet-hours
      queue owns delivery timing. */
  briefMin: number
  wrapMin: number
  /** The weekly planning ritual's time (#304), minutes from midnight: Sunday
      at this time MEW posts one shaping invite per ISO week (default 17:00 —
      ahead of default quiet hours, so the boundary resolves to "posts at
      17:00"). Once-per-week rides the persisted weekKey, same law as the
      daily rituals' once-per-day. */
  weeklyRitualMin: number
  /** Engine dedupe state — machine state like dismissedEvents/brainBackfillAt,
      not a preference. Persisting it is what makes "fired today" survive a
      restart (the brief/wrap once-per-day law); hydrate seeds the engine from
      it. Absent ⇒ nothing has fired yet. */
  nudgeLastFired?: NudgeFiredMap
  /** The standing day-scaffold (#299, v0.5 16b): each morning at the brief's
      tick the day gains its missing meals + paced breathers, once, through
      the executor. 'off' restores the un-scaffolded behavior byte-for-byte. */
  sustenance: 'on' | 'off'
  /** Per-meal window/duration the scaffold places with (see ScaffoldMealPlan). */
  sustenanceMeals: Record<ScaffoldMealId, ScaffoldMealPlan>
  showScience: boolean
  /** Show the model's pre-tool reasoning snapshot in the session log (#166).
      Off by default: turning it on asks Anthropic models to think before acting
      (a small extra cost/latency on the user's own key), then renders that plan
      as a collapsible note. Off ⇒ no thinking is requested and nothing shows —
      the same graceful degradation as a keyless turn. Anthropic-only for now
      (see PROVIDER_CONTRACT.reasoning); other providers ignore it. */
  showReasoning: boolean
  modelLocation: 'remote' | 'local'
  /** Which remote brain answers (BYO key either way). */
  remoteProvider: 'anthropic' | 'openai'
  anthropicKey: string
  /** Active model per provider — chosen in Settings, or any id typed in
      (model ids change often, so the picker is a convenience, not a fence). */
  anthropicModel: string
  openaiKey: string
  openaiModel: string
  ollamaUrl: string
  ollamaModel: string
  /** Google OAuth client ID (Web) from the user's own Cloud project — BYO
      credentials, same ethos as BYO key; there is no MEW server to hold one. */
  googleClientId: string
  overnightConsolidation: boolean
  mewName: string
  /** GBrain (optional): a `gbrain serve` endpoint MEW writes senses to and
      recalls from. BYO endpoint + token, off by default — the insights floor
      never depends on it. */
  brainEnabled: boolean
  brainUrl: string
  brainToken: string
  /** Where the brain lives: the desktop-managed sidecar, any gbrain serve
      you run, or a Supabase-backed serve — all the same wire contract. */
  brainMode: 'sidecar' | 'endpoint' | 'supabase'
  /** Recall scope: MEW's own pages only (default) or the whole shared brain
      — strictly opt-in; whole-brain in a calendar is noise until it isn't. */
  brainScope: 'mew' | 'all'
  /** Backfill ledger (#249), machine state like dismissedEvents — not a
      preference. Per-brain watermark: the newest event ts that brain has
      already been OFFERED (live dispatch or replay), keyed by
      effectiveBrainKey, so switching brains replays the gap into the one
      that missed it and never re-offers to one that saw it. Absent ⇒ that
      brain has been offered nothing yet. */
  brainBackfillAt?: Record<string, number>
  /** Quick-capture default (Cmd/Ctrl+Shift+C, #171): 'open' queues a capture
      with no when-where interrupt; 'auto-place' drops it in the first free
      30-min slot today, falling back to 'open' when the day is full. Default
      'open' — suggest, don't seize. */
  quickCaptureMode: 'open' | 'auto-place'
  /** OS-global quick-capture hotkey (#284, desktop shell only): a Tauri
      accelerator string the shell registers system-wide; null = disabled.
      Only a binding the OS accepted persists — the Settings row validates by
      attempting registration. The in-app ⌘/Ctrl+Shift+C handler is
      independent and always on. */
  globalCaptureHotkey: string | null
  /** Plan mode's auto-offer gear (#293): when does a multi-task ask get the
      scenario picker instead of a one-pass placement? 'auto' (default) offers
      it at 3+ new un-pinned items, 'always' already at 2, 'off' never — the
      pre-picker behavior. Steers both the model (tool advertising) and the
      keyless rules floor, so the gear means the same thing with zero keys. */
  planMode: PlanMode
  /** First-run state, not a preference: false until the guided concept tour
      (Focus/Week/Talk) is dismissed or completed, then true forever. There is
      deliberately no Settings control to re-show it — the three pillars are
      learned in context after the first pass (NN/g: onboarding shouldn't
      return). Clearing storage is the only reset. */
  hasSeenOnboarding: boolean
  /** #302 (v0.5 item 13): a prep/decompress buffer MEW keeps around EXTERNAL
      (calendar) meetings for its OWN placements — deep work lands shy of a
      meeting's edges. Minutes; presets 0/5/10/15. 0 (default) = off, so the
      placement paths reproduce today's behavior byte-for-byte. External events
      never move; only MEW's candidate generation honors it. */
  meetingBufferMin: number
  /** #321: energy-fit planning — deep work placed where you DEMONSTRABLY finish
      it (learned from completions, never a textbook curve) and admin batched.
      'on' (default) only ENGAGES once the data floor is met (a real
      energyProfile) or a stated batch/deep rule forces it — a fresh profile
      behaves exactly as today. 'off' omits the energy-fit scenario always. */
  energyFit: 'on' | 'off'
  /** #322: estimate correction at plan time — size blocks to how they REALLY
      run, per task-type (deep work vs admin, learned from completion lateness).
      'off' (default) is byte-identical to today. 'ask' offers ONE chip nudge
      after a plan places under-booked work of a run-long kind ("give them
      room?"). 'always' silently pre-sizes the plan-mode scenario picker. A
      duration stated in the ask is never touched, in any mode. */
  estimateAutosize: 'off' | 'ask' | 'always'
}

/* The Rive "PixieMachine" input contract — PRD §6. The placeholder SVG and the
   future pixie.riv are two renderers of exactly this. */
export interface PixieInputs {
  mood: 'healthy' | 'drowsy' | 'rundown'
  resting: boolean
  pace: number // 0–1 rolling sustainability score
  attention: boolean // a nudge is waiting in chat
}

export type ClearScope = 'today' | 'tomorrow' | 'week' | 'upcoming'

export interface ScheduleIntent {
  /** insights: read-only — surface what local memory computed (#287); no fields.
      list: read-only — itemize the day/week's blocks (#333); carries `list`. */
  kind:
    | 'plan'
    | 'complete'
    | 'move'
    | 'capture'
    | 'clear'
    | 'remove'
    | 'edit'
    | 'resize'
    | 'duplicate'
    | 'relmove'
    | 'remember'
    | 'chat'
    | 'insights'
    | 'list'
    | 'giveRoom'
  /** clear: which open MEW-placed blocks to remove (mews + calendar events never) */
  scope?: ClearScope
  /** edit: changes to apply to the matched block */
  edit?: {
    startMin?: number
    endMin?: number
    durationMin?: number
    title?: string
    tag?: Tag
    attention?: 'focus' | 'background'
    due?: number
    /** A relative duration delta in minutes (#320): "make it longer" (+15),
        "give it another 30" (+30), "shorten it by 15" (−15). The executor
        applies it against the referent's CURRENT length after resolution —
        parse.ts stays pure and never reads the block. */
    relDurationMin?: number
  }
  /* plan */
  places?: {
    title: string
    tag: Tag
    dayOffset?: number // relative to today; engine resolves weekday words
    dayKey?: string
    startMin?: number
    endMin?: number
    durationMin?: number
    protected?: boolean
    attention?: 'focus' | 'background'
    due?: number
    /** A standing recurrence (DAILY/WEEKLY) — execPlan expands it into one
        block per occurrence, all linked by recurringBlockId (#159). */
    rrule?: Rrule
  }[]
  frees?: { dayKey: string; startMin: number; endMin: number; label: string }[]
  /* complete / move / remove */
  query?: string
  /** complete/move/edit: the TARGET block's start time ("19:45") pinning which
      of several same-named blocks to act on — name AND time together address
      exactly one (#334). Distinct from toStartMin (a move's new start) and from
      edit.startMin (a retime); remove keeps its own `remove.at`. */
  at?: string
  toDayKey?: string
  toStartMin?: number
  /** move: a relative start shift in minutes (#320): "30 min earlier" (−30),
      "push it back an hour" (+60). The executor computes the absolute start
      from the referent's CURRENT start after resolution, on the same day —
      today move needs an absolute target, so the relative math lives there. */
  relStartMin?: number
  /** remove: pin which of several same-named blocks ("22:30"), or drop all */
  remove?: { at?: string; all?: boolean }
  /** edit/remove: the recurring-edit scope a scope word named (#343) — 'this'
      (just this one), 'following' (this & the ones after), 'series' (the whole
      set). Absent on a series block ⇒ the executor asks with chips. */
  seriesScope?: 'this' | 'following' | 'series'
  /* capture / chat */
  title?: string
  reply?: string
  /* remember */
  pref?: PrefPayload
  /** list: which day(s) to itemize (a 0–13 day offset, or the whole week) and
      an optional tag filter (#333) — read-only, mutates nothing. */
  list?: { day: number | 'week'; tag?: Tag }
  /** resize (#335): a duration-only change that keeps the block's start —
      durationMin sets an absolute length, relDurationMin a signed delta
      ("30 min longer" = +30). The executor keeps the start and moves only the
      end; the target is the `query` (+ `at`/`seriesScope` like edit). */
  resize?: { durationMin?: number; relDurationMin?: number }
  /** duplicate (#335): copy the matched block to another day/time — the
      original stays put and the copy is a new independent block. toDayOffset/
      toStartMin place it (absent time ⇒ the source's clock, or the next free
      slot within the same day); rrule makes the copy a repeating series (#159). */
  duplicate?: { toDayOffset?: number; toStartMin?: number; rrule?: Rrule }
  /** relmove (#335): a relative nudge with no absolute time — 'earlier'/'later'
      shift the start by amountMin (default 30) on the same day, 'next_day' moves
      one day on at the same clock, 'next_free' relocates to the soonest clear
      slot from now. The target is the `query` (+ `at`). */
  relmove?: { direction: 'earlier' | 'later' | 'next_day' | 'next_free'; amountMin?: number }
  /** giveRoom (#322): the "give them room" chip's ask — resize the just-placed
      blocks of this focus class up to how the kind really runs. The union is
      spelled inline (not imported from energy) to keep types.ts a leaf. */
  focusClass?: 'deep' | 'admin' | 'health'
}

export const DEFAULT_SETTINGS: Settings = {
  calendars: [],
  matrix: {},
  pet: 'cat',
  themeMode: 'carbon',
  uiFont: 'hanken',
  browserMirror: true,
  quietHours: { startMin: 18 * 60 + 30, endMin: 8 * 60 + 30 },
  briefMin: 8 * 60 + 30,
  wrapMin: 17 * 60 + 30,
  weeklyRitualMin: 17 * 60,
  sustenance: 'on',
  sustenanceMeals: DEFAULT_SUSTENANCE_MEALS,
  showScience: true,
  showReasoning: false,
  modelLocation: 'remote',
  remoteProvider: 'anthropic',
  anthropicKey: '',
  anthropicModel: 'claude-sonnet-5',
  openaiKey: '',
  openaiModel: 'gpt-5.4-mini',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  googleClientId: '',
  overnightConsolidation: true,
  mewName: 'Pixie',
  brainEnabled: false,
  brainUrl: 'http://localhost:3131',
  brainToken: '',
  brainMode: 'endpoint',
  brainScope: 'mew',
  quickCaptureMode: 'open',
  globalCaptureHotkey: 'CmdOrCtrl+Shift+C',
  planMode: 'auto',
  hasSeenOnboarding: false,
  meetingBufferMin: 0,
  energyFit: 'on',
  estimateAutosize: 'off',
}
