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
import { describeRrule, expandRrule, RRULE_DEFAULT_WEEKS } from '../domain/recurrence'
import { liveNow } from '../domain/liveNow'
import { aggregates, consolidate, interruptionsLastHour } from '../domain/memory'
import {
  computeInsights,
  dayLoadAssessment,
  dayLoadFiredKey,
  dayThroughputMin,
  proposeKinderPlan,
  taskDurations,
  trimMove,
  type TaskDuration,
} from '../domain/insights'
import { pixieInputs } from '../domain/pixie'
import { dayShape } from '../domain/dayShape'
import { restInsertion, scoreSlots, type SlotQuery, type TimeWindow } from '../domain/scheduler'
import { mealClassOf, scaffoldDay, scaffoldLine } from '../domain/sustenance'
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
import { applyPrefs } from '../domain/prefs'
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
import { generateScenarios, validateScenario, type ScenarioTask } from '../domain/scenarios'
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

  page: 'week' | 'settings'
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
  nudgeAction(msgId: string, actionId: string): void
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
  setPage(page: 'week' | 'settings'): void
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
  return {
    todayKey,
    todayLabel: fmtLongDate(now),
    nowLabel: fmtTime(minOfDay(now)),
    weekSummary: summary,
    realisticBestH: agg.realisticBestH,
    mewsToday: live.mewsToday,
    insightLines: insights.lines,
    /* the full set rides along so the rules floor's `show insights` renders
       the same presenter rows as the Settings card (#287) */
    insights,
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
      meals: s.settings.sustenanceMeals,
      nowMin,
    })
    burnSustenanceKey(todayKey, s.nowMs)
    if (!specs.length) return // fed (or wall-to-wall): nothing to add, nothing to say
    runToolWithCard('plan', { places: specs, frees: [] }, () => execPlan(specs, []))
    post([mewMsg(scaffoldLine(specs))])
  }

  function runTickEngine() {
    runSustenancePass()
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

  function execPlan(places: PlaceSpec[], frees: FreeSpec[]): string {
    const s = get()
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    let blocks = s.blocks
    const lines: string[] = []
    let placedDeep: Block | null = null
    const touchedDays = new Set<string>() // days a rest-pacing pass should re-check (#103)

    const prefs = activePrefsFrom(s.memory, brainOn() ? brainPrefs : null)
    const hist = histDurations(s)
    const bufferMin = s.settings.meetingBufferMin ?? 0 // #302
    for (const p of places) {
      const key = addDaysKey(todayKey, p.dayOffset)
      /* recurring block (#159): a rule expands into one block per occurrence,
         all linked by a shared recurringBlockId, before any one-off logic. The
         expansion reuses the same bounded DAILY/WEEKLY walk (and 800-cap) the
         ICS importer uses, but in day-keys; each occurrence keeps the anchor's
         wall-clock start. Window = anchor day → +52 weeks (UNTIL/COUNT cut it
         shorter). Recurrence is MEW's: these land as ordinary dated blocks, so
         the calendar push projects each one individually and never sees an
         RRULE (sync.ts has no rrule field by design). */
      if (p.rrule) {
        const { spec: prefd, applied: rApplied } = applyPrefs(
          { title: p.title, startMin: p.startMin, durationMin: p.durationMin },
          prefs,
          hist
        )
        const anchorStart = prefd.startMin ?? p.startMin ?? week.DAY_START
        const durationMin = prefd.durationMin ?? 60
        const windowEnd = addDaysKey(key, RRULE_DEFAULT_WEEKS * 7)
        const occs = expandRrule(p.rrule, key, anchorStart, durationMin, key, windowEnd)
        if (!occs.length) {
          lines.push(`couldn't place "${p.title}" — that recurrence has no dates in the next year`)
          continue
        }
        const seriesId = uid()
        const microRest = p.tag === 'rest' && durationMin <= 20
        for (const occ of occs) {
          const made = week.place(blocks, {
            title: p.title,
            tag: p.tag,
            dayKey: occ.dayKey,
            startMin: occ.startMin,
            endMin: occ.endMin,
            protected: p.protected ?? !microRest,
            attention: p.attention,
            due: p.due,
            recurringBlockId: seriesId,
            rrule: p.rrule,
          })
          if (!made) continue // that day is full — skip just this occurrence, keep the series
          blocks = [...blocks, made]
          if (made.tag === 'work' && !week.isBackground(made)) touchedDays.add(occ.dayKey)
        }
        const placedCount = blocks.filter((b) => b.recurringBlockId === seriesId).length
        if (!placedCount) {
          lines.push(`couldn't place "${p.title}" — every day in that recurrence is already full`)
          continue
        }
        const cadence = describeRrule(p.rrule, key)
        const through = occs[occs.length - 1].dayKey
        lines.push(
          `${p.title} repeats ${cadence} ${fmtTime(anchorStart)}–${fmtTime(anchorStart + durationMin)} — ${placedCount} block${placedCount === 1 ? '' : 's'} through ${fmtShortDate(through)}${rApplied.length ? ' (your standing rule)' : ''}`
        )
        continue
      }
      /* the standing rulebook fills what the user left open this message —
         their explicit times/durations always win over their own rules */
      const {
        spec: prefd,
        applied,
        usual,
      } = applyPrefs(
        { title: p.title, startMin: p.startMin, durationMin: p.durationMin },
        prefs,
        hist
      )
      /* short rests are pacing, not sacred rest: leave them unprotected so a
         reshape can absorb them instead of tripping protect-rest every move */
      const microRest = p.tag === 'rest' && (prefd.durationMin ?? 60) <= 20
      const bg = p.attention === 'background'
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
          tag: p.tag,
          durationMin: prefd.durationMin ?? 60,
          ...(p.due != null ? { due: p.due } : {}),
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
      if (existing) {
        const landStart = start ?? existing.startMin
        blocks = week.move(blocks, existing.id, key, landStart)
        const moved = blocks.find((b) => b.id === existing.id)!
        const clash = week.conflictsWith(blocks, key, moved.startMin, moved.endMin, moved.id, prefs)
        if (week.isDeep(moved)) placedDeep = moved
        if (moved.tag === 'work' && !week.isBackground(moved)) touchedDays.add(key)
        lines.push(
          `moved ${p.title.split('—')[0].trim()} to ${key === todayKey ? 'today' : fmtDowLong(key)} ${fmtTime(moved.startMin)}–${fmtTime(moved.endMin)}${clashNote(clash, prefs)}`
        )
        continue
      }
      const placed = week.place(blocks, {
        title: p.title,
        tag: p.tag,
        dayKey: key,
        startMin: start,
        durationMin: prefd.durationMin,
        protected: p.protected ?? !microRest,
        attention: p.attention,
        due: p.due,
      })
      if (!placed) {
        lines.push(`${fmtDowLong(key)} couldn't hold "${p.title}" — the day is full`)
        continue
      }
      /* background holds the clock, not the slot — placing one over a meeting
         (or vice versa) is the point, never a collision to warn about */
      const clash = week.isBackground(placed)
        ? []
        : week.conflictsWith(blocks, key, placed.startMin, placed.endMin, placed.id, prefs)
      blocks = [...blocks, placed]
      if (week.isDeep(placed)) placedDeep = placed
      if (placed.tag === 'work' && !week.isBackground(placed)) touchedDays.add(key)
      lines.push(
        `${key === todayKey ? 'today' : fmtDowLong(key)} ${fmtTime(placed.startMin)}–${fmtTime(placed.endMin)} is held for ${p.title}${week.isBackground(placed) ? ' (running in the background)' : ''}${applied.length ? ' (your standing rule)' : usual ? ' (your usual)' : ''}${placed.due != null ? ` · due ${fmtTime(placed.due)}` : ''}${clashNote(clash, prefs)}`
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

    /* the day-load meter (#301): every day this run placed work on gets one
       look against the demonstrated line — the guard posts (or parks) its own
       chips message and burns the per-day key */
    const guarded = offerDayLoadGuard(touchedDays, todayKey)

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
    return `Done — ${joinHuman(lines)}.${observation}${pacing}`
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

  function execComplete(query: string): string {
    const s = get()
    const todayKey = dayKey(new Date(s.nowMs))
    const target = week.findByQuery(s.blocks, query, todayKey)
    if (!target) return `I couldn't find "${query}" in the week — say it another way?`
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

  function execMove(query: string, toDayOffset?: number, toStartMin?: number): string {
    const s = get()
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    const target = week.findByQuery(s.blocks, query, todayKey)
    if (!target) return `I couldn't find "${query}" to move — say it another way?`
    /* an imported event CAN be moved — moving it takes ownership: detach from
       the source and tombstone it so a re-sync leaves your placement alone */
    let blocks = s.blocks
    if (target.external) {
      dismissExternal([target])
      blocks = detachExternal(blocks, target.id)
    }
    const toKey = toDayOffset != null ? addDaysKey(todayKey, toDayOffset) : target.dayKey
    /* same rulebook as plan/edit — a move's collision wording must not
       contradict its siblings about whether the other side can shift */
    const prefs = activePrefsFrom(s.memory, brainOn() ? brainPrefs : null)
    let start = toStartMin
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
    const landed = week.conflictsWith(
      blocks,
      toKey,
      start,
      start + week.duration(target),
      target.id,
      prefs
    )
    setBlocks(week.move(blocks, target.id, toKey, start))
    return `Moved — ${target.title.split('—')[0].trim()} now lives ${toKey === todayKey ? 'today' : fmtDowLong(toKey)} at ${fmtTime(start)}.${clashNote(landed, prefs)}`
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

  function execEdit(
    query: string,
    patch: {
      startMin?: number
      endMin?: number
      durationMin?: number
      title?: string
      tag?: import('../domain/types').Tag
      attention?: 'focus' | 'background'
      due?: number
    }
  ): string {
    const s = get()
    const todayKey = dayKey(new Date(s.nowMs))
    const target = week.findByQuery(s.blocks, query, todayKey)
    if (!target) return `I couldn't find "${query}" to change — say it another way?`
    /* editing an imported event takes ownership (detach + tombstone) so the
       change survives a re-sync */
    if (target.external) dismissExternal([target])
    const startMin = patch.startMin ?? target.startMin
    let endMin = patch.endMin ?? target.endMin
    if (patch.durationMin != null) endMin = startMin + patch.durationMin
    if (patch.startMin != null && patch.endMin == null && patch.durationMin == null) {
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
    const clash = week.isBackground(next)
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
        ? ` The brain didn't answer just now — it may know more; worth asking again in a moment.`
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
      executor. Durations fill exactly as execPlan would fill them (standing
      rules, then the user's own medians, then the 60-min floor), so a preview
      is sized the way the apply will be. Every scenario is validated against
      the live week at post time — the engine is conflict-free by construction,
      and the gate keeps that a checked fact rather than a hope. */
  function execProposeScenarios(prompt: string, specs: ScenarioTaskSpec[]): string {
    const s = get()
    const now = new Date(s.nowMs)
    const todayKey = dayKey(now)
    const prefs = activePrefsFrom(s.memory, brainOn() ? brainPrefs : null)
    const hist = histDurations(s)
    const tasks: ScenarioTask[] = specs
      .filter((t) => t.title.trim())
      .map((t) => ({
        title: t.title.trim(),
        tag: t.tag,
        durationMin:
          t.durationMin ??
          applyPrefs({ title: t.title.trim(), durationMin: t.durationMin }, prefs, hist).spec
            .durationMin ??
          60,
        ...(t.due != null ? { due: t.due } : {}),
        ...(t.window ? { window: t.window } : {}),
      }))
    if (!tasks.length) return 'nothing to propose — name the tasks and I will lay out the week.'
    const insights = computeInsights(s.memory, aggregates(s.memory, now), now)
    const all = generateScenarios(s.blocks, tasks, {
      nowMin: minOfDay(now),
      todayKey,
      horizonDays: 7,
      ...(insights.bestBand ? { bestWindow: BAND_WINDOW[insights.bestBand.band] } : {}),
      prefs,
      bufferMin: s.settings.meetingBufferMin ?? 0, // #302: scenarios inherit the seam
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

  function execRemove(query: string, opts: { at?: string; all?: boolean } = {}): string {
    const s = get()
    const todayKey = dayKey(new Date(s.nowMs))
    const { remove: matches, candidates } = week.resolveRemoval(s.blocks, query, opts, todayKey)
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
      const group = opts.all ? week.seriesOf(s.blocks, m) : [m]
      for (const b of group) removeSet.set(b.id, b)
    }
    const removed = [...removeSet.values()]
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

  /** ONE home for "a capture becomes a 30-min block": place, mark, announce.
      Used by the when-where accept and the thread rail's place action. */
  function placeCaptureAt(cap: Capture, toDayKey: string, startMin: number): boolean {
    const s = get()
    const placed = week.place(s.blocks, {
      title: cap.title,
      tag: 'work',
      dayKey: toDayKey,
      startMin,
      durationMin: 30,
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
    const inScope = (b: Block) => {
      if (b.status !== 'open' || b.external) return false
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
    const removed = s.blocks.filter(inScope)
    if (!removed.length)
      return `Nothing to clear ${scope === 'upcoming' ? 'ahead' : scope} — it's already a blank page.`
    const kept = s.blocks.filter((b) => !inScope(b))
    const keptExternal = s.blocks.filter(
      (b) => b.external && b.status === 'open' && b.dayKey >= todayKey
    ).length
    set({ blocks: kept })
    persistBlocks(kept)
    storage.deleteBlocks(removed.map((b) => b.id)).catch(() => {})
    const scopeLabel =
      scope === 'today'
        ? 'today'
        : scope === 'tomorrow'
          ? 'tomorrow'
          : scope === 'week'
            ? 'this week'
            : 'ahead'
    /* a deliberate blank page is a temporal landmark — offer the fresh start */
    setTimeout(() => fireEventNudges({ justCleared: { scope, count: removed.length } }), 0)
    return `Cleared — ${removed.length} open block${removed.length === 1 ? '' : 's'} ${scopeLabel} removed. Your mews stay counted${keptExternal ? `, and ${keptExternal} synced calendar event${keptExternal === 1 ? '' : 's'} stay (not mine to delete)` : ''}. A blank page — say the word and we'll shape it.`
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
    const droppedMemIds = s.memory.filter((e) => !snapMemIds.has(e.id)).map((e) => e.id) // notes this call logged

    if (
      !added.length &&
      !removed.length &&
      !changed.length &&
      !addedCaptureIds.length &&
      !droppedMemIds.length
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
      runTickEngine()
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
      /* mid-turn ordering (#282): a card is about to land — when reply text has
         already begun, close the live streamed row first, so post-tool deltas
         open a NEW mew row (text → card → text). The closed row is final:
         persist it and feed the brain sense exactly as stream-end would; a
         whitespace-only row is dropped the same way stream-end drops one. */
      const closeStreamRow = () => {
        const closed = reply?.closeRow()
        if (!closed) return
        if (closed.body.trim()) {
          spoke = true
          persistChat([closed])
          if (brainOn()) chatBatcher.add(closed, dayKey(new Date(get().nowMs)))
        } else {
          set((s) => ({ chat: s.chat.filter((m) => m.id !== closed.id) }))
        }
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
        complete: (q) => {
          acted = true
          snapshotForUndo()
          working('marking it done…')
          closeStreamRow()
          return runToolWithCard('complete', { query: q }, () => execComplete(q))
        },
        move: (q, d, t) => {
          acted = true
          snapshotForUndo()
          working('moving it…')
          closeStreamRow()
          return runToolWithCard('move', { query: q, toDayOffset: d, toStartMin: t }, () =>
            execMove(q, d, t)
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
        edit: (q, patch) => {
          acted = true
          snapshotForUndo()
          working('reshaping it…')
          closeStreamRow()
          return runToolWithCard('edit', { query: q }, () => execEdit(q, patch))
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
        findSlot: (dur, d, nb, na) => {
          working('finding a slot…')
          closeStreamRow()
          return runToolWithCard(
            'findSlot',
            { durationMin: dur, dayOffset: d, notBeforeMin: nb, notAfterMin: na },
            () => execFindSlot(dur, d, nb, na) // read-only
          )
        },
        suggestSlots: (t, tag, dur, due, win) => {
          working('finding a slot…')
          closeStreamRow()
          return runToolWithCard(
            'suggestSlots',
            { title: t, durationMin: dur },
            () => execSuggestSlots(t, tag, dur, due, win) // read-only
          )
        },
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
              if (final?.body.trim()) {
                persistChat([final])
                /* streamed replies bypass post() — feed the sense directly,
                   same brain-on gate as post() */
                if (brainOn()) chatBatcher.add(final, dayKey(new Date(get().nowMs)))
              } else if (final) set((s) => ({ chat: s.chat.filter((m) => m.id !== live.msgId) }))
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
        ts: nowMs,
      })
      set({ celebratePulse: nowMs })
      const done = { ...target, status: 'done' as const, completedAt: nowMs }
      fireEventNudges({ justCompleted: done })
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

      switch (`${msg.nudgeType}:${actionId}`) {
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
         "not mine to touch" path. The block bounces back in the view. */
      if (target.external) {
        post([
          mewMsg(
            `${target.title.split('—')[0].trim()} stays put — that event is from your calendar, so it's not mine to move. Change it where it lives and the next sync brings it across.`
          ),
        ])
        return 'external'
      }
      const todayKey = dayKey(new Date(s.nowMs))
      const dur = durationMin ?? week.duration(target)
      const resized = dur !== week.duration(target)
      /* dropped exactly where it already sits, at its own length → a click */
      if (toDayKey === target.dayKey && toStartMin === target.startMin && !resized) return 'noop'
      /* authoritative conflict gate (the view shows the same set live): a drop
         onto a time-holding open block is bounced, never silently stacked —
         MEW's "never silent" law. Optional/background blocks are transparent,
         exactly as conflictsWith treats them everywhere else. */
      const prefs = activePrefsFrom(s.memory, brainOn() ? brainPrefs : null)
      const endMin = toStartMin + dur
      const clash = week.conflictsWith(s.blocks, toDayKey, toStartMin, endMin, target.id, prefs)
      if (clash.length) return 'conflict'
      setBlocks(week.move(s.blocks, blockId, toDayKey, toStartMin, dur))
      post([
        mewMsg(
          resized
            ? `Resized — ${target.title.split('—')[0].trim()} now runs ${fmtTime(toStartMin)}–${fmtTime(endMin)} (${dur} min).`
            : `Moved — ${target.title.split('—')[0].trim()} now lives ${toDayKey === todayKey ? 'today' : fmtDowLong(toDayKey)} at ${fmtTime(toStartMin)}.`
        ),
      ])
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
}
