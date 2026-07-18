/* The one store. UI subscribes here; domain stays pure; adapters do I/O.
   Anything about "now" is derived via domain/liveNow on each tick — never stored. */

import { useMemo } from 'react'
import { create } from 'zustand'
import {
  type Block,
  type Capture,
  type ChatChoice,
  type ChatMessage,
  type ConnectedCalendar,
  DEFAULT_SETTINGS,
  type MemoryEvent,
  type NudgeAction,
  type NudgeId,
  type PrefPayload,
  type Settings,
  type StoredScenario,
  type Tag,
  type ToolCardState,
  type VisibleTag,
} from '../domain/types'
import { TOOL_ERROR_NOTE, toolCardLabel } from '../domain/toolCard'
import {
  detectRescues,
  rescueKey,
  rescueLine,
  rescueOptions,
  withinDayWords,
} from '../domain/rescue'
import {
  addDaysKey,
  dayKey,
  fmtDowLong,
  fmtLongDate,
  fmtShortDate,
  fmtTime,
  fromDayKey,
  inQuietHours,
  minOfDay,
  spell,
  stripWeekPhrase,
  uid,
  weekKey,
  weekKeys,
  weekOffsetFromQuestion,
  weekOffsetLabel,
} from '../domain/time'
import * as week from '../domain/week'
import { search as searchDomain, type SearchHit, type SearchKind } from '../domain/search'
import {
  describeRrule,
  expandRrule,
  RRULE_DEFAULT_WEEKS,
  splitSeriesFrom,
} from '../domain/recurrence'
import { liveNow } from '../domain/liveNow'
import { aggregates, consolidate, interruptionsLastHour } from '../domain/memory'
import {
  computeInsights,
  dayLoadAssessment,
  dayLoadFiredKey,
  dayThroughputMin,
  estimateFactorByTag,
  ESTIMATE_FIRED_KEY,
  ESTIMATE_PAD_FLOOR,
  padDuration,
  proposeKinderPlan,
  taskDurations,
  trimMove,
  type TaskDuration,
} from '../domain/insights'
import { consoleSummary, memoryConsole } from '../domain/console'
import { isRollCandidate, weeklyReview, type WeeklyReview } from '../domain/review'
import { composeReviewOffer, shouldOfferReview } from '../domain/nudges/review'
import { pixieInputs } from '../domain/pixie'
import { dayShape } from '../domain/dayShape'
import { listReadout } from '../domain/listing'
import {
  driftCollisions,
  moveBlockedBy,
  restInsertion,
  scoreSlots,
  type SlotQuery,
  type TimeWindow,
} from '../domain/scheduler'
import { correctMeal, mealClassOf, scaffoldDay, scaffoldLine } from '../domain/sustenance'
import { buildCtx, evaluateEvent, evaluateTick, type EngineState } from '../domain/nudges/engine'
import type { NudgeInstance } from '../domain/nudges/library'
import { coalesceNudges } from '../domain/nudges/queue'
import { NEW_CALENDAR_DEFAULTS } from '../domain/project'
import { createDexieStorage, type StoragePort } from '../adapters/storage'
import { createGbrainHttp } from '../adapters/brain/gbrainHttp'
import type { BrainPort } from '../adapters/brain/types'
import {
  type BlockEventKind,
  blockEventPage,
  chatBatchPage,
  condenseChatPage,
  condensedChatSlug,
  debriefPage,
  knownProjectsFrom,
  learnedRulePage,
  makeChatBatcher,
  peopleFrom,
  prefPage,
  slugify,
} from '../adapters/brain/senses'
import {
  adoptSidecarSnapshot,
  effectiveBrain,
  effectiveBrainKey,
  setSidecarBrain,
  setSidecarStatus,
  sidecarStatus,
  type SidecarStatus,
} from '../adapters/brain/sidecar'
import {
  batchAdminRule,
  deepWorkAnytime,
  parseTimeValue,
  resolveTaskSpec,
  type LearnedRule,
} from '../domain/prefs'
import {
  energyProfile,
  focusClassOfTask,
  FOCUS_CLASS_LABEL,
  type FocusClass,
} from '../domain/energy'
import { DEFAULT_DURATION_MIN, fitOffers, type InboxOffer, offerBody } from '../domain/inbox'
import {
  candidateToRule,
  confirmedRulesFrom,
  detectTaskRules,
  dismissedMatchesFrom,
  offerPhrase,
  parseLearnedRule,
  type RuleCandidate,
} from '../domain/learn'
import {
  applyUpdate,
  brainEndpoint,
  brainStatus,
  isTauri,
  latestBackupDate,
  onBrainEndpoint,
  onBrainStatus,
  onShellTick,
  onTrayAction,
  onUpdateReady,
  readBackup,
  registerCloseFlush,
  setCaptureHotkey,
  updateTray,
  writeBackup,
} from '../adapters/desktop'
import { trayShape, type TrayShape } from '../domain/tray'
import {
  CHOICES_POSTED,
  classifyFailure,
  selectAdapters,
  type ChatTurn,
  type ChoiceOption,
  type FreeSpec,
  type PlaceSpec,
  type ScenarioTaskSpec,
  type ToolExecutor,
  type WeekContext,
} from '../adapters/model'
import {
  generateScenarios,
  validateScenario,
  type ScenarioPlace,
  type ScenarioTask,
} from '../domain/scenarios'
import { weekScaffold } from '../domain/scaffold'
import { choicesActive, scenariosActive } from '../domain/choices'
import { createNotifier, type NotifyActionId } from '../adapters/notify'
import { logger } from '../adapters/logger'
import { googleAccount } from '../adapters/calendar/google'
import { adoptOrphanedExternals, mergePull, runSync, syncWindow } from '../adapters/calendar/sync'
import { icsToRemoteEvents } from '../adapters/calendar/ics'
import type { RemoteCalendar } from '../adapters/calendar/types'
import { seed } from './seed'

const storage: StoragePort = createDexieStorage()
const notifier = createNotifier() // native on the desktop shell, browser API on web (#168)
const log = logger.withContext('store')

/* the optional knowledge brain — config read per call so Settings edits
   (and the desktop sidecar's handshake) apply live; every method is a no-op
   while no brain is on. effectiveBrain ranks: Settings opt-in > sidecar > off */
const brain: BrainPort = createGbrainHttp({
  url: () => effectiveBrain(useMew.getState().settings).url,
  token: () => effectiveBrain(useMew.getState().settings).token,
  enabled: () => effectiveBrain(useMew.getState().settings).on,
})
/** brain-on truth for the store's own gates — same ranking the port reads */
const brainOn = () => effectiveBrain(useMew.getState().settings).on
/** the same truth for UI selectors: Settings health must render the EFFECTIVE
    brain (sidecar included), never the bare toggle — a running or dead sidecar
    must not look "Off" (#249). Reactive through useMew: brainSidecar ticks on
    every sidecar transition, re-running any selector that calls this. */
export const brainIsOn = (settings: Settings) => effectiveBrain(settings).on
/** recall scope truth — the live toggle, so a 'Whole brain' choice reaches
    every recall site (heads-up, week-review, rollups), not just chat */
const brainScope = () => useMew.getState().settings.brainScope
/* recall races: a slow brain must never hold a turn hostage. The chat turn's
   context ride-along stays tight; query_brain is the one tool whose whole job
   is history, so it gets a looser bound (#249 — under the transport's 3s cap,
   so a hang is still the race's to call). Losing the race (or a port error)
   reads as "the brain didn't answer", never as an empty history. */
const TURN_RECALL_RACE_MS = 1500
const QUERY_BRAIN_RACE_MS = 2500
/** exposed for the Settings health dot — same instance the store writes through */
export const mewBrain = brain
/** re-exported so the UI reads sidecar state through the store, not the adapter */
export type { SidecarStatus } from '../adapters/brain/sidecar'

/* the always-on pref slice: brain-backed when connected, memory-backed
   otherwise. Cached per session; refreshed after every remember. */
let brainPrefs: PrefPayload[] | null = null
function refreshBrainPrefs(): void {
  if (!brainOn()) {
    brainPrefs = null
    return
  }
  void brain.listPrefs().then((prefs) => {
    brainPrefs = prefs
  })
}

/** newest-first, deduped by kind+match — the standing rulebook, as data */
export function activePrefsFrom(
  memory: MemoryEvent[],
  fromBrain: PrefPayload[] | null
): PrefPayload[] {
  const source: PrefPayload[] = fromBrain?.length
    ? fromBrain
    : [...memory]
        .reverse()
        .filter((e) => e.kind === 'preference' && e.pref)
        .map((e) => e.pref!)
  const seen = new Set<string>()
  const out: PrefPayload[] = []
  for (const p of source) {
    const key = `${p.kind}:${p.match.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= 15) break
  }
  return out
}

/** the same rulebook, rendered for the context block */
export function prefLinesFrom(memory: MemoryEvent[], fromBrain: PrefPayload[] | null): string[] {
  return activePrefsFrom(memory, fromBrain).map(
    (p) => `${p.match} → ${p.value} (stated: "${p.stated}")`
  )
}

/* Dev/design affordance: `?t=HH:MM` shifts the app clock so any moment of the
   day can be previewed deterministically (now-line, end-of-day, quiet hours);
   `?d=YYYY-MM-DD` shifts the DAY the same way (#304 — the Sunday ritual can be
   previewed midweek). Calendar math via setFullYear/setDate so DST can't skew
   the offset; both compose (`?d=…&t=17:05`). */
function clockOffsetMs(): number {
  if (typeof location === 'undefined') return 0
  const params = new URLSearchParams(location.search)
  const t = params.get('t')?.match(/^(\d{1,2}):(\d{2})$/)
  const d = params.get('d')?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!t && !d) return 0
  const target = new Date()
  if (d) target.setFullYear(Number(d[1]), Number(d[2]) - 1, Number(d[3]))
  if (t) target.setHours(Number(t[1]), Number(t[2]), 0, 0)
  return target.getTime() - Date.now()
}
const CLOCK_OFFSET = clockOffsetMs()
const nowFn = () => Date.now() + CLOCK_OFFSET
/** The app clock (honors the ?t= override) — for UI that ticks faster than the store. */
export const clockNow = nowFn

export interface MewState {
  hydrated: boolean
  blocks: Block[]
  captures: Capture[]
  /** The hydrated chat window (#250 phase 2): boot loads only the newest
      page from storage; scrolling up prepends older pages via
      loadEarlierChat. Appends land at the tail exactly as before — every
      tail-anchored reader (thread building, live streaming, nudge lookups)
      sees the same world it always did. */
  chat: ChatMessage[]
  /** True while storage holds chat older than the window's head — drives the
      session log's "· earlier ·" sentinel past the in-memory rows. */
  chatHasEarlier: boolean
  memory: import('../domain/types').MemoryEvent[]
  settings: Settings

  page: 'week' | 'settings' | 'inbox'
  view: 'focus' | 'week'
  /** Non-persisted first-run cursor (#306). `hasSeenOnboarding` is the gate that
      decides whether the modal shows at all; this says WHERE inside it we are:
      the concept tour (#160), then the three guided steps. It is deliberately
      not persisted — a refresh mid-onboarding restarts the tour, and completion
      is carried by the persisted flag, never this. */
  onboardingStep: 'tour' | 'keys' | 'calendar' | 'plan'
  /** Week view paging: 0 = this week, ±n weeks. */
  weekOffset: number
  focusedDayKey: string | null
  nowMs: number
  scrollToMsgId: string | null
  celebratePulse: number
  thinking: boolean
  /** Non-persisted: a short, positive label for what MEW is doing this turn
      ("placing blocks…", "checking your week…"). Set by the executors as each
      tool fires, rendered by the thinking row, cleared in speak's finally. */
  workingStatus: string | null
  /** Draft prompt text — held in the store so it survives a screen switch
      (Focus/Week/Settings unmount the composer, which would drop local state). */
  promptDraft: string
  /** Non-persisted: a message composed while a turn was in flight, parked to
      send as its own next turn the moment this one settles (#280 — the
      composer never locks). One slot, not a FIFO: a second Enter merges into
      it, so the drain in speak's finally sends exactly one combined turn. */
  queuedSpeak: string | null
  /** Non-persisted conversational referent (#320): the block a turn's executor
      last touched (single-block plan / move / edit / complete) or the user last
      tapped. "move it", "make that 45", "30 min earlier" resolve against it on
      every path — keyless included. Session context, never week state: not
      persisted, cleared on day rollover. One slot covers the vast majority; a
      wrong-block mutation is worse than a kind "which one?", so an absent or
      removed referent asks rather than guesses. */
  lastReferent: { blockId: string; ts: number } | null
  /** Non-persisted: the desktop sidecar brain's lifecycle, live from the
      shell's mew://brain-status beats ('off' on the web, or before the first
      beat). Settings renders it so a dead built-in brain is visibly dead —
      the user can always answer "is my brain on?" (#249). */
  brainSidecar: SidecarStatus

  engine: EngineState
  lastActivityMs: number
  guardUntilMin: number | null
  guardDayKey: string | null
  queuedNudges: ChatMessage[]
  lastTickDay: string

  /* calendar sync */
  googlePicker: RemoteCalendar[] | null
  connecting: boolean
  syncing: boolean
  lastSyncAt: number
  syncError: string | null

  /* power-user surface (#169/#170/#171): the command palette is a UI-only
     overlay; its open flag lives here so any shortcut (Cmd/Ctrl+K) and any
     close (Esc / outside click / a chosen action) share one source of truth.
     Search and quick-capture are read/additive actions below — neither is a
     new mutation path: search is read-only, quick-capture reuses the capture
     executor and the same slot proposer the rail already uses. The pane the
     next open lands on lives beside the flag for the same reason: hotkeys
     and the tray's quick-capture route (#283) must agree on it. */
  commandPaletteOpen: boolean
  commandPaletteMode: 'command' | 'search' | 'capture'

  /* weekly review (#346): a UI-only overlay flag, same discipline as the
     command palette — the offer's "show me", the command palette, and a dev
     seam all open it through openWeeklyReview(); Esc / "leave them" close it.
     The surface reads the pure presenter live, so a roll re-renders it. */
  weeklyReviewOpen: boolean

  /** The OS refused the global capture hotkey (#284) — owned by another app.
      Non-persisted, re-derived on every registration attempt; the Settings
      row reads it for the kind collision note. */
  hotkeyCollision: boolean
  /** Rebind (accelerator string) or disable (null) the OS-global capture
      hotkey. The shell is the validator: only a binding the OS accepted
      persists — a refusal flips hotkeyCollision and keeps the old binding
      working, in Settings and at the OS alike. Resolves with the outcome. */
  applyCaptureHotkey(accel: string | null): Promise<boolean>

  hydrate(): Promise<void>
  /** Prepend the previous page of chat from storage onto the window (#250
      phase 2) — the session log calls this once its in-memory head is
      exhausted. Returns how many messages arrived (0 = history fully loaded);
      flips chatHasEarlier off on the final page. Concurrent calls coalesce. */
  loadEarlierChat(): Promise<number>
  tick(): void
  activity(): void
  interruption(): void
  speak(text: string): Promise<void>
  /** The composer's one submit path (#280): consumes the draft and decides by
      turn phase — idle, this is speak(); mid-turn, the message queues (a
      second Enter merges: queued + newline + new, one combined turn). The
      phase decision lives here, not in the composer, so typing and Enter work
      at every phase. Whitespace-only text no-ops. */
  send(text: string): void
  /** Un-queue the parked message and put it back in the draft — a queued
      thought is never lost (any newer draft typing is kept below it). */
  cancelQueuedSpeak(): void
  /** Stop the in-flight turn (the composer's ■ / Esc). Aborts the live
      stream/fetch and clears the turn state; whatever already streamed or
      committed stays — an abort is the user's call, never a rollback, and
      never replayed through a fallback. No-op when nothing is mewing. With a
      message queued this IS stop-and-send: the settle drain in speak's
      finally fires it — same action, no second path. */
  stopSpeaking(): void
  /** Read-only history answer: real sums from the asked week — this one, or
      a past one ("last week", "two weeks ago") — + brain recall color. Never
      mutates — chat is where the reply lands, via the tool. */
  queryBrain(question: string): Promise<string>
  toggleComplete(blockId: string): void
  /** Record the conversational referent (#320) — the block the user just
      tapped (the detail card already knows its id). Keeps "it/that/this"
      resolving to what they're looking at, the same slot the executors set
      when they act, so a tap-then-"move it earlier" lands on the right block. */
  noteReferent(blockId: string): void
  nudgeAction(msgId: string, actionId: string): void
  /* ── memory console (#330) — see & correct what MEW knows. Edits go through
     the same append-only memory the learn/remember paths write; a forget is
     honest (the rule is really gone from what applies, and recorded so it
     won't instantly re-learn). No brain/key needed — the local floor is the
     source of truth for what applies. */
  /** Confirm a learned task rule — a pending offer accepted, or an edited rule
      saved. Appends it to memory (newest per match wins) and mirrors to the
      brain when on; #328's resolver then applies it silently. */
  confirmTaskRule(rule: LearnedRule): void
  /** Forget a task rule for `match`: delete its learned_rule event(s) so it
      stops applying, and record a dismissal so repetition won't re-offer it at
      once. Covers a confirmed rule (deletes + dismisses) and a pending offer
      declined (dismisses only). */
  forgetRule(match: string): void
  /** Re-enable a dismissed/forgotten pattern: drop the dismissal so MEW may
      notice and offer it again. */
  reEnableRule(match: string): void
  /** Save a standing rule (stated preference) — the same remember path a typed
      rule takes; newest per kind+match wins. */
  saveStandingPref(pref: PrefPayload): void
  /** Forget a standing rule: delete its preference event(s) so it stops
      applying (and refresh the brain-backed cache). */
  forgetStandingPref(pref: PrefPayload): void
  /** Open the weekly review (#346) and return its data — a READ-ONLY presenter,
      like the memory console: it computes weeklyReview() over the local week +
      memory (no key, no I/O, no mutation) and flips the surface open. The offer
      chip, the command palette, and a dev seam all route here. */
  openWeeklyReview(): WeeklyReview
  /** Close the weekly review surface ("leave them" / Esc). */
  closeWeeklyReview(): void
  /** Roll the owner-SELECTED carried blocks forward into `targetWeekKey`, through
      the executor (the normal plan path) — never a direct mutation. Only ids that
      pass isRollCandidate move (own + flexible + open): a mew, an external event,
      or a fixed-time block handed in is refused at the gate, so nothing rolls
      that the owner didn't pick from a legitimate carried set. Human-in-the-loop
      by construction. */
  rollForward(blockIds: string[], targetWeekKey: string): void
  /** Draft the owner's learned week-shape for `targetWeekKey` (#349) — confirmed
      rules, their recurrences, and learned energy bands, laid AROUND existing/
      external events by weekScaffold (pure, keyless). Presented as a plan-mode
      scenario the owner previews and accepts/tweaks/discards: proposing mutates
      NOTHING; only pickScenario places, through the executor. Empty signal ⇒ an
      honest "I don't know your week yet" line, never a guessed week. Default
      target is the coming week; the offer nudge and the command palette both
      route here. Returns whether a draft was posted (false = the honest-empty
      line, or the week already holds the shape). */
  proposeScaffold(targetWeekKey?: string): boolean
  /** Pick an option chip (#254): mark it picked, then post its reply as an
      ordinary user turn — the same speak() path as typing, so the model sees
      a normal message and the week still changes only via tools. Inert by
      law: a no-op once any option was picked, once a newer user message
      landed, or while a turn is in flight (a pick would race the live
      stream — the same phase gate send() queues on, #280). */
  pickChoice(msgId: string, choiceId: string): Promise<void>
  /** Pick a plan scenario (#293): liveness exactly the chips grammar — inert
      after any pick, after a newer user message, or while a turn is in flight.
      A live pick re-validates the stored quote against the LIVE week; stale
      refuses kindly and re-offers, fresh applies the stored places byte-
      exactly through the plan executor (snapshot taken first, so "undo that"
      as the very next turn reaches it). Synchronous end to end — the apply is
      one deterministic executor call, never a model round-trip (#102). */
  pickScenario(msgId: string, scenarioId: string): void
  focusDay(key: string | null): void
  setPage(page: 'week' | 'settings' | 'inbox'): void
  setView(view: 'focus' | 'week'): void
  /** Mark first-run onboarding as seen and persist it — one-way, fired when the
      user skips-all, completes the last guided step, or closes the modal. Resets
      the (non-persisted) cursor so a re-show would start clean. */
  dismissOnboarding(): void
  /** Advance the guided onboarding one step (#306): tour → keys → calendar →
      plan, and from plan → done (which dismisses). Every step's "later" and
      every step's success land here; nothing this walks through mutates a
      setting, so skipping forward always leaves clean defaults (the keyless
      floor, local-only calendar, an empty planned week). */
  advanceOnboarding(): void
  setPromptDraft(text: string): void
  /** Set the live working label for the current turn (null clears it). The
      executors call this; the thinking row reads it. Non-persisted. */
  setWorking(label: string | null): void
  setWeekOffset(offset: number): void
  /** Pull a block to start at the current minute (detail-card "Start now"). */
  startNow(blockId: string): void
  /** Stop a started block now; the remainder rolls to the next free slot. */
  interruptBlock(blockId: string): void
  /** Re-place a block in the next free slot today (else tomorrow morning). */
  moveToNextFree(blockId: string): void
  /** Direct-manipulation move from a week-grid drag to an exact day/start. The
      only mutation path for drag (the executor law) — and for the keyboard
      nudge/resize (#303), which commits through this same door: an optional
      durationMin resizes as it lands (keyboard Alt+arrows pass it; drag never
      does, so drag behavior is byte-unchanged). Self-validating, so the
      outcome is testable without the DOM: an external (calendar) block is never
      moved — it returns 'external' with a one-line chat note; a drop onto a
      time-holding block returns 'conflict' and leaves the week untouched (the
      view bounces it back); a clear drop commits via week.move and returns
      'moved' ('resized' when the length changed). A drop onto the block's own
      slot at its own length is a 'noop'. */
  dragMove(
    blockId: string,
    toDayKey: string,
    toStartMin: number,
    durationMin?: number
  ): 'moved' | 'resized' | 'external' | 'conflict' | 'noop'
  toggleProtected(blockId: string): void
  /** Delete a block outright from its detail card (#334) — the block-card remove
      affordance. Shares the chat proposal's confirm path (removeBlocksConfirmed):
      a DONE block's completion event goes too (never resurrects it as open), and
      it's undoable ("undo that"). The card owns the one-line confirm before it
      calls this; external (calendar) blocks aren't offered it (not ours). */
  removeBlock(blockId: string): void
  /** Promotion/demotion from the Focus orbit — the click writes attention;
      the center swap falls out of liveNow. Quiet: the swap IS the feedback. */
  setAttention(blockId: string, attention: 'focus' | 'background'): void
  /** Land an open capture in the first free 30-min slot (the same proposal +
      placement the when-where nudge's accept runs) — the rail's "place". */
  placeCapture(captureId: string): void
  clearScroll(): void
  updateSettings(patch: Partial<Settings>): void
  cycleVisibility(calId: string, tag: VisibleTag): void
  cycleDefaultTag(calId: string): void
  /** Consume an exported .ics snapshot as external events (re-import updates). */
  importIcs(fileName: string, text: string): void
  /** Full-state backup as JSON (API keys stripped — they stay on-device). */
  exportData(): Promise<string>
  /** Restore a backup, then re-hydrate the live store from storage. */
  importData(json: string): Promise<void>
  connectGoogle(): Promise<void>
  addGoogleCalendar(cal: RemoteCalendar): void
  dismissPicker(): void
  disconnectCalendar(calId: string): void
  syncNow(): Promise<void>
  /** Dev/scenario seam (#286): drive an inbound calendar listing through the
      REAL pull path — mergePull diffs it against the week exactly as runSync
      does, then the same rescue-offer pass runs — with no network and no
      OAuth. Each call is one complete simulated listing for its calendar
      (an event absent from a later call reads as deleted, same as a real
      pull). RC verification is one paste: window.__mewSimulatePull. */
  simulatePull(
    events: {
      eventId: string
      title: string
      startMin: number
      endMin: number
      dayKey?: string
      calId?: string
      optional?: boolean
    }[]
  ): void

  /* ── power-user surface (#169/#170/#171), all additive ─────────────── */
  /** Open the command palette on a pane ('command' unless asked otherwise),
      remembering where focus was so Esc can return it (the component
      restores the saved element). */
  openCommandPalette(mode?: 'command' | 'search' | 'capture'): void
  /** Close the palette. Idempotent — closing a closed palette is a no-op. */
  closeCommandPalette(): void
  /** Read-only global search (#170): blocks, captures, chat scored by
      domain/search and grouped by kind. Never mutates — the palette renders
      the result, the store stays still. */
  searchAll(query: string): Record<SearchKind, SearchHit[]>
  /** Quick-capture (#171): jot a title with no chat round-trip. 'open' (the
      default, or whenever autoPlace is false) queues a capture with NO
      when-where nudge; 'auto-place' lands it in today's first free 30-min slot
      and falls back to 'open' when the day is full. Returns what happened so
      the caller can toast it; the chat thread is never touched by the capture
      itself. autoPlace defaults to the user's quickCaptureMode setting. */
  quickCapture(
    title: string,
    autoPlace?: boolean
  ): { kind: 'open' | 'placed' | 'empty'; message: string }
  /* ── quick-capture inbox (#348) — capture holds no time; gbrain OFFERS a
     fitting slot the owner confirms; placement routes through the executor.
     The inbox IS the open-capture queue (#171 substrate), enriched. ───────── */
  /** Capture an intent that holds NO time — an open inbox item, no chat turn,
      no when-where interrupt (capture-now, place-later). Optional hints size a
      later offer. Returns the item so a surface can toast it. Never touches the
      week (MEW law: optional/unscheduled events hold no time). */
  capture(
    text: string,
    opts?: { tag?: Tag; durationMin?: number; energy?: 'deep' | 'admin' | 'health' }
  ): { kind: 'open' | 'empty'; item?: Capture; message: string }
  /** The owner CONFIRMS a slot for a waiting item → the executor places it (the
      same one-mutation path when-where accept and the rail use), marks it placed
      and links its block. Only the owner's confirm calls this — gbrain never
      auto-schedules. Returns false if the item is gone/placed or the day filled. */
  placeFromInbox(
    itemId: string,
    slot: { dayKey: string; startMin: number; durationMin?: number }
  ): boolean
  /** "not now" on an offer — keep the item WAITING (still open) and mark it
      offered today so the proactive offer doesn't nag again the same day. */
  dismissInboxOffer(itemId: string): void
  /** Drop a waiting item from the inbox for good (the surface's ×). */
  removeInboxItem(itemId: string): void
  /** The fitting-slot offers for the waiting items right now — pure fitOffers
      over the live week + local memory, keyless. Read-only: the surface renders
      them; a placement happens only on the owner's confirm. */
  inboxOffers(): InboxOffer[]
  /** Surface ONE proactive placement offer as a nudge the owner confirms — the
      top waiting item not already offered today. A store ritual (rides the
      tick, once per item per day), never an auto-schedule. */
  offerNextInboxPlacement(): void
  /** Jump to a block from a search hit: focus its day and surface its week so
      the card is on screen. Read-only navigation — no mutation. */
  revealBlock(blockId: string): void
  /** Jump to a chat message from a search hit: route to the week page and ask
      the session log to scroll the message into view (reuses scrollToMsgId). */
  revealChatMessage(msgId: string): void
}

/* ── helpers ──────────────────────────────────────────────────────── */

function mewMsg(body: string, observation?: string): ChatMessage {
  return { id: uid(), role: 'mew', body, ts: nowFn(), ...(observation ? { observation } : {}) }
}

/* #325 — the acknowledgment vocabulary of a correction ("you're right", "good
   catch", "sorry"), longest-first so a phrase always wins over its own suffix
   ("right you are" before a bare match). Only correction/apology openers live
   here — not generic affirmations — so the classifier stays narrow. */
const ACK_PHRASES = [
  "you're absolutely right",
  'you are absolutely right',
  "you're totally right",
  "you're so right",
  "you're right about that",
  "you're right",
  'you are right',
  'right you are',
  "you're correct",
  'you are correct',
  'fair point',
  'fair enough',
  "that's fair",
  'good point',
  'good catch',
  'nice catch',
  'great catch',
  'my apologies',
  'my mistake',
  'my bad',
  'my fault',
  'apologies',
  'sorry about that',
  'so sorry',
  'sorry',
  'oops',
  'understood',
  'noted',
  'got it',
  'gotcha',
  'you got it',
  'i hear you',
].sort((a, b) => b.length - a.length)

/* #325 — is this streamed reply row nothing but acknowledgment? A correction
   should land as one "got it" plus one reshape, never a chain of "you're
   right / fair point / good catch". A row is acknowledgment-only when, after
   peeling the known ack phrases and the punctuation/fillers that join them,
   nothing is left AND at least one real phrase was peeled: the fix line
   ("moved dinner to 20:00 — here's the evening") always leaves a remainder, so
   it is never mistaken for grovel. Pure and exported for the guardrail's tests. */
export function isAcknowledgmentOnly(body: string): boolean {
  const trimEdges = (t: string) => t.replace(/^[\s,.!?;:—–-]+|[\s,.!?;:—–-]+$/g, '')
  let s = trimEdges(
    body
      .toLowerCase()
      .replace(/[*_`~#>]/g, ' ') // strip light-markdown emphasis
      .replace(/\s+/g, ' ')
      .trim()
  )
  if (!s) return false
  let peeledPhrase = false
  let changed = true
  while (changed && s) {
    changed = false
    /* a leading connective that joins two acks ("and sorry", "oh, you're right") */
    const defiller = s.replace(/^(and|but|also|so|oh|well|really|truly|again|totally|just)\b/, '')
    if (defiller !== s) {
      s = trimEdges(defiller)
      changed = true
      continue
    }
    for (const p of ACK_PHRASES) {
      const rest = s.slice(p.length)
      /* match only on a word/punctuation boundary — never chop "rightly" at "right" */
      if (s.startsWith(p) && (rest === '' || /^[\s,.!?;:—–-]/.test(rest))) {
        s = trimEdges(rest)
        peeledPhrase = true
        changed = true
        break
      }
    }
  }
  return peeledPhrase && s.length === 0
}

/** The #254 chips message shape — one home, shared by the offer_choices
    executor and the sync-side rescue offers (#286), so the two paths can
    never drift. Chat-only by law: a pick posts the choice's reply as an
    ordinary user turn; the week changes only through tools. */
function choicesMsg(body: string, choices: ChatChoice[]): ChatMessage {
  return { id: uid(), role: 'mew', body, ts: nowFn(), choices }
}

/** The #293 scenario-picker message shape — the chips pattern with cards:
    ONE mew message carrying the engine's named placements. Chat-only data;
    the week changes only when pickScenario routes the stored places through
    the plan executor. */
function scenariosMsg(body: string, scenarios: StoredScenario[]): ChatMessage {
  return { id: uid(), role: 'mew', body, ts: nowFn(), scenarios }
}

/** The learn-from-doing offer (#327): ONE nudge carrying the candidate rule and
    two chips. The pick resolves DETERMINISTICALLY in nudgeAction — confirm
    stores the rule, dismiss records a dismissal — so the loop is identical
    keyless (no model reconstructs the rule from prose). The rule rides `payload`
    as JSON; `match` lets the pass see the pattern was already offered. */
function learnOfferMsg(c: RuleCandidate): ChatMessage {
  return {
    id: uid(),
    role: 'nudge',
    body: offerPhrase(c),
    ts: nowFn(),
    nudgeType: 'learn-offer',
    actions: [
      { id: 'confirm', label: 'yes, always', kind: 'primary' },
      { id: 'dismiss', label: 'not a rule', kind: 'secondary' },
    ],
    payload: { match: c.match, rule: JSON.stringify(candidateToRule(c)) },
  }
}

/** The inbox placement offer (#348): ONE nudge carrying the fitting slot and two
    chips — gbrain OFFERS, the owner confirms. `place` resolves DETERMINISTICALLY
    in nudgeAction (placeFromInbox → the executor's one mutation path); `notnow`
    keeps the item waiting (dismissInboxOffer). The slot rides `payload` so a
    keyless confirm is identical — no model reconstructs it, nothing auto-places. */
function inboxOfferMsg(title: string, offer: InboxOffer, todayKey: string): ChatMessage {
  return {
    id: uid(),
    role: 'nudge',
    body: offerBody(title, offer, todayKey),
    ts: nowFn(),
    nudgeType: 'inbox-offer',
    actions: [
      { id: 'place', label: 'place it', kind: 'primary' },
      { id: 'notnow', label: 'not now', kind: 'secondary' },
    ],
    payload: {
      captureId: offer.itemId,
      dayKey: offer.dayKey,
      startMin: offer.startMin,
      durationMin: offer.durationMin,
    },
  }
}

/** The per-chunk paint path for ONE streaming mew reply (#281): the first delta
    creates the message row and flips `thinking` off; every later delta rewrites
    that same row immutably, so SessionRow's liveTail subscription repaints
    exactly one row per chunk. speak() drives it with live adapter chunks and
    the __mewSayStream dev hook drives it with scripted ones — one seam, so the
    e2e paint pin observes the real flush mechanics, never a simulation. */
function streamedReply() {
  let msgId: string | null = null
  let buffer = ''
  let reasoning: string | undefined // the model's pre-tool plan (#166)
  const flush = () => {
    if (msgId == null) {
      msgId = uid()
      const msg: ChatMessage = {
        id: msgId,
        role: 'mew',
        body: buffer,
        ts: nowFn(),
        ...(reasoning ? { reasoning } : {}),
      }
      useMew.setState((s) => ({ thinking: false, chat: [...s.chat, msg] }))
    } else {
      const id = msgId
      useMew.setState((s) => ({
        chat: s.chat.map((m) =>
          m.id === id ? { ...m, body: buffer, ...(reasoning ? { reasoning } : {}) } : m
        ),
      }))
    }
  }
  return {
    /** null until the first delta lands — no message row exists yet */
    get msgId() {
      return msgId
    },
    /** everything appended so far — speak's catch reads it for honest copy */
    get buffer() {
      return buffer
    },
    append(delta: string) {
      buffer += delta
      flush()
    },
    /** pin the pre-action plan to the message; it renders as a collapsible
        note. Before the row exists it parks here and rides the first flush. */
    attachReasoning(note: string) {
      reasoning = note
      if (msgId) flush()
    },
    /** A tool card is about to land after reply text began (#282): detach the
        live row where it stands so post-tool deltas open a NEW mew row and the
        transcript stays strictly chronological (text → card → text). Returns
        the closed row — final now, the caller owns persisting or dropping it —
        or null when nothing has streamed yet (nothing to close). The parked
        reasoning is spent with the row it flushed into, never re-pinned. */
    closeRow(): ChatMessage | null {
      if (msgId == null) return null
      const closed = useMew.getState().chat.find((m) => m.id === msgId) ?? null
      msgId = null
      buffer = ''
      reasoning = undefined
      return closed
    },
  }
}

/* ── tool-call activity cards (#282) ─────────────────────────────────
   Every executor invocation leaves one role:'tool' receipt row in the log:
   appended as `running` BEFORE the tool touches anything, then settled
   immutably (id-matched replace, the same pattern as flush()) — `done` on
   return, `error` + a MEW-voiced note on throw. Cards OBSERVE the executor
   seam; they are never a second mutation path. Module-level beside
   streamedReply so the lifecycle is one tested unit: speak()'s wrappers feed
   it live, tests feed it a scripted run (the SessionWindow precedent). */

function openToolCard(name: string, args?: Record<string, unknown>): string {
  const todayKey = dayKey(new Date(useMew.getState().nowMs))
  const { verb, target } = toolCardLabel(name, { todayKey, ...(args ?? {}) })
  const card: ChatMessage = {
    id: uid(),
    role: 'tool',
    body: '',
    ts: nowFn(),
    tool: { name, verb, ...(target ? { target } : {}), state: 'running' },
  }
  useMew.setState((s) => ({ chat: [...s.chat, card] }))
  /* the running row persists too (same delta putChat as settle): a crash
     mid-tool must replay as `interrupted` on reload — an in-flight action
     that simply vanished from the receipt would be a silent lie */
  storage.putChat([card]).catch(() => {})
  return card.id
}

function settleToolCard(id: string, state: 'done' | 'error', note?: string) {
  useMew.setState((s) => ({
    chat: s.chat.map((m) =>
      m.id === id && m.tool ? { ...m, tool: { ...m.tool, state, ...(note ? { note } : {}) } } : m
    ),
  }))
  const settled = useMew.getState().chat.find((m) => m.id === id)
  if (settled) storage.putChat([settled]).catch(() => {})
}

/** Run one executor tool inside its card lifecycle. On throw the card settles
    `error` (MEW-voiced note), the raw error goes to log.error, and the throw
    travels on UNCHANGED — the SDK/model sees the failure exactly as before. */
export function runToolWithCard(
  name: string,
  args: Record<string, unknown> | undefined,
  run: () => string
): string
export function runToolWithCard(
  name: string,
  args: Record<string, unknown> | undefined,
  run: () => Promise<string>
): Promise<string>
export function runToolWithCard(
  name: string,
  args: Record<string, unknown> | undefined,
  run: () => string | Promise<string>
): string | Promise<string> {
  const id = openToolCard(name, args)
  const fail = (err: unknown) => {
    log.error(`tool/${name}`, { tool: name }, err)
    settleToolCard(id, 'error', TOOL_ERROR_NOTE)
  }
  try {
    const out = run()
    if (out instanceof Promise) {
      return out.then(
        (line) => {
          settleToolCard(id, 'done')
          return line
        },
        (err) => {
          fail(err)
          throw err
        }
      )
    }
    settleToolCard(id, 'done')
    return out
  } catch (err) {
    fail(err)
    throw err
  }
}

/** Honest replay (#282): a stored `running` card is a turn the app never got
    to settle (closed/crashed mid-tool). Map it to `interrupted` AT HYDRATION —
    never at render — so history can never wear a live shimmer. Returns the
    flipped rows separately so callers converge storage with the same delta
    putChat the live path uses. */
function interruptStoredToolCards(msgs: ChatMessage[]): {
  msgs: ChatMessage[]
  flipped: ChatMessage[]
} {
  const flipped: ChatMessage[] = []
  const mapped = msgs.map((m) => {
    if (m.role !== 'tool' || m.tool?.state !== 'running') return m
    const settled: ChatMessage = { ...m, tool: { ...m.tool, state: 'interrupted' } }
    flipped.push(settled)
    return settled
  })
  return { msgs: flipped.length ? mapped : msgs, flipped }
}

function nudgeMsg(n: NudgeInstance): ChatMessage {
  return {
    id: uid(),
    role: 'nudge',
    body: n.body,
    ts: nowFn(),
    nudgeType: n.type,
    nudgeLabel: n.label,
    footnote: n.footnote,
    actions: n.actions,
    payload: n.payload,
  }
}

/** Factual collision note for tool results — names what the placement overlaps
    and whether each side can shift, so the model OFFERS to drift the flexible
    side rather than reactively re-placing the block it was just asked to set
    (#102: an explicit time is the user's judgment — place it, then offer). */
function clashNote(clash: Block[], prefs: PrefPayload[] = []): string {
  if (!clash.length) return ''
  const parts = clash.map((c) => {
    const base = `${c.title.split('—')[0].trim()} ${fmtTime(c.startMin)}–${fmtTime(c.endMin)}`
    return week.isFixedTime(c, prefs)
      ? `${base} (fixed${c.optional ? ', tentative' : ''} — it can't move)`
      : `${base} (flexible — offer to drift it, don't move it unasked)`
  })
  return ` — note: it overlaps ${parts.join(' and ')}`
}

/** #324 own-vs-own collision drift — the placement-time sibling of #345's
    edit-time drift-offer. New explicit-time WORK landing on the user's own
    flexible blocks clears them out of its way in the SAME pass (meals re-anchor
    through the circadian scorer, everything else takes the nearest later gap)
    and the reply names what moved — no place-then-ask (#102 reversed). External
    and fixed blocks are never moved (the honest overlap note); a flexible block
    with no clean slot becomes an offer (offer_choices is the fallback, never a
    silent overlap). `blocks` MUST already include `placed`; returns the reshaped
    blocks, the reply fragment, and the drifted ids (for touched-day tracking). */
function driftReply(
  blocks: Block[],
  placed: Block,
  todayKey: string,
  nowMin: number,
  prefs: PrefPayload[]
): { blocks: Block[]; note: string; driftedIds: string[] } {
  const res = driftCollisions(blocks, placed, todayKey, nowMin, prefs)
  let next = blocks
  const driftedIds: string[] = []
  const moved: string[] = []
  const placedBase = placed.title.split('—')[0].trim()
  for (const d of res.drifts) {
    next = week.move(next, d.block.id, d.toDayKey, d.toStartMin)
    driftedIds.push(d.block.id)
    const name = d.block.title.split('—')[0].trim()
    const where =
      d.toDayKey === placed.dayKey
        ? ''
        : `${d.toDayKey === todayKey ? 'today' : fmtDowLong(d.toDayKey)} `
    moved.push(`${name} to ${where}${fmtTime(d.toStartMin)}`)
  }
  const driftPart = moved.length ? ` — moved ${moved.join(', ')} to clear ${placedBase}` : ''
  // external/fixed never move — the same honest note clashNote has always given
  const fixedPart = clashNote(res.fixed, prefs)
  const stuckPart = res.stuck.length
    ? ` — note: ${res.stuck
        .map((b) => b.title.split('—')[0].trim())
        .join(
          ' and '
        )} still overlaps ${placedBase} with no clean slot to drift to — offer to shift the work, drop it, or keep the overlap (don't leave it unasked)`
    : ''
  return { blocks: next, note: `${driftPart}${fixedPart}${stuckPart}`, driftedIds }
}

function weekContext(s: MewState, recallLines: string[] = [], recallDegraded = false): WeekContext {
  const now = new Date(s.nowMs)
  const todayKey = dayKey(now)
  const live = liveNow(s.blocks, todayKey, minOfDay(now))
  const agg = aggregates(s.memory, now)
  const summary: string[] = []
  for (let i = 0; i < 7; i++) {
    const key = addDaysKey(todayKey, i)
    const day = week.blocksForDay(s.blocks, key)
    if (!day.length) continue
    const items = day
      .map(
        (b) =>
          `${fmtTime(b.startMin)}\u2013${fmtTime(b.endMin)} ${b.title} [${week.contextMarkers(b)}]`
      )
      .join(' · ')
    summary.push(`${i === 0 ? 'today' : fmtDowLong(key)} (${key}): ${items}`)
  }
  const insights = computeInsights(s.memory, agg, now)
  /* the conversational referent (#320), named for the keyed model so it
     resolves "it/that/the one after lunch" the SAME way the keyless floor does
     — one slot drives both paths, no drift. Only a live block qualifies (a
     removed referent names nothing). */
  const refBlock = s.lastReferent
    ? s.blocks.find((b) => b.id === s.lastReferent!.blockId)
    : undefined
  const referent = refBlock
    ? `${refBlock.title.split('—')[0].trim()} — ${refBlock.dayKey === todayKey ? 'today' : fmtDowLong(refBlock.dayKey)} ${fmtTime(refBlock.startMin)}`
    : undefined
  return {
    todayKey,
    todayLabel: fmtLongDate(now),
    nowLabel: fmtTime(minOfDay(now)),
    weekSummary: summary,
    ...(referent ? { referent } : {}),
    realisticBestH: agg.realisticBestH,
    mewsToday: live.mewsToday,
    insightLines: insights.lines,
    /* the full set rides along so the rules floor's `show insights` renders
       the same presenter rows as the Settings card (#287) */
    insights,
    /* the memory console, spoken (#330): the keyless "what do you know about
       me?" reply renders these — the SAME presenter the Settings console
       shows, over LOCAL memory (brain-off by law), so reply and card are one
       summary. Computed here so runIntent stays a pure render of ctx. */
    knownLines: consoleSummary(
      memoryConsole({ events: s.memory, prefs: activePrefsFrom(s.memory, null), insights })
    ),
    recallLines,
    recallDegraded,
    brainOn: brainOn(),
    prefLines: prefLinesFrom(s.memory, brainOn() ? brainPrefs : null),
    /* the structured rulebook + open captures ride along un-rendered (#304):
       the keyless ritual route derives its default tasks from them */
    prefs: activePrefsFrom(s.memory, brainOn() ? brainPrefs : null),
    openCaptures: s.captures.filter((c) => c.status === 'open').map((c) => c.title),
  }
}

/* ── store ────────────────────────────────────────────────────────── */

export const useMew = create<MewState>((set, get) => {
  /* desktop auto-backup: every persisted change marks the snapshot dirty; a
     30s coalescing timer writes ONE on-disk copy (keys already stripped by
     exportJson). Failures warn and wait for the next change — the backup
     must never block the week. No-ops outside the desktop shell. */
  let backupTimer: ReturnType<typeof setTimeout> | null = null
  let backupDirty = false
  const flushBackup = async () => {
    if (!backupDirty) return
    backupDirty = false
    if (backupTimer) {
      clearTimeout(backupTimer)
      backupTimer = null
    }
    try {
      await writeBackup(await storage.exportJson())
    } catch (err) {
      log.warn('backup/write', { note: 'will retry on the next change' }, err)
    }
  }
  const queueBackup = () => {
    if (!isTauri()) return
    backupDirty = true
    if (backupTimer) return // coalesce: one write per quiet 30s window
    backupTimer = setTimeout(() => {
      backupTimer = null
      void flushBackup()
    }, 30_000)
  }
  registerCloseFlush(() => backupDirty, flushBackup)

  /* persistence helpers (fire-and-forget; IndexedDB failures must never block the week) */
  const persistBlocks = (blocks: Block[]) => {
    storage.putBlocks(blocks).catch(() => {})
    queueBackup()
  }
  const persistChat = (msgs: ChatMessage[]) => storage.putChat(msgs).catch(() => {})
  const persistMemory = (evs: MewState['memory']) => {
    storage.putMemory(evs).catch(() => {})
    queueBackup()
  }
  /* undo (#162) clears the memory events its reversed tool logged (a completion,
     a drift mark, a stated preference) — the only path that retracts a logged
     event (memory is otherwise append-only). */
  const persistDeleteMemory = (ids: string[]) => {
    if (!ids.length) return
    storage.deleteMemory(ids).catch(() => {})
    queueBackup()
  }
  const persistSettings = (st: Settings) => {
    storage.putSettings(st).catch(() => {})
    queueBackup()
  }
  const persistCaptures = (cs: Capture[]) => {
    storage.putCaptures(cs).catch(() => {})
    queueBackup()
  }
  /* undo (#162) may take back a capture a tool jotted this turn — the only path
     that deletes one (a placed capture is updated in place, never removed). */
  const persistDeleteCaptures = (ids: string[]) => {
    if (!ids.length) return
    storage.deleteCaptures(ids).catch(() => {})
    queueBackup()
  }
  const dismissedSet = () => new Set(get().settings.dismissedEvents ?? [])
  /* tombstone imported events the user deleted or took ownership of (moved/
     edited) — a re-sync (mergePull reads dismissedEvents) won't resurrect them. */
  const dismissExternal = (blocks: Block[]) => {
    const keys = blocks
      .filter((b) => b.external)
      .map((b) => `${b.external!.calId}:${b.external!.eventId}`)
    if (!keys.length) return
    const cur = get().settings
    const next = {
      ...cur,
      dismissedEvents: [...new Set([...(cur.dismissedEvents ?? []), ...keys])],
    }
    set({ settings: next })
    persistSettings(next)
  }
  /** detach an imported block from its source so the user's change sticks */
  const detachExternal = (blocks: Block[], id: string): Block[] =>
    blocks.map((b) => (b.id === id ? { ...b, external: undefined } : b))

  /* desktop self-update: the shell stages the download and announces it;
     MEW offers a restart in chat and installs only on accept — an update
     never restarts a running week by itself. The shell can announce before
     the store hydrates, so the version parks until chat exists. */
  let stagedUpdateVersion: string | null = null
  const offerUpdate = (version: string) =>
    post([
      {
        id: uid(),
        role: 'nudge',
        body: `v${version} is downloaded and ready — restart when you like and it's yours. I'll keep running this one until then.`,
        ts: nowFn(),
        nudgeType: 'update',
        nudgeLabel: 'update ready',
        actions: [
          { id: 'restart', label: 'restart now', kind: 'primary' },
          { id: 'later', label: 'not now', kind: 'secondary' },
        ],
      },
    ])
  /* subscribed from hydrate(), not at store creation: module-init order is
     undefined for test fakes (TDZ), and an update can't precede a boot anyway */
  let updateOffersSubscribed = false
  function subscribeUpdateOffers() {
    if (updateOffersSubscribed) return // hydrate re-runs (restore); one listener is plenty
    updateOffersSubscribed = true
    onUpdateReady((version) => {
      if (get().hydrated) offerUpdate(version)
      else stagedUpdateVersion = version
    })
  }

  /* desktop sidecar brain: the shell spawns `gbrain serve` and hands the
     webview {url, token} — zero user setup. The endpoint can land before or
     after hydrate (the shell both stores it and emits an event), and lands
     again with fresh credentials after a health-restart; module state in
     adapters/brain/sidecar absorbs every ordering. Each handshake also
     refreshes the pref cache: the brain that just came on must serve the
     always-on rulebook, not only receive the senses' writes. The shell's
     status beats land in state (brainSidecar) so Settings renders the
     lifecycle live — a spawn that never succeeds is visible, not silent. */
  let sidecarSubscribed = false
  function connectSidecarBrain() {
    if (sidecarSubscribed || !isTauri()) return
    sidecarSubscribed = true
    onBrainStatus((status) => {
      setSidecarStatus(status)
      set({ brainSidecar: sidecarStatus() })
    })
    onBrainEndpoint((e) => {
      setSidecarBrain(e)
      set({ brainSidecar: sidecarStatus() })
      refreshBrainPrefs()
      maybeBackfillBrain()
    })
    /* pull both snapshots too: the shell beats "starting" while React is
       still mounting, and a reload after the give-up gets no beat ever —
       event-only status would show the retired "Off" copy for the first-boot
       PGLite window (up to 90s) and forget "unavailable" for the session */
    void Promise.all([brainEndpoint(), brainStatus()]).then(([e, s]) => {
      adoptSidecarSnapshot(e, s)
      if (e) {
        refreshBrainPrefs()
        maybeBackfillBrain() // pre-hydrate adoptions are re-offered by hydrate's own call
      }
      set({ brainSidecar: sidecarStatus() })
    })
  }

  /* ── system tray (#283): remote controls + the shell metronome ─────────
     Every tray route lands on a door that already exists — toggleComplete
     (the checkbox's path), startNow (the start-by nudge's accept), the
     quick-capture overlay — never a second mutation path. The shell's 60s
     mew://tick keeps tick() honest while the window hides to the tray:
     webview timers throttle there, and the 5-min syncNow gate rides on
     tick, so the hidden-window sync cadence hangs off the shell clock. */
  const quietTrayToast = (body: string) =>
    notifier.mirror({ title: 'MEW', body, tag: 'tray', onClick: () => {} })
  let shellTraySubscribed = false
  function connectShellTray() {
    if (shellTraySubscribed || !isTauri()) return
    shellTraySubscribed = true
    onShellTick(() => get().tick())
    onTrayAction((action) => {
      const s = get()
      const now = new Date(s.nowMs)
      const live = liveNow(s.blocks, dayKey(now), minOfDay(now))
      switch (action) {
        case 'start-next':
          if (live.next) get().startNow(live.next.id)
          else quietTrayToast('nothing queued today — the day is yours')
          break
        case 'done':
          /* liveNow.current is open by construction, so this can only ever
             complete — the toggle's un-complete branch is unreachable here */
          if (live.current) get().toggleComplete(live.current.id)
          else quietTrayToast('nothing live right now — all yours')
          break
        case 'quick-capture':
          get().openCommandPalette('capture')
          break
        case 'open':
          break // the shell already raised the window — nothing to do here
      }
    })
  }

  /* OS-global capture hotkey (#284): the shell registers what the webview
     pushes — on hydrate (the persisted binding) and on rebind. The shell is
     the validator; false lands as the collision flag the Settings row reads.
     The trigger needs no wiring of its own: the shell emits the tray's
     quick-capture route, which onTrayAction above already owns. */
  async function syncCaptureHotkey(accel: string | null): Promise<boolean> {
    const ok = await setCaptureHotkey(accel)
    set({ hotkeyCollision: !ok })
    return ok
  }

  /* tray dot + tooltip (#283): recomputed per tick, pushed only on change —
     the shell repaints on block transitions and countdown-minute flips,
     never on the raw 5 s cadence. */
  let lastTray: TrayShape | null = null
  function pushTray() {
    if (!isTauri()) return
    const s = get()
    const now = new Date(s.nowMs)
    const shape = trayShape(liveNow(s.blocks, dayKey(now), minOfDay(now)))
    if (lastTray && lastTray.state === shape.state && lastTray.tooltip === shape.tooltip) return
    lastTray = shape
    void updateTray(shape.state, shape.tooltip)
  }

  /* ── backfill-on-connect (#249 fix 4) ──────────────────────────────
     Ingest no-ops while no brain is on, so every block event of a brainless
     stretch used to be lost to the brain forever. When one becomes reachable,
     replay the recent events it never saw through the same sense
     (blockEventPage). The ledger is a per-brain watermark
     (settings.brainBackfillAt): an event ts ≤ the mark has had its ONE offer
     — live dispatch or replay — because add_timeline_entry cannot be deduped
     from this side (the gbrain server is an external pin; page upserts are
     safe, timeline appends are not). Each event is claimed BEFORE it is
     sent, one at a time: a quit mid-replay costs at most the event in
     flight, and the next connect resumes at the mark instead of forfeiting
     the tail — while a sent-but-unclaimed event (the duplicate window) can
     never exist. The claim persists per event for the same reason: batching
     the writes would reopen that window across a quit. */
  const BACKFILL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // raw events outlive it (56d consolidation)
  const BACKFILL_MAX_EVENTS = 400 // a decade of imported history must not turn connect into a flood
  /* one live replay pass per brain: a newer pass (second connect beat, or a
     sidecar restart mid-replay) re-selects from the advanced mark and
     supersedes the old loop, which aborts at its next event — between them,
     every event is offered exactly once */
  const backfillPass = new Map<string, number>()

  /** Advance one brain's offer mark — monotonic, persisted. The key is the
      caller's truth: live dispatch claims for the brain it dispatches to,
      a replay claims for the brain it captured at start. */
  function claimBrainOffer(key: string, ts: number) {
    const s = get()
    if (ts <= (s.settings.brainBackfillAt?.[key] ?? 0)) return
    const settings = {
      ...s.settings,
      brainBackfillAt: { ...s.settings.brainBackfillAt, [key]: ts },
    }
    set({ settings })
    persistSettings(settings)
  }

  /** The one path a live block event reaches the brain. Dispatch and claim
      are inseparable: once offered — even if this send silently fails while
      the sidecar is between deaths — the event is never offered again. `ts`
      must be the ts the matching MemoryEvent is logged with, or a later
      replay window could half-overlap the event and double it. */
  function ingestBlockEvent(b: Block, kind: BlockEventKind, atMin: number, ts: number) {
    if (brainOn()) claimBrainOffer(effectiveBrainKey(get().settings), ts)
    const known = knownProjectsFrom(get().blocks.map((x) => x.title)).keys()
    void brain.ingest(blockEventPage(b, kind, b.dayKey, atMin, known))
  }

  /** Replay what the effective brain missed — fire-and-forget, off-gated,
      never blocks the UI. Hydration-gated too: claiming over an unloaded
      memory would mark events as offered that were never even seen. Only
      events carrying the full block shape replay (title, tag, times) —
      a page can't be honest about a block it can't describe. */
  function maybeBackfillBrain() {
    const s = get()
    if (!s.hydrated || !effectiveBrain(s.settings).on) return
    const key = effectiveBrainKey(s.settings)
    const mark = s.settings.brainBackfillAt?.[key]
    const since = Math.max(mark ?? 0, nowFn() - BACKFILL_WINDOW_MS)
    const events = s.memory
      .filter(
        (e) =>
          (e.kind === 'completed' || e.kind === 'rolled') &&
          e.ts > since &&
          e.title != null &&
          e.tag != null &&
          e.startMin != null
      )
      .sort((a, b) => a.ts - b.ts)
      .slice(-BACKFILL_MAX_EVENTS)
    if (!events.length) return // an empty pass claims nothing and supersedes nothing
    const pass = (backfillPass.get(key) ?? 0) + 1
    backfillPass.set(key, pass)
    const known = [
      ...knownProjectsFrom([
        ...s.blocks.map((b) => b.title),
        ...events.map((e) => e.title!),
      ]).keys(),
    ]
    void (async () => {
      for (const ev of events) {
        /* abort while the loop holds the thread, before claiming or sending:
           — a newer pass owns this brain (it re-selected from the advanced
             mark, so stopping here is what keeps the handover overlap-free);
           — the effective brain is no longer the one this replay claimed
             for: the port reads config live, so the remainder would land on
             the NEW brain while claimed under the old key — and the new
             brain's own pass offers these same events. Its ledger stops at
             the last event actually offered, so switching back resumes
             exactly there; at most the event in flight straddles a switch. */
        if (backfillPass.get(key) !== pass || effectiveBrainKey(get().settings) !== key) return
        claimBrainOffer(key, ev.ts)
        /* the sense reads only title/tag/times — the rest is shape filler */
        const b: Block = {
          id: ev.id,
          title: ev.title!,
          tag: ev.tag!,
          dayKey: ev.dayKey,
          startMin: ev.startMin!,
          endMin: ev.endMin ?? ev.startMin! + (ev.plannedMin ?? 30),
          protected: false,
          status: 'open',
          calendarRefs: [],
          estimateSource: 'user',
        }
        const kind: BlockEventKind = ev.kind === 'completed' ? 'completed' : 'rolled'
        await brain.ingest(blockEventPage(b, kind, ev.dayKey, minOfDay(new Date(ev.ts)), known))
      }
    })()
  }

  /* chat → brain: user/mew turns batch into one timeline write per quiet
     minute (nudges stay out — engine chatter isn't the user's story) */
  const chatBatcher = makeChatBatcher((turns, day) => {
    const page = chatBatchPage(turns, day)
    if (page) void brain.ingest(page)
  })

  /* ── chat condensation (#250 phase 2) ────────────────────────────────
     At the day-debrief moment, chat older than the horizon distills into one
     durable digest page per day (senses.condenseChatPage) and the raw rows
     prune — locally bounded store, old conversations recallable instead of
     dead scrollback. Two hard laws:
       · brainless profiles prune NOTHING — no brain, no condensation, ever;
       · a day prunes only on PROOF its digest landed. ingest never throws
         (failures are swallowed to a health flip), so proof is a read-back:
         the digest page's links must include the day page. The digest is an
         idempotent body upsert, so a pass that failed mid-way simply re-runs
         next debrief — history is never destroyed un-condensed.
     The horizon rounds to a DAY boundary: only whole days condense, so one
     day is distilled exactly once and its digest never self-overwrites with
     a partial remainder. */
  const CONDENSE_HORIZON_DAYS = 14
  let condenseInFlight = false
  /* the earlier-page loader's single-flight handle (loadEarlierChat) — page
     size mirrors the session log's render page, but any size stays correct:
     the log reveals exactly what a page returns */
  const EARLIER_CHAT_PAGE = 50
  let earlierChatPending: Promise<number> | null = null
  async function condenseOldChat(): Promise<void> {
    if (condenseInFlight || !brainOn()) return
    condenseInFlight = true
    try {
      const todayKey = dayKey(new Date(get().nowMs))
      /* everything before the first kept day (today − horizon) condenses */
      const cutoffTs = fromDayKey(addDaysKey(todayKey, -CONDENSE_HORIZON_DAYS)).getTime()
      const old = await storage.loadChatOlderThan(cutoffTs)
      if (!old.length) return
      const byDay = new Map<string, ChatMessage[]>()
      for (const m of old) {
        const k = dayKey(new Date(m.ts))
        const day = byDay.get(k)
        if (day) day.push(m)
        else byDay.set(k, [m])
      }
      const pruneIds: string[] = []
      for (const [day, msgs] of byDay) {
        const page = condenseChatPage(msgs, day)
        if (page) {
          await brain.ingest(page)
          /* the proof: the digest's link to its day page is readable back.
             Absent (brain down, write lost), the day stays — next debrief
             retries the same upsert. */
          const linked = await brain.links(condensedChatSlug(day))
          if (!linked.includes(`week/${day}`)) continue
        }
        /* page === null: the day held only nudges — engine chatter carries
           no user story, so it prunes without an ingest */
        for (const m of msgs) pruneIds.push(m.id)
      }
      if (!pruneIds.length) return
      await storage.deleteChat(pruneIds)
      /* the window may reach that far back on a small profile — drop the
         pruned rows from live state so the log and storage agree */
      const drop = new Set(pruneIds)
      set((s) => ({ chat: s.chat.filter((m) => !drop.has(m.id)) }))
      queueBackup() // the desktop's on-disk copy converges to the pruned table
    } finally {
      condenseInFlight = false
    }
  }

  /* The two universal quick-actions (#305) a mirrored nudge grows, or null.
     A nudge earns them when it points at a block that is still to come and
     ours to touch: open, not external (never our meeting to move), not already
     ended, and not the one you're in right now — the live block is drift's and
     guard's moment, not a done/+15 moment. The pair is fixed for every nudge,
     never tailored per type, so the toast and the card show the SAME two. */
  function blockQuickActions(msg: ChatMessage): NudgeAction[] | null {
    const id = msg.payload?.blockId
    if (typeof id !== 'string') return null
    const s = get()
    const b = s.blocks.find((x) => x.id === id)
    if (!b || b.status !== 'open' || b.external) return null
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    const nowMin = minOfDay(now)
    const ended = b.dayKey < todayKey || (b.dayKey === todayKey && b.endMin <= nowMin)
    if (ended) return null
    if (liveNow(s.blocks, todayKey, nowMin).current?.id === b.id) return null
    return [
      { id: 'done', label: 'Done', kind: 'secondary' },
      { id: 'snooze15', label: '+15 min', kind: 'secondary' },
    ]
  }

  function post(msgs: ChatMessage[], opts?: { mirror?: boolean }) {
    if (!msgs.length) return
    const last = msgs[msgs.length - 1]
    /* a mirrored block reminder grows done/+15 (#305): the same pair feeds the
       native toast and the card, so a platform that can't render buttons still
       lands the click on a card that carries them — parity, never an error. */
    const quick = opts?.mirror && last.role === 'nudge' ? blockQuickActions(last) : null
    if (quick) last.actions = [...(last.actions ?? []), ...quick]
    set((s) => ({ chat: [...s.chat, ...msgs] }))
    persistChat(msgs)
    if (brainOn()) {
      const day = dayKey(new Date(get().nowMs))
      for (const m of msgs) if (m.role !== 'nudge') chatBatcher.add(m, day)
    }
    if (opts?.mirror && last.role === 'nudge') {
      /* the rituals announce themselves by name (#285); everything else keeps
         the companion's own title */
      const title =
        last.nudgeType === 'morning-brief'
          ? 'mew — morning brief'
          : last.nudgeType === 'evening-wrap'
            ? 'mew — evening wrap'
            : last.nudgeType === 'weekly-ritual'
              ? 'mew — weekly ritual'
              : `${get().settings.mewName} · MEW`
      notifier.mirror({
        title,
        body: last.body.split('\n')[0],
        tag: last.id,
        onClick: () => {
          useMew.setState({ page: 'week', scrollToMsgId: last.id })
        },
        ...(quick
          ? {
              actions: quick.map((a) => ({ id: a.id as NotifyActionId, label: a.label })),
              onAction: (aid: NotifyActionId) => get().nudgeAction(last.id, aid),
            }
          : {}),
      })
    }
  }

  function logMemory(ev: Omit<MewState['memory'][number], 'id' | 'ts'> & { ts?: number }) {
    const full = { id: uid(), ts: ev.ts ?? nowFn(), ...ev }
    set((s) => ({ memory: [...s.memory, full] }))
    persistMemory([full])
  }

  function logOutcome(nudgeType: NudgeId, outcome: 'accepted' | 'declined' | 'ignored') {
    logMemory({ kind: 'nudge_outcome', dayKey: dayKey(new Date(get().nowMs)), nudgeType, outcome })
  }

  function resolveNudge(msgId: string, label: string) {
    set((s) => ({
      chat: s.chat.map((m) => (m.id === msgId ? { ...m, resolved: label } : m)),
    }))
    const msg = get().chat.find((m) => m.id === msgId)
    if (msg) persistChat([msg])
  }

  function markFired(n: NudgeInstance, nowMs: number) {
    set((s) => {
      const lastFired = { ...s.engine.lastFired, [n.type]: { ts: nowMs, key: n.key } }
      return {
        engine: {
          lastFired,
          lastDriftBlockId:
            n.type === 'drift' ? String(n.payload.blockId) : s.engine.lastDriftBlockId,
        },
        /* dedupe keys ride Settings as machine state (like dismissedEvents),
           so "fired today" survives a restart — the brief/wrap once-per-day
           law depends on it. hydrate() seeds the engine back from it. */
        settings: { ...s.settings, nudgeLastFired: lastFired },
      }
    })
    persistSettings(get().settings)
    /* a drift check-in IS the drift signal — log it so insights can find where
       attention slips (driftBand reads these; weekly summaries count them) */
    if (n.type === 'drift') {
      logMemory({ kind: 'drift', dayKey: dayKey(new Date(nowMs)), ts: nowMs })
    }
  }

  /* Rescue offers (#286): after a pull that changed blocks, name each NEW
     inbound-meeting landing in chat with one-tap re-plan chips. Chat-only —
     nothing here mutates the week; a pick posts the choice's reply as a user
     turn and the executor does the rest. Dedupe rides the engine.lastFired
     key mechanism, one slot per landing: the same event re-pulled every 5
     minutes never re-nudges, the same event moving again (new startMin) is a
     fresh key and correctly re-fires. */
  const RESCUE_KEY_TTL = 21 * 24 * 60 * 60 * 1000 // the sync window — older landings can't recur
  function offerRescues(prevBlocks: Block[]) {
    const s = get()
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    const conflicts = detectRescues(prevBlocks, s.blocks, todayKey)
    if (!conflicts.length) return
    const lastFired = { ...s.engine.lastFired }
    const msgs: ChatMessage[] = []
    for (const c of conflicts) {
      const key = rescueKey(c)
      if (lastFired[key]) continue // this landing was already offered
      const options = rescueOptions(s.blocks, c, todayKey, minOfDay(now))
      if (options.length) {
        msgs.push(choicesMsg(rescueLine(c, todayKey), options))
      } else if (!withinDayWords(c.block.dayKey, todayKey)) {
        /* beyond the chip horizon the landing would otherwise go PERMANENTLY
           silent — detection is diff-based, so a merged event never re-detects
           as it drifts into range. Say it once, in prose, with no fake taps. */
        msgs.push(mewMsg(rescueLine(c, todayKey)))
      } else {
        /* a near day with zero viable options stays quiet: the week view
           already shows the overlap, and there is nothing honest to offer */
        continue
      }
      lastFired[key] = { ts: s.nowMs }
    }
    if (!msgs.length) return
    for (const k of Object.keys(lastFired) as (keyof typeof lastFired)[]) {
      const fired = lastFired[k]
      if (String(k).startsWith('rescue:') && fired && fired.ts < s.nowMs - RESCUE_KEY_TTL) {
        delete lastFired[k]
      }
    }
    set((st) => ({ engine: { ...st.engine, lastFired } }))
    post(msgs)
  }

  /* Back-to-back observation (#302): after a pull, if the meeting buffer is on
     and the pull LANDED external meetings sitting ≤ bufferMin apart on a day,
     ONE positive line per day rides the arrival message's observation slot —
     never a separate message, never blame. Dedupe through the persisted
     nudgeLastFired map (`buffer:<dayKey>`), so re-pulling the same tight pair
     never re-observes it; keys sweep on the same sync-window TTL as rescue
     landings. Pure detection lives in week.tightMeetingJunction; the events
     never move — this only notices. Returns the joined lines, or undefined. */
  function meetingBufferObservation(prePull: Block[]): string | undefined {
    const s = get()
    const bufferMin = s.settings.meetingBufferMin ?? 0
    if (bufferMin <= 0) return undefined
    const had = new Set(prePull.filter((b) => b.external).map((b) => b.id))
    const landedDays = [
      ...new Set(
        get()
          .blocks.filter((b) => b.external && b.status === 'open' && !had.has(b.id))
          .map((b) => b.dayKey)
      ),
    ].sort()
    if (!landedDays.length) return undefined
    const lastFired = { ...s.engine.lastFired }
    const lines: string[] = []
    for (const day of landedDays) {
      const key = `buffer:${day}` as `buffer:${string}`
      if (lastFired[key]) continue // this day was already observed
      const pivot = week.tightMeetingJunction(get().blocks, day, bufferMin)
      if (pivot == null) continue
      lines.push(
        `two meetings back-to-back at ${fmtTime(pivot)} — i kept your ${bufferMin} min after free`
      )
      lastFired[key] = { ts: s.nowMs, key: day }
    }
    if (!lines.length) return undefined
    /* TTL sweep, mirroring rescue: buffer keys past the sync window can't recur */
    for (const k of Object.keys(lastFired) as (keyof typeof lastFired)[]) {
      const fired = lastFired[k]
      if (String(k).startsWith('buffer:') && fired && fired.ts < s.nowMs - RESCUE_KEY_TTL) {
        delete lastFired[k]
      }
    }
    set((st) => ({
      engine: { ...st.engine, lastFired },
      settings: { ...st.settings, nudgeLastFired: lastFired },
    }))
    persistSettings(get().settings)
    return lines.join('\n')
  }

  /* The honest day-load meter (#301, v0.5 item 12): after a plan-executor run
     that placed work on a day now past the user's demonstrated line, ONE
     choicesMsg (the #296 shape) — the kindness line plus keep/trim chips.
     Chat-only by law: a pick posts the chip's reply as an ordinary user turn
     and the executor does the rest; the keep chip's reply parses as plain
     chat on the rules floor (deliberately — an acknowledgment, not an ask).
     Dedupe per assessed day per calendar day rides the persisted
     nudgeLastFired mechanism (#297), so it survives a restart. Mid-turn the
     message parks (a guard is reflection, not an interrupt — #115) and
     flushes after the reply; outside a turn it posts on the next microtask so
     the plan's own line lands first. Under the line, and under the data
     floor, this function says nothing — silence is pinned. */
  let pendingDayLoadMsgs: ChatMessage[] = []
  function offerDayLoadGuard(days: Set<string>, todayKey: string): Set<string> {
    const spoke = new Set<string>()
    if (!days.size) return spoke
    const s = get()
    const now = new Date(s.nowMs)
    const throughput = dayThroughputMin(s.memory, aggregates(s.memory, now), todayKey)
    if (throughput == null) return spoke // data floor: no meter, no claims
    const lastFired = { ...s.engine.lastFired }
    const msgs: ChatMessage[] = []
    for (const k of [...days].sort()) {
      if (k < todayKey) continue // only days still being planned
      const a = dayLoadAssessment(s.blocks, k, throughput)
      if (!a?.over) continue // zero nagging under the line
      const slot = dayLoadFiredKey(k)
      if (lastFired[slot]?.key === todayKey) continue // once per day per day-key
      const trim = trimMove(s.blocks, k, todayKey, minOfDay(now), throughput)
      /* no honest keyless trim → no chips faked; the density tint still
         carries the truth (the rescue offers' zero-viable-options rule) */
      if (!trim) continue
      msgs.push(
        choicesMsg(a.line, [
          { id: 'keep', label: 'keep it as planned', reply: 'ok, keep it as planned' },
          { id: 'trim', label: 'trim to my usual', reply: trim.reply },
        ])
      )
      lastFired[slot] = { ts: s.nowMs, key: todayKey }
      spoke.add(k)
    }
    if (!msgs.length) return spoke
    /* sweep spent slots — a day already lived can't be re-planned */
    for (const k of Object.keys(lastFired) as (keyof typeof lastFired)[]) {
      if (String(k).startsWith('dayload:') && String(k).slice('dayload:'.length) < todayKey) {
        delete lastFired[k]
      }
    }
    set((st) => ({
      engine: { ...st.engine, lastFired },
      /* persisted like the rituals' keys (#297) — "spoke today" must hold
         across a restart or the guard would nag again on reload */
      settings: { ...st.settings, nudgeLastFired: lastFired },
    }))
    persistSettings(get().settings)
    if (turnInFlight) pendingDayLoadMsgs.push(...msgs)
    else queueMicrotask(() => post(msgs))
    return spoke
  }

  /* Estimate correction at plan time (#322, ask mode): after a plan places
     under-booked work of a kind the user's OWN history shows runs long, ONE
     choicesMsg (the #296 shape) offers to give it room — kindly, once per day,
     their choice. Per task-type (deep runs long; batched admin usually doesn't),
     so admin is never over-padded to fix deep. `pendingEstimatePad` remembers
     the EXACT blocks the offer is about, so the pad chip resizes those and no
     others (like the day-load guard's parked chips, it's store-held guard state
     — the pick reads it back through execGiveRoom).

     THE ONE-VOICE COORDINATION (#301 precedent): the day-load meter runs first
     and returns `guarded` (the days it spoke for). If it spoke at all for this
     placement, the estimate offer stays silent AND does not burn its key — one
     guard voice per placement, and the offer waits for a turn the meter is quiet
     on. Under the ask setting, under the pad floor, or with a stated duration,
     this says nothing. */
  let pendingEstimateMsgs: ChatMessage[] = []
  let pendingEstimatePad: { ids: string[]; factor: number; focusClass: FocusClass } | null = null
  function offerEstimateGuard(
    placed: { id: string; focusClass: FocusClass }[],
    guarded: Set<string>,
    todayKey: string
  ) {
    if (get().settings.estimateAutosize !== 'ask') return // off / always never offer
    if (!placed.length) return
    /* one guard voice per placement: the day-load meter already spoke this turn
       — defer without burning the key, so the offer still gets its one shot on a
       later turn the meter is quiet on */
    if (guarded.size > 0) return
    const s = get()
    const lastFired = { ...s.engine.lastFired }
    if (lastFired[ESTIMATE_FIRED_KEY]?.key === todayKey) return // once per calendar day
    const factors = estimateFactorByTag(s.memory, new Date(s.nowMs))
    /* group the just-placed, non-stated blocks by kind, keep only kinds whose
       demonstrated factor clears the pad floor — this is where admin (factor ≈ 1)
       drops out and deep (factor > 1.1) stays */
    const byClass = new Map<FocusClass, string[]>()
    for (const p of placed) {
      const f = factors[p.focusClass]
      if (f != null && f >= ESTIMATE_PAD_FLOOR) {
        const ids = byClass.get(p.focusClass) ?? []
        ids.push(p.id)
        byClass.set(p.focusClass, ids)
      }
    }
    if (!byClass.size) return
    /* one message: the kind that runs longest leads (deterministic tie-break by
       clock order of the classes is irrelevant — factor decides) */
    const [focusClass, ids] = [...byClass.entries()].sort(
      (a, b) => factors[b[0]]! - factors[a[0]]!
    )[0]
    const factor = factors[focusClass]!
    const pct = Math.round((factor - 1) * 100)
    const label = FOCUS_CLASS_LABEL[focusClass]
    pendingEstimatePad = { ids, factor, focusClass }
    const msg = choicesMsg(
      `your ${label} blocks tend to run ~${pct}% long — want me to give them room?`,
      [
        { id: 'pad', label: 'give them room', reply: `give my ${label} blocks room` },
        { id: 'leave', label: 'leave as-is', reply: 'ok, leave them as they are' },
      ]
    )
    lastFired[ESTIMATE_FIRED_KEY] = { ts: s.nowMs, key: todayKey }
    set((st) => ({
      engine: { ...st.engine, lastFired },
      /* persisted like the rituals' keys (#297) — "offered today" holds across a
         restart so the offer never repeats on reload */
      settings: { ...st.settings, nudgeLastFired: lastFired },
    }))
    persistSettings(get().settings)
    if (turnInFlight) pendingEstimateMsgs.push(msg)
    else queueMicrotask(() => post([msg]))
  }

  /* The "give them room" chip / give_room tool (#322): resize the EXACT blocks
     the last offer was about (pendingEstimatePad) up to how the kind really runs,
     through the resize edit path — tools stay the only mutation door. Skips any
     that have since been completed, removed, or moved behind the clock; a stated
     duration was never in the set to begin with. No matching offer on record ⇒
     a gentle no-op (a cold or stale call never mass-resizes the week). */
  function execGiveRoom(focusClass: FocusClass): string {
    const pad = pendingEstimatePad
    if (!pad || pad.focusClass !== focusClass) {
      return `nothing to give room right now — I only pad the blocks I just offered on.`
    }
    const s = get()
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    const nowMin = minOfDay(now)
    const targets = s.blocks.filter(
      (b) =>
        pad.ids.includes(b.id) &&
        b.status === 'open' &&
        !b.external &&
        (b.dayKey > todayKey || (b.dayKey === todayKey && b.startMin >= nowMin))
    )
    if (!targets.length) {
      pendingEstimatePad = null
      return `those blocks have already moved on — nothing to give room.`
    }
    const grown = new Set(targets.map((b) => b.id))
    const next = s.blocks.map((b) =>
      grown.has(b.id)
        ? applyEditPatch(b, { durationMin: padDuration(week.duration(b), pad.factor) })
        : b
    )
    setBlocks(next)
    pendingEstimatePad = null // one pad per offer
    const label = FOCUS_CLASS_LABEL[focusClass]
    const n = targets.length
    const pct = Math.round((pad.factor - 1) * 100)
    return `Gave your ${label} block${n === 1 ? '' : 's'} room — ${n} now run${n === 1 ? 's' : ''} about ${pct}% longer, sized to how they really go.`
  }

  /* task→person link snapshot for the delegate nudge — fetched once per
     week, on the first tick inside the fresh-start window (the only moment
     the nudge can use it). The engine stays pure: it reads pairs as data.
     Brain off → never fetched → the nudge cannot exist. */
  let brainLinks: { weekOf: string; pairs: { from: string; to: string }[] } | null = null
  let brainLinksPending = false
  function primeBrainLinks(s: MewState, todayKey: string, nowMin: number, now: Date) {
    if (!brainOn()) return
    const dowMon0 = (now.getDay() + 6) % 7
    if (dowMon0 !== 0 || nowMin < 8 * 60 || nowMin >= 11 * 60) return
    if (brainLinks?.weekOf === todayKey || brainLinksPending) return
    /* the kinds worth asking about: trailing-28d completed work, normalized */
    const floor = s.nowMs - 28 * 24 * 60 * 60 * 1000
    const kinds = [
      ...new Set(
        s.memory
          .filter((e) => e.kind === 'completed' && e.ts >= floor && e.title)
          .map((e) =>
            e
              .title!.split('—')[0]
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '')
          )
          .filter(Boolean)
      ),
    ].slice(0, 12)
    if (!kinds.length) return
    brainLinksPending = true
    void Promise.all(
      kinds.map(async (k) => {
        const targets = await brain.links(`task/${k}`).catch(() => [])
        return targets
          .filter((t) => t.startsWith('person/'))
          .map((t) => ({ from: `task/${k}`, to: t }))
      })
    )
      .then((nested) => {
        brainLinks = { weekOf: todayKey, pairs: nested.flat() }
      })
      .finally(() => {
        brainLinksPending = false
      })
  }

  /* Monday color for the week review: one recall per Monday, cached for the
     day, threaded into the engine as data. Brain off → never asked, the
     review runs on local events alone. */
  let weekColor: { day: string; lines: string[] } | null = null
  let weekColorPending = false
  function primeWeekColor(todayKey: string, now: Date) {
    if (!brainOn()) return
    if ((now.getDay() + 6) % 7 !== 0) return
    if (weekColor?.day === todayKey || weekColorPending) return
    weekColorPending = true
    brain
      .recall(`debrief last week — week of ${addDaysKey(todayKey, -7)}`, {
        limit: 2,
        scope: brainScope(),
      })
      .then((lines) => {
        weekColor = { day: todayKey, lines: lines ?? [] } // color-only: degraded = no color
      })
      .catch(() => {
        weekColor = { day: todayKey, lines: [] }
      })
      .finally(() => {
        weekColorPending = false
      })
  }

  /* pre-meeting recall: fetched a tick ahead of the 8–12 min window (the
     engine stays pure — it only reads the map). Cached per block id for the
     session; a failed or empty recall caches [] so the brain is asked once.
     Brain off → never asked, never fired: no degradation theater. */
  const personRecall: Record<string, string[]> = {}
  const personRecallPending = new Set<string>()
  function primePersonRecall(s: MewState, todayKey: string, nowMin: number) {
    if (!brainOn()) return
    for (const b of week.blocksForDay(s.blocks, todayKey)) {
      if (b.status !== 'open' || b.optional || !week.isFixedTime(b)) continue
      const lead = b.startMin - nowMin
      if (lead < 0 || lead > 15) continue
      if (b.id in personRecall || personRecallPending.has(b.id)) continue
      const people = peopleFrom(b.title)
      if (!people.length) continue
      personRecallPending.add(b.id)
      const names = people.map((p) => p.split('/')[1]).join(', ')
      brain
        .recall(`person ${names} recent interactions and outcomes`, {
          limit: 2,
          scope: brainScope(),
        })
        .then((lines) => {
          personRecall[b.id] = lines ?? [] // color-only: degraded = no color
        })
        .catch(() => {
          personRecall[b.id] = [] // silence, not error — the floor never hears about it
        })
        .finally(() => personRecallPending.delete(b.id))
    }
  }

  /* ── the sustenance scaffold (#299, v0.5 16b) ──────────────────────
     The standing day-scaffold: at/after the morning brief's tick, once per
     day, the day gains its missing meals + paced breathers — placed by the
     pure scaffoldDay and applied THROUGH THE EXECUTOR plan path (the only
     mutation door), then one plain chat line. The 'sustenance' key rides the
     same persisted map as the rituals (#297): it burns whether or not the
     day needed anything (checked, not needed — once per day either way),
     and hydrate heals it by chat/week truth. Runs BEFORE the engine builds
     its ctx, so the brief's "today's shape" already includes the meals. */
  function burnSustenanceKey(todayKey: string, nowMs: number) {
    set((s) => {
      const lastFired = { ...s.engine.lastFired, sustenance: { ts: nowMs, key: todayKey } }
      return {
        engine: { ...s.engine, lastFired },
        settings: { ...s.settings, nudgeLastFired: lastFired },
      }
    })
    persistSettings(get().settings)
  }

  function runSustenancePass() {
    const s = get()
    if (!s.hydrated || s.settings.sustenance === 'off') return
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    const nowMin = minOfDay(now)
    if (nowMin < s.settings.briefMin) return
    if (s.engine.lastFired.sustenance?.key === todayKey) return
    const specs = scaffoldDay(s.blocks, todayKey, {
      prefs: activePrefsFrom(s.memory, brainOn() ? brainPrefs : null),
      learned: learnedRules(s), // #328: a confirmed rule can size the meal
      meals: s.settings.sustenanceMeals,
      nowMin,
    })
    burnSustenanceKey(todayKey, s.nowMs)
    if (!specs.length) return // fed (or wall-to-wall): nothing to add, nothing to say
    runToolWithCard('plan', { places: specs, frees: [] }, () => execPlan(specs, []))
    post([mewMsg(scaffoldLine(specs))])
  }

  /* ── the learn-from-doing pass (#327, gbrain Pillar 1) ─────────────
     Rides the tick like the rituals: detectTaskRules is pure over local
     memory, and this surfaces ONE fresh candidate as a single offer. Gated
     three ways so it offers-once-then-stays-silent (never nags): at most one
     offer per calendar day (the key burns only when an offer actually posts),
     never a pattern already confirmed (a rule in force) or dismissed
     (detectTaskRules skips both), and never one already offered in the log.
     Confirm/dismiss resolve deterministically in nudgeAction. */
  function burnLearnKey(todayKey: string, nowMs: number) {
    set((s) => {
      const lastFired = { ...s.engine.lastFired, 'learn-offer': { ts: nowMs, key: todayKey } }
      return {
        engine: { ...s.engine, lastFired },
        settings: { ...s.settings, nudgeLastFired: lastFired },
      }
    })
    persistSettings(get().settings)
  }

  function runLearnPass() {
    const s = get()
    if (!s.hydrated) return
    const todayKey = dayKey(new Date(s.nowMs))
    if (s.engine.lastFired['learn-offer']?.key === todayKey) return // one offer/day
    const covered = [
      ...confirmedRulesFrom(s.memory).map((r) => r.match),
      ...activePrefsFrom(s.memory, brainOn() ? brainPrefs : null).map((p) => p.match),
    ]
    const dismissed = dismissedMatchesFrom(s.memory)
    const candidate = detectTaskRules(s.memory, covered, dismissed).find(
      (c) => !s.chat.some((m) => m.nudgeType === 'learn-offer' && m.payload?.match === c.match)
    )
    if (!candidate) return
    post([learnOfferMsg(candidate)])
    burnLearnKey(todayKey, s.nowMs)
  }

  /* the fitting-slot offers for the WAITING items — pure fitOffers over the live
     week + local memory (keyless, the energyFit gear honored). One home for the
     surface's inline offers and the proactive pass below. */
  function computeInboxOffers(s: MewState): InboxOffer[] {
    const open = s.captures.filter((c) => c.status === 'open')
    if (!open.length) return []
    return fitOffers(open, s.blocks, s.memory, new Date(s.nowMs), {
      energyFit: s.settings.energyFit !== 'off',
    })
  }

  /* burn the once-per-day offer marker onto the item — "not now" and the
     proactive pass share it, so neither re-nags today. Persisted with the
     capture, so the dedupe survives a reload. */
  function markInboxOffered(itemId: string, todayKey: string) {
    let updated: Capture | undefined
    set((st) => ({
      captures: st.captures.map((c) => {
        if (c.id !== itemId) return c
        updated = { ...c, lastOfferedDay: todayKey }
        return updated
      }),
    }))
    if (updated) persistCaptures([updated])
  }

  /* ── the inbox placement offer (#348, gbrain OFFERS) ─────────────────
     Rides the tick like the learn offer: fitOffers is pure over the live week +
     local memory, and this surfaces ONE fitting slot as a single nudge the owner
     confirms. Gated so it offers-once-then-stays-quiet: at most one offer per
     item per day (lastOfferedDay burns only when an offer posts), never one
     already live in the log. gbrain NEVER auto-schedules — place/notnow resolve
     deterministically in nudgeAction. Silent with no waiting item, no fitting
     slot, or an item already covered today. */
  function runInboxOfferPass() {
    const s = get()
    if (!s.hydrated) return
    const todayKey = dayKey(new Date(s.nowMs))
    const offer = computeInboxOffers(s).find((o) => {
      const item = s.captures.find((c) => c.id === o.itemId)
      return (
        item != null &&
        item.lastOfferedDay !== todayKey &&
        !s.chat.some((m) => m.nudgeType === 'inbox-offer' && m.payload?.captureId === o.itemId)
      )
    })
    if (!offer) return
    const item = s.captures.find((c) => c.id === offer.itemId)
    if (!item) return
    post([inboxOfferMsg(item.title, offer, todayKey)])
    markInboxOffered(offer.itemId, todayKey)
  }

  /* ── the weekly-review offer (#346) ─────────────────────────────────
     The once-a-week invite to close the week kindly. Same ritual shape as the
     learn offer: the pure trigger + copy live in domain/nudges/review.ts, and
     the dedup key ('weekly-review') rides the persisted nudgeLastFired map keyed
     on the ISO weekKey — so it offers at most once per week and survives a
     restart, the weekly-ritual law. The invite OPENS the review; it never rolls
     anything (the owner selects inside). An empty week burns the key and stays
     silent — checked once, no theater (the sustenance pattern). */
  function reviewOfferMsg(review: WeeklyReview): ChatMessage {
    return {
      id: uid(),
      role: 'nudge',
      body: composeReviewOffer(review).body,
      ts: nowFn(),
      nudgeType: 'weekly-review',
      actions: [
        { id: 'open', label: 'show me', kind: 'primary' },
        { id: 'later', label: 'not now', kind: 'secondary' },
      ],
    }
  }

  function burnReviewKey(wk: string, nowMs: number) {
    set((s) => {
      const lastFired = { ...s.engine.lastFired, 'weekly-review': { ts: nowMs, key: wk } }
      return {
        engine: { ...s.engine, lastFired },
        settings: { ...s.settings, nudgeLastFired: lastFired },
      }
    })
    persistSettings(get().settings)
  }

  function runReviewOfferPass() {
    const s = get()
    if (!s.hydrated) return
    const now = new Date(s.nowMs)
    const wk = weekKey(now)
    if (s.engine.lastFired['weekly-review']?.key === wk) return // one offer per ISO week
    const dowMon0 = (fromDayKey(dayKey(now)).getDay() + 6) % 7
    if (!shouldOfferReview(dowMon0, minOfDay(now), s.settings.wrapMin)) return
    const prefs = activePrefsFrom(s.memory, brainOn() ? brainPrefs : null)
    const review = weeklyReview(s.blocks, s.memory, wk, prefs)
    burnReviewKey(wk, s.nowMs) // burn whether or not the week had anything — once per week either way
    if (review.empty) return // nothing to celebrate or carry: stay silent
    post([reviewOfferMsg(review)])
  }

  /* ── the week-scaffold offer (#349, the gbrain marquee at week scale) ─
     Offers ONCE per coming week to rough it out the owner's usual way — the
     "empty/new week" trigger. Same ritual shape as the review offer: the pure
     draft lives in domain/scaffold.ts (weekScaffold), the dedup key
     ('scaffold-week', keyed on the coming week's key) rides the persisted
     nudgeLastFired map so it survives a restart and never nags. It INVITES; the
     chip runs proposeScaffold, which posts a preview the owner accepts/tweaks —
     nothing commits from the offer. "Empty" ignores recurrences and synced
     events (a week that's only your standing shape is still unshaped); a week
     the owner has already planned is left alone, unburned. No learned shape yet
     ⇒ burn the key and stay silent (an honest nothing, the sustenance pattern). */
  function scaffoldOfferMsg(target: string): ChatMessage {
    return {
      id: uid(),
      role: 'nudge',
      body: 'want me to rough out next week the way your weeks usually go? nothing lands until you say so.',
      ts: nowFn(),
      nudgeType: 'scaffold-week',
      actions: [
        { id: 'draft', label: 'rough it out', kind: 'primary' },
        { id: 'later', label: 'not now', kind: 'secondary' },
      ],
      payload: { weekKey: target },
    }
  }

  function burnScaffoldKey(target: string, nowMs: number) {
    set((s) => {
      const lastFired = { ...s.engine.lastFired, 'scaffold-week': { ts: nowMs, key: target } }
      return {
        engine: { ...s.engine, lastFired },
        settings: { ...s.settings, nudgeLastFired: lastFired },
      }
    })
    persistSettings(get().settings)
  }

  function runScaffoldOfferPass() {
    const s = get()
    if (!s.hydrated) return
    const now = new Date(s.nowMs)
    const target = weekKey(new Date(s.nowMs + 7 * 24 * 60 * 60 * 1000)) // the coming week
    if (s.engine.lastFired['scaffold-week']?.key === target) return // one offer per coming week
    /* an owner-planned week is already shaped — leave it, and DON'T burn: if they
       clear it later, the empty week can still be offered. Recurrences and synced
       events don't count as "planned" (a week that's only your standing shape is
       a blank canvas for the week's real work). */
    const targetDays = new Set(weekKeys(now, 1))
    const ownerPlanned = s.blocks.some(
      (b) => targetDays.has(b.dayKey) && b.status === 'open' && !b.external && !b.recurringBlockId
    )
    if (ownerPlanned) return
    /* no learned shape yet ⇒ an honest silence, and the key stays UNBURNED so a
       rhythm learned later this same week can still earn the one offer (the
       learn-offer pattern: the key burns only when an offer actually posts). */
    if (!weekScaffold(s.memory, s.blocks, target, now).length) return
    post([scaffoldOfferMsg(target)])
    burnScaffoldKey(target, s.nowMs)
  }

  function runTickEngine(opts?: { skipLearn?: boolean }) {
    runSustenancePass()
    /* the learn offer waits for a regular tick — the boot tick belongs to the
       morning brief (#285); a gentle offer never front-loads the launch. */
    if (!opts?.skipLearn) runLearnPass()
    /* the weekly-review offer rides the same tick, once per ISO week (#346) */
    runReviewOfferPass()
    /* the week-scaffold offer rides the same tick, once per coming week (#349) */
    runScaffoldOfferPass()
    /* the inbox placement offer rides the same tick — a fitting slot for a
       waiting item, once per item per day; skipped on the boot tick like the
       learn offer, so a gentle offer never front-loads the launch (#348) */
    if (!opts?.skipLearn) runInboxOfferPass()
    const s = get()
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    const nowMin = minOfDay(now)
    const agg = aggregates(s.memory, now)
    const guardActive = s.guardDayKey === todayKey ? s.guardUntilMin : null
    primeBrainLinks(s, todayKey, nowMin, now)
    primeWeekColor(todayKey, now)
    primePersonRecall(s, todayKey, nowMin)
    const ctx = buildCtx(
      {
        nowMs: s.nowMs,
        nowMin,
        todayKey,
        blocks: s.blocks,
        agg,
        events: s.memory,
        captures: s.captures,
        idleMin: (s.nowMs - s.lastActivityMs) / 60000,
        interruptionsLastHour: interruptionsLastHour(s.memory, s.nowMs),
        guardUntilMin: guardActive,
        quietStartMin: s.settings.quietHours.startMin,
        briefMin: s.settings.briefMin,
        wrapMin: s.settings.wrapMin,
        weeklyRitualMin: s.settings.weeklyRitualMin,
        prefs: activePrefsFrom(s.memory, brainOn() ? brainPrefs : null),
        brainLinks: brainOn() ? brainLinks?.pairs : undefined,
        brainWeekLines: weekColor?.day === todayKey ? weekColor.lines : undefined,
        personRecall,
      },
      s.engine
    )
    const fired = evaluateTick(ctx)
    for (const n of fired) {
      markFired(n, s.nowMs)
      const msg = nudgeMsg(n)
      if (inQuietHours(nowMin, s.settings.quietHours)) {
        set((st) => ({ queuedNudges: [...st.queuedNudges, msg] }))
      } else {
        post([msg], { mirror: s.settings.browserMirror })
      }
      /* the day's story is durable knowledge, not just chat — when a brain
         is connected it lands on the day page for week-in-review to read.
         The same once-an-evening moment runs the condensation pass: old chat
         distills into digests and prunes (#250 phase 2, brain-gated). */
      if (n.type === 'debrief' && brainOn()) {
        void brain.ingest(debriefPage(n.body, todayKey))
        void condenseOldChat()
      }
    }
  }

  function fireEventNudges(event: {
    justCompleted?: Block
    newCapture?: Capture
    justCleared?: { scope: string; count: number }
  }) {
    const s = get()
    const now = new Date(s.nowMs)
    const ctx = buildCtx(
      {
        nowMs: s.nowMs,
        nowMin: minOfDay(now),
        todayKey: dayKey(now),
        blocks: s.blocks,
        agg: aggregates(s.memory, now),
        events: s.memory,
        captures: s.captures,
        idleMin: 0,
        interruptionsLastHour: 0,
        guardUntilMin: null,
      },
      s.engine,
      event
    )
    for (const n of evaluateEvent(ctx)) {
      /* a chat completion celebrates in the model's own reply — posting the
         celebrate line too would say the same thing twice in a row */
      if (n.type === 'celebrate' && chatCompletion) continue
      markFired(n, s.nowMs)
      /* mid-turn (#115): park the nudge so it lands after the reply, not spliced
         into the stream. The flush in speak's finally drains the queue. */
      if (turnInFlight) {
        pendingNudgeQueue.push(n)
        continue
      }
      // event nudges answer the user's own action — straight to chat, no mirror.
      // celebrations are brief and concrete (voice law): a plain line, not a card.
      post([eventNudgeMsg(n)])
    }
  }

  /* event nudges answer the user's own action — celebrations are a brief plain
     line (voice law), every other nudge a card. One place so the immediate path
     and the deferred flush (#115) phrase them identically. */
  function eventNudgeMsg(n: NudgeInstance): ChatMessage {
    return n.type === 'celebrate' ? mewMsg(n.body) : nudgeMsg(n)
  }

  /* drain parked nudges once the turn is done (#115): coalesce exact dupes so a
     multi-action plan that re-triggers the same nudge speaks it once, then post
     in order. Idempotent and safe on the error path — an empty queue is a no-op. */
  function flushPendingNudges() {
    if (pendingNudgeQueue.length) {
      const drained = pendingNudgeQueue
      pendingNudgeQueue = []
      post(coalesceNudges(drained).map(eventNudgeMsg))
    }
    /* the day-load guard's parked chips (#301) ride the same beat — after the
       reply, after the nudges, so the meter reads as reflection on the turn.
       Already deduped at build time (the burned key), so a multi-plan turn
       parks each over day exactly once. */
    if (pendingDayLoadMsgs.length) {
      const msgs = pendingDayLoadMsgs
      pendingDayLoadMsgs = []
      post(msgs)
    }
    /* the estimate offer's parked chips (#322) ride the same beat, last — the
       day-load meter has already yielded to it (or vice versa), so at most one
       guard voice reaches this point for a given placement */
    if (pendingEstimateMsgs.length) {
      const msgs = pendingEstimateMsgs
      pendingEstimateMsgs = []
      post(msgs)
    }
  }

  function setBlocks(blocks: Block[]) {
    /* refresh the clock with the mutation so liveNow, the now-line, and the
       dial reflect the change this frame instead of waiting for the next tick */
    set({ blocks, nowMs: nowFn() })
    persistBlocks(blocks)
  }

  /* ── the tool executor — the only path from a model to the week ─────
     Each function mutates the live week and returns a short factual line.
     Whatever model is talking, these strings are the ground truth it must
     confirm from (and the rules/Ollama composers use them verbatim). */

  /* per-kind duration medians, recomputed only when memory actually changed
     (array identity flips on every write) — cheap, and always tick-fresh */
  let histCache: { mem: unknown; map: Map<string, TaskDuration> } | null = null
  function histDurations(s: MewState): Map<string, TaskDuration> {
    if (histCache?.mem !== s.memory) {
      histCache = { mem: s.memory, map: taskDurations(s.memory, s.nowMs) }
    }
    return histCache.map
  }

  /* The confirmed task rules the resolver applies (gbrain Pillar 2, #328).
     Pillar 1 (#327, the learn side) forms these from repetition and the learn
     pass below confirms them into the append-only memory; this reads them back
     — the always-on floor, pure over local memory so keyless is identical. No
     confirmed rule ⇒ [], so resolveTaskSpec stays byte-identical to before. */
  function learnedRules(s: MewState): LearnedRule[] {
    return confirmedRulesFrom(s.memory)
  }

  function execPlan(places: PlaceSpec[], frees: FreeSpec[]): string {
    const s = get()
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    let blocks = s.blocks
    const lines: string[] = []
    const mealNotes: string[] = [] // #323: one aside per meal the guardrail moved or named
    let placedDeep: Block | null = null
    const touchedDays = new Set<string>() // days a rest-pacing pass should re-check (#103)
    /* #322: blocks this run newly PLACED without a stated duration, by focus
       class — the estimate offer's candidate set (moves keep their length, so
       they're never in here; a stated duration is the "stated word wins" veto) */
    const placedForEstimate: { id: string; focusClass: FocusClass }[] = []
    const trackForEstimate = (b: Block, stated: boolean | undefined) => {
      if (stated) return
      const fc = focusClassOfTask({ tag: b.tag, durationMin: week.duration(b) })
      if (fc) placedForEstimate.push({ id: b.id, focusClass: fc })
    }
    const targetedIds: string[] = [] // #320: the user's own blocks this run placed/moved

    const prefs = activePrefsFrom(s.memory, brainOn() ? brainPrefs : null)
    const hist = histDurations(s)
    const learned = learnedRules(s) // #328: confirmed rules, once #327 lands
    const bufferMin = s.settings.meetingBufferMin ?? 0 // #302

    /* #324: a WORK block landing on the user's own flexible blocks drifts them
       clear in this same pass and names what moved (external/fixed stay put, an
       honest note); every other placement keeps the place-then-offer note
       (#102). `blocks` must already hold `landed`. Mutates blocks + touchedDays. */
    const collisionNote = (landed: Block, key: string): string => {
      if (landed.tag === 'work' && !week.isBackground(landed)) {
        const d = driftReply(blocks, landed, todayKey, minOfDay(now), prefs)
        blocks = d.blocks
        for (const id of d.driftedIds) {
          const b = blocks.find((x) => x.id === id)
          if (b && b.tag === 'work' && !week.isBackground(b)) touchedDays.add(b.dayKey)
        }
        return d.note
      }
      const clash = week.isBackground(landed)
        ? []
        : week.conflictsWith(blocks, key, landed.startMin, landed.endMin, landed.id, prefs)
      return clashNote(clash, prefs)
    }
    for (const p of places) {
      const key = addDaysKey(todayKey, p.dayOffset)
      /* deterministic apply (#328): one resolver fills every field the user left
         open this message — their explicit words this turn always win over any
         confirmed rule or history. Seeded with everything a place may leave
         open so a confirmed rule can fill duration, tag, window, attention,
         protected, or recurrence; every branch below reads the filled spec. */
      const {
        spec: prefd,
        applied,
        usual,
        credit,
      } = resolveTaskSpec(
        p.title,
        {
          startMin: p.startMin,
          durationMin: p.durationMin,
          tag: p.tag,
          attention: p.attention,
          protected: p.protected,
          rrule: p.rrule,
        },
        prefs,
        hist,
        learned
      )
      const tag = prefd.tag ?? p.tag
      /* recurring block (#159): a rule expands into one block per occurrence,
         all linked by a shared recurringBlockId, before any one-off logic. The
         expansion reuses the same bounded DAILY/WEEKLY walk (and 800-cap) the
         ICS importer uses, but in day-keys; each occurrence keeps the anchor's
         wall-clock start. Window = anchor day → +52 weeks (UNTIL/COUNT cut it
         shorter). Recurrence is MEW's: these land as ordinary dated blocks, so
         the calendar push projects each one individually and never sees an
         RRULE (sync.ts has no rrule field by design). A confirmed rule may
         supply the recurrence itself (#328), routed here like an explicit one. */
      if (prefd.rrule) {
        const anchorStart = prefd.startMin ?? week.DAY_START
        const durationMin = prefd.durationMin ?? 60
        const windowEnd = addDaysKey(key, RRULE_DEFAULT_WEEKS * 7)
        const occs = expandRrule(prefd.rrule, key, anchorStart, durationMin, key, windowEnd)
        if (!occs.length) {
          lines.push(`couldn't place "${p.title}" — that recurrence has no dates in the next year`)
          continue
        }
        const seriesId = uid()
        const microRest = tag === 'rest' && durationMin <= 20
        for (const occ of occs) {
          const made = week.place(blocks, {
            title: p.title,
            tag,
            dayKey: occ.dayKey,
            startMin: occ.startMin,
            endMin: occ.endMin,
            protected: prefd.protected ?? !microRest,
            attention: prefd.attention,
            due: p.due,
            recurringBlockId: seriesId,
            rrule: prefd.rrule,
          })
          if (!made) continue // that day is full — skip just this occurrence, keep the series
          blocks = [...blocks, made]
          targetedIds.push(made.id) // a series is many blocks → no single referent (#320)
          if (made.tag === 'work' && !week.isBackground(made)) touchedDays.add(occ.dayKey)
          if (!week.isBackground(made)) trackForEstimate(made, p.durationStated) // #322
        }
        const placedCount = blocks.filter((b) => b.recurringBlockId === seriesId).length
        if (!placedCount) {
          lines.push(`couldn't place "${p.title}" — every day in that recurrence is already full`)
          continue
        }
        const cadence = describeRrule(prefd.rrule, key)
        const through = occs[occs.length - 1].dayKey
        lines.push(
          `${p.title} repeats ${cadence} ${fmtTime(anchorStart)}–${fmtTime(anchorStart + durationMin)} — ${placedCount} block${placedCount === 1 ? '' : 's'} through ${fmtShortDate(through)}${credit ? ` — ${credit}` : applied.length ? ' (your standing rule)' : ''}`
        )
        continue
      }
      /* short rests are pacing, not sacred rest: leave them unprotected so a
         reshape can absorb them instead of tripping protect-rest every move */
      const microRest = tag === 'rest' && (prefd.durationMin ?? 60) <= 20
      const bg = prefd.attention === 'background'
      /* a background block doesn't contend for the slot, so auto-placement
         doesn't hunt for free air — it starts now-ish (today) or at day
         start, and runs over whatever else holds the clock. A standing rule
         outranks this heuristic the same way an explicit time does. */
      const bgAutoStart =
        bg && prefd.startMin == null
          ? key === todayKey
            ? Math.max(week.DAY_START, Math.ceil(minOfDay(now) / 5) * 5)
            : week.DAY_START
          : prefd.startMin
      /* de-dup (#89): re-planning a block that already lives in the target day
         is a MOVE, not a twin. Match on the EXACT base title (before any "—"
         qualifier), not a fuzzy/substring tier — so "lunch" never collapses the
         distinct "order lunch" errand. Generic pacing rests repeat freely
         (exempt), and a background hold doesn't contend for a slot. */
      const reBase = p.title.split('—')[0].trim().toLowerCase()
      const existing =
        !bg && p.tag !== 'rest'
          ? blocks.find(
              (b) =>
                b.dayKey === key &&
                b.status === 'open' &&
                !week.isBackground(b) &&
                !b.external &&
                b.title.split('—')[0].trim().toLowerCase() === reBase
            )
          : undefined
      /* the deterministic floor: with no explicit/ruled time (and not a
         background hold), the scoring oracle (#80) picks the slot —
         conflict-free by construction and rest-aware — so even a model that
         skips suggest_slots can't stack work into a busy gap. */
      let start = bgAutoStart
      if (start == null && !bg) {
        const occupied = existing ? blocks.filter((b) => b.id !== existing.id) : blocks
        const q: SlotQuery = {
          title: p.title,
          tag,
          durationMin: prefd.durationMin ?? 60,
          ...(p.due != null ? { due: p.due } : {}),
          /* #328: a confirmed window is FIRM here — the scorer collapses
             off-window, so "deck → mornings" lands in the morning. No confirmed
             window ⇒ unset ⇒ today's soft tag-default scoring, byte-identical. */
          ...(prefd.window != null ? { window: prefd.window, windowFirm: prefd.windowFirm } : {}),
        }
        const best = scoreSlots(
          occupied,
          q,
          todayKey,
          minOfDay(now),
          prefs,
          undefined, // weights: the default profile
          undefined, // horizonDays: the default week
          undefined, // mealBase: the circadian default (#298)
          bufferMin // #302: keep MEW's placements shy of external meetings
        ).find((c) => c.dayKey === key)
        if (best) start = best.startMin
      }
      /* #323 the meal guardrail: the circadian window + inter-meal gap engage
         through the SCORER above, so an EXPLICIT meal time (a plan_blocks
         reshape, never the auto floor) bypasses them and the model's own meal
         arithmetic lands uncorrected. Check any meal-classified block placed
         at a model-derived time and pull it to the nearest sane slot; a time
         in the USER's own words (startStated) is kept, named once. Pure
         domain, so keyed and keyless behave identically. */
      if (start != null && !bg && p.startMin != null && mealClassOf(p.title)) {
        const occupied = existing ? blocks.filter((b) => b.id !== existing.id) : blocks
        const durationMin = existing
          ? existing.endMin - existing.startMin
          : (prefd.durationMin ?? 60)
        const fix = correctMeal(
          occupied,
          key,
          todayKey,
          minOfDay(now),
          { title: p.title, tag, startMin: start, durationMin, stated: p.startStated === true },
          prefs
        )
        if (fix.kind === 'shift') {
          start = fix.startMin
          mealNotes.push(fix.reason)
        } else if (fix.kind === 'warn') {
          mealNotes.push(fix.reason)
        }
      }
      if (existing) {
        const landStart = start ?? existing.startMin
        blocks = week.move(blocks, existing.id, key, landStart)
        const moved = blocks.find((b) => b.id === existing.id)!
        targetedIds.push(moved.id) // #320
        if (week.isDeep(moved)) placedDeep = moved
        if (moved.tag === 'work' && !week.isBackground(moved)) touchedDays.add(key)
        const clashPart = collisionNote(moved, key)
        lines.push(
          `moved ${p.title.split('—')[0].trim()} to ${key === todayKey ? 'today' : fmtDowLong(key)} ${fmtTime(moved.startMin)}–${fmtTime(moved.endMin)}${clashPart}`
        )
        continue
      }
      const placed = week.place(blocks, {
        title: p.title,
        tag,
        dayKey: key,
        startMin: start,
        durationMin: prefd.durationMin,
        protected: prefd.protected ?? !microRest,
        attention: prefd.attention,
        due: p.due,
      })
      if (!placed) {
        lines.push(`${fmtDowLong(key)} couldn't hold "${p.title}" — the day is full`)
        continue
      }
      blocks = [...blocks, placed]
      targetedIds.push(placed.id) // #320
      if (week.isDeep(placed)) placedDeep = placed
      if (placed.tag === 'work' && !week.isBackground(placed)) touchedDays.add(key)
      if (!week.isBackground(placed)) trackForEstimate(placed, p.durationStated) // #322
      /* background holds the clock, not the slot — placing one over a meeting
         (or vice versa) is the point, never a collision to warn about; a work
         placement over own flexible blocks drifts them clear (#324) */
      const clashPart = collisionNote(placed, key)
      lines.push(
        `${key === todayKey ? 'today' : fmtDowLong(key)} ${fmtTime(placed.startMin)}–${fmtTime(placed.endMin)} is held for ${p.title}${week.isBackground(placed) ? ' (running in the background)' : ''}${credit ? ` — ${credit}` : applied.length ? ' (your standing rule)' : usual ? ' (your usual)' : ''}${placed.due != null ? ` · due ${fmtTime(placed.due)}` : ''}${clashPart}`
      )
    }
    for (const f of frees) {
      const key = addDaysKey(todayKey, f.dayOffset)
      const guard: Block = {
        id: uid(),
        title: 'Kept free',
        tag: 'rest',
        dayKey: key,
        startMin: f.startMin,
        endMin: f.endMin,
        protected: true,
        status: 'open',
        calendarRefs: [],
        estimateSource: 'user',
      }
      blocks = [...blocks, guard]
      lines.push(`${fmtDowLong(key)} ${f.startMin === 13 * 60 ? 'afternoon ' : ''}kept free`)
    }
    if (!lines.length) return 'nothing was placed'

    /* pacing rest (#103): a long unbroken work run earns one short breather.
       The pass is pure and idempotent — it returns at most one rest per day
       and nothing once one sits inside the run, so re-running a reshape never
       stacks rests. A free seam gets an UNPROTECTED micro-rest (≤20m, the same
       absorbable pacing rest a reshape can dissolve); a wall-to-wall run that
       would need a committed block displaced is only OFFERED, never seized. */
    const restNotes: string[] = []
    for (const key of touchedDays) {
      const r = restInsertion(blocks, key)
      if (!r) continue
      const when = key === todayKey ? 'today' : fmtDowLong(key)
      if (r.kind === 'place') {
        const rest = week.place(blocks, {
          title: 'Breather',
          tag: 'rest',
          dayKey: key,
          startMin: r.startMin,
          endMin: r.endMin,
          protected: false,
        })
        if (rest) {
          blocks = [...blocks, rest]
          restNotes.push(
            `tucked a ${rest.endMin - rest.startMin}-min breather into ${when} at ${fmtTime(rest.startMin)}`
          )
        }
      } else {
        restNotes.push(
          `${when} runs ${fmtTime(r.startMin)}–${fmtTime(r.endMin)} unbroken — want me to make room for a short breather?`
        )
      }
    }
    setBlocks(blocks)

    /* referent (#320): a single-block plan is the one unambiguous "it" — set it.
       A multi-block plan or a kept-free window is ambiguous by construction, so
       clear rather than let "it" point at a stale block. */
    if (targetedIds.length === 1 && !frees.length) noteReferentId(targetedIds[0])
    else clearReferent()

    /* the day-load meter (#301): every day this run placed work on gets one
       look against the demonstrated line — the guard posts (or parks) its own
       chips message and burns the per-day key */
    const guarded = offerDayLoadGuard(touchedDays, todayKey)

    /* the estimate offer (#322, ask mode): runs AFTER the meter and yields to it
       — `guarded` non-empty means the meter already spoke for this placement, so
       the offer stays silent (one guard voice per placement). Chat-only; never
       touches the blocks this run placed, so off/always stay byte-identical. */
    offerEstimateGuard(placedForEstimate, guarded, todayKey)

    /* one contextual observation, from the user's own numbers */
    let observation = ''
    if (placedDeep) {
      const agg = aggregates(get().memory, now)
      const weekStart = addDaysKey(todayKey, -((now.getDay() + 6) % 7))
      const deepCount = get().blocks.filter(
        (b) =>
          b.dayKey >= weekStart &&
          b.dayKey <= addDaysKey(weekStart, 6) &&
          week.isDeep(b) &&
          b.status !== 'rolled'
      ).length
      observation = ` That's your ${ordinal(deepCount)} deep-work block this week.`
      /* the meter speaking for this day makes the right-size aside a second
         voice in the same turn — the chips carry the offer, the count stands */
      if (agg.realisticBestH != null && !guarded.has(placedDeep.dayKey)) {
        const planned = week.plannedDeepMin(get().blocks, placedDeep.dayKey) / 60
        if (planned > agg.realisticBestH * 1.2) {
          observation = ` ${fmtDowLong(placedDeep.dayKey)} now holds ${Math.round(planned * 2) / 2}h of deep work — your best is ~${agg.realisticBestH}. I can right-size it if you want.`
        }
      }
    }
    let pacing = ''
    if (restNotes.length) {
      const joined = joinHuman(restNotes)
      pacing = ` ${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`
    }
    /* #323: the meal guardrail's asides — a moved or kept meal named once, in
       the same positive voice as the pacing note above */
    let mealAside = ''
    if (mealNotes.length) {
      const joined = joinHuman(mealNotes)
      mealAside = ` ${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`
    }
    return `Done — ${joinHuman(lines)}.${observation}${pacing}${mealAside}`
  }

  /* completions through CHAT celebrate in the reply itself — the celebrate
     nudge stays quiet so one mew speaks once (UI clicks still get the nudge) */
  let chatCompletion = false

  /* a nudge is reflection, not an interrupt (#115): while a turn is in flight
     the executors' nudges park here instead of splicing into the live stream;
     speak's finally flushes them once the reply is done. turnInFlight (not
     `thinking`) is the gate — thinking flips false on the first streamed token,
     but the turn keeps mutating after that, so an executor firing post-stream
     must still defer. Idle ticks/timers leave it false and post at once. */
  let turnInFlight = false
  /* the live turn's cancel handle (#117): speak owns it for the turn, the
     composer's stopSpeaking() aborts it. The adapter wires .signal into its
     stream/fetch, so an abort ends the turn within a beat. Cleared in speak's
     finally — a stale controller must never abort the next turn. */
  let turnAbort: AbortController | null = null
  let pendingNudgeQueue: NudgeInstance[] = []

  /* undo an AI action (#162): the snapshot of the mutable week taken just
     BEFORE the turn's most recent mutating tool ran — undo_last_action restores
     it. speak resets it to null at entry (a new exchange starts fresh); each
     mutating exec calls snapshotForUndo() before it runs, so this always holds
     "the week as it was before the last change". Shallow arrays are a true
     point-in-time copy here: every mutation replaces element objects (week.*
     return new arrays, set/logMemory spread), never edits one in place — the
     same immutability the rest of the store leans on. Chat is deliberately NOT
     snapshotted: the reply about the undone action stays as context (the spec's
     "undo does not touch chat history"). */
  let preMutationSnapshot: {
    blocks: Block[]
    captures: Capture[]
    memory: MewState['memory']
  } | null = null
  /* a scenario pick applies OUTSIDE any turn (#293) — the user's very next
     message ("undo that") must still reach it, so this flag carries the pick's
     snapshot across exactly one speak() entry instead of the usual fresh-
     exchange reset. One turn only: the moment that next turn runs (mutating or
     not), the ordinary #162 lifecycle owns the snapshot again. */
  let pickSnapshotHolds = false
  function snapshotForUndo() {
    const s = get()
    preMutationSnapshot = { blocks: s.blocks, captures: s.captures, memory: s.memory }
  }

  /* ── conversational referents (#320) ────────────────────────────────────
     The session's last-touched (or last-tapped) block, so a follow-up that
     names nothing — "move it", "make that 45", "the one after lunch" — lands on
     the right block on EVERY path, keyless included. The executors set it when
     they touch one specific block; resolveTarget turns a parse.ts sentinel into
     a concrete target through the one shared resolver. */
  function noteReferentId(id: string) {
    set({ lastReferent: { blockId: id, ts: nowFn() } })
  }
  function clearReferent() {
    if (get().lastReferent) set({ lastReferent: null })
  }

  /** Resolve a tool query that MAY be a referent sentinel (#320) to a concrete
      block. A plain title returns { passthrough } so each executor keeps its
      own findByQuery + miss copy, unchanged. A sentinel resolves against the
      live week + the session referent (week.resolveReferent — the SAME resolver
      a keyed turn would reach, so no path drifts): a hit returns the block;
      absent/ambiguous returns a kind, positive-voice clarifier the caller hands
      straight back — never a wrong-block mutation. op:'move' carries the
      external law: a vague referent landing on a calendar event refuses to move
      it (an explicitly named move still takes ownership — "it" must not). */
  function resolveTarget(
    query: string,
    op: 'move' | 'edit' | 'complete' | 'remove'
  ): { passthrough: true } | { block: Block } | { reply: string } {
    if (!query.startsWith('@')) return { passthrough: true }
    const s = get()
    const todayKey = dayKey(new Date(s.nowMs))
    const r = week.resolveReferent(
      s.blocks,
      query,
      s.lastReferent?.blockId ?? null,
      todayKey,
      minOfDay(new Date(s.nowMs))
    )
    if (r.status === 'ok') {
      if (op === 'move' && r.block.external)
        return {
          reply: `${r.block.title.split('—')[0].trim()} came in from a connected calendar — it's not mine to move. Open it there, or name a block of your own to shift.`,
        }
      return { block: r.block }
    }
    if (r.status === 'ambiguous') {
      const when = (b: Block) =>
        `${b.title.split('—')[0].trim()}${b.dayKey === todayKey ? '' : ` ${fmtDowLong(b.dayKey)}`} at ${fmtTime(b.startMin)}`
      const list = r.candidates.map(when)
      const tail =
        list.length === 2
          ? `${list[0]} or ${list[1]}`
          : `${list.slice(0, -1).join(', ')}, or ${list[list.length - 1]}`
      return {
        reply: `A couple could be the one — ${tail}? Name which and I'll take it from there.`,
      }
    }
    return {
      reply:
        query === '@referent'
          ? `Which block do you mean? Tap it, or name it, and I'll take it from there.`
          : `I can't tell which block that points to — tap the one you mean, or name it.`,
    }
  }

  /* ── precise name+time targeting + done-block confirm (#334) ─────────────
     findTarget addresses ONE block by name AND (optional) start time; an
     ambiguous bare name surfaces as offer_choices chips rather than a silent
     wrong pick (the transcript's rename hit 21:30 instead of 19:45). A DONE
     block is not walled off from an EXPLICIT named delete — the mew guard lifts
     for single-target intent — but deleting a mew is consequential, so it goes
     through a one-tap confirm (chat chips or the block card, one shared path):
     the confirm deletes the block AND its completion event cleanly (never
     un-completes), and it is undoable. clear_blocks stays the silent-collateral
     guard: it never sweeps a mew, only surfaces the ones it kept as selectable. */

  /** A query's human base title — em-dash detail and a leading article dropped. */
  function baseOf(text: string): string {
    return (
      text
        .split('—')[0]
        .replace(/^\s*(the|my|a|an)\s+/i, '')
        .trim() || text.trim()
    )
  }

  /** Resolve a plain-title target precisely (#334): the `at` clock string pins
      name AND time. `ok` → the block; `ambiguous` → post name+time chips (each a
      time-pinned re-issue of the SAME op) and return CHOICES_POSTED; `none` → a
      kind miss line the caller returns. Referent sentinels are handled upstream
      by resolveTarget; this owns the plain-title path the executors shared. */
  function resolvePrecise(
    query: string,
    op: 'complete' | 'move' | 'edit' | 'duplicate',
    at: string | undefined,
    includeDone: boolean,
    reissue: (b: Block) => string
  ): { block: Block } | { reply: string } {
    const s = get()
    const todayKey = dayKey(new Date(s.nowMs))
    const atMin = at ? parseTimeValue(at) : null
    const r = week.findTarget(s.blocks, query, todayKey, { at: atMin, includeDone })
    if (r.status === 'ok') return { block: r.block }
    if (r.status === 'ambiguous') {
      const base = baseOf(query)
      const times = r.candidates.map((b) => fmtTime(b.startMin))
      const tail =
        times.length === 2
          ? `${times[0]} or ${times[1]}`
          : `${times.slice(0, -1).join(', ')}, or ${times[times.length - 1]}`
      return {
        reply: execOfferChoices(
          `${spell(r.candidates.length)} "${base}" blocks — ${tail}? Which one?`,
          r.candidates.slice(0, 5).map((b) => ({
            label: `the ${fmtTime(b.startMin)}${b.dayKey === todayKey ? '' : ` (${fmtDowLong(b.dayKey)})`}`,
            reply: reissue(b),
          }))
        ),
      }
    }
    const verb =
      op === 'complete'
        ? 'in the week'
        : op === 'move'
          ? 'to move'
          : op === 'duplicate'
            ? 'to duplicate'
            : 'to change'
    return {
      reply: `I couldn't find "${query}"${at ? ` at ${at}` : ''} ${verb} — say it another way?`,
    }
  }

  /** Propose deleting done block(s) an explicit ask named — a one-tap confirm,
      never a refusal (#334 refinement). One done block → remove-it / keep-it;
      several → a selectable list (each time, plus all / keep). The tap runs
      through nudgeAction → removeBlocksConfirmed (the block-card's path too), so
      the confirm is deterministic and shares one door. Returns CHOICES_POSTED:
      the ask is on screen, the model ends its turn, the keyless floor stays
      quiet — the tap does the rest. */
  function proposeDoneRemoval(base: string, dones: Block[], todayKey: string): string {
    const ids = dones.map((b) => b.id).join(',')
    const span = (b: Block) =>
      `${fmtTime(b.startMin)}–${fmtTime(b.endMin)}${b.dayKey === todayKey ? '' : ` ${fmtDowLong(b.dayKey)}`}`
    if (dones.length === 1) {
      const b = dones[0]
      post([
        {
          id: uid(),
          role: 'nudge',
          body: `that ${baseOf(b.title)} block (${span(b)}) is a mew — it's done. Remove it anyway? That deletes the block and its completion, and it's undoable.`,
          ts: nowFn(),
          nudgeType: 'remove-done',
          actions: [
            { id: `rm-done:${b.id}`, label: 'remove it', kind: 'primary' },
            { id: 'keep-done', label: 'keep it', kind: 'secondary' },
          ],
          payload: { doneIds: ids },
        },
      ])
    } else {
      const actions: NudgeAction[] = dones.slice(0, 4).map((b) => ({
        id: `rm-done:${b.id}`,
        label: `the ${fmtTime(b.startMin)}`,
        kind: 'secondary',
      }))
      actions.push({ id: 'rm-done:all', label: 'all of them', kind: 'primary' })
      actions.push({ id: 'keep-done', label: 'keep them', kind: 'secondary' })
      post([
        {
          id: uid(),
          role: 'nudge',
          body: `${spell(dones.length)} "${base}" blocks are done (mews) — which to remove? Removing one deletes the block and its completion (undoable).`,
          ts: nowFn(),
          nudgeType: 'remove-done',
          actions,
          payload: { doneIds: ids },
        },
      ])
    }
    return `${CHOICES_POSTED}: a done-block removal confirm is on screen. Say nothing more and END your turn — the tap does the rest.`
  }

  /** Delete blocks the user explicitly confirmed removing (chat chip or block
      card, one path) — including DONE ones, whose completion event is dropped
      too so history stays honest and mews-today (derived) recounts. Snapshots
      for undo and holds it across the next typed turn (the pickScenario pattern),
      so "undo that" restores the block AND its mew. Runs outside a chat turn. */
  function removeBlocksConfirmed(ids: string[]): void {
    const s = get()
    const targets = s.blocks.filter((b) => ids.includes(b.id))
    if (!targets.length) return
    snapshotForUndo()
    pickSnapshotHolds = true // survive the next turn's fresh-exchange reset, so "undo that" reaches it
    const todayKey = dayKey(new Date(s.nowMs))
    /* drop each removed DONE block's completion event — one per block, matched
       the way toggleComplete's un-complete does (dayKey + planned length), each
       used once so several same-shaped mews don't collapse to one drop */
    const usedEv = new Set<string>()
    const dropEv = new Set<string>()
    for (const b of targets.filter((x) => x.status === 'done')) {
      const ev = [...s.memory]
        .reverse()
        .find(
          (e) =>
            e.kind === 'completed' &&
            e.dayKey === b.dayKey &&
            e.plannedMin === week.duration(b) &&
            !usedEv.has(e.id)
        )
      if (ev) {
        usedEv.add(ev.id)
        dropEv.add(ev.id)
      }
    }
    const keep = new Set(ids)
    const kept = s.blocks.filter((b) => !keep.has(b.id))
    set({
      blocks: kept,
      memory: dropEv.size ? s.memory.filter((e) => !dropEv.has(e.id)) : s.memory,
      nowMs: nowFn(),
    })
    persistBlocks(kept)
    storage.deleteBlocks(ids).catch(() => {})
    if (dropEv.size) persistDeleteMemory([...dropEv])
    dismissExternal(targets) // an external we deleted stays gone across a re-sync
    if (targets.some((b) => b.id === get().lastReferent?.blockId)) clearReferent()
    const names = targets
      .map(
        (b) =>
          `${baseOf(b.title)} (${b.dayKey === todayKey ? 'today' : fmtDowLong(b.dayKey)} ${fmtTime(b.startMin)})`
      )
      .join(', ')
    post([mewMsg(`Removed — ${names}. Its mew is off the count; say "undo that" and it's back.`)])
  }

  function execComplete(query: string, at?: string): string {
    const s = get()
    const todayKey = dayKey(new Date(s.nowMs))
    const res = resolveTarget(query, 'complete')
    if ('reply' in res) return res.reply
    let target: Block | undefined
    if ('block' in res) target = res.block
    else {
      const r = resolvePrecise(
        query,
        'complete',
        at,
        true,
        (b) => `done with ${baseOf(query)} at ${fmtTime(b.startMin)}`
      )
      if ('reply' in r) return r.reply
      target = r.block
    }
    if (!target) return `I couldn't find "${query}" in the week — say it another way?`
    noteReferentId(target.id) // the turn touched one block — "it" now points here
    const base = target.title.split('—')[0].trim()
    if (target.status === 'done') return `${base} was already done — it counted.`
    chatCompletion = true
    try {
      get().toggleComplete(target.id)
    } finally {
      chatCompletion = false
    }
    const after = get()
    const live = liveNow(after.blocks, todayKey, minOfDay(new Date(after.nowMs)))
    const tail =
      live.openToday === 0
        ? ' The day is clear — rest is earned.'
        : live.openToday === 1
          ? ' One to go.'
          : ''
    return `Marked ${base} done — that's a mew, ${spell(live.mewsToday)} today.${tail}`
  }

  function execMove(
    query: string,
    toDayOffset?: number,
    toStartMin?: number,
    /* #320: a relative start shift ("30 min earlier" = −30) — the referent's
       CURRENT start + delta, on the same day, clamped inside the day. Read here
       (not in parse.ts, which is pure) because only the live block knows its
       current start; today move needs an absolute target, so the math lives at
       resolution. */
    relStartMin?: number,
    /* #334: the TARGET block's current start time, pinning which of several
       same-named blocks to move — distinct from toStartMin (its new start). */
    at?: string
  ): string {
    const s = get()
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    const res = resolveTarget(query, 'move')
    if ('reply' in res) return res.reply
    let target: Block | undefined
    if ('block' in res) target = res.block
    else {
      const dest =
        toStartMin != null
          ? `to ${fmtTime(toStartMin)}`
          : toDayOffset != null
            ? `to ${toDayOffset === 0 ? 'today' : toDayOffset === 1 ? 'tomorrow' : fmtDowLong(addDaysKey(todayKey, toDayOffset))}`
            : 'to the next free slot'
      const r = resolvePrecise(
        query,
        'move',
        at,
        false, // a done block isn't moved — it's in the past, completed
        (b) => `move ${baseOf(query)} at ${fmtTime(b.startMin)} ${dest}`
      )
      if ('reply' in r) return r.reply
      target = r.block
    }
    if (!target) return `I couldn't find "${query}" to move — say it another way?`
    const toKey = toDayOffset != null ? addDaysKey(todayKey, toDayOffset) : target.dayKey
    return moveResolved(target, toKey, toStartMin, relStartMin)
  }

  /** Move an already-resolved block to (toKey, start) — the shared tail of
      execMove and execRelativeMove (#335), so both take ownership of an external
      (detach + tombstone), auto-slot the same way (#80/#302), drift own flexible
      work (#324), and word the clash identically. `toStartMin` places it exactly;
      `relStartMin` shifts against its current start (clamped to the day); neither
      ⇒ the scoring oracle picks the conflict-free, rest-aware slot on toKey. */
  function moveResolved(
    target: Block,
    toKey: string,
    toStartMin?: number,
    relStartMin?: number
  ): string {
    const s = get()
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    /* an imported event CAN be moved — moving it takes ownership: detach from
       the source and tombstone it so a re-sync leaves your placement alone (a
       VAGUE referent onto an external event already refused, upstream) */
    let blocks = s.blocks
    if (target.external) {
      dismissExternal([target])
      blocks = detachExternal(blocks, target.id)
    }
    /* same rulebook as plan/edit — a move's collision wording must not
       contradict its siblings about whether the other side can shift */
    const prefs = activePrefsFrom(s.memory, brainOn() ? brainPrefs : null)
    let start = toStartMin
    /* relative shift against the block's current start, clamped to the day so
       "an hour earlier" can't push it below midnight or past its end (#320) */
    if (start == null && relStartMin != null) {
      start = Math.max(0, Math.min(24 * 60 - week.duration(target), target.startMin + relStartMin))
    }
    if (start == null) {
      /* the scoring oracle picks the destination — rest-aware and conflict-free
         — instead of the first open hole; fall back to first-fit if it finds
         none (e.g. the asked day is past the scorer horizon) (#80). An
         auto-slotted move IS a placement, so it honors the meeting buffer
         (#302) the same as plan/findSlot/suggestSlots — an explicit toStartMin
         above skips this branch entirely (explicit intent wins). */
      const bufferMin = s.settings.meetingBufferMin ?? 0
      const q: SlotQuery = {
        title: target.title,
        tag: target.tag,
        durationMin: week.duration(target),
      }
      const best = scoreSlots(
        blocks.filter((b) => b.id !== target.id),
        q,
        todayKey,
        minOfDay(now),
        prefs,
        undefined, // weights: the default profile
        undefined, // horizonDays: the default week
        undefined, // mealBase: the circadian default (#298)
        bufferMin // #302: keep the moved block shy of external meetings
      ).find((c) => c.dayKey === toKey)
      if (best) start = best.startMin
      else {
        const slot = week.findFreeSlot(
          blocks.filter((b) => b.id !== target.id),
          toKey,
          week.duration(target),
          toKey === todayKey ? minOfDay(now) + 15 : undefined,
          undefined, // windowEnd: the working-day cap
          bufferMin // #302: the first-fit fallback honors the buffer too
        )
        if (!slot) return `${fmtDowLong(toKey)} can't hold it — want a different day?`
        start = slot.startMin
      }
    }
    let moved = week.move(blocks, target.id, toKey, start)
    const landedBlock = moved.find((b) => b.id === target.id)!
    /* #324: an explicit-time move of WORK onto the user's own flexible blocks
       drifts them clear in the same pass and names what moved; other moves keep
       the honest place-then-offer note. External/fixed are never moved. */
    let clashPart: string
    if (landedBlock.tag === 'work' && !week.isBackground(landedBlock)) {
      const d = driftReply(moved, landedBlock, todayKey, minOfDay(now), prefs)
      moved = d.blocks
      clashPart = d.note
    } else {
      const landed = week.conflictsWith(
        moved,
        toKey,
        start,
        start + week.duration(target),
        target.id,
        prefs
      )
      clashPart = clashNote(landed, prefs)
    }
    setBlocks(moved)
    noteReferentId(target.id) // the turn touched one block — "it" now points here
    return `Moved — ${target.title.split('—')[0].trim()} now lives ${toKey === todayKey ? 'today' : fmtDowLong(toKey)} at ${fmtTime(start)}.${clashPart}`
  }

  /* ── granular calendar ops (#335) ────────────────────────────────────────
     resize / duplicate / relative-move — three cohesive single-target commands
     on the standing "more every RC" surface, each a first-class tool + keyless
     route flowing through the ONE mutation path (setBlocks). They REUSE the
     targeting shipped in #345 (resolveTarget/resolvePrecise), the recurring
     scope of #343/#350, and the move/edit tails above — no second door, no
     re-implemented targeting. External/fixed blocks are respected by all three:
     resize never touches a neighbor, the copy is a fresh owned block (the
     original stays), and the next free slot lands clear of them. */

  /** Resize a block's LENGTH keeping its start (#335). A duration-only edit is
      exactly what execEdit already does, so route through it — targeting,
      recurring scope, external ownership, and the clash note come for free, and
      the start never moves (applyEditPatch/execEdit keep it when only the
      duration changes). durationMin sets an absolute length; relDurationMin a
      signed delta ("30 min longer"). */
  function execResize(
    query: string,
    resize: { durationMin?: number; relDurationMin?: number },
    at?: string,
    scope?: RecurScope
  ): string {
    return execEdit(
      query,
      { durationMin: resize.durationMin, relDurationMin: resize.relDurationMin },
      at,
      scope
    )
  }

  /** Copy a block to another day/time (#335) — the original is untouched and the
      copy is a NEW independent block (fresh id, same title/tag/length/attention/
      due). Placed with week.place + setBlocks (the one mutation path); NO execPlan
      de-dup (#89), because a duplicate is deliberately a twin, not a re-plan that
      would MOVE the original. Cross-day keeps the source's clock; same-day with no
      time lands in the next free slot (never on top of the original). An rrule
      makes the copy a repeating series, expanded and linked like a planned
      recurrence (#159). An external source copies into an owned block; the
      calendar original is never moved or detached. */
  function execDuplicate(
    query: string,
    opts: {
      toDayOffset?: number
      toStartMin?: number
      rrule?: import('../domain/recurrence').Rrule
    },
    at?: string
  ): string {
    const s = get()
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    const destKey = opts.toDayOffset != null ? addDaysKey(todayKey, opts.toDayOffset) : null
    const destPhrase =
      opts.toStartMin != null
        ? ` to ${fmtTime(opts.toStartMin)}`
        : destKey
          ? ` to ${destKey === todayKey ? 'today' : fmtDowLong(destKey)}`
          : ''
    /* op 'edit' (not 'move'): a referent onto a calendar event resolves here —
       copying an external is allowed (only MOVING it is refused). */
    const res = resolveTarget(query, 'edit')
    if ('reply' in res) return res.reply
    let target: Block | undefined
    if ('block' in res) target = res.block
    else {
      const r = resolvePrecise(
        query,
        'duplicate',
        at,
        true, // a done block is copyable — the copy is a fresh open block
        (b) => `duplicate ${baseOf(query)} at ${fmtTime(b.startMin)}${destPhrase}`
      )
      if ('reply' in r) return r.reply
      target = r.block
    }
    if (!target) return `I couldn't find "${query}" to duplicate — say it another way?`

    const base = target.title.split('—')[0].trim()
    const dur = week.duration(target)
    const toKey = destKey ?? target.dayKey
    const prefs = activePrefsFrom(s.memory, brainOn() ? brainPrefs : null)
    const bufferMin = s.settings.meetingBufferMin ?? 0

    /* recurrence (#159): the copy seeds a NEW series — the same bounded DAILY/
       WEEKLY walk execPlan uses, linked under a fresh id. The original stays
       exactly as it is (its own one-off or series untouched). */
    if (opts.rrule) {
      const anchorStart = opts.toStartMin ?? target.startMin
      const windowEnd = addDaysKey(toKey, RRULE_DEFAULT_WEEKS * 7)
      const occs = expandRrule(opts.rrule, toKey, anchorStart, dur, toKey, windowEnd)
      if (!occs.length) return `that cadence has no dates in the next year — pick another?`
      const seriesId = uid()
      let blocks = s.blocks
      for (const occ of occs) {
        const made = week.place(blocks, {
          title: target.title,
          tag: target.tag,
          dayKey: occ.dayKey,
          startMin: occ.startMin,
          endMin: occ.endMin,
          protected: target.protected,
          attention: target.attention,
          due: target.due,
          recurringBlockId: seriesId,
          rrule: opts.rrule,
        })
        if (!made) continue // that day is full — skip the occurrence, keep the series
        blocks = [...blocks, made]
      }
      const placed = blocks.filter((b) => b.recurringBlockId === seriesId).length
      if (!placed) return `couldn't place the copy — every day in that cadence is already full`
      setBlocks(blocks)
      const cadence = describeRrule(opts.rrule, toKey)
      const through = occs[occs.length - 1].dayKey
      return `Copied — ${base} now repeats ${cadence} ${fmtTime(anchorStart)}–${fmtTime(anchorStart + dur)}, ${placed} block${placed === 1 ? '' : 's'} through ${fmtShortDate(through)}.`
    }

    /* single copy: the source's clock on another day, or the next free slot when
       copying within the same day (a copy never lands on top of its original). */
    let startMin = opts.toStartMin
    if (startMin == null) {
      if (toKey === target.dayKey) {
        const slot = week.findFreeSlot(
          s.blocks,
          toKey,
          dur,
          toKey === todayKey ? minOfDay(now) + 15 : undefined,
          undefined,
          bufferMin
        )
        if (!slot)
          return `${toKey === todayKey ? 'today' : fmtDowLong(toKey)} has no free ${dur}-min slot for a copy — name a time?`
        startMin = slot.startMin
      } else {
        startMin = target.startMin
      }
    }
    const made = week.place(s.blocks, {
      title: target.title,
      tag: target.tag,
      dayKey: toKey,
      startMin,
      endMin: startMin + dur,
      protected: target.protected,
      attention: target.attention,
      due: target.due,
    })
    if (!made)
      return `${toKey === todayKey ? 'today' : fmtDowLong(toKey)} can't hold the copy — want a different day?`
    let blocks = [...s.blocks, made]
    /* the copy is a placement, so it drifts own flexible work and words fixed/
       external clashes exactly like plan/move (#324) — never moving a neighbor. */
    let note: string
    if (made.tag === 'work' && !week.isBackground(made)) {
      const d = driftReply(blocks, made, todayKey, minOfDay(now), prefs)
      blocks = d.blocks
      note = d.note
    } else {
      const clash = week.isBackground(made)
        ? []
        : week.conflictsWith(blocks, toKey, made.startMin, made.endMin, made.id, prefs)
      note = clashNote(clash, prefs)
    }
    setBlocks(blocks)
    noteReferentId(made.id) // the fresh copy is now "it"
    const when = toKey === todayKey ? 'today' : fmtDowLong(toKey)
    return `Copied — ${base} now also lives ${when} at ${fmtTime(startMin)}–${fmtTime(startMin + dur)}.${note}`
  }

  /** Move a block relative to where it is now, with no absolute time (#335).
      earlier/later delegate straight to moveResolved's relative shift; next_day
      keeps the clock one day on; next_free relocates to the soonest genuinely
      clear slot from now (week.nextFreeSlot, which lands clear of fixed/external
      by construction). One resolution (reusing #345 targeting), then the shared
      move tail — drift, clash, and ownership are never re-implemented. */
  function execRelativeMove(
    query: string,
    direction: 'earlier' | 'later' | 'next_day' | 'next_free',
    amountMin?: number,
    at?: string
  ): string {
    const s = get()
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    const res = resolveTarget(query, 'move')
    if ('reply' in res) return res.reply
    let target: Block | undefined
    if ('block' in res) target = res.block
    else {
      const destPhrase =
        direction === 'earlier'
          ? 'earlier'
          : direction === 'later'
            ? 'later'
            : direction === 'next_day'
              ? 'to the next day'
              : 'to the next free slot'
      const r = resolvePrecise(
        query,
        'move',
        at,
        false, // a done block isn't nudged — it's in the past
        (b) => `move ${baseOf(query)} at ${fmtTime(b.startMin)} ${destPhrase}`
      )
      if ('reply' in r) return r.reply
      target = r.block
    }
    if (!target) return `I couldn't find "${query}" to move — say it another way?`
    if (direction === 'earlier' || direction === 'later') {
      const amt = amountMin ?? 30
      return moveResolved(target, target.dayKey, undefined, direction === 'earlier' ? -amt : amt)
    }
    if (direction === 'next_day') {
      return moveResolved(target, addDaysKey(target.dayKey, 1), target.startMin)
    }
    /* next_free: the earliest clear slot from now across the horizon, target's
       own slot excluded so its current position reads as free. */
    const bufferMin = s.settings.meetingBufferMin ?? 0
    const fromMin = Math.ceil(minOfDay(now) / 5) * 5 + 15
    const durMin = week.duration(target)
    const slot = week.nextFreeSlot(
      s.blocks.filter((b) => b.id !== target!.id),
      todayKey,
      fromMin,
      durMin,
      13,
      bufferMin
    )
    if (!slot)
      return `I couldn't find a clear ${durMin}-min slot in the next two weeks — want me to make room?`
    if (slot.dayKey === target.dayKey && slot.startMin === target.startMin)
      return `${target.title.split('—')[0].trim()} already sits in the earliest open slot — nothing to move.`
    return moveResolved(target, slot.dayKey, slot.startMin)
  }

  function execCapture(title: string): string {
    const clean = title.trim()
    if (!clean) return 'nothing to capture'
    const capture: Capture = { id: uid(), title: clean, createdAt: nowFn(), status: 'open' }
    set((st) => ({ captures: [...st.captures, capture] }))
    persistCaptures([capture])
    fireEventNudges({ newCapture: capture })
    return `Captured "${clean}". (The when-&-where nudge with a proposed slot is already posted — don't propose another time yourself.)`
  }

  /* ── recurring-edit scope (#343) ─────────────────────────────────────────
     Every calendar app asks scope when you touch a repeating event: just this
     one / this & following / the whole series. MEW handled the ends (a single
     delete drops one occurrence; all:true/seriesOf drops the series); this adds
     the middle (split from a date forward) and surfaces the choice as chips when
     an edit/delete lands on a series block and the ask named no scope. Every
     chip re-issues the SAME op with an explicit scope word, so the pick routes
     back through the executor (tools-only, positive voice) and never repeats. */
  type RecurScope = 'this' | 'following' | 'series'
  type EditPatch = {
    startMin?: number
    endMin?: number
    durationMin?: number
    /** #320: a relative length delta ("give it another 30" = +30, "make it
        shorter" = −15) — applied to the block's CURRENT duration here, since
        only the live block knows it and parse.ts stays pure. */
    relDurationMin?: number
    title?: string
    tag?: import('../domain/types').Tag
    attention?: 'focus' | 'background'
    due?: number
  }

  /** The scope word each chip's re-issued ask carries — parsed back by the
      keyless floor (extractSeriesScope) and understood by the keyed model, so a
      pick applies the scope without re-triggering the offer. */
  function scopeWord(scope: RecurScope): string {
    return scope === 'this'
      ? 'just this one'
      : scope === 'following'
        ? 'this and following'
        : 'across the whole series'
  }

  /** Post the this / following / series chips — a calm question, one message,
      chat-only. `reissue(scope)` builds each chip's complete ask; the pick
      arrives as an ordinary user turn and routes through the executor. */
  function offerRecurringScope(base: string, reissue: (scope: RecurScope) => string): string {
    return execOfferChoices(`"${base}" repeats — which do you mean?`, [
      { label: 'just this one', reply: reissue('this') },
      { label: 'this & the ones after', reply: reissue('following') },
      { label: 'the whole series', reply: reissue('series') },
    ])
  }

  /** The soonest OPEN occurrence of a single shared series among `pool`, when the
      series still holds more than one occurrence (so the three scope answers
      actually differ) — else null. Guards the offer: a mixed match, a one-off, or
      a lone-occurrence series never raises a scope question. */
  function recurringSeriesTarget(pool: Block[]): Block | null {
    const id = pool[0]?.recurringBlockId
    if (!id || !pool.every((b) => b.recurringBlockId === id)) return null
    const soonest = [...pool].sort(
      (a, b) => a.dayKey.localeCompare(b.dayKey) || a.startMin - b.startMin
    )[0]
    const m = week.seriesMembership(get().blocks, soonest)
    return m && m.count > 1 ? soonest : null
  }

  /** Apply an edit patch to ONE block — the same field math execEdit runs on its
      single target, factored so a series/following scope applies it per
      occurrence. Retime keeps length; a relative length clamps to 5–720. */
  function applyEditPatch(b: Block, patch: EditPatch): Block {
    const startMin = patch.startMin ?? b.startMin
    let endMin = patch.endMin ?? b.endMin
    if (patch.durationMin != null) endMin = startMin + patch.durationMin
    if (patch.relDurationMin != null)
      endMin = startMin + Math.max(5, Math.min(720, week.duration(b) + patch.relDurationMin))
    if (
      patch.startMin != null &&
      patch.endMin == null &&
      patch.durationMin == null &&
      patch.relDurationMin == null
    )
      endMin = startMin + week.duration(b) // retime keeps length
    if (endMin <= startMin) endMin = startMin + 15
    return {
      ...b,
      startMin,
      endMin,
      ...(b.external ? { external: undefined } : {}),
      ...(patch.title ? { title: patch.title } : {}),
      ...(patch.tag ? { tag: patch.tag } : {}),
      ...(patch.attention ? { attention: patch.attention } : {}),
      ...(patch.due != null ? { due: patch.due } : {}),
    }
  }

  /** Rebuild an edit as a complete ask a chip re-issues with a scope word —
      pinned by the target's name + current start so the pick lands on the same
      occurrence. Mirrors the keyless edit grammar (rename / range / duration) so
      a keyless pick parses it back identically; times are canonical HH:MM. */
  function editReissue(base: string, target: Block, patch: EditPatch, scope: RecurScope): string {
    const at = fmtTime(target.startMin)
    const w = scopeWord(scope)
    if (patch.title != null) return `rename ${base} at ${at} to ${patch.title} ${w}`
    if (patch.startMin != null && patch.endMin != null)
      return `${base} at ${at} should be ${fmtTime(patch.startMin)}-${fmtTime(patch.endMin)} ${w}`
    if (patch.startMin != null)
      return `${base} at ${at} should be ${fmtTime(patch.startMin)}-${fmtTime(patch.startMin + week.duration(target))} ${w}`
    if (patch.durationMin != null) return `make ${base} at ${at} ${patch.durationMin} min ${w}`
    if (patch.relDurationMin != null)
      return `make ${base} at ${at} ${Math.max(5, Math.min(720, week.duration(target) + patch.relDurationMin))} min ${w}`
    return `${base} at ${at} ${w}`
  }

  /** Apply an edit to a whole series ('series') or from the target's day forward
      ('following'). `following` splits: the tail occurrences re-time/rename in
      place and re-link under a fresh id carrying the bounded tail rule, while the
      earlier ones keep their old shape under the bounded head rule
      (splitSeriesFrom). Re-links existing occurrences rather than re-expanding,
      so a previously-deleted occurrence stays deleted and no external event is
      ever recreated. */
  function applyEditScope(target: Block, patch: EditPatch, scope: 'following' | 'series'): string {
    const s = get()
    const rid = target.recurringBlockId
    const split = scope === 'following' ? splitSeriesFrom(target.rrule, target.dayKey) : null
    const affected =
      scope === 'series'
        ? s.blocks.filter((b) => b.recurringBlockId === rid && b.status === 'open')
        : s.blocks.filter(
            (b) => b.recurringBlockId === rid && b.status === 'open' && b.dayKey >= target.dayKey
          )
    const newId = scope === 'following' ? uid() : null
    const patched = new Map(
      affected.map((b) => {
        let nb = applyEditPatch(b, patch)
        if (scope === 'following')
          nb = { ...nb, recurringBlockId: newId!, ...(split?.tail ? { rrule: split.tail } : {}) }
        return [b.id, nb] as const
      })
    )
    const next = s.blocks.map((b) => {
      if (patched.has(b.id)) return patched.get(b.id)!
      if (
        scope === 'following' &&
        split?.head &&
        b.recurringBlockId === rid &&
        b.status !== 'rolled' &&
        b.dayKey < target.dayKey
      )
        return { ...b, rrule: split.head } // bound the surviving head to where it now ends
      return b
    })
    setBlocks(next)
    const base = (patch.title ?? target.title).split('—')[0].trim()
    const n = patched.size
    const when = target.dayKey === dayKey(new Date(s.nowMs)) ? 'today' : fmtDowLong(target.dayKey)
    return scope === 'series'
      ? `Updated — ${base} across the whole series (${n} block${n === 1 ? '' : 's'}).`
      : `Updated — ${base} from ${when} on (${n} block${n === 1 ? '' : 's'}); the earlier ones keep their old shape.`
  }

  /** Delete a series from the target's day forward ('this & following' delete) —
      the tail occurrences come off, the earlier ones stay under a bounded head
      rule. A DONE occurrence never falls here: a done target routes to
      proposeDoneRemoval upstream, and the tail is today-or-ahead (open only), so
      the mew-consent gate is never bypassed. */
  function removeSeriesFollowing(target: Block, todayKey: string): string {
    const s = get()
    const rid = target.recurringBlockId
    const split = splitSeriesFrom(target.rrule, target.dayKey)
    const tail = s.blocks.filter(
      (b) => b.recurringBlockId === rid && b.status === 'open' && b.dayKey >= target.dayKey
    )
    const drop = new Set(tail.map((b) => b.id))
    if (tail.some((b) => b.id === get().lastReferent?.blockId)) clearReferent()
    dismissExternal(tail)
    const kept = s.blocks
      .filter((b) => !drop.has(b.id))
      .map((b) =>
        split?.head &&
        b.recurringBlockId === rid &&
        b.status !== 'rolled' &&
        b.dayKey < target.dayKey
          ? { ...b, rrule: split.head }
          : b
      )
    set({ blocks: kept, nowMs: nowFn() })
    persistBlocks(kept)
    storage.deleteBlocks([...drop]).catch(() => {})
    const base = target.title.split('—')[0].trim()
    const when = target.dayKey === todayKey ? 'today' : fmtDowLong(target.dayKey)
    return `Removed — ${base} from ${when} on (${tail.length} block${tail.length === 1 ? '' : 's'}); the earlier ones stay.`
  }

  function execEdit(
    query: string,
    patch: EditPatch,
    /* #334: the TARGET block's current start time, pinning which of several
       same-named blocks to change — distinct from patch.startMin (a retime). */
    at?: string,
    /* #343: the recurring-edit scope for a series block — absent asks (chips). */
    scope?: RecurScope
  ): string {
    const s = get()
    const res = resolveTarget(query, 'edit')
    if ('reply' in res) return res.reply
    let target: Block | undefined
    if ('block' in res) target = res.block
    else {
      const r = resolvePrecise(query, 'edit', at, true, (b) => {
        const t = fmtTime(b.startMin)
        const base = baseOf(query)
        if (patch.title) return `rename ${base} at ${t} to ${patch.title}`
        if (patch.durationMin != null) return `make ${base} at ${t} ${patch.durationMin} min`
        if (patch.startMin != null && patch.endMin != null)
          return `${base} at ${t} should be ${fmtTime(patch.startMin)}-${fmtTime(patch.endMin)}`
        return `${base} at ${t}` // retag/attention/due-only — the keyed model re-issues with at
      })
      if ('reply' in r) return r.reply
      target = r.block
    }
    if (!target) return `I couldn't find "${query}" to change — say it another way?`
    noteReferentId(target.id) // the turn touched one block — "it" now points here
    /* #343: the edit landed on a live series. With no scope, ask (chips) rather
       than silently editing one; an explicit series/following applies across the
       set. A retag/attention/due-only edit skips the CHIP offer (the keyless
       floor can't reconstruct that ask), but still honors an explicit scope. */
    const membership = week.seriesMembership(s.blocks, target)
    if (membership && membership.count > 1 && target.status === 'open') {
      const reissuable =
        patch.title != null ||
        patch.startMin != null ||
        patch.endMin != null ||
        patch.durationMin != null ||
        patch.relDurationMin != null
      if (!scope && reissuable) {
        const base = baseOf(query)
        return offerRecurringScope(base, (sc) => editReissue(base, target!, patch, sc))
      }
      if (scope === 'series' || scope === 'following') return applyEditScope(target, patch, scope)
    }
    /* editing an imported event takes ownership (detach + tombstone) so the
       change survives a re-sync */
    if (target.external) dismissExternal([target])
    const startMin = patch.startMin ?? target.startMin
    let endMin = patch.endMin ?? target.endMin
    if (patch.durationMin != null) endMin = startMin + patch.durationMin
    /* relative length against the current duration, clamped to the same 5–720
       bounds the absolute edit tool takes (#320) */
    if (patch.relDurationMin != null) {
      endMin = startMin + Math.max(5, Math.min(720, week.duration(target) + patch.relDurationMin))
    }
    if (
      patch.startMin != null &&
      patch.endMin == null &&
      patch.durationMin == null &&
      patch.relDurationMin == null
    ) {
      endMin = startMin + week.duration(target) // retime keeps length
    }
    if (endMin <= startMin) endMin = startMin + 15
    const next = {
      ...target,
      startMin,
      endMin,
      ...(target.external ? { external: undefined } : {}), // taken over — no longer the calendar's
      ...(patch.title ? { title: patch.title } : {}),
      ...(patch.tag ? { tag: patch.tag } : {}),
      ...(patch.attention ? { attention: patch.attention } : {}),
      ...(patch.due != null ? { due: patch.due } : {}),
    }
    const prefs = activePrefsFrom(s.memory, brainOn() ? brainPrefs : null)
    /* only a real retime can create an overlap — a pure rename/retag/attention
       edit keeps the block's span, so it never warns about a pre-existing
       neighbor it didn't disturb (#334: a rename touches only the title). */
    const timesChanged = startMin !== target.startMin || endMin !== target.endMin
    const clash =
      !timesChanged || week.isBackground(next)
        ? []
        : week.conflictsWith(s.blocks, target.dayKey, startMin, endMin, target.id, prefs)
    setBlocks(s.blocks.map((b) => (b.id === target.id ? next : b)))
    return `Updated — ${next.title.split('—')[0].trim()} is now ${fmtTime(startMin)}–${fmtTime(endMin)} (${endMin - startMin} min)${patch.tag ? `, tagged ${patch.tag}` : ''}${patch.attention ? `, ${patch.attention === 'background' ? 'running in the background' : 'holding your focus'}` : ''}${patch.due != null ? `, due ${fmtTime(patch.due)}` : ''}.${clashNote(clash, prefs)}`
  }

  function execRemember(pref: PrefPayload): string {
    /* the local memory is the always-on home (single-device floor); the
       brain mirrors it when connected, and a restated rule upserts both
       sides (slug = kind+match in the brain; newest event wins locally) */
    logMemory({ kind: 'preference', dayKey: dayKey(new Date(get().nowMs)), pref })
    if (brainOn()) {
      void brain.ingest(prefPage(pref)).then(() => refreshBrainPrefs())
    }
    return `Remembered — ${pref.match} ${pref.value}.`
  }

  /* Words a single-token subject capture must never be — pronouns,
     determiners, quantifiers, wh-words, counts. The rollup filter matches
     subjects as raw slug substrings, so these function words hide inside
     real titles ("my" ⊂ anatomy, "many" ⊂ germany) and would sum the wrong
     blocks with full confidence; an unresolved subject answers honestly
     instead. Multi-word captures pass through untouched. */
  const SUBJECT_STOP = new Set([
    ...['my', 'our', 'your', 'his', 'her', 'their', 'its', 'me', 'us', 'them', 'it', 'i'],
    ...['the', 'a', 'an', 'this', 'that', 'these', 'those'],
    ...['what', 'which', 'whose', 'how'],
    ...['any', 'all', 'some', 'few', 'more', 'most', 'many', 'much', 'several'],
    ...['both', 'each', 'every', 'either', 'neither', 'no', 'none', 'other'],
    ...['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
    ...['first', 'last', 'past', 'next', 'previous', 'recent', 'earlier', 'final'],
  ])

  /** History/entity answers: the asked week supplies the NUMBERS (rollup over
      real blocks — never an estimate), the brain supplies citable color. The
      question names its week: "last week" / "two weeks ago" reach back through
      block history (kept forever), so past weeks answer with real sums even
      with no brain; no time phrase means this week. "Eaten" means held clock
      time. The subject is matched as a title fragment, so projects, tasks,
      and people all answer — and a name only ever spoken to the keyless floor
      (which lowercases titles) still resolves. */
  async function execQueryBrain(question: string): Promise<string> {
    const s = get()
    const known = knownProjectsFrom(s.blocks.map((b) => b.title))
    /* a subject NAMED with week words ("Last week review", asked by name)
       must not be mis-windowed by the phrase parser: when a known project
       or a block title that carries a week phrase matches the un-stripped
       question, it IS the subject and the window stays the live week */
    const rawSlug = `-${slugify(question)}-`
    const namedHit: [string, string] | null =
      [...known.entries()].find(
        ([slug, name]) => stripWeekPhrase(name) !== name && rawSlug.includes(`-${slug}-`)
      ) ??
      s.blocks
        .map((b) => b.title.split('—')[0].trim())
        .filter((t) => t && stripWeekPhrase(t) !== t)
        .map((t): [string, string] => [slugify(t), t])
        .find(([slug]) => slug && rawSlug.includes(`-${slug}-`)) ??
      null
    /* which Mon–Sun window the question means — and the question with the
       week phrase removed, so "gym last week" never reads as one title */
    const offset = namedHit ? 0 : weekOffsetFromQuestion(question)
    const subjectText = namedHit ? question : stripWeekPhrase(question)
    const label = weekOffsetLabel(offset)
    const qSlug = `-${slugify(subjectText)}-`
    /* subject: the week-worded name if one matched, else a declared project
       named in the question, else the noun the question's own shape points
       at ("how much has X eaten", "how long did X take", "my X sessions") —
       single-token captures are stoplist-checked so a bare function word
       never becomes a subject */
    const projectHit =
      namedHit ?? [...known.entries()].find(([slug]) => qSlug.includes(`-${slug}-`))
    const unstopped = (w: string | undefined) =>
      w && !SUBJECT_STOP.has(w.toLowerCase()) ? w : null
    const asked =
      subjectText.match(
        /\b(?:has|have|did)\s+(.+?)\s+(?:eaten|taken|cost|consumed|used)\b/i
      )?.[1] ??
      subjectText.match(
        /\b(?:time|much|long)\s+(?:on|for|with)\s+(.+?)(?:\s+this\s+week|[?.!]|$)/i
      )?.[1] ??
      /* duration shape only — the final take/took/taken is the verb, so the
         greedy capture keeps a subject that itself contains "take" whole */
      unstopped(
        subjectText.match(
          /\bhow\s+(?:long|much\s+time)\s+(?:did|does|has|have)\s+(.+)\s+(?:take|took|taken)\b/i
        )?.[1]
      ) ??
      unstopped(subjectText.match(/\b([\w'-]+)\s+sessions?\b/i)?.[1]) ??
      null
    const slug = projectHit?.[0] ?? (asked ? slugify(asked) : null)
    const name = projectHit?.[1] ?? asked?.trim() ?? null

    /* recall rides along when a brain is connected — raced, optional-path;
       it gets the question verbatim, week phrase and all. null from either
       leg (port error, race timeout) means the brain DIDN'T ANSWER — kept
       apart from an empty answer so the tails below stay honest (#249) */
    let recall: string[] = []
    let brainAnswered = true
    if (brainOn()) {
      const got = await Promise.race([
        brain.recall(question, { limit: 3, scope: brainScope() }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), QUERY_BRAIN_RACE_MS)),
      ]).catch(() => null)
      if (got == null) brainAnswered = false
      else recall = got
    }

    if (slug && name) {
      const days = weekKeys(new Date(s.nowMs), offset)
      const r = week.rollup(s.blocks, days, (b) => slugify(b.title).includes(slug))
      if (r.plannedMin > 0 || r.rolled > 0) {
        const h = (min: number) =>
          min % 60 === 0 ? `${min / 60}h` : `${Math.round((min / 60) * 10) / 10}h`
        const openMin = r.plannedMin - r.doneMin
        const parts = [
          `${name} ${label}: ${h(r.plannedMin)} across ${r.done + r.open} block${r.done + r.open === 1 ? '' : 's'}`,
          /* a past week that finished clean needs no "0h still open" tail */
          offset < 0 && openMin === 0
            ? `${h(r.doneMin)} done`
            : `${h(r.doneMin)} done, ${h(openMin)} still open`,
        ]
        if (r.rolled) parts.push(`${r.rolled} rolled forward`)
        const lines = recall.length ? `\n${recall.join('\n')}` : ''
        return `${parts.join(' · ')}.${lines}`
      }
    }

    /* no local numbers — recall may still know it; absent both, say so
       honestly, naming the week the question asked about. "Or the brain" is
       claimed only when the brain really answered: an unanswering brain is
       named as such (it may know more) — its silence is never passed off as
       an empty history (#249) */
    if (recall.length) return recall.join('\n')
    const brainChecked = brainOn() && brainAnswered ? ' or the brain' : ''
    const brainSilent =
      brainOn() && !brainAnswered
        ? ` I'm running on what I know on-device — the brain didn't answer just now, so it may know more; worth asking again in a moment.`
        : ''
    if (offset < 0)
      return `I can't see ${name ?? 'that'} ${label} — nothing in that week's blocks${brainChecked} mentions it.${brainSilent}`
    return `I can't see ${name ?? 'that'} yet — nothing in this week's blocks${brainChecked} mentions it.${brainSilent}`
  }

  /** The ask-a-question / suggestions engine (#254): post one mew message
      carrying clickable choice chips. Chat-only by law — the week never
      changes here; a pick posts the choice's reply as an ordinary user turn
      (pickChoice), so tools remain the only mutation path. The returned
      string leads with CHOICES_POSTED: the model reads it as "end your turn",
      the keyless floor reads it as "stay quiet — the chips ARE the reply". */
  function execOfferChoices(prompt: string, options: ChoiceOption[]): string {
    post([
      choicesMsg(
        prompt,
        options.map((o, i) => ({ id: `c${i + 1}`, label: o.label, reply: o.reply }))
      ),
    ])
    return `${CHOICES_POSTED}: ${options.map((o) => `"${o.label}"`).join(' · ')}. Say nothing more and END your turn — the pick (or the user's own typed words) arrives as the next user message.`
  }

  /* insights' follow-through bands → the scenario engine's window vocabulary.
     The 'late' band (15:00–21:00) sits mostly past windowOf's 17:00 afternoon
     edge, so it reads as evening; the alignment is a soft profile weight, so
     a rough edge steers taste, never gates a slot. */
  const BAND_WINDOW: Record<'morning' | 'midday' | 'late', TimeWindow> = {
    morning: 'morning',
    midday: 'afternoon',
    late: 'evening',
  }

  /** Plan mode's propose half (#293): classify → generate → post ONE picker
      message. Mutates NOTHING (the #254 offer_choices precedent) — scenarios
      are chat-only data until pickScenario applies one through the plan
      executor. The resolver (#328) fills exactly as execPlan would (explicit >
      confirmed rule > medians > the 60-min floor; a confirmed window rides
      along), so a preview is sized and windowed the way the apply will be.
      Every scenario is validated against the live week at post time — the
      engine is conflict-free by construction, the gate keeps that checked. */
  function execProposeScenarios(prompt: string, specs: ScenarioTaskSpec[]): string {
    const s = get()
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    const prefs = activePrefsFrom(s.memory, brainOn() ? brainPrefs : null)
    const hist = histDurations(s)
    const learned = learnedRules(s) // #328
    const tasks: ScenarioTask[] = specs
      .filter((t) => t.title.trim())
      .map((t) => {
        const r = resolveTaskSpec(
          t.title.trim(),
          { durationMin: t.durationMin, window: t.window },
          prefs,
          hist,
          learned
        )
        return {
          title: t.title.trim(),
          tag: t.tag,
          durationMin: r.spec.durationMin ?? 60,
          ...(t.due != null ? { due: t.due } : {}),
          // a stated window, else a confirmed rule's — the engine honors both
          ...(r.spec.window ? { window: r.spec.window } : {}),
          // #322: a length in the ask is the user's word — "always" leaves it be
          ...(t.durationMin != null ? { durationStated: true } : {}),
        }
      })
    if (!tasks.length) return 'nothing to propose — name the tasks and I will lay out the week.'
    const agg = aggregates(s.memory, now)
    const insights = computeInsights(s.memory, agg, now)
    /* #321: energy-fit joins the set only when the toggle allows AND either a
       learned rhythm exists (energyProfile past the data floor) or a stated
       rule forces it. Off, or a fresh profile with no rule, ⇒ these are all
       absent and the scenario set stays byte-identical to today. Stated word
       wins: a "deep work anytime" rule overrides a peak-leaning profile. */
    const energyOn = s.settings.energyFit !== 'off'
    const profile = energyOn ? energyProfile(s.memory, agg, now) : null
    const batchAdmin = energyOn && batchAdminRule(prefs)
    const deepFlexible = energyOn && deepWorkAnytime(prefs)
    /* #322 "always": pre-size the whole picker to demonstrated durations, so the
       preview AND the applied quote both carry honest lengths. off/ask ⇒ absent
       ⇒ scenarios are byte-identical to today. */
    const estimateFactor =
      s.settings.estimateAutosize === 'always' ? estimateFactorByTag(s.memory, now) : undefined
    const all = generateScenarios(s.blocks, tasks, {
      nowMin: minOfDay(now),
      todayKey,
      horizonDays: 7,
      ...(insights.bestBand ? { bestWindow: BAND_WINDOW[insights.bestBand.band] } : {}),
      prefs,
      bufferMin: s.settings.meetingBufferMin ?? 0, // #302: scenarios inherit the seam
      ...(profile ? { energyProfile: profile } : {}), // #321
      ...(batchAdmin ? { batchAdmin: true } : {}),
      ...(deepFlexible ? { deepFlexible: true } : {}),
      ...(estimateFactor ? { estimateFactor } : {}), // #322
      ids: uid,
    })
    /* a scenario placing nothing is nothing to pick — it only ever narrates
       what waits; its honesty is kept for the zero-fit line below */
    const scenarios = all.filter((sc) => sc.places.length > 0 && validateScenario(s.blocks, sc))
    if (!scenarios.length) {
      return `The next seven days can't hold these as one plan — ${all[0]?.line ?? 'every gap is held by something fixed'}. Want to trim the list, or look further out?`
    }
    const label = (offset: number) =>
      offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : fmtDowLong(addDaysKey(todayKey, offset))
    if (scenarios.length === 1) {
      /* one honest shape, no picker theater — suggest it in plain prose */
      const sc = scenarios[0]
      const places = sc.places
        .map(
          (p) =>
            `${p.title} ${label(p.dayOffset)} ${fmtTime(p.startMin)}–${fmtTime(p.startMin + p.durationMin)}`
        )
        .join(' · ')
      return `One shape fits — ${sc.name}: ${sc.line}. ${places}. Say the word and I'll place exactly that.`
    }
    const body =
      prompt.trim() ||
      `${spell(scenarios.length)} ways this week could hold it — pick the one that feels right.`
    post([scenariosMsg(body, scenarios)])
    /* the CHOICES_POSTED token is deliberately shared with offer_choices: one
       token means "the ask is on screen — end the turn", for every model and
       for the keyless floor, so the two paths can never disagree. */
    return `${CHOICES_POSTED}: ${scenarios.map((sc) => `"${sc.name}"`).join(' · ')}. Say nothing more and END your turn — the pick (or the user's own typed words) arrives as the next user message.`
  }

  function execRemove(
    query: string,
    opts: { at?: string; all?: boolean; scope?: RecurScope } = {}
  ): string {
    const s = get()
    const todayKey = dayKey(new Date(s.nowMs))
    /* #343: "the whole series" (scope:'series') sweeps the linked set exactly as
       an explicit all does — both flow through seriesOf below. */
    const scope = opts.scope
    const wholeSeries = opts.all || scope === 'series'
    /* a referent/positional sentinel points at ONE concrete block (#320): the
       clarifier owns absent/ambiguous, and a hit drops exactly that one (no
       at/all pinning). A plain title keeps resolveRemoval's own matching —
       start-time pins, whole-series sweeps, and the ask-which-one path. */
    let matches: Block[] = []
    let candidates: Block[] = []
    let doneProposal: Block[] = []
    const ref = resolveTarget(query, 'remove')
    if ('reply' in ref) return ref.reply
    if ('block' in ref) {
      // a tapped/last-touched done block is named explicitly → propose, not drop
      if (ref.block.status === 'done') doneProposal = [ref.block]
      else matches = [ref.block]
    } else {
      ;({ remove: matches, candidates } = week.resolveRemoval(
        s.blocks,
        query,
        { at: opts.at, all: wholeSeries },
        todayKey
      ))
      /* no OPEN target by that name — it may name DONE block(s). The cage lifts
         for explicit single-target intent (#334): propose a one-tap confirm
         rather than refusing ("mews are protected"). clear_blocks keeps the
         silent-collateral guard; this is the named-intent exception. */
      if (!matches.length && !candidates.length) {
        const atMin = opts.at ? parseTimeValue(opts.at) : null
        const r = week.findTarget(s.blocks, query, todayKey, { at: atMin, includeDone: true })
        const hits = r.status === 'ok' ? [r.block] : r.status === 'ambiguous' ? r.candidates : []
        doneProposal = hits.filter((b) => b.status === 'done')
      }
    }
    if (doneProposal.length) return proposeDoneRemoval(baseOf(query), doneProposal, todayKey)
    /* #343 recurring-edit scope: the delete landed on ONE live series and the ask
       named no scope → offer this / following / series, rather than a per-
       occurrence time list or a silent single drop. An explicit scope/all skips
       it: 'following' splits, 'this' drops the next occurrence alone, and
       series/all fall through to the whole-series sweep below. */
    const seriesTarget = recurringSeriesTarget(matches.length ? matches : candidates)
    if (seriesTarget && !scope && !wholeSeries) {
      const base = baseOf(query)
      const at = fmtTime(seriesTarget.startMin)
      return offerRecurringScope(base, (sc) =>
        sc === 'series' ? `remove all ${base}` : `remove ${base} at ${at} ${scopeWord(sc)}`
      )
    }
    if (seriesTarget && scope === 'following') return removeSeriesFollowing(seriesTarget, todayKey)
    if (seriesTarget && scope === 'this') {
      matches = [seriesTarget] // "just this one" = the next occurrence, dropped alone
      candidates = []
    }
    /* several share the title and nothing singled one out — name them with
       their times and ask, rather than dropping a block they didn't mean */
    if (!matches.length && candidates.length > 1) {
      const when = (b: Block) =>
        `the ${fmtTime(b.startMin)} (${b.dayKey === todayKey ? '' : `${fmtDowLong(b.dayKey)} `}${fmtTime(b.startMin)}–${fmtTime(b.endMin)})`
      const list = candidates.map(when)
      const tail =
        list.length === 2
          ? `${list[0]} or ${list[1]}`
          : `${list.slice(0, -1).join(', ')}, or ${list[list.length - 1]}`
      const base = query.split('—')[0].trim()
      /* the question rides a chips message (#254) — the same structure the
         offer_choices tool posts, so the keyless floor gets clickable answers
         too. Each reply is a complete remove the parser (and any model) acts
         on; times dedupe because `at` pins by start minute — one chip removes
         exactly what typing that time would. ≤5 chips: 4 times + the sweep. */
      const seen = new Set<string>()
      const timeOptions = candidates
        .filter((b) => {
          const t = fmtTime(b.startMin)
          if (seen.has(t)) return false
          seen.add(t)
          return true
        })
        .slice(0, 4)
        .map((b) => ({
          label: `the ${fmtTime(b.startMin)}`,
          reply: `remove ${base} ${fmtTime(b.startMin)}`,
        }))
      return execOfferChoices(
        `${candidates.length} "${base}" blocks ahead — ${tail}? Tell me which, or say "both" to drop them all.`,
        [
          ...timeOptions,
          { label: candidates.length === 2 ? 'both' : 'all of them', reply: `remove all ${base}` },
        ]
      )
    }
    if (!matches.length) return `I couldn't find "${query}" ahead to remove — say it another way?`
    /* "drop all the gym sessions" (#159): an explicit all over a recurring block
       removes the WHOLE linked series (every open occurrence, past or ahead),
       not just the ahead substring matches — so the recurringBlockId drops with
       it and nothing is orphaned. A single delete (no `all`) stays a single
       occurrence: the rule and the rest of the series live on. */
    const removeSet = new Map<string, Block>()
    for (const m of matches) {
      const group = wholeSeries ? week.seriesOf(s.blocks, m) : [m]
      for (const b of group) removeSet.set(b.id, b)
    }
    const removed = [...removeSet.values()]
    /* the touched block is gone — a dangling "it" would resolve to nothing, so
       clear it (subsequent "it" then asks, never guesses) (#320) */
    if (removed.some((b) => b.id === get().lastReferent?.blockId)) clearReferent()
    /* imported events CAN be removed now — tombstone them so a re-sync won't
       resurrect them; everything else just deletes */
    dismissExternal(removed)
    const keep = new Set(removed.map((b) => b.id))
    const kept = s.blocks.filter((b) => !keep.has(b.id))
    set({ blocks: kept, nowMs: nowFn() })
    persistBlocks(kept)
    storage.deleteBlocks(removed.map((b) => b.id)).catch(() => {})
    const fromCal = removed.filter((b) => b.external).length
    /* a whole-series sweep reads as "gym × 24", not 24 listed times */
    const seriesRemoved = removed.filter((b) => b.recurringBlockId).length
    const names =
      seriesRemoved > 1 && seriesRemoved === removed.length
        ? `${removed[0].title.split('—')[0].trim()} × ${seriesRemoved} sessions`
        : removed
            .map(
              (b) =>
                `${b.title.split('—')[0].trim()} (${b.dayKey === todayKey ? 'today' : fmtDowLong(b.dayKey)} ${fmtTime(b.startMin)})`
            )
            .join(', ')
    return `Removed — ${names}.${fromCal ? ` (${fromCal} from a connected calendar — won't come back on the next sync.)` : ''}`
  }

  /** ONE home for "a capture becomes a block": place, mark, announce. Used by
      the when-where accept, the thread rail's place, and the #348 inbox confirm.
      The user already chose the slot, so start stands; `durationMin` is the
      caller's (the 30-min quick-slot default, or the inbox offer's sized hint),
      and the resolver (#328) fills the softer spec a confirmed rule may know —
      the tag, attention, protection — so a captured "deck" lands as its usual
      kind. No rule ⇒ the work-tagged default, byte-identical to before. */
  function placeCaptureAt(
    cap: Capture,
    toDayKey: string,
    startMin: number,
    durationMin = DEFAULT_DURATION_MIN
  ): boolean {
    const s = get()
    const { spec: prefd } = resolveTaskSpec(
      cap.title,
      {},
      activePrefsFrom(s.memory, brainOn() ? brainPrefs : null),
      undefined, // duration is the caller's (the quick-slot default or the inbox offer)
      learnedRules(s)
    )
    const placed = week.place(s.blocks, {
      title: cap.title,
      tag: prefd.tag ?? 'work',
      dayKey: toDayKey,
      startMin,
      durationMin,
      ...(prefd.protected != null ? { protected: prefd.protected } : {}),
      ...(prefd.attention != null ? { attention: prefd.attention } : {}),
    })
    if (!placed) return false
    setBlocks([...s.blocks, placed])
    const updated: Capture = { ...cap, status: 'placed', placedBlockId: placed.id }
    set((st) => ({ captures: st.captures.map((c) => (c.id === cap.id ? updated : c)) }))
    persistCaptures([updated])
    const todayKey = dayKey(new Date(s.nowMs))
    post([
      mewMsg(
        `Placed — "${cap.title}" lives ${toDayKey === todayKey ? 'today' : fmtDowLong(toDayKey)} at ${fmtTime(startMin)}.`
      ),
    ])
    return true
  }

  function execAnalyze(dayOffset: number): string {
    const s = get()
    const todayKey = dayKey(new Date(s.nowMs))
    const key = addDaysKey(todayKey, dayOffset)
    const fromMin = key === todayKey ? minOfDay(new Date(s.nowMs)) : 0
    const shape = dayShape(s.blocks, key, fromMin)
    const agg = aggregates(s.memory, new Date(s.nowMs))
    const deepH = Math.round((week.plannedDeepMin(s.blocks, key) / 60) * 2) / 2
    const load =
      agg.realisticBestH != null && deepH > agg.realisticBestH * 1.2
        ? ` · planned deep work ${deepH}h vs realistic best ~${agg.realisticBestH}h — consider right-sizing`
        : ''
    const label = key === todayKey ? 'today' : fmtDowLong(key)
    return `Day shape (${label}, from ${fmtTime(fromMin)}): ${shape.lines.join(' · ')}${load}`
  }

  /* list_blocks (#333): MEW's eyes on the calendar — the itemized, addressable
     readout analyze lacks. Read-only like execAnalyze: reads the live week and
     hands it to the pure formatter, mutating nothing and taking no snapshot. */
  function execListBlocks(day: number | 'week', tag?: import('../domain/types').Tag): string {
    const s = get()
    const todayKey = dayKey(new Date(s.nowMs))
    const dayKeys =
      day === 'week'
        ? Array.from({ length: 7 }, (_, i) => addDaysKey(todayKey, i))
        : [addDaysKey(todayKey, day)]
    return listReadout(s.blocks, { dayKeys, todayKey, tag })
  }

  function execFindSlot(
    durationMin: number,
    dayOffset: number,
    notBeforeMin?: number,
    notAfterMin?: number
  ): string {
    const s = get()
    const todayKey = dayKey(new Date(s.nowMs))
    const key = addDaysKey(todayKey, dayOffset)
    const label = key === todayKey ? 'today' : fmtDowLong(key)
    const bufferMin = s.settings.meetingBufferMin ?? 0 // #302: shy of meeting edges
    const floor = Math.max(
      notBeforeMin ?? week.DAY_START,
      key === todayKey ? minOfDay(new Date(s.nowMs)) + 5 : 0
    )
    const ceil = notAfterMin ?? 22 * 60 + 30
    const fit = week
      .freeWindows(s.blocks, key, floor, ceil, bufferMin)
      .find((w) => w.endMin - w.startMin >= durationMin)
    if (fit) {
      return `Clear window ${label}: ${fmtTime(fit.startMin)}–${fmtTime(fit.startMin + durationMin)} (checked against every time-holding block${notAfterMin ? `, ends before ${fmtTime(ceil)}` : ''}).`
    }
    /* honest alternatives: same day without the ceiling, then tomorrow */
    const later = week
      .freeWindows(s.blocks, key, floor, 22 * 60 + 30, bufferMin)
      .find((w) => w.endMin - w.startMin >= durationMin)
    const nextKey = addDaysKey(key, 1)
    const nextDay = week
      .freeWindows(s.blocks, nextKey, 9 * 60, 22 * 60 + 30, bufferMin)
      .find((w) => w.endMin - w.startMin >= durationMin)
    const alts = [
      later
        ? `later ${label} ${fmtTime(later.startMin)}–${fmtTime(later.startMin + durationMin)}`
        : null,
      nextDay
        ? `${nextKey === addDaysKey(todayKey, 1) ? 'tomorrow' : fmtDowLong(nextKey)} ${fmtTime(nextDay.startMin)}–${fmtTime(nextDay.startMin + durationMin)}`
        : null,
    ].filter(Boolean)
    return `No clear ${durationMin}-min window ${label}${notAfterMin ? ` before ${fmtTime(ceil)}` : ''} — every gap is held by something fixed or committed.${alts.length ? ` Nearest clear options: ${alts.join(', or ')}.` : ''}`
  }

  /* suggest_slots: hand the model the scoring oracle's ranked, conflict-free
     candidates (#80) so it places into vetted air. Read-only and keyless —
     scoreSlots scores deterministically; a brain only enriches later. */
  function execSuggestSlots(
    title: string,
    tag: import('../domain/types').Tag,
    durationMin: number,
    dueMin?: number,
    window?: TimeWindow
  ): string {
    const clean = title.trim()
    if (!clean) return 'name the task and I will rank where it fits best.'
    const s = get()
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    const prefs = activePrefsFrom(s.memory, brainOn() ? brainPrefs : null)
    const q: SlotQuery = {
      title: clean,
      tag,
      durationMin,
      ...(dueMin != null ? { due: dueMin } : {}),
      ...(window ? { window } : {}),
    }
    const ranked = scoreSlots(
      s.blocks,
      q,
      todayKey,
      minOfDay(now),
      prefs,
      undefined, // weights: the default profile
      undefined, // horizonDays: the default week
      undefined, // mealBase: the circadian default (#298)
      s.settings.meetingBufferMin ?? 0 // #302: shy of external meetings
    )
    if (!ranked.length) {
      return `No conflict-free ${durationMin}-min slot for "${clean}"${dueMin != null ? ' before its deadline today' : ' in the next week'} — every fit is held by something fixed. Shorten it or free some time.`
    }
    const label = (k: string) =>
      k === todayKey ? 'today' : k === addDaysKey(todayKey, 1) ? 'tomorrow' : fmtDowLong(k)
    const top = ranked
      .slice(0, 4)
      .map((c) => `${label(c.dayKey)} ${fmtTime(c.startMin)}–${fmtTime(c.endMin)} (${c.why})`)
    return `Best slots for "${clean}", highest first: ${joinHuman(top)}. Place the first unless the user wants another.`
  }

  function execClear(scope: import('../domain/types').ClearScope): string {
    const s = get()
    const todayKey = dayKey(new Date(s.nowMs))
    const weekEnd = addDaysKey(todayKey, 6 - ((new Date(s.nowMs).getDay() + 6) % 7))
    /* the day-window this scope covers — the broom's reach; open/done is decided
       on top of it so both share one definition of "in scope" */
    const inDayScope = (b: Block) => {
      switch (scope) {
        case 'today':
          return b.dayKey === todayKey
        case 'tomorrow':
          return b.dayKey === addDaysKey(todayKey, 1)
        case 'week':
          return b.dayKey >= todayKey && b.dayKey <= weekEnd
        default:
          return b.dayKey >= todayKey
      }
    }
    const inScope = (b: Block) => b.status === 'open' && !b.external && inDayScope(b)
    const removed = s.blocks.filter(inScope)
    /* the mews the broom keeps (the silent-collateral guard holds): never swept,
       but no longer walled off — surfaced as a selectable removal offer (#334) */
    const doneInScope = s.blocks.filter((b) => b.status === 'done' && !b.external && inDayScope(b))
    if (!removed.length && !doneInScope.length)
      return `Nothing to clear ${scope === 'upcoming' ? 'ahead' : scope} — it's already a blank page.`
    const kept = s.blocks.filter((b) => !inScope(b))
    const keptExternal = s.blocks.filter(
      (b) => b.external && b.status === 'open' && b.dayKey >= todayKey
    ).length
    if (removed.length) {
      set({ blocks: kept })
      persistBlocks(kept)
      storage.deleteBlocks(removed.map((b) => b.id)).catch(() => {})
    }
    const scopeLabel =
      scope === 'today'
        ? 'today'
        : scope === 'tomorrow'
          ? 'tomorrow'
          : scope === 'week'
            ? 'this week'
            : 'ahead'
    /* a deliberate blank page is a temporal landmark — offer the fresh start.
       Surface any kept mews as selectable removals too, so "clear my evening"
       that hit three done blocks proposes them instead of walling them off. */
    setTimeout(() => {
      if (removed.length) fireEventNudges({ justCleared: { scope, count: removed.length } })
      if (doneInScope.length) proposeDoneRemoval(`${scopeLabel} done`, doneInScope, todayKey)
    }, 0)
    if (!removed.length)
      return `Nothing open to clear ${scopeLabel} — but ${spell(doneInScope.length)} completed block${doneInScope.length === 1 ? '' : 's'} sit there. They're mews, so they stay by default; I've offered them for removal if you want the slate truly blank.`
    return `Cleared — ${removed.length} open block${removed.length === 1 ? '' : 's'} ${scopeLabel} removed. Your mews stay counted${keptExternal ? `, and ${keptExternal} synced calendar event${keptExternal === 1 ? '' : 's'} stay (not mine to delete)` : ''}${doneInScope.length ? `. ${spell(doneInScope.length)} completed block${doneInScope.length === 1 ? '' : 's'} stayed — I've offered ${doneInScope.length === 1 ? 'it' : 'them'} for removal if you want` : ''}. A blank page — say the word and we'll shape it.`
  }

  /* undo_last_action (#162): reverse the turn's most recent mutating tool by
     restoring the pre-call snapshot. Read-only when nothing has changed this
     exchange. Diffs snapshot↔live to (a) describe what came back in MEW's voice
     and (b) drive storage: blocks the call ADDED are deleted, everything from
     the snapshot is re-put (so a remove/clear/move/edit is reversed too), and
     memory events the call logged (completed, drift, a stated preference) are
     cleared. Chat is untouched — the reply about the undone action stays as
     context. The snapshot is consumed: a second "undo that" with nothing new
     finds none and says so (one step back, not a history rewind). */
  function execUndo(): string {
    const snap = preMutationSnapshot
    if (!snap) return `nothing to undo yet — I haven't changed the week this turn.`
    const s = get()

    const snapBlockIds = new Set(snap.blocks.map((b) => b.id))
    const liveBlockById = new Map(s.blocks.map((b) => [b.id, b]))
    const added = s.blocks.filter((b) => !snapBlockIds.has(b.id)) // placed this call → drop
    const removed = snap.blocks.filter((b) => !liveBlockById.has(b.id)) // deleted/cleared → bring back
    const changed = snap.blocks.filter((b) => {
      const live = liveBlockById.get(b.id)
      return live && live !== b // moved/edited (object replaced) → put back
    })
    const addedCaptureIds = s.captures
      .filter((c) => !snap.captures.some((p) => p.id === c.id))
      .map((c) => c.id)
    const snapMemIds = new Set(snap.memory.map((e) => e.id))
    const liveMemIds = new Set(s.memory.map((e) => e.id))
    const droppedMemIds = [...liveMemIds].filter((id) => !snapMemIds.has(id)) // notes this call logged → drop
    /* events the call DELETED (a done-block removal drops its completion, #334)
       must be re-put, not just restored in state — else undo brings the mew back
       on screen but a reload loses it again. */
    const restoredMem = snap.memory.filter((e) => !liveMemIds.has(e.id))

    if (
      !added.length &&
      !removed.length &&
      !changed.length &&
      !addedCaptureIds.length &&
      !droppedMemIds.length &&
      !restoredMem.length
    ) {
      preMutationSnapshot = null
      return `nothing to undo — the last step changed nothing.`
    }

    /* restore the live state in one pass, then mirror to storage. nowMs ticks
       with the change so liveNow/the dial reflect the rollback this frame. */
    set({ blocks: snap.blocks, captures: snap.captures, memory: snap.memory, nowMs: nowFn() })
    persistBlocks(snap.blocks)
    if (added.length) storage.deleteBlocks(added.map((b) => b.id)).catch(() => {})
    if (snap.captures.length) persistCaptures(snap.captures)
    persistDeleteCaptures(addedCaptureIds)
    persistDeleteMemory(droppedMemIds)
    if (restoredMem.length) persistMemory(restoredMem) // bring back a deleted completion event (#334)
    /* a reversed `remember` must leave the standing rulebook as it was — the
       local memory event is already gone above; refresh the brain-backed cache
       too (the brain's own copy is append-only and not ours to retract here). */
    if (droppedMemIds.length) refreshBrainPrefs()

    preMutationSnapshot = null // one step back; a second undo finds nothing new

    /* describe what came back, in MEW's voice — the model confirms from this */
    const base = (b: Block) => b.title.split('—')[0].trim()
    const parts: string[] = []
    if (added.length)
      parts.push(
        `took back ${added.length === 1 ? `the ${base(added[0])} block` : `the ${spell(added.length)} blocks`} I'd just placed`
      )
    if (removed.length)
      parts.push(
        `brought back ${removed.length === 1 ? base(removed[0]) : `${spell(removed.length)} blocks`}`
      )
    if (changed.length)
      parts.push(
        `put ${changed.length === 1 ? base(changed[0]) : `${spell(changed.length)} blocks`} back where ${changed.length === 1 ? 'it' : 'they'} ${changed.length === 1 ? 'was' : 'were'}`
      )
    if (addedCaptureIds.length) parts.push(`cleared the note I'd jotted`)
    return `Undone — ${joinHuman(parts)}.`
  }

  /** Chat history → model thread. Nudges ride along as labeled assistant turns.
      Tool cards never do (#282): they're receipts for humans — the SDK's own
      loop already carried the tool results within their turn, and replaying
      them as prose would double the model's ground truth. */
  function buildThread(chat: ChatMessage[]): ChatTurn[] {
    return chat
      .filter((m) => m.role !== 'tool')
      .filter((m) => m.body.trim())
      .slice(-16)
      .map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        text: m.role === 'nudge' ? `[nudge · ${m.nudgeLabel ?? m.nudgeType}] ${m.body}` : m.body,
      }))
  }

  return {
    hydrated: false,
    blocks: [],
    captures: [],
    chat: [],
    chatHasEarlier: false,
    memory: [],
    settings: DEFAULT_SETTINGS,

    page: 'week',
    view: 'focus',
    onboardingStep: 'tour',
    weekOffset: 0,
    focusedDayKey: null,
    nowMs: nowFn(),
    scrollToMsgId: null,
    celebratePulse: 0,
    thinking: false,
    workingStatus: null,
    promptDraft: '',
    queuedSpeak: null,
    lastReferent: null,
    brainSidecar: 'off',

    engine: { lastFired: {}, lastDriftBlockId: null },
    lastActivityMs: nowFn(),
    guardUntilMin: null,
    guardDayKey: null,
    queuedNudges: [],
    lastTickDay: dayKey(new Date()),

    googlePicker: null,
    connecting: false,
    syncing: false,
    lastSyncAt: 0,
    syncError: null,

    commandPaletteOpen: false,
    commandPaletteMode: 'command',
    weeklyReviewOpen: false,
    hotkeyCollision: false,

    queryBrain(question: string) {
      return execQueryBrain(question)
    },

    async hydrate() {
      subscribeUpdateOffers()
      connectSidecarBrain()
      connectShellTray()
      const loaded = await storage.load()
      if (loaded.blocks.length === 0 && loaded.memory.length === 0) {
        const s = seed(new Date(nowFn()))
        set({
          blocks: s.blocks,
          memory: s.memory,
          chat: s.chat,
          chatHasEarlier: false, // a fresh seed IS the whole history
          settings: s.settings,
          hydrated: true,
          nowMs: nowFn(),
        })
        await Promise.all([
          storage.putBlocks(s.blocks),
          storage.putMemory(s.memory),
          storage.putChat(s.chat),
          storage.putSettings(s.settings),
        ]).catch(() => {})
        /* desktop first boot on an empty DB: a disk backup may hold the real
           week — offer it in chat. Suggest, don't seize: restore only on accept. */
        if (isTauri()) {
          void (async () => {
            const json = await readBackup()
            if (!json) return
            const when = (await latestBackupDate()) ?? 'earlier'
            post([
              {
                id: uid(),
                role: 'nudge',
                body: `found a backup from ${when} in Documents/MEW — want me to bring it back?`,
                ts: nowFn(),
                nudgeType: 'restore',
                nudgeLabel: 'backup found',
                actions: [
                  { id: 'accept', label: 'bring it back', kind: 'primary' },
                  { id: 'decline', label: 'start fresh', kind: 'secondary' },
                ],
              },
            ])
          })()
        }
      } else {
        /* loaded.chat is the newest window (#250 phase 2); counting after the
           load keeps the flag exact even if load's recovery cleared the table */
        const chatTotal = await storage.countChat().catch(() => loaded.chat.length)
        // merge so settings keys added in newer versions (pet, themeMode, …) backfill
        const settings = { ...DEFAULT_SETTINGS, ...(loaded.settings ?? {}) }
        /* the persisted dedupe keys come back before the first tick — a brief
           that fired this morning must not fire again (#285). One heal: a
           ritual that fired INTO the quiet-hours queue dies with the queue on
           restart (queuedNudges is in-memory), leaving a burned key and no
           delivery. Chat is the source of truth: today's key with no ritual
           card in today's chat means the user never got it — drop the key so
           it re-fires (late is honest; the re-fire writes a fresh key, so
           once-per-day still holds). */
        const bootDay = dayKey(new Date(nowFn()))
        const lastFired = { ...(settings.nudgeLastFired ?? {}) }
        for (const ritual of ['morning-brief', 'evening-wrap'] as const) {
          const delivered = loaded.chat.some(
            (m) => m.nudgeType === ritual && dayKey(new Date(m.ts)) === bootDay
          )
          if (lastFired[ritual]?.key === bootDay && !delivered) delete lastFired[ritual]
        }
        /* the weekly ritual (#304) heals by the same chat-as-truth rule at
           week scope: this ISO week's key with no ritual card anywhere in
           this week's chat means the invite never landed — drop the key so
           it re-fires (the re-fire writes a fresh key; once-per-week holds) */
        const bootWeek = weekKey(new Date(nowFn()))
        const ritualDelivered = loaded.chat.some(
          (m) => m.nudgeType === 'weekly-ritual' && weekKey(new Date(m.ts)) === bootWeek
        )
        if (lastFired['weekly-ritual']?.key === bootWeek && !ritualDelivered) {
          delete lastFired['weekly-ritual']
        }
        /* heal blocks whose source calendar is gone (restored backup, cleared
           connections): adopt them as MEW's own so sync can place them again */
        const swept = adoptOrphanedExternals(loaded.blocks, settings.calendars)
        /* the scaffold key (#299) heals by the same chat-as-truth rule: today's
           key with NO meal-class block on today AND no scaffold line in today's
           chat means the pass never landed — drop the key so it re-runs (the
           re-run writes a fresh key, so once-per-day still holds). Either
           artifact standing keeps the key: meal blocks mean the day is fed,
           the line means it already spoke. */
        if (lastFired.sustenance?.key === bootDay) {
          const fed = swept.blocks.some(
            (b) => b.dayKey === bootDay && b.status !== 'rolled' && mealClassOf(b.title) != null
          )
          const said = loaded.chat.some(
            (m) =>
              m.role === 'mew' &&
              m.body.startsWith('fed and paced') &&
              dayKey(new Date(m.ts)) === bootDay
          )
          if (!fed && !said) delete lastFired.sustenance
        }
        /* a `running` tool card in storage means the app closed mid-tool —
           replay it honestly as `interrupted`, never as a live shimmer (#282) */
        const cards = interruptStoredToolCards(loaded.chat)
        set({
          blocks: swept.blocks,
          captures: loaded.captures,
          chat: cards.msgs,
          chatHasEarlier: chatTotal > loaded.chat.length,
          memory: loaded.memory,
          settings,
          engine: { lastFired, lastDriftBlockId: null },
          hydrated: true,
          nowMs: nowFn(),
        })
        if (swept.adopted) persistBlocks(swept.blocks)
        if (cards.flipped.length) persistChat(cards.flipped)
      }
      /* the persisted binding registers on every desktop boot — and again
         after a restore re-hydrates (#284); null keeps the OS untouched
         beyond releasing whatever this session held */
      if (isTauri()) void syncCaptureHotkey(get().settings.globalCaptureHotkey)
      runTickEngine({ skipLearn: true })
      /* an update announced during boot waits for chat to exist */
      if (stagedUpdateVersion) {
        offerUpdate(stagedUpdateVersion)
        stagedUpdateVersion = null
      }
      refreshBrainPrefs()
      /* a brain already on at boot (persisted Settings opt-in, or a sidecar
         adopted before memory loaded) gets its offer now that memory exists */
      maybeBackfillBrain()
    },

    async loadEarlierChat() {
      /* one page in flight at a time: the sentinel can fire repeatedly while
         a slow read runs, and a doubled prepend would duplicate rows */
      if (earlierChatPending) return earlierChatPending
      const head = get().chat[0]
      if (!head || !get().chatHasEarlier) return 0
      earlierChatPending = (async () => {
        try {
          const older = await storage.loadChatBefore(head.ts, head.id, EARLIER_CHAT_PAGE)
          /* stored pages hydrate too: a `running` card in an older page maps
             to `interrupted` exactly as boot does — never a shimmer (#282) */
          const cards = interruptStoredToolCards(older)
          if (older.length) set((s) => ({ chat: [...cards.msgs, ...s.chat] }))
          if (cards.flipped.length) persistChat(cards.flipped)
          /* a short page means the table's head is reached — the sentinel
             yields to the beginning-of-session endstop */
          if (older.length < EARLIER_CHAT_PAGE) set({ chatHasEarlier: false })
          return older.length
        } catch {
          return 0 // a failed read leaves the flag on — scrolling retries
        } finally {
          earlierChatPending = null
        }
      })()
      return earlierChatPending
    },

    tick() {
      const prevDay = get().lastTickDay
      const nowMs = nowFn()
      const todayKey = dayKey(new Date(nowMs))
      set({ nowMs })

      if (todayKey !== prevDay) {
        /* day rollover: log whether yesterday's rest was honored */
        const s = get()
        const yRest = week.blocksForDay(s.blocks, prevDay).find((b) => b.tag === 'rest')
        if (yRest) {
          const workLeftOpen = week.openItems(s.blocks, prevDay).length > 0
          logMemory({
            kind: workLeftOpen ? 'rest_skipped' : 'rest_kept',
            dayKey: prevDay,
            ts: nowMs,
          })
        }
        /* overnight consolidation (PRD §8): compact old raw events per ISO week */
        if (s.settings.overnightConsolidation) {
          const result = consolidate(get().memory, new Date(nowMs), uid)
          if (result.removedIds.length) {
            set({ memory: result.kept })
            storage.deleteMemory(result.removedIds).catch(() => {})
            persistMemory(result.summaries)
          }
        }
        set({ lastTickDay: todayKey, guardUntilMin: null, guardDayKey: null })
        clearReferent() // a new day: yesterday's "it" no longer means anything (#320)
      }

      /* quiet hours over → flush the queue into chat (morning catch-up) */
      const s = get()
      const nowMin = minOfDay(new Date(nowMs))
      if (s.queuedNudges.length && !inQuietHours(nowMin, s.settings.quietHours)) {
        post(s.queuedNudges)
        set({ queuedNudges: [] })
      }

      /* background calendar sync every ~5 minutes when live calendars exist */
      const hasLive = s.settings.calendars.some((c) => c.kind === 'live')
      if (hasLive && !s.syncing && nowMs - s.lastSyncAt > 5 * 60_000) {
        void get().syncNow()
      }

      runTickEngine()
      pushTray()
    },

    activity() {
      set({ lastActivityMs: nowFn() })
    },

    interruption() {
      const s = get()
      const now = new Date(s.nowMs)
      const live = liveNow(s.blocks, dayKey(now), minOfDay(now))
      if (live.current && live.current.tag === 'work') {
        logMemory({ kind: 'interruption', dayKey: dayKey(now) })
      }
    },

    async speak(text: string) {
      const trimmed = text.trim()
      if (!trimmed) return
      post([{ id: uid(), role: 'user', body: trimmed, ts: nowFn() }])
      set({ thinking: true })
      turnInFlight = true // executors' nudges park until this turn finishes (#115)
      /* a fresh exchange — "undo that" reaches only this turn's last action
         (#162). The one exception: a scenario pick just applied outside any
         turn (#293) — its snapshot survives THIS entry so the immediate
         "undo that" can take the picked plan back. */
      if (pickSnapshotHolds) pickSnapshotHolds = false
      else preMutationSnapshot = null
      /* fresh cancel handle for this turn; .signal rides into the adapter so a
         user 'stop' aborts the live stream/fetch (#117) */
      const abort = new AbortController()
      turnAbort = abort

      let acted = false // once the week mutated, never re-run the message through a fallback
      /* mew text already closed into the log this turn (#282): a tool card cut
         the streamed row loose mid-reply, so `reply.buffer` no longer vouches
         for it — this flag does, keeping the no-replay law exactly as strong */
      let spoke = false
      /* the live attempt's stream row — assigned per adapter in the loop below;
         the tool wrappers reach it through here to keep the log chronological */
      let reply: ReturnType<typeof streamedReply> | null = null
      /* #325 — the store is the behavior net for a flailed correction, because
         the model can't be trusted to obey MEW_VOICE alone (the live bug: five
         "you're right" messages + repeated find_slot — Dinner to move one
         block). Both guardrails are turn-scoped — they live in speak(), so a
         fresh turn starts clean. */
      const readOnlyTurnCache = new Map<string, string>()
      let apologyPosted = false
      /* a read-only slot query the model repeats for the SAME target this turn
         returns the first answer verbatim — no second executor run, no
         duplicate card. The executor already has the answer; re-asking is the
         flail. Keyed by tool+args, so a genuinely different query still runs. */
      const dedupReadOnly = (key: string, run: () => string): string => {
        const hit = readOnlyTurnCache.get(key)
        if (hit !== undefined) return hit
        const out = run()
        readOnlyTurnCache.set(key, out)
        return out
      }
      /* a committed streamed row whose whole body is acknowledgment is kept the
         first time and dropped after — the reshape and its one crisp line carry
         the correction. Substantive rows (the fix itself) never match, so they
         always stay. Returns true when it dropped the row. */
      const coalesceApology = (msg: ChatMessage): boolean => {
        if (!isAcknowledgmentOnly(msg.body)) return false
        if (apologyPosted) {
          set((s) => ({ chat: s.chat.filter((m) => m.id !== msg.id) }))
          return true
        }
        apologyPosted = true
        return false
      }
      /* mid-turn ordering (#282): a card is about to land — when reply text has
         already begun, close the live streamed row first, so post-tool deltas
         open a NEW mew row (text → card → text). The closed row is final:
         persist it and feed the brain sense exactly as stream-end would; a
         whitespace-only row is dropped the same way stream-end drops one. */
      const closeStreamRow = () => {
        const closed = reply?.closeRow()
        if (!closed) return
        if (!closed.body.trim()) {
          set((s) => ({ chat: s.chat.filter((m) => m.id !== closed.id) }))
          return
        }
        if (coalesceApology(closed)) return // #325: a repeated apology row is dropped
        spoke = true
        persistChat([closed])
        if (brainOn()) chatBatcher.add(closed, dayKey(new Date(get().nowMs)))
      }
      /* one short, positive label per tool — what MEW is doing right now. The
         thinking row shows it while `thinking`; speak's finally clears it. */
      const working = (label: string) => set({ workingStatus: label })
      /* every tool below (offerChoices excepted — its chips message IS the
         visible artifact) also leaves one activity card in the log (#282):
         closeStreamRow keeps the chronology, runToolWithCard owns the card's
         append→settle lifecycle and rethrows errors unchanged. */
      /* snapshot the mutable week just before a mutating tool runs, so
         undo_last_action can take back exactly that one change (#162). The
         read-only tools below never snapshot — there's nothing to reverse. */
      const exec: ToolExecutor = {
        plan: (places, frees) => {
          acted = true
          snapshotForUndo()
          working('placing blocks…')
          closeStreamRow()
          return runToolWithCard('plan', { places, frees }, () => execPlan(places, frees))
        },
        complete: (q, at) => {
          acted = true
          snapshotForUndo()
          working('marking it done…')
          closeStreamRow()
          return runToolWithCard('complete', { query: q }, () => execComplete(q, at))
        },
        move: (q, d, t, rel, at) => {
          acted = true
          snapshotForUndo()
          working('moving it…')
          closeStreamRow()
          return runToolWithCard('move', { query: q, toDayOffset: d, toStartMin: t }, () =>
            execMove(q, d, t, rel, at)
          )
        },
        capture: (t) => {
          acted = true
          snapshotForUndo()
          working('jotting it down…')
          closeStreamRow()
          return runToolWithCard('capture', { title: t }, () => execCapture(t))
        },
        clear: (scope) => {
          acted = true
          snapshotForUndo()
          working('clearing the time…')
          closeStreamRow()
          return runToolWithCard('clear', { scope }, () => execClear(scope))
        },
        edit: (q, patch, at, scope) => {
          acted = true
          snapshotForUndo()
          working('reshaping it…')
          closeStreamRow()
          return runToolWithCard('edit', { query: q }, () => execEdit(q, patch, at, scope))
        },
        remove: (q, opts) => {
          acted = true
          snapshotForUndo()
          working('taking it off…')
          closeStreamRow()
          return runToolWithCard('remove', { query: q }, () => execRemove(q, opts))
        },
        analyze: (d) => {
          working('reading your week…')
          closeStreamRow()
          return runToolWithCard('analyze', { dayOffset: d }, () => execAnalyze(d)) // read-only: not an action
        },
        listBlocks: (day, tag) => {
          working('listing your blocks…')
          closeStreamRow()
          // read-only: not an action — no acted flag, no undo snapshot
          return runToolWithCard('listBlocks', { day, tag }, () => execListBlocks(day, tag))
        },
        findSlot: (dur, d, nb, na) =>
          /* #325: an identical slot query this turn returns the cached answer —
             no second run, no duplicate card */
          dedupReadOnly(`findSlot:${dur}:${d}:${nb ?? ''}:${na ?? ''}`, () => {
            working('finding a slot…')
            closeStreamRow()
            return runToolWithCard(
              'findSlot',
              { durationMin: dur, dayOffset: d, notBeforeMin: nb, notAfterMin: na },
              () => execFindSlot(dur, d, nb, na) // read-only
            )
          }),
        suggestSlots: (t, tag, dur, due, win) =>
          /* #325: the same target twice this turn collapses — the ranking
             already ran; the second call is the flail, not a new question */
          dedupReadOnly(`suggestSlots:${t}:${tag}:${dur}:${due ?? ''}:${win ?? ''}`, () => {
            working('finding a slot…')
            closeStreamRow()
            return runToolWithCard(
              'suggestSlots',
              { title: t, durationMin: dur },
              () => execSuggestSlots(t, tag, dur, due, win) // read-only
            )
          }),
        queryBrain: (q) => {
          working('checking what I know…')
          closeStreamRow()
          return runToolWithCard('queryBrain', { question: q }, () => execQueryBrain(q)) // read-only
        },
        remember: (pref) => {
          acted = true
          snapshotForUndo()
          working('remembering that…')
          closeStreamRow()
          return runToolWithCard('remember', { match: pref.match, value: pref.value }, () =>
            execRemember(pref)
          )
        },
        offerChoices: (prompt, options) => {
          /* chat-only, but the ask is now on screen — a fallback replay would
             double it, so the turn counts as acted. Never a snapshot: there is
             nothing week-side to undo (#254 law: this tool mutates nothing).
             No card either — the chips message IS the visible artifact. */
          acted = true
          working('offering choices…')
          closeStreamRow()
          return execOfferChoices(prompt, options)
        },
        proposeScenarios: (prompt, tasks) => {
          /* the #254 discipline exactly (#293): chat-only, the picker message
             is the visible artifact (no card), never a snapshot — proposing
             mutates nothing; the PICK snapshots before it applies. acted stays
             true even on the no-picker fall-throughs: a replay through a
             fallback adapter could double a posted picker, and skipping the
             replay on a read-only line is graceful, never a lie. */
          acted = true
          working('shaping the week…')
          closeStreamRow()
          return execProposeScenarios(prompt, tasks)
        },
        undoLast: () => {
          /* the reversal itself isn't a fresh action: it consumes the snapshot
             rather than taking one, so a misfired "undo that" can't be undone
             into a loop. acted stays as-is — the turn already mutated. */
          working('putting that back…')
          closeStreamRow()
          return runToolWithCard('undoLast', undefined, () => execUndo())
        },
        resize: (q, resize, at, scope) => {
          acted = true
          snapshotForUndo()
          working('resizing it…')
          closeStreamRow()
          return runToolWithCard('resize', { query: q }, () => execResize(q, resize, at, scope))
        },
        duplicate: (q, opts, at) => {
          acted = true
          snapshotForUndo()
          working('duplicating it…')
          closeStreamRow()
          return runToolWithCard(
            'duplicate',
            { query: q, toDayOffset: opts.toDayOffset, toStartMin: opts.toStartMin },
            () => execDuplicate(q, opts, at)
          )
        },
        relativeMove: (q, direction, amountMin, at) => {
          acted = true
          snapshotForUndo()
          working('nudging it…')
          closeStreamRow()
          return runToolWithCard('relativeMove', { query: q }, () =>
            execRelativeMove(q, direction, amountMin, at)
          )
        },
        giveRoom: (focusClass) => {
          acted = true
          snapshotForUndo()
          working('giving them room…')
          closeStreamRow()
          return runToolWithCard('giveRoom', { focusClass }, () => execGiveRoom(focusClass))
        },
      }

      try {
        /* hybrid recall rides into context — raced so a slow brain can never
           hold the turn hostage (history informs; liveNow decides). null from
           either leg = the brain didn't answer: the context carries an
           explicit degraded marker instead of a silence that would read as an
           empty history (#249) */
        let recallLines: string[] = []
        let recallDegraded = false
        if (brainOn()) {
          const today = week
            .blocksForDay(get().blocks, dayKey(new Date(get().nowMs)))
            .map((b) => b.title.split('—')[0].trim())
            .join(', ')
          const got = await Promise.race([
            brain.recall(`${text} · today: ${today}`, { limit: 5, scope: brainScope() }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), TURN_RECALL_RACE_MS)),
          ]).catch(() => null)
          if (got == null) recallDegraded = true
          else recallLines = got
        }
        const ctx = weekContext(get(), recallLines, recallDegraded)
        const thread = buildThread(get().chat)
        const adapters = selectAdapters(get().settings, () => new Date(nowFn()))
        const failed: string[] = []
        let lastModelErr: unknown = null // why a model adapter threw, for honest fallback copy

        for (const adapter of adapters) {
          /* the one per-chunk paint path (streamedReply, #281) — each text
             delta repaints the same growing message row. Assigned to speak's
             hoisted handle so the tool wrappers can close the live row (#282). */
          const live = streamedReply()
          reply = live
          try {
            for await (const chunk of adapter.converse(thread, ctx, exec, abort.signal)) {
              if (!chunk) continue
              if (typeof chunk !== 'string') {
                /* an activity chunk is what the model is doing right now while
                   nothing visible streams (#281) — show it on the status line
                   beside the dots, exactly like a tool's working label; never a
                   chat message. speak's finally clears it with the rest. */
                if ('activity' in chunk) {
                  working(chunk.activity)
                  continue
                }
                /* a reasoning chunk is the pre-action plan, not reply text — pin
                   it to the message (it renders as a collapsible note) and keep
                   going. It arrives BEFORE the first tool/text, so the snapshot
                   is on the record ahead of any mutation (#166). */
                live.attachReasoning(chunk.reasoning)
                continue
              }
              live.append(chunk)
            }
            if (live.msgId) {
              const final = get().chat.find((m) => m.id === live.msgId)
              if (final && !final.body.trim())
                set((s) => ({ chat: s.chat.filter((m) => m.id !== live.msgId) }))
              /* #325: a repeated apology tail is dropped — one acknowledgment
                 stands for the turn (the catch path stays as-is: an error is not
                 the flail, and a hiccuped turn keeps whatever streamed) */
              else if (final && !coalesceApology(final)) {
                persistChat([final])
                /* streamed replies bypass post() — feed the sense directly,
                   same brain-on gate as post() */
                if (brainOn()) chatBatcher.add(final, dayKey(new Date(get().nowMs)))
              }
            }
            if (failed.length && adapter.id === 'rules') {
              /* an upstream adapter threw and we've landed on the rules floor.
                 Tell the truth about WHY, per class (#153) — the fixes live in
                 different places: a rejected key (401/403) or unknown model
                 (404) is PERMANENT and points at Settings; a refused request
                 (400/422) is the model saying no — for a local model, usually
                 one that can't run tools; busy is transient. Only the LOCAL
                 busy line claims a retry, because only the local adapter
                 retries (the SDK's backoff) — remote fails fast to this floor
                 by design (#156), so its copy never claims a retry that didn't
                 happen. */
              const local = failed.includes('ollama')
              const kind = classifyFailure(lastModelErr)
              post([
                mewMsg(
                  kind === 'auth'
                    ? `(your API key was rejected — open Settings to check it. I handled this one myself.)`
                    : kind === 'model'
                      ? `(I couldn't reach that model — check the model name in Settings. I handled this myself.)`
                      : kind === 'rejected'
                        ? `(the model rejected that request — I handled this myself.)`
                        : kind === 'busy'
                          ? local
                            ? `(the local model was busy — I retried, then handled it myself.)`
                            : `(the model was busy — I handled this one myself.)`
                          : `(I couldn't reach the model just now — I handled this myself.)`
                ),
              ])
            }
            return
          } catch (err) {
            if (live.msgId) {
              const final = get().chat.find((m) => m.id === live.msgId)
              if (final?.body.trim()) {
                persistChat([final])
                /* streamed replies bypass post() — feed the sense directly,
                   same brain-on gate as post() */
                if (brainOn()) chatBatcher.add(final, dayKey(new Date(get().nowMs)))
              } else if (final) set((s) => ({ chat: s.chat.filter((m) => m.id !== live.msgId) }))
            }
            if (abort.signal.aborted) {
              /* the user pressed stop — a clean end, not a failure. Whatever
                 streamed or committed stays; never retry, never fall to the
                 rules floor (#117). The signal is the truth here, not the error
                 type, so a stop reads the same however the stream rejected. */
              post([mewMsg(`(stopped — what's above stands.)`)])
              return
            }
            if (acted || spoke || live.buffer.trim()) {
              /* the week already changed (or MEW already spoke — including a
                 row a tool card closed, #282) — finish honestly, don't replay */
              post([
                mewMsg(`(The connection hiccuped mid-thought — everything above did go through.)`),
              ])
              return
            }
            /* surface WHY (never swallow): the failed adapter's error drives
               the honest per-class fallback copy above (#153, local included —
               a 404'd model tag or a tool-less local model must not read as
               "busy"), and every non-rules failure is logged so a key/model/
               network cause is diagnosable in devtools. */
            if (adapter.id !== 'rules') lastModelErr = err
            if (adapter.id !== 'rules') log.error('model/adapter', { adapter: adapter.id }, err)
            failed.push(adapter.id)
          }
        }
      } finally {
        /* the turn is over (success, hiccup, or stop): flip the gate, then drain
           the parked nudges so nothing fired mid-stream is lost (#115). Order
           matters — flushPendingNudges posts straight to chat only with the
           gate already down. Drop this turn's cancel handle so a later
           stopSpeaking() can't abort the next turn (#117). */
        set({ thinking: false, workingStatus: null })
        turnInFlight = false
        if (turnAbort === abort) turnAbort = null
        flushPendingNudges()
        /* #280 — a message queued mid-turn sends as its own next turn. Every
           settle path (success, hiccup, stop) passes through this finally
           exactly once, so exactly-once falls out — and plain stop with a
           queued message IS stop-and-send, with the stop note already posted
           above. Take the value and null the slot BEFORE invoking (the next
           turn must start with an empty queue), then queueMicrotask so this
           turn fully unwinds before the fresh speak begins. */
        const queued = get().queuedSpeak
        if (queued != null) {
          set({ queuedSpeak: null })
          queueMicrotask(() => void get().speak(queued))
        }
      }
    },

    send(text: string) {
      const trimmed = text.trim()
      if (!trimmed) return // Enter on an empty draft stays a no-op
      if (!turnInFlight) {
        set({ promptDraft: '' })
        void get().speak(trimmed)
        return
      }
      /* mid-turn: park it (merging a second thought into the slot), one
         atomic set so the draft never lingers a render behind the queue */
      set((s) => ({
        queuedSpeak: s.queuedSpeak != null ? `${s.queuedSpeak}\n${trimmed}` : trimmed,
        promptDraft: '',
      }))
    },

    cancelQueuedSpeak() {
      const queued = get().queuedSpeak
      if (queued == null) return
      /* restore into the draft; anything typed since queueing stays, below it
         (same order the merge rule would have sent) — never lose a thought */
      set((s) => ({
        queuedSpeak: null,
        promptDraft: s.promptDraft.trim() ? `${queued}\n${s.promptDraft}` : queued,
      }))
    },

    stopSpeaking() {
      /* abort the live turn; speak's catch sees signal.aborted, keeps whatever
         streamed or committed, and ends cleanly without a fallback. No turn in
         flight → nothing to stop. The finally clears turnAbort, so a second
         press is a harmless no-op. */
      turnAbort?.abort()
    },

    noteReferent(blockId: string) {
      /* a tap on a block's detail card makes it the conversational "it" (#320)
         — the same slot the executors set when they act, so tap-then-"move it
         earlier" lands here. Ignore an unknown id (a stale card). */
      if (get().blocks.some((b) => b.id === blockId)) noteReferentId(blockId)
    },

    toggleComplete(blockId: string) {
      const s = get()
      const target = s.blocks.find((b) => b.id === blockId)
      if (!target) return
      if (target.status === 'done') {
        /* a misclick undo — remove the matching completion event too */
        const evIdx = [...s.memory]
          .reverse()
          .find(
            (e) =>
              e.kind === 'completed' &&
              e.dayKey === target.dayKey &&
              e.plannedMin === week.duration(target)
          )
        setBlocks(week.uncomplete(s.blocks, blockId))
        if (evIdx) set((st) => ({ memory: st.memory.filter((e) => e.id !== evIdx.id) }))
        return
      }
      if (target.status !== 'open') return
      const nowMs = nowFn()
      setBlocks(week.complete(s.blocks, blockId, nowMs))
      ingestBlockEvent(target, 'completed', minOfDay(new Date(nowMs)), nowMs)
      logMemory({
        kind: 'completed',
        dayKey: target.dayKey,
        tag: target.tag,
        plannedMin: week.duration(target),
        deep: week.isDeep(target),
        title: target.title,
        startMin: target.startMin,
        endMin: target.endMin,
        ...(target.attention ? { attention: target.attention } : {}), // #327 detection fuel
        ts: nowMs,
      })
      set({ celebratePulse: nowMs })
      const done = { ...target, status: 'done' as const, completedAt: nowMs }
      fireEventNudges({ justCompleted: done })
    },

    removeBlock(blockId: string) {
      /* the block-card remove affordance (#334): the card confirmed already; this
         is the same door the chat proposal's "remove it" chip runs, so a done
         block's completion event drops with it and the whole thing is undoable. */
      if (get().blocks.some((b) => b.id === blockId)) removeBlocksConfirmed([blockId])
    },

    async pickChoice(msgId: string, choiceId: string) {
      const s = get()
      /* chips park while a turn is in flight — a pick mid-turn would start a
         concurrent speak racing the live stream. turnInFlight is the phase
         authority (same gate send() queues on, #280): `thinking` alone is too
         narrow — it flips off at the first streamed token while the turn
         keeps running. */
      if (turnInFlight) return
      const msg = s.chat.find((m) => m.id === msgId)
      const choice = msg?.choices?.find((c) => c.id === choiceId)
      if (!msg || !choice) return
      if (!choicesActive(s.chat, msg)) return // picked or superseded — inert by law
      set((st) => ({
        chat: st.chat.map((m) =>
          m.id === msgId
            ? {
                ...m,
                choices: m.choices!.map((c) => (c.id === choiceId ? { ...c, picked: true } : c)),
              }
            : m
        ),
      }))
      const updated = get().chat.find((m) => m.id === msgId)
      if (updated) persistChat([updated]) // delta putChat, same as resolveNudge
      /* the pick IS the user's next message — the normal turn does the rest */
      await get().speak(choice.reply)
    },

    pickScenario(msgId: string, scenarioId: string) {
      const s = get()
      /* the same phase gate as pickChoice (#254/#280): a pick mid-turn would
         mutate the week under a live stream. turnInFlight is the authority —
         `thinking` alone flips off at the first streamed token. */
      if (turnInFlight) return
      const msg = s.chat.find((m) => m.id === msgId)
      const scenario = msg?.scenarios?.find((x) => x.id === scenarioId)
      if (!msg || !scenario) return
      if (!scenariosActive(s.chat, msg)) return // picked or superseded — inert by law

      const now = new Date(s.nowMs)
      const todayKey = dayKey(now)
      /* the staleness gate — at pick time, never at render: the quote must be
         appliable exactly as previewed. Same day zero (dayOffsets count from
         the scenario's todayKey), no today-place already behind the clock, and
         every place still conflict-free against the LIVE week. */
      const fresh =
        scenario.todayKey === todayKey &&
        !scenario.places.some((p) => p.dayOffset === 0 && p.startMin < minOfDay(now)) &&
        validateScenario(s.blocks, scenario)
      if (!fresh) {
        /* refuse kindly — never a lying apply — then offer the same shapes a
           fresh look at the week as it stands. Proposing mutates nothing, so
           the re-offer is safe outside a turn (the rescue-offer precedent);
           a fall-through line (one shape, nothing fits) posts as prose. */
        post([mewMsg('the week moved under this plan — want a fresh look?')])
        const offer = execProposeScenarios(
          '',
          scenario.places.map((p) => ({
            title: p.title,
            tag: p.tag,
            durationMin: p.durationMin,
            ...(p.due != null ? { due: p.due } : {}),
          }))
        )
        if (!offer.startsWith(CHOICES_POSTED)) post([mewMsg(offer)])
        return
      }

      /* settle the cards first (picked persists with the message, so the
         picker rehydrates settled), then apply the STORED places byte-exactly
         through the plan executor — the same door plan_blocks uses, receipt
         card included. Deterministic invocation of the stored quote; never a
         second derivation (#102). */
      set((st) => ({
        chat: st.chat.map((m) =>
          m.id === msgId
            ? {
                ...m,
                scenarios: m.scenarios!.map((x) =>
                  x.id === scenarioId ? { ...x, picked: true } : x
                ),
              }
            : m
        ),
      }))
      const updated = get().chat.find((m) => m.id === msgId)
      if (updated) persistChat([updated]) // delta putChat, same as pickChoice
      snapshotForUndo() // "undo that" must reach the applied plan (#162)
      pickSnapshotHolds = true // …across the next turn's fresh-exchange reset (#293)
      try {
        const line = runToolWithCard('plan', { places: scenario.places, frees: [] }, () =>
          execPlan(scenario.places, [])
        )
        post([mewMsg(line)])
      } catch (err) {
        /* runToolWithCard already settled the receipt card 'error' with its
           kind note — the card speaks for the step; keep the raw cause
           diagnosable and the pick handler quiet. */
        log.error('pickScenario/plan', {}, err)
      }
    },

    proposeScaffold(targetWeekKey?: string): boolean {
      const s = get()
      const now = new Date(s.nowMs)
      const todayKey = dayKey(now)
      /* default target = the coming week: "rough out NEXT week the way your weeks
         usually go." A caller may name any week. */
      const target = targetWeekKey ?? weekKey(new Date(s.nowMs + 7 * 24 * 60 * 60 * 1000))
      /* the whole draft is one pure, keyless call — confirmed rules + their
         recurrences + learned bands, laid around what already sits in the week
         (external events included). Nothing here mutates the week. */
      const specs = weekScaffold(s.memory, s.blocks, target, now)
      /* dayOffsets count from todayKey (the scenario contract); drop any place
         already behind us (a mid-week look at the current week), so a preview is
         always appliable and never lands in the past. */
      const dayOffsetOf = (key: string): number =>
        Math.round((fromDayKey(key).getTime() - fromDayKey(todayKey).getTime()) / 86_400_000)
      const places: ScenarioPlace[] = specs
        .filter((p) => p.dayKey >= todayKey && p.startMin != null && p.endMin != null)
        .map((p) => ({
          title: p.title,
          tag: p.tag,
          dayOffset: dayOffsetOf(p.dayKey),
          startMin: p.startMin!,
          durationMin: p.endMin! - p.startMin!,
          ...(p.due != null ? { due: p.due } : {}),
        }))
      if (!places.length) {
        /* honest empty: no learned shape yet (the data floor), or the week
           already holds it — an "I don't know your week" than a guessed week
           (the sustenance/review pattern: checked once, no theater). */
        post([
          mewMsg(
            "I don't know your week yet — once I've picked up a few of your rhythms, I'll rough one out for you to tweak."
          ),
        ])
        return false
      }
      const dayLoad: Record<string, number> = {}
      for (const p of places) {
        const key = addDaysKey(todayKey, p.dayOffset)
        dayLoad[key] = (dayLoad[key] ?? 0) + p.durationMin
      }
      const n = places.length
      const scenario: StoredScenario = {
        id: uid(),
        name: 'your usual week',
        line: `${spell(n)} block${n === 1 ? '' : 's'} the way your weeks usually go — laid around what's already there`,
        todayKey,
        places,
        dayLoad,
      }
      /* the same post-time gate the picker uses (#293): every stored place still
         lands conflict-free against the LIVE week. weekScaffold already fits
         around it, so this is belt-and-braces — a moved week just re-offers. */
      if (!validateScenario(s.blocks, scenario)) {
        post([mewMsg('your week is already shaped — nothing to rough out right now.')])
        return false
      }
      /* one picker message — chat-only data, exactly like propose_scenarios.
         Accept (pick) places it through the executor; tell them anything to
         change flows as an ordinary turn; leaving it settles like any offer.
         NOTHING commits here. */
      post([
        scenariosMsg(
          "here's next week, roughed out your usual way — accept it, tell me what to change, or leave it for now.",
          [scenario]
        ),
      ])
      return true
    },

    nudgeAction(msgId: string, actionId: string) {
      const s = get()
      const msg = s.chat.find((m) => m.id === msgId)
      if (!msg || msg.resolved || !msg.nudgeType) return
      const label = msg.actions?.find((a) => a.id === actionId)?.label ?? actionId
      const now = new Date(s.nowMs)
      const todayKey = dayKey(now)
      const payload = msg.payload ?? {}

      const accept = () => logOutcome(msg.nudgeType!, 'accepted')
      const decline = () => logOutcome(msg.nudgeType!, 'declined')

      /* the two notification quick-actions (#305), routed through the doors the
         checkbox and a move already use — never a second mutation path, so a
         toast-done logs the completed event exactly like the card. Handled for
         ANY nudge type: the pair is uniform, never per-type. A block that
         completed or moved between mirror and tap resolves quietly, no error. */
      if (actionId === 'done' || actionId === 'snooze15') {
        const id = typeof payload.blockId === 'string' ? payload.blockId : ''
        const target = s.blocks.find((b) => b.id === id)
        if (target && target.status === 'open' && !target.external) {
          if (actionId === 'done') {
            get().toggleComplete(target.id) // the checkbox's path: a mew, event logged, celebrated
          } else {
            /* +15: the same week.move the other move-nudges use; it rides the
               next sync run (tick's 5-min gate pushes the new time out) */
            setBlocks(week.move(s.blocks, target.id, target.dayKey, target.startMin + 15))
            post([
              mewMsg(
                `Moved — ${target.title.split('—')[0].trim()} now starts ${fmtTime(target.startMin + 15)}.`
              ),
            ])
          }
          accept()
        }
        resolveNudge(msgId, label)
        return
      }

      /* done-block removal confirm (#334): the explicit-delete cage-lift. One tap
         removes the named mew(s) through removeBlocksConfirmed (the block card's
         path too) — deterministic, so it deletes exactly the confirmed block(s)
         and their completion events, undoable; "keep" just closes the offer. */
      if (msg.nudgeType === 'remove-done') {
        if (actionId === 'keep-done') {
          resolveNudge(msgId, label)
          return
        }
        if (actionId.startsWith('rm-done:')) {
          const which = actionId.slice('rm-done:'.length)
          const listed = typeof payload.doneIds === 'string' ? payload.doneIds.split(',') : []
          const ids = which === 'all' ? listed : [which]
          removeBlocksConfirmed(ids)
          resolveNudge(msgId, label)
          return
        }
      }

      switch (`${msg.nudgeType}:${actionId}`) {
        case 'learn-offer:confirm': {
          /* confirm = "remember this" (tools-only law: the confirm stores a
             pref, placement stays the executor's). The rule lands in the
             append-only memory — the always-on floor, survives restart — and
             ingests to gbrain when on, so #328's resolver applies it silently
             forever. Deterministic here, so keyless confirms identically. */
          const rule = parseLearnedRule(typeof payload.rule === 'string' ? payload.rule : '')
          if (rule) {
            logMemory({ kind: 'learned_rule', dayKey: todayKey, rule })
            if (brainOn()) void brain.ingest(learnedRulePage(rule))
            post([mewMsg("Got it — I'll just do that from now on.")])
          }
          resolveNudge(msgId, 'yes, always')
          break
        }
        case 'learn-offer:dismiss': {
          /* dismiss = "not a rule": a persisted dismissal so this pattern is
             never offered again (detectTaskRules skips it). No week change. */
          const match = typeof payload.match === 'string' ? payload.match : ''
          if (match) logMemory({ kind: 'dismissed_rule', dayKey: todayKey, rule: { match } })
          resolveNudge(msgId, 'not a rule')
          break
        }
        case 'inbox-offer:place': {
          /* the owner CONFIRMED the slot → the executor places it (placeFromInbox
             → placeCaptureAt, the one mutation path), sized by the offered
             duration. gbrain never reaches here on its own — only a confirm, so
             nothing is ever auto-scheduled (human-in-the-loop). */
          const capId = String(payload.captureId)
          const cap = s.captures.find((c) => c.id === capId)
          if (cap && cap.status === 'open') {
            get().placeFromInbox(capId, {
              dayKey: String(payload.dayKey),
              startMin: Number(payload.startMin),
              durationMin: payload.durationMin != null ? Number(payload.durationMin) : undefined,
            })
          }
          accept()
          break
        }
        case 'inbox-offer:notnow': {
          /* "not now" keeps the item WAITING and dedupes today's offer — the
             intent is never lost, never re-nagged the same day. */
          get().dismissInboxOffer(String(payload.captureId))
          decline()
          break
        }
        case 'drift:still': {
          set({ lastActivityMs: nowFn() })
          accept()
          break
        }
        case 'drift:move': {
          const id = String(payload.blockId)
          const target = s.blocks.find((b) => b.id === id)
          if (target) {
            const without = s.blocks.filter((b) => b.id !== id)
            const todaySlot = week.findFreeSlot(
              without,
              todayKey,
              week.duration(target),
              minOfDay(now) + 15
            )
            const slot =
              todaySlot ??
              week.findFreeSlot(without, addDaysKey(todayKey, 1), week.duration(target), 9 * 60)
            if (slot) {
              const toKey = todaySlot ? todayKey : addDaysKey(todayKey, 1)
              setBlocks(week.move(s.blocks, id, toKey, slot.startMin))
              post([
                mewMsg(
                  `Moved — it lives ${toKey === todayKey ? 'later today' : 'tomorrow'} at ${fmtTime(slot.startMin)}.`
                ),
              ])
            }
          }
          accept()
          break
        }
        case 'drift:guard':
        case 'guard:guard': {
          const id = String(payload.blockId)
          const target = s.blocks.find((b) => b.id === id)
          if (target) {
            set({ guardUntilMin: target.endMin, guardDayKey: todayKey })
            post([
              mewMsg(`Guarded until ${fmtTime(target.endMin)} — nothing non-urgent gets through.`),
            ])
          }
          accept()
          break
        }
        case 'guard:notnow':
          decline()
          break
        case 'post-buffer:buffer': {
          const srcId = payload.blockId ? String(payload.blockId) : null
          const src = srcId ? s.blocks.find((b) => b.id === srcId) : null
          const today = dayKey(new Date(s.nowMs))
          const start = Math.ceil(minOfDay(new Date(s.nowMs)) / 5) * 5
          const placed = week.place(s.blocks, {
            title: `${src ? src.title.split('—')[0].trim() + ' — ' : ''}review & notes`,
            tag: 'work',
            dayKey: today,
            startMin: start,
            durationMin: 15,
            protected: true,
          })
          if (placed) {
            setBlocks([...s.blocks, placed])
            post([
              mewMsg(
                `Held — review & notes ${fmtTime(start)}–${fmtTime(start + 15)}. Capture it while it's warm.`
              ),
            ])
          }
          accept()
          break
        }
        case 'post-buffer:skip':
          decline()
          break
        case 'right-size:rightsize': {
          const heavyKey = String(payload.dayKey)
          const day = week
            .blocksForDay(s.blocks, heavyKey)
            .filter((b) => week.isDeep(b) && b.status === 'open')
            .sort((a, b) => week.duration(a) - week.duration(b))
          const candidate = day[0]
          if (candidate) {
            let moved = false
            for (let i = 1; i <= 6 && !moved; i++) {
              const toKey = addDaysKey(heavyKey, i)
              const slot = week.findFreeSlot(s.blocks, toKey, week.duration(candidate), 9 * 60)
              if (slot) {
                setBlocks(week.move(s.blocks, candidate.id, toKey, slot.startMin))
                post([
                  mewMsg(
                    `Right-sized — ${candidate.title.split('—')[0].trim()} moved to ${fmtDowLong(toKey)} ${fmtTime(slot.startMin)}. ${fmtDowLong(heavyKey)} breathes again.`
                  ),
                ])
                moved = true
              }
            }
            if (!moved)
              post([mewMsg(`The week is tight everywhere — want to look at it together?`)])
          }
          accept()
          break
        }
        case 'right-size:keep':
          decline()
          break
        case 'close-loop:roll': {
          const id = String(payload.blockId)
          const toKey = String(payload.toDayKey)
          const toStart = Number(payload.toStartMin)
          const target = s.blocks.find((b) => b.id === id)
          if (target && target.status === 'open') {
            const { blocks } = week.roll(s.blocks, id, toKey, toStart)
            setBlocks(blocks)
            const evTs = nowFn() // one ts for the event and its brain offer
            ingestBlockEvent(target, 'rolled', minOfDay(new Date(evTs)), evTs)
            logMemory({
              kind: 'rolled',
              dayKey: target.dayKey,
              tag: target.tag,
              plannedMin: week.duration(target),
              deep: week.isDeep(target),
              title: target.title,
              startMin: target.startMin,
              endMin: target.endMin,
              ts: evTs,
            })
            const dayLabel = toKey === addDaysKey(todayKey, 1) ? 'tomorrow' : fmtDowLong(toKey)
            post([
              mewMsg(
                `Held — ${target.title.split('—')[0].trim()} lives ${dayLabel} at ${fmtTime(toStart)}. Let it go for tonight.`
              ),
            ])
          }
          accept()
          break
        }
        case 'close-loop:leave':
          decline()
          break
        case 'when-where:placecap': {
          const capId = String(payload.captureId)
          const cap = s.captures.find((c) => c.id === capId)
          if (cap && cap.status === 'open') {
            placeCaptureAt(cap, String(payload.dayKey), Number(payload.startMin))
          }
          accept()
          break
        }
        case 'when-where:later':
          decline()
          break
        case 'protect-rest:keeprest': {
          const intruderId = payload.intruderId ? String(payload.intruderId) : null
          const intruder = intruderId ? s.blocks.find((b) => b.id === intruderId) : null
          if (intruder?.external) {
            /* someone else's meeting — not ours to move; the rest still stands */
            post([
              mewMsg(
                `Kept. I can't move their meeting, but the rest stays on your calendar — they see you as busy.`
              ),
            ])
            accept()
            break
          }
          if (intruder) {
            const fromMin =
              intruder.dayKey === dayKey(new Date(s.nowMs)) ? minOfDay(new Date(s.nowMs)) : 0
            const next = week.nextSlotAfter(s.blocks, intruder, fromMin)
            if (next) {
              setBlocks(week.move(s.blocks, intruder.id, next.dayKey, next.startMin))
              const dayLabel = next.dayKey === intruder.dayKey ? '' : ' tomorrow'
              post([
                mewMsg(
                  `Kept. ${intruder.title.split('—')[0].trim()} moved${dayLabel} to ${fmtTime(next.startMin)} — the rest stays yours.`
                ),
              ])
            } else {
              post([
                mewMsg(
                  `Kept — the rest stays. I couldn't find a later slot for ${intruder.title.split('—')[0].trim()}, so it's still where it was; move it where you like.`
                ),
              ])
            }
          } else {
            post([mewMsg(`Kept. Tonight's rest is yours.`)])
          }
          accept()
          break
        }
        case 'protect-rest:moverest': {
          const restId = String(payload.restId)
          const rest = s.blocks.find((b) => b.id === restId)
          if (rest) {
            const slot = week.findFreeSlot(
              s.blocks.filter((b) => b.id !== restId),
              rest.dayKey,
              week.duration(rest),
              rest.endMin
            )
            if (slot) {
              setBlocks(week.move(s.blocks, restId, rest.dayKey, slot.startMin))
              post([
                mewMsg(
                  `Moved — rest now starts at ${fmtTime(slot.startMin)}. It still happens; that's the deal.`
                ),
              ])
            } else {
              post([mewMsg(`There's nowhere later for it today — I left it where it was.`)])
            }
          }
          decline()
          break
        }
        case 'kinder-plan:kinder': {
          accept()
          const agg = aggregates(s.memory, now)
          const { moves, summary } = proposeKinderPlan(s.blocks, agg, todayKey, week.findFreeSlot)
          if (!moves.length) {
            post([
              mewMsg(
                `The days ahead already fit inside your realistic best${agg.realisticBestH != null ? ` (~${agg.realisticBestH}h deep work a day)` : ''} — the shape is kind. The carry-over story is about size, not placement: try booking blocks a touch longer than instinct says.`
              ),
            ])
            break
          }
          post([
            {
              id: uid(),
              role: 'nudge',
              ts: nowFn(),
              nudgeType: 'kinder-plan',
              nudgeLabel: 'the kinder shape',
              body: `Here's the kinder shape: ${summary}. Every day stays inside ~${agg.realisticBestH ?? 5}h of deep work. Nothing moves unless you say so.`,
              footnote: `Proposed, not imposed — suggest, don't seize.`,
              actions: [
                { id: 'apply', label: 'Apply the shape', kind: 'primary' },
                { id: 'skip', label: 'Not this week', kind: 'secondary' },
              ],
              payload: { moves: JSON.stringify(moves) },
            },
          ])
          break
        }
        case 'kinder-plan:apply': {
          try {
            const moves = JSON.parse(
              String(payload.moves)
            ) as import('../domain/insights').KinderMove[]
            let blocks = s.blocks
            const applied: string[] = []
            for (const m of moves) {
              const target = blocks.find((b) => b.id === m.blockId && b.status === 'open')
              if (!target) continue
              blocks = week.move(blocks, m.blockId, m.toDayKey, m.toStartMin)
              applied.push(
                `${m.title} → ${fmtDowLong(m.toDayKey).toLowerCase()} ${fmtTime(m.toStartMin)}`
              )
            }
            setBlocks(blocks)
            post([
              mewMsg(
                applied.length
                  ? `Done — ${joinHuman(applied)}. The week breathes again.`
                  : `Those blocks moved on their own since I proposed this — the shape may already be kinder.`
              ),
            ])
          } catch {
            post([
              mewMsg(
                `That proposal went stale — ask me for a kinder shape again and I'll recompute it.`
              ),
            ])
          }
          accept()
          break
        }
        case 'kinder-plan:skip':
        case 'kinder-plan:notweek':
          decline()
          break
        case 'fresh-start:shape': {
          accept()
          const agg = aggregates(s.memory, now)
          post([
            mewMsg(
              `Good. Give me the one thing that matters most — "block tomorrow morning for the deck" works — and I'll place the rest around it${agg.realisticBestH != null ? `, keeping every day inside ~${agg.realisticBestH}h of deep work` : ''}.`
            ),
          ])
          break
        }
        case 'fresh-start:later':
          decline()
          break
        case 'break-smaller:starter': {
          const title = String(payload.title ?? 'it')
          const toKey = payload.dayKey ? String(payload.dayKey) : todayKey
          const toStart = payload.startMin != null ? Number(payload.startMin) : null
          if (toStart != null) {
            const placed = week.place(s.blocks, {
              title: `Starter: ${title}`,
              tag: 'work',
              dayKey: toKey,
              startMin: toStart,
              durationMin: 25,
            })
            if (placed) {
              setBlocks([...s.blocks, placed])
              post([
                mewMsg(
                  `Placed — a 25-minute starter for "${title}" ${toKey === todayKey ? 'today' : fmtDowLong(toKey).toLowerCase()} at ${fmtTime(toStart)}. Crack it open; the rest follows.`
                ),
              ])
            }
          }
          accept()
          break
        }
        case 'break-smaller:leave':
          decline()
          break
        case 'micro-break:take': {
          const dur = Math.max(5, Number(payload.durMin) || 10)
          const placed = week.place(s.blocks, {
            title: 'Micro-break — move, water, stretch',
            tag: 'rest',
            dayKey: todayKey,
            startMin: minOfDay(now),
            durationMin: dur,
            protected: false,
          })
          if (placed) {
            setBlocks([...s.blocks, placed])
            post([mewMsg(`${dur} minutes claimed. Away from the screen — the block is yours.`)])
          }
          accept()
          break
        }
        case 'micro-break:keep':
          decline()
          break
        case 'next-up:pull': {
          if (payload.kind === 'block') {
            get().startNow(String(payload.id))
          } else {
            const cap = s.captures.find((c) => c.id === String(payload.id))
            if (cap) {
              const placed = week.place(s.blocks, {
                title: cap.title,
                tag: 'work',
                dayKey: todayKey,
                startMin: minOfDay(now),
                durationMin: Math.max(15, Number(payload.durMin) || 30),
              })
              if (placed) {
                setBlocks([...s.blocks, placed])
                const updated: Capture = { ...cap, status: 'placed', placedBlockId: placed.id }
                set((st) => ({ captures: st.captures.map((c) => (c.id === cap.id ? updated : c)) }))
                persistCaptures([updated])
                post([mewMsg(`Pulled in — "${cap.title}" lives now, while the engine's warm.`)])
              }
            }
          }
          accept()
          break
        }
        case 'next-up:leave':
          decline()
          break
        /* update is a system offer, not an engine nudge — no outcome stats */
        case 'update:restart': {
          void applyUpdate().catch((err) => {
            post([
              mewMsg(
                `The restart didn't take — ${err instanceof Error ? err.message : 'unknown error'}. The update stays staged; relaunching will pick it up.`
              ),
            ])
          })
          break
        }
        case 'update:later':
          /* "later" defers the staged update — a pure dismissal, no restore, no
             outcome stats (update is a system offer, not an engine nudge) */
          break
        /* restore is a system offer, not an engine nudge — no outcome stats */
        case 'restore:accept': {
          void (async () => {
            const json = await readBackup()
            if (json) await get().importData(json)
            else
              post([
                mewMsg(
                  `The backup file isn't readable anymore — check Documents/MEW/mew-backup.json.`
                ),
              ])
          })()
          break
        }
        case 'restore:decline':
          break
        /* start-by proposes the latest start; only an accept starts anything */
        case 'start-by:start': {
          get().startNow(String(payload.blockId))
          accept()
          break
        }
        case 'start-by:ack':
          decline() // "I know" — learning stretches the cooldown, not the deadline
          break
        /* the rulebook keeps up with the life it describes */
        case 'pref-drift:update': {
          post([
            mewMsg(
              execRemember({
                kind: payload.kind as PrefPayload['kind'],
                match: String(payload.match),
                value: String(payload.observed),
                stated: `updated from how it actually lives (was: "${String(payload.stated)}")`,
              })
            ),
          ])
          accept()
          break
        }
        case 'pref-drift:keep':
          decline() // outcome learning stretches the 7d cooldown toward 14d
          break
        /* delegate suggests, never seizes: accepting creates a capture for
           the handoff — nothing is reassigned, MEW has no one to assign to */
        case 'delegate:capture': {
          execCapture(`Hand the ${String(payload.label)} thread to ${String(payload.personLabel)}`)
          accept()
          break
        }
        case 'delegate:later':
          decline()
          break
        /* heads-up is information; "got it" means it landed, not "stop" */
        case 'heads-up:ack':
          accept()
          break
        /* the weekly ritual (#304): the nudge INVITES, the turn does the work
           (chat-first law) — the chip's words become an ordinary user turn
           through the same speak() door typing them would use; the keyed
           recipe or the keyless route takes it from there. */
        case 'weekly-ritual:plan': {
          accept()
          void get().speak('plan my week')
          break
        }
        /* the weekly-review offer (#346): "show me" opens the read-only review
           surface (the owner selects what to roll inside — the offer itself
           moves nothing); "not now" dismisses it, offered again next week. */
        case 'weekly-review:open': {
          accept()
          get().openWeeklyReview()
          break
        }
        case 'weekly-review:later':
          decline()
          break
        /* the week-scaffold offer (#349): "rough it out" runs proposeScaffold,
           which posts the plan-mode preview the owner accepts/tweaks — the offer
           itself places NOTHING (human-in-the-loop). "not now" dismisses it,
           offered again for a future coming week. */
        case 'scaffold-week:draft': {
          accept()
          get().proposeScaffold(typeof payload.weekKey === 'string' ? payload.weekKey : undefined)
          break
        }
        case 'scaffold-week:later':
          decline()
          break
        default:
          decline()
      }
      resolveNudge(msgId, label)
    },

    focusDay(key) {
      set({ focusedDayKey: key })
    },
    setPage(page) {
      set({ page })
    },
    setView(view) {
      set({ view })
    },
    dismissOnboarding() {
      set({ onboardingStep: 'tour' }) // non-persisted cursor back to the start
      if (get().settings.hasSeenOnboarding) return // idempotent — never re-persist
      get().updateSettings({ hasSeenOnboarding: true })
    },
    advanceOnboarding() {
      const next = { tour: 'keys', keys: 'calendar', calendar: 'plan' } as const
      const step = get().onboardingStep
      if (step === 'plan') {
        get().dismissOnboarding() // last step done → the modal closes for good
        return
      }
      set({ onboardingStep: next[step] })
    },
    setPromptDraft(text) {
      set({ promptDraft: text })
    },
    setWorking(label) {
      set({ workingStatus: label })
    },
    setWeekOffset(offset) {
      set({ weekOffset: offset, focusedDayKey: null })
    },
    startNow(blockId) {
      const s = get()
      const target = s.blocks.find((b) => b.id === blockId)
      if (!target || target.status !== 'open' || target.external) return
      const now = new Date(s.nowMs)
      const nowMin = minOfDay(now)
      /* started is a state, not a button to mash: a live started block stays put */
      if (
        target.startedAt != null &&
        target.dayKey === dayKey(now) &&
        target.startMin <= nowMin &&
        nowMin < target.endMin
      ) {
        post([
          mewMsg(
            `${target.title.split('—')[0].trim()} is already running — finish it for the mew, or interrupt it to park the rest.`
          ),
        ])
        return
      }
      const moved = week.move(s.blocks, blockId, dayKey(now), nowMin)
      setBlocks(moved.map((b) => (b.id === blockId ? { ...b, startedAt: s.nowMs } : b)))
      post([mewMsg(`Started — ${target.title.split('—')[0].trim()} is the now.`)])
    },

    interruptBlock(blockId) {
      const s = get()
      const target = s.blocks.find((b) => b.id === blockId)
      if (!target || target.status !== 'open' || target.external) return
      const now = new Date(s.nowMs)
      const todayKey = dayKey(now)
      const nowMin = minOfDay(now)
      const remaining = Math.max(15, target.endMin - nowMin)
      const without = s.blocks.filter((b) => b.id !== blockId)
      /* the remainder needs a real home — search up to 3 days out, like close-loop */
      let slot: { startMin: number } | null = null
      let toKey = todayKey
      for (let i = 0; i <= 3 && !slot; i++) {
        const key = addDaysKey(todayKey, i)
        slot = week.findFreeSlot(without, key, remaining, i === 0 ? nowMin + 15 : 9 * 60)
        if (slot) toKey = key
      }
      if (!slot) {
        post([
          mewMsg(
            `Nowhere kind to park the rest this week — it stays open; say the word and we'll find it a home.`
          ),
        ])
        return
      }
      const { blocks: rolled, rolled: next } = week.roll(s.blocks, blockId, toKey, slot.startMin)
      setBlocks(rolled)
      const evTs = nowFn() // one ts for the event and its brain offer
      ingestBlockEvent(target, 'interrupted', nowMin, evTs)
      /* full block shape, matching the close-loop roll — the backfill replay
         can only re-tell an interruption its event fully describes */
      logMemory({
        kind: 'rolled',
        dayKey: target.dayKey,
        tag: target.tag,
        plannedMin: week.duration(target),
        deep: week.isDeep(target),
        title: target.title,
        startMin: target.startMin,
        endMin: target.endMin,
        ts: evTs,
      })
      logMemory({ kind: 'interruption', dayKey: todayKey })
      const base = target.title.split('—')[0].trim()
      post([
        mewMsg(
          `Paused — no blame, things land mid-block. The remaining ${remaining} min of ${base} now lives ${toKey === todayKey ? 'today' : fmtDowLong(toKey)} at ${fmtTime(slot.startMin)}.`
        ),
      ])
      void next
    },
    moveToNextFree(blockId) {
      const s = get()
      const target = s.blocks.find((b) => b.id === blockId)
      if (!target || target.external) return
      const now = new Date(s.nowMs)
      const todayKey = dayKey(now)
      const without = s.blocks.filter((b) => b.id !== blockId)
      const todaySlot = week.findFreeSlot(
        without,
        todayKey,
        week.duration(target),
        minOfDay(now) + 15
      )
      const slot =
        todaySlot ??
        week.findFreeSlot(without, addDaysKey(todayKey, 1), week.duration(target), 9 * 60)
      if (!slot) {
        post([mewMsg(`Nowhere kind to put it yet — want to look at the week together?`)])
        return
      }
      const toKey = todaySlot ? todayKey : addDaysKey(todayKey, 1)
      setBlocks(week.move(s.blocks, blockId, toKey, slot.startMin))
      post([
        mewMsg(
          `Moved — ${target.title.split('—')[0].trim()} now lives ${toKey === todayKey ? 'today' : 'tomorrow'} at ${fmtTime(slot.startMin)}.`
        ),
      ])
    },
    dragMove(blockId, toDayKey, toStartMin, durationMin) {
      const s = get()
      const target = s.blocks.find((b) => b.id === blockId)
      if (!target) return 'noop'
      /* a synced calendar event is never MEW's to move (product law) — the drag
         is silently dropped and chat explains, the same voice as every other
         "not mine to touch" path. The block bounces back in the view. A typed
         "move my 1:1" still takes ownership through execMove; the GESTURE does
         not, so the drop bounces here before it can reach the move executor. */
      if (target.external) {
        post([
          mewMsg(
            `${target.title.split('—')[0].trim()} stays put — that event is from your calendar, so it's not mine to move. Change it where it lives and the next sync brings it across.`
          ),
        ])
        return 'external'
      }
      const curDur = week.duration(target)
      const dur = durationMin ?? curDur
      const endMin = toStartMin + dur
      const resized = durationMin != null && dur !== curDur
      const moved = toDayKey !== target.dayKey || toStartMin !== target.startMin
      /* dropped exactly where it already sits, at its own length → a click */
      if (!moved && !resized) return 'noop'
      const prefs = activePrefsFrom(s.memory, brainOn() ? brainPrefs : null)
      /* Validity gate (#347), the "never over fixed-time" law made pre-commit.
         A MOVE bounces only off blocks it can't schedule around — external/fixed
         meetings and the owner's held (protected) blocks; every other conflict
         is unprotected own-flexible work the move executor drifts (#324). A
         RESIZE grows in place and shifts nothing, so ANY occupied minute in its
         new span bounces it. Either way the week is left untouched and the view
         snaps the block home. */
      const blocked = resized
        ? week.conflictsWith(s.blocks, toDayKey, toStartMin, endMin, target.id, prefs)
        : moveBlockedBy(s.blocks, toDayKey, toStartMin, endMin, target.id, prefs)
      if (blocked.length) return 'conflict'
      /* the gesture IS the owner's intent: snapshot so undo_last_action ("undo
         that") can take it back, and hold that snapshot across the next turn's
         fresh-exchange reset exactly as a scenario pick does (#293) — the drag
         commits outside any turn. Then route through the SAME merged executor a
         chat command uses: a move through moveResolved (#335, its #324 drift and
         clash note come free), a resize through applyEditPatch (#335, execEdit's
         own field math) — no second mutation door. */
      snapshotForUndo()
      let reply: string
      if (resized) {
        const next = applyEditPatch(target, { startMin: toStartMin, endMin })
        setBlocks(s.blocks.map((b) => (b.id === target.id ? next : b)))
        noteReferentId(target.id)
        reply = `Resized — ${target.title.split('—')[0].trim()} now runs ${fmtTime(next.startMin)}–${fmtTime(next.endMin)} (${next.endMin - next.startMin} min).`
      } else {
        reply = moveResolved(target, toDayKey, toStartMin)
      }
      pickSnapshotHolds = true
      post([mewMsg(reply)])
      return resized ? 'resized' : 'moved'
    },
    setAttention(blockId, attention) {
      const s = get()
      const target = s.blocks.find((b) => b.id === blockId)
      if (!target || (target.attention ?? 'focus') === attention) return
      setBlocks(s.blocks.map((b) => (b.id === blockId ? { ...b, attention } : b)))
    },

    placeCapture(captureId) {
      const s = get()
      const cap = s.captures.find((c) => c.id === captureId)
      if (!cap || cap.status !== 'open') return
      const now = new Date(s.nowMs)
      const proposal = week.proposeCaptureSlot(s.blocks, dayKey(now), minOfDay(now))
      if (!proposal) {
        post([
          mewMsg(
            `The week can't hold "${cap.title}" yet — say where it should live and I'll make room.`
          ),
        ])
        return
      }
      if (!placeCaptureAt(cap, proposal.dayKey, proposal.startMin)) return
    },

    toggleProtected(blockId) {
      const s = get()
      const target = s.blocks.find((b) => b.id === blockId)
      if (!target || target.external) return
      setBlocks(s.blocks.map((b) => (b.id === blockId ? { ...b, protected: !b.protected } : b)))
      post([
        mewMsg(
          target.protected
            ? `Released — ${target.title.split('—')[0].trim()} can flex now: I may move it when right-sizing, and the slot reads as open.`
            : `Held — ${target.title.split('—')[0].trim()} is protected: I won't move it, and connected calendars show you busy there.`
        ),
      ])
    },
    clearScroll() {
      set({ scrollToMsgId: null })
    },

    /* ── memory console edits (#330) — every one goes through the append-only
       memory the learn/remember paths already write, so keyless and keyed
       behave identically and the console stays tools-only. */
    confirmTaskRule(rule) {
      logMemory({ kind: 'learned_rule', dayKey: dayKey(new Date(get().nowMs)), rule })
      if (brainOn()) void brain.ingest(learnedRulePage(rule))
    },
    forgetRule(match) {
      const drop = get()
        .memory.filter((e) => e.kind === 'learned_rule' && e.rule?.match === match)
        .map((e) => e.id)
      if (drop.length) {
        const gone = new Set(drop)
        set((s) => ({ memory: s.memory.filter((e) => !gone.has(e.id)) }))
        persistDeleteMemory(drop)
      }
      /* record the dismissal so detectTaskRules won't re-offer it at once. The
         brain's copy is append-only and not ours to retract (as with undo of a
         remember); applying reads confirmedRulesFrom(local memory) only, so the
         rule truly stops applying regardless of the brain. */
      logMemory({ kind: 'dismissed_rule', dayKey: dayKey(new Date(get().nowMs)), rule: { match } })
    },
    reEnableRule(match) {
      const drop = get()
        .memory.filter((e) => e.kind === 'dismissed_rule' && e.rule?.match === match)
        .map((e) => e.id)
      if (!drop.length) return
      const gone = new Set(drop)
      set((s) => ({ memory: s.memory.filter((e) => !gone.has(e.id)) }))
      persistDeleteMemory(drop)
    },
    saveStandingPref(pref) {
      /* the same remember path a typed rule takes (append + mirror to brain);
         the console re-renders from memory, so no chat confirmation is posted. */
      execRemember(pref)
    },
    forgetStandingPref(pref) {
      const key = `${pref.kind}:${pref.match.toLowerCase()}`
      const drop = get()
        .memory.filter(
          (e) =>
            e.kind === 'preference' &&
            e.pref &&
            `${e.pref.kind}:${e.pref.match.toLowerCase()}` === key
        )
        .map((e) => e.id)
      if (!drop.length) return
      const gone = new Set(drop)
      set((s) => ({ memory: s.memory.filter((e) => !gone.has(e.id)) }))
      persistDeleteMemory(drop)
      /* local removal is authoritative for what applies; mirror it into the
         brain-backed pref cache too (the brain's copy is append-only, as undo). */
      refreshBrainPrefs()
    },

    /* ── weekly review (#346) ──────────────────────────────────────────
       A read-only presenter over the LOCAL week + memory (no key, no I/O), the
       memory-console discipline: openWeeklyReview computes and returns the shape
       AND flips the surface open; the UI re-derives it live so a roll re-renders.
       rollForward is the ONLY write, and it never mutates directly — it re-places
       the owner-selected blocks through the executor's plan path. */
    openWeeklyReview() {
      const s = get()
      const prefs = activePrefsFrom(s.memory, brainOn() ? brainPrefs : null)
      const review = weeklyReview(s.blocks, s.memory, weekKey(new Date(s.nowMs)), prefs)
      set({ weeklyReviewOpen: true })
      return review
    },
    closeWeeklyReview() {
      set({ weeklyReviewOpen: false })
    },
    rollForward(blockIds, targetWeekKey) {
      const s = get()
      const now = new Date(s.nowMs)
      const todayKey = dayKey(now)
      const prefs = activePrefsFrom(s.memory, brainOn() ? brainPrefs : null)
      /* the human-in-the-loop gate, enforced in code: only the ids the owner
         selected AND that pass isRollCandidate (own + flexible + open) can move.
         A mew, an external event, or a fixed-time block handed in — even by a
         buggy caller — is refused here, so nothing rolls that wasn't a real,
         owner-picked carried block. External events are never moved (law). */
      const want = new Set(blockIds)
      const picked = s.blocks.filter((b) => want.has(b.id) && isRollCandidate(b, prefs))
      if (!picked.length) return

      /* re-place each pick on its SAME weekday in the target week and let the
         executor's scorer time it — meals re-anchor via the circadian oracle,
         everything else lands rest-aware and conflict-free (no startMin means
         "you pick the slot"). This goes through execPlan, the normal plan path:
         tools are the only mutation door, so a tool card records the roll and
         undo reaches it, exactly like a typed plan. */
      const places: PlaceSpec[] = picked.map((b) => {
        const weekdayIdx = (fromDayKey(b.dayKey).getDay() + 6) % 7 // Mon=0 … Sun=6
        const targetDay = addDaysKey(targetWeekKey, weekdayIdx)
        const dayOffset = Math.round(
          (fromDayKey(targetDay).getTime() - fromDayKey(todayKey).getTime()) / 86_400_000
        )
        return {
          title: b.title,
          tag: b.tag,
          dayOffset,
          durationMin: week.duration(b),
          protected: b.protected,
          ...(b.attention ? { attention: b.attention } : {}),
        }
      })
      runToolWithCard('plan', { places, frees: [] }, () => execPlan(places, []))

      const names = picked.map((b) => b.title.split('—')[0].trim())
      post([
        mewMsg(
          `Rolled forward — ${joinHuman(names)} now ${picked.length === 1 ? 'lives' : 'live'} in next week. Nothing else moved.`
        ),
      ])
    },

    updateSettings(patch) {
      const settings = { ...get().settings, ...patch }
      set({ settings })
      persistSettings(settings)
      /* flipping the brain choice is a connect: the now-effective brain
         (opt-in on, or the sidecar it falls back to) gets its offer (#249).
         URL/token edits alone don't trigger — a half-typed endpoint must not
         be sprayed with a replay; the next launch converges it. */
      if ('brainEnabled' in patch) maybeBackfillBrain()
    },

    async applyCaptureHotkey(accel) {
      const ok = await syncCaptureHotkey(accel)
      /* register-then-persist: a refusal leaves the setting (and the OS
         binding the shell rolled back to) exactly where it was — the
         collision flag carries the story to the Settings row */
      if (ok) get().updateSettings({ globalCaptureHotkey: accel })
      return ok
    },

    cycleVisibility(calId, tag) {
      const s = get()
      const order = ['details', 'busy', 'hidden'] as const
      const row = s.settings.matrix[calId] ?? { ...NEW_CALENDAR_DEFAULTS }
      const next = order[(order.indexOf(row[tag]) + 1) % order.length]
      const settings: Settings = {
        ...s.settings,
        matrix: { ...s.settings.matrix, [calId]: { ...row, [tag]: next } },
      }
      set({ settings })
      persistSettings(settings)
      /* matrix edits apply on next sync (acceptance #6) — pull it forward */
      if (s.settings.calendars.find((c) => c.id === calId)?.kind === 'live') {
        set({ lastSyncAt: 0 })
      }
    },

    cycleDefaultTag(calId) {
      const s = get()
      const order: VisibleTag[] = ['work', 'private', 'health']
      const settings: Settings = {
        ...s.settings,
        calendars: s.settings.calendars.map((c) =>
          c.id === calId
            ? {
                ...c,
                defaultTag: order[(order.indexOf(c.defaultTag ?? 'work') + 1) % order.length],
              }
            : c
        ),
      }
      set({ settings })
      persistSettings(settings)
      set({ lastSyncAt: 0 })
    },

    async exportData() {
      return storage.exportJson()
    },

    async importData(json: string) {
      await storage.importJson(json)
      await get().hydrate()
      get().tick()
      post([
        mewMsg(
          `Restored — the week, captures, chat, and memory are back. Keys stay per-device; check Settings if the brain needs one.`
        ),
      ])
    },

    importIcs(fileName: string, text: string) {
      const s = get()
      const now = new Date(s.nowMs)
      const win = syncWindow(now)
      const windowStart = fromDayKey(win.startKey)
      const windowEnd = fromDayKey(win.endKey)
      let result: ReturnType<typeof icsToRemoteEvents>
      try {
        const probableOwner = /@/.test(fileName) ? fileName.replace(/\.ics$/i, '') : undefined
        result = icsToRemoteEvents(text, '', windowStart, windowEnd, probableOwner) // calId set below
      } catch {
        post([mewMsg(`That file didn't read as a calendar (.ics) — is it the right export?`)])
        return
      }
      /* one calendar entry per source name; re-import refreshes it */
      const sourceName = result.calName ?? fileName.replace(/\.ics$/i, '')
      const calId = `ics:${sourceName}`
      const events = result.events.map((e) => ({ ...e, calId }))

      let settings = get().settings
      let cal = settings.calendars.find((c) => c.id === calId)
      if (!cal) {
        cal = {
          id: calId,
          name: `ICS · ${sourceName}`,
          who: 'imported · snapshot',
          provider: 'ics',
          kind: 'import',
          defaultTag: 'work',
          readOnly: true,
        }
        settings = {
          ...settings,
          calendars: [...settings.calendars, cal],
          matrix: { ...settings.matrix, [calId]: { ...NEW_CALENDAR_DEFAULTS } },
        }
        set({ settings })
        persistSettings(settings)
      }

      const before = get().blocks
      const merged = mergePull(before, events, [cal], win, dismissedSet())
      const kept = new Set(merged.blocks.map((b) => b.id))
      const removedIds = before.filter((b) => !kept.has(b.id)).map((b) => b.id)
      set({ blocks: merged.blocks })
      persistBlocks(merged.blocks)
      if (removedIds.length) storage.deleteBlocks(removedIds).catch(() => {})

      const optionalCount = events.filter((e) => e.optional).length
      const skipped =
        result.skippedAllDay + result.skippedRules > 0
          ? ` (skipped ${result.skippedAllDay} all-day and ${result.skippedRules} monthly/yearly-recurring — they don't sit on the day grid)`
          : ''
      post([
        mewMsg(
          `Imported ${sourceName} — ${merged.added} event${merged.added === 1 ? '' : 's'} in this window landed in the week${merged.updated ? `, ${merged.updated} updated` : ''}${merged.removed ? `, ${merged.removed} gone since last import` : ''}${optionalCount ? `, ${optionalCount} tentative/free (thin tint — they don't hold time)` : ''}${skipped}. They're calendar facts: I plan around them, never over them.`
        ),
      ])
    },

    async connectGoogle() {
      const s = get()
      if (!s.settings.googleClientId.trim()) return
      set({ connecting: true, syncError: null })
      try {
        const acct = googleAccount(s.settings.googleClientId.trim())
        await acct.authorize(true)
        const all = await acct.listCalendars()
        const connected = new Set(s.settings.calendars.map((c) => c.id))
        set({ googlePicker: all.filter((c) => !connected.has(c.id)) })
      } catch (e) {
        set({ syncError: e instanceof Error ? e.message : 'sign-in failed' })
      } finally {
        set({ connecting: false })
      }
    },

    addGoogleCalendar(cal) {
      const s = get()
      const entry = {
        id: cal.id,
        /* label by the calendar's real name/email — for a primary that's the
           account address (e.g. "you@acme.com"), so a work account reads as
           work, not a generic "Primary" that hid which account it was (#cal). */
        name: `Google · ${cal.summary}${cal.primary ? ' (primary)' : ''}`,
        who: cal.readOnly ? 'live · read-only' : 'live · two-way',
        provider: 'google' as const,
        kind: 'live' as const,
        defaultTag: 'work' as const,
        readOnly: cal.readOnly,
      }
      const settings: Settings = {
        ...s.settings,
        calendars: [...s.settings.calendars, entry],
        matrix: { ...s.settings.matrix, [cal.id]: { ...NEW_CALENDAR_DEFAULTS } },
      }
      set({
        settings,
        googlePicker: s.googlePicker?.filter((c) => c.id !== cal.id) ?? null,
        lastSyncAt: 0, // sync on the next tick
      })
      persistSettings(settings)
    },

    dismissPicker() {
      set({ googlePicker: null })
    },

    disconnectCalendar(calId) {
      const s = get()
      const wasLiveGoogle = s.settings.calendars.find((c) => c.id === calId)?.kind === 'live'
      const settings: Settings = {
        ...s.settings,
        calendars: s.settings.calendars.filter((c) => c.id !== calId),
        matrix: Object.fromEntries(Object.entries(s.settings.matrix).filter(([k]) => k !== calId)),
      }
      /* drop this calendar's inbound blocks from the week */
      const removed = s.blocks.filter((b) => b.external?.calId === calId).map((b) => b.id)
      const blocks = s.blocks.filter((b) => b.external?.calId !== calId)
      set({ settings, blocks })
      persistSettings(settings)
      if (removed.length) storage.deleteBlocks(removed).catch(() => {})
      persistBlocks(blocks)
      if (!wasLiveGoogle) return // .ics imports have nothing remote to clean up
      /* best-effort: remove the events MEW pushed there, then forget the ledger */
      void (async () => {
        try {
          const map = (await storage.loadSyncMap()).filter((e) => e.calId === calId)
          const acct = googleAccount(get().settings.googleClientId.trim())
          await acct.authorize(false)
          for (const e of map) await acct.deleteEvent(e.calId, e.eventId).catch(() => {})
        } catch {
          /* signed out — events stay on the remote calendar, harmless */
        } finally {
          await storage.deleteSyncForCalendar(calId).catch(() => {})
        }
      })()
    },

    async syncNow() {
      const s = get()
      const live = s.settings.calendars.filter((c) => c.kind === 'live' && c.provider === 'google')
      if (!live.length || s.syncing || !s.settings.googleClientId.trim()) return
      set({ syncing: true })
      /* the pull's before-snapshot for rescue detection (#286) — captured the
         moment the pull commits (runSync's one setBlocks), so a user turn that
         lands mid-await can never smear the diff. Null ⇒ the pull changed
         nothing and there is nothing to detect. */
      let prePull: Block[] | null = null
      try {
        const report = await runSync({
          account: googleAccount(s.settings.googleClientId.trim()),
          calendars: live,
          matrix: get().settings.matrix,
          now: new Date(nowFn()),
          dismissed: dismissedSet(),
          getBlocks: () => get().blocks,
          setBlocks: (blocks, removedIds) => {
            prePull ??= get().blocks
            set({ blocks })
            persistBlocks(blocks)
            if (removedIds.length) storage.deleteBlocks(removedIds).catch(() => {})
          },
          loadSyncMap: () => storage.loadSyncMap(),
          saveSyncMap: (put, removeIds) => storage.saveSyncMap(put, removeIds),
        })
        set({ lastSyncAt: nowFn(), syncError: null })
        const inbound = report.pulled.added + report.pulled.updated
        if (report.pulled.added > 0) {
          post([
            mewMsg(
              `${report.pulled.added} event${report.pulled.added === 1 ? '' : 's'} arrived from your calendar${inbound > 1 ? 's' : ''} — they're in the week now.`,
              prePull ? meetingBufferObservation(prePull) : undefined
            ),
          ])
        }
      } catch (e) {
        /* swallowed to state (syncError drives honest Settings copy), but logged
           with structure so a token/CORS/API cause is diagnosable in devtools —
           the calendar count is safe context; the error is redacted on the way out */
        log.error('calendar/sync', { calendars: live.length }, e)
        set({
          lastSyncAt: nowFn(), // back off; don't hammer a failing API every tick
          syncError: e instanceof Error ? e.message : 'sync failed',
        })
      } finally {
        /* rescues ride even a failed push — a landed pull is a real landing
           (#286); on success this posts right after the arrival line */
        if (prePull) offerRescues(prePull)
        set({ syncing: false })
      }
    },

    simulatePull(events) {
      const s = get()
      const todayKey = dayKey(new Date(s.nowMs))
      const calId = events[0]?.calId ?? 'demo@sim'
      /* a synthetic source calendar so mergePull tags/keys the events exactly
         as a live pull would; it never enters Settings, so a later hydrate's
         orphan sweep adopts anything left behind — self-healing by design */
      const cal: ConnectedCalendar = {
        id: calId,
        name: 'Simulated',
        who: 'dev seam',
        provider: 'google',
        kind: 'simulated',
        defaultTag: 'work',
      }
      const listing = events.map((e) => ({ calId, dayKey: todayKey, ...e }))
      const prev = s.blocks
      const pulled = mergePull(prev, listing, [cal], syncWindow(new Date(s.nowMs)), dismissedSet())
      if (pulled.added || pulled.updated || pulled.removed) {
        const kept = new Set(pulled.blocks.map((b) => b.id))
        const removedIds = prev.filter((b) => !kept.has(b.id)).map((b) => b.id)
        setBlocks(pulled.blocks)
        if (removedIds.length) storage.deleteBlocks(removedIds).catch(() => {})
        offerRescues(prev)
      }
    },

    /* ── power-user surface (#169/#170/#171) — additive ──────────────── */

    openCommandPalette(mode = 'command') {
      set({ commandPaletteOpen: true, commandPaletteMode: mode })
    },

    closeCommandPalette() {
      if (!get().commandPaletteOpen) return
      set({ commandPaletteOpen: false })
    },

    searchAll(query: string) {
      const s = get()
      return searchDomain({
        query,
        blocks: s.blocks,
        captures: s.captures,
        chat: s.chat,
        weekKeys: weekKeys(new Date(s.nowMs)),
        nowMs: s.nowMs,
      })
    },

    quickCapture(title: string, autoPlace?: boolean) {
      const clean = title.trim().slice(0, 120) // matches Block.title constraint (#171)
      if (!clean)
        return { kind: 'empty' as const, message: 'Nothing to capture yet — type a few words.' }
      const wantPlace = autoPlace ?? get().settings.quickCaptureMode === 'auto-place'

      /* AUTO-PLACE: today's first free 30-min slot, after the quiet-hours/now
         floor the rail already honors (proposeCaptureSlot scans from now+15,
         9:00 floor). We constrain to TODAY (i === 0) per the spec; no slot
         today → fall through to an open capture, never tomorrow silently. */
      if (wantPlace) {
        const s = get()
        const now = new Date(s.nowMs)
        const todayKey = dayKey(now)
        const slot = week.findFreeSlot(s.blocks, todayKey, 30, Math.max(minOfDay(now) + 15, 9 * 60))
        if (slot) {
          const placed = week.place(s.blocks, {
            title: clean,
            tag: 'work',
            dayKey: todayKey,
            startMin: slot.startMin,
            durationMin: 30,
          })
          if (placed) {
            const cap: Capture = {
              id: uid(),
              title: clean,
              createdAt: nowFn(),
              status: 'placed',
              placedBlockId: placed.id,
            }
            setBlocks([...s.blocks, placed])
            set((st) => ({ captures: [...st.captures, cap] }))
            persistCaptures([cap])
            /* the day's block landed — feed the brain the same sense a chat
               placement would, brain-on gated; chat itself stays untouched */
            return {
              kind: 'placed' as const,
              message: `Placed: ${clean} ${fmtTime(placed.startMin)}–${fmtTime(placed.endMin)} today`,
            }
          }
        }
        /* no free slot today — keep it, don't drop it: an open capture, with
           copy that says exactly what happened (acceptance: "No free slot
           today—captured as open"). */
        const cap: Capture = { id: uid(), title: clean, createdAt: nowFn(), status: 'open' }
        set((st) => ({ captures: [...st.captures, cap] }))
        persistCaptures([cap])
        return {
          kind: 'open' as const,
          message: `No free slot today — captured "${clean}" as open.`,
        }
      }

      /* OPEN MODE (default): a parallel capture, NO when-where nudge, NO chat
         turn — it waits quietly in the rail/search until you place it. This is
         the one capture path that deliberately skips fireEventNudges, because a
         quick-capture is "jot it and move on", not "let's find a slot now". */
      const cap: Capture = { id: uid(), title: clean, createdAt: nowFn(), status: 'open' }
      set((st) => ({ captures: [...st.captures, cap] }))
      persistCaptures([cap])
      return { kind: 'open' as const, message: `Captured: ${clean}` }
    },

    capture(text, opts) {
      const clean = text.trim().slice(0, 120) // Block.title constraint (#171)
      if (!clean)
        return { kind: 'empty' as const, message: 'Nothing to capture yet — type a few words.' }
      const item: Capture = {
        id: uid(),
        title: clean,
        createdAt: nowFn(),
        status: 'open',
        ...(opts?.tag ? { tag: opts.tag } : {}),
        ...(opts?.durationMin != null ? { durationMin: opts.durationMin } : {}),
        ...(opts?.energy ? { energy: opts.energy } : {}),
      }
      set((st) => ({ captures: [...st.captures, item] }))
      persistCaptures([item])
      /* holds NO time: no block, no when-where interrupt — it waits in the inbox
         until the owner places it (capture-now, place-later; MEW law). */
      return { kind: 'open' as const, item, message: `Added to your inbox: ${clean}` }
    },

    placeFromInbox(itemId, slot) {
      const s = get()
      const item = s.captures.find((c) => c.id === itemId)
      if (!item || item.status !== 'open') return false
      /* the owner CONFIRMED a slot → the executor places it (placeCaptureAt: the
         one mutation path the when-where accept + rail use), sized by the offer's
         duration hint. gbrain never reaches here on its own — only a confirm, so
         nothing is ever auto-scheduled. */
      return placeCaptureAt(
        item,
        slot.dayKey,
        slot.startMin,
        slot.durationMin ?? item.durationMin ?? DEFAULT_DURATION_MIN
      )
    },

    dismissInboxOffer(itemId) {
      const s = get()
      const item = s.captures.find((c) => c.id === itemId)
      if (!item || item.status !== 'open') return
      /* keep it WAITING (still open); mark it offered today so the proactive
         offer doesn't nag again the same day (#348 offer-once dedupe). */
      markInboxOffered(itemId, dayKey(new Date(s.nowMs)))
    },

    removeInboxItem(itemId) {
      if (!get().captures.some((c) => c.id === itemId)) return
      set((st) => ({ captures: st.captures.filter((c) => c.id !== itemId) }))
      persistDeleteCaptures([itemId])
    },

    inboxOffers() {
      return computeInboxOffers(get())
    },

    offerNextInboxPlacement() {
      runInboxOfferPass()
    },

    revealBlock(blockId: string) {
      const s = get()
      const target = s.blocks.find((b) => b.id === blockId)
      if (!target) return
      /* page to the week, focus the day, and page the week-grid to the week
         that holds it — read-only navigation, the card comes on screen */
      const todayKey = dayKey(new Date(s.nowMs))
      const offset = Math.round(
        (fromDayKey(target.dayKey).getTime() - fromDayKey(todayKey).getTime()) / (7 * 86400_000)
      )
      set({ page: 'week', focusedDayKey: target.dayKey, view: 'week', weekOffset: offset })
    },

    revealChatMessage(msgId: string) {
      /* the session log already knows how to scroll to a message id (a nudge
         clicked from a mirror uses the same field) — route there and hand it off */
      set({ page: 'week', scrollToMsgId: msgId })
    },
  }
})

/* ── derived hooks — select primitives/stable refs, compute via useMemo
      (zustand v5 selectors must not return fresh objects each render) ── */

export function useLive() {
  const blocks = useMew((s) => s.blocks)
  const nowMs = useMew((s) => s.nowMs)
  return useMemo(() => {
    const now = new Date(nowMs)
    return liveNow(blocks, dayKey(now), minOfDay(now))
  }, [blocks, nowMs])
}

export function usePixie() {
  const blocks = useMew((s) => s.blocks)
  const memory = useMew((s) => s.memory)
  const nowMs = useMew((s) => s.nowMs)
  const nudgeWaiting = useMew((s) =>
    s.chat.some((m) => m.role === 'nudge' && !m.resolved && (m.actions?.length ?? 0) > 0)
  )
  return useMemo(() => {
    const now = new Date(nowMs)
    const todayKey = dayKey(now)
    return pixieInputs({
      plannedDeepTodayH: week.plannedDeepMin(blocks, todayKey) / 60,
      agg: aggregates(memory, now),
      dayClear: week.dayClear(blocks, todayKey),
      nudgeWaiting,
    })
  }, [blocks, memory, nowMs, nudgeWaiting])
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

function joinHuman(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return parts.slice(0, -1).join(', ') + ', ' + parts[parts.length - 1]
}

declare global {
  interface Window {
    __mewReset?: () => Promise<void>
    /** Dev/scenario helper: patch settings programmatically (e.g. inject a test key). */
    __mewConfigure?: (patch: Partial<Settings>) => void
    /** Dev/scenario helper: push a mew reply into the log (visual/markdown proofs). */
    __mewSay?: (body: string, role?: ChatMessage['role']) => void
    /** Dev/scenario helper (E2E): stream a scripted mew reply chunk-by-chunk,
        `gapMs` apart, through the SAME per-chunk flush path speak() uses
        (streamedReply, #281) — so the paint pin observes the real repaint
        mechanics of one growing message row, never a simulation. Resolves when
        the last chunk has painted. */
    __mewSayStream?: (chunks: string[], gapMs: number) => Promise<void>
    /** Dev/scenario helper: append a scripted tool activity card (#282) so the
        multi-tool-turn shot is deterministic and keyless. Renders through the
        same role:'tool' LogLine path the live executor wrappers feed. */
    __mewSayTool?: (verb: string, target?: string, state?: ToolCardState) => void
    /** Dev/scenario helper (#293): post a scenario-picker message so the
        plan-mode cards render deterministically and keyless (the shoot shot).
        id / todayKey / dayLoad fill in when omitted; the message rides the
        same LogLine → ScenarioCards path a live propose feeds. */
    __mewSayScenarios?: (
      scenarios: (Pick<StoredScenario, 'name' | 'line' | 'places'> & Partial<StoredScenario>)[],
      body?: string
    ) => void
    /** Dev/scenario helper: drive the turn-in-flight UI (typing-indicator /
        working-status visual proofs) without a live model. */
    __mewSetTurn?: (thinking: boolean, workingStatus?: string | null) => void
    /** Dev/scenario helper (#280): park text as the queued composer message
        (null clears it) — display state only, so a shot can capture the
        queued row + stop & send without a live model turn. */
    __mewSetQueued?: (text: string | null) => void
    /** Dev/scenario helper: drive the sidecar lifecycle DISPLAY state (#249) —
        the web build has no shell to emit real beats. Display-only: it never
        touches the effective-brain ranking, so recall stays honestly off. */
    __mewSetBrainSidecar?: (status: SidecarStatus) => void
    /** Dev/scenario helper (E2E): rewind last-activity by `minutes` and run one
        tick, so the drift check-in can be exercised deterministically without
        advancing the wall clock. Mirrors how the real ticker evaluates drift. */
    __mewSetIdle?: (minutes: number) => void
    /** Dev/scenario helper (E2E): the append-only memory events, kind + day only
        (no payload), so a test can assert a flow logged what it should. */
    __mewMemoryKinds?: () => { kind: MemoryEvent['kind']; dayKey: string }[]
    /** Dev/scenario helper (#286): feed a simulated inbound calendar listing
        through the REAL pull + rescue path (mergePull diff → rescue chips) —
        no OAuth, no network. dayKey defaults to today; calId to 'demo@sim'.
        One paste verifies the rescue loop end-to-end:
        __mewSimulatePull([{ eventId:'e1', title:'Product sync', startMin:780, endMin:825 }]) */
    __mewSimulatePull?: (
      events: {
        eventId: string
        title: string
        startMin: number
        endMin: number
        dayKey?: string
        calId?: string
        optional?: boolean
      }[]
    ) => void
    /** Dev/scenario helper (#346): open the weekly-review surface directly, the
        way the offer's "show me" chip does — for a deterministic UI proof shot. */
    __mewOpenReview?: () => void
    /** Dev/scenario helper (#349): confirm a learned rule into local memory, so
        the week-scaffold offer/preview has a rhythm to draft from — the same
        append-only path the learn-offer's "yes, always" writes. Keyless. */
    __mewConfirmRule?: (rule: LearnedRule) => void
  }
}
if (typeof window !== 'undefined') {
  window.__mewReset = async () => {
    await storage.wipe()
    location.reload()
  }
  window.__mewConfigure = (patch) => {
    useMew.getState().updateSettings(patch)
  }
  window.__mewSay = (body, role = 'mew') => {
    useMew.setState((s) => ({ chat: [...s.chat, { id: uid(), role, body, ts: Date.now() }] }))
  }
  window.__mewSayStream = async (chunks, gapMs) => {
    const reply = streamedReply()
    for (const c of chunks) {
      reply.append(c)
      await new Promise((r) => setTimeout(r, gapMs))
    }
  }
  window.__mewSayTool = (verb, target, state = 'done') => {
    useMew.setState((s) => ({
      chat: [
        ...s.chat,
        {
          id: uid(),
          role: 'tool',
          body: '',
          ts: Date.now(),
          tool: { name: 'scripted', verb, ...(target ? { target } : {}), state },
        },
      ],
    }))
  }
  window.__mewSayScenarios = (scenarios, body) => {
    const todayKey = dayKey(new Date(nowFn()))
    const full: StoredScenario[] = scenarios.map((sc, i) => {
      const t = sc.todayKey ?? todayKey
      return {
        id: sc.id ?? `scn-dev-${i + 1}`,
        name: sc.name,
        line: sc.line,
        todayKey: t,
        places: sc.places,
        dayLoad:
          sc.dayLoad ??
          sc.places.reduce<Record<string, number>>((acc, p) => {
            const key = addDaysKey(t, p.dayOffset)
            acc[key] = (acc[key] ?? 0) + p.durationMin
            return acc
          }, {}),
        ...(sc.picked ? { picked: true } : {}),
      }
    })
    useMew.setState((s) => ({
      chat: [
        ...s.chat,
        scenariosMsg(
          body ??
            `${spell(full.length)} ways this week could hold it — pick the one that feels right.`,
          full
        ),
      ],
    }))
  }
  window.__mewSetTurn = (thinking, workingStatus = null) => {
    useMew.setState({ thinking, workingStatus })
  }
  window.__mewSetQueued = (text) => {
    useMew.setState({ queuedSpeak: text })
  }
  window.__mewSetBrainSidecar = (status) => {
    useMew.setState({ brainSidecar: status })
  }
  window.__mewSetIdle = (minutes) => {
    useMew.setState({ lastActivityMs: nowFn() - minutes * 60_000 })
    useMew.getState().tick()
  }
  window.__mewMemoryKinds = () =>
    useMew.getState().memory.map((e) => ({ kind: e.kind, dayKey: e.dayKey }))
  window.__mewSimulatePull = (events) => {
    useMew.getState().simulatePull(events)
  }
  window.__mewOpenReview = () => {
    useMew.getState().openWeeklyReview()
  }
  window.__mewConfirmRule = (rule) => {
    useMew.getState().confirmTaskRule(rule)
  }
}
