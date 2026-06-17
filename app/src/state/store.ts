/* The one store. UI subscribes here; domain stays pure; adapters do I/O.
   Anything about "now" is derived via domain/liveNow on each tick — never stored. */

import { useMemo } from 'react'
import { create } from 'zustand'
import { type Block, type Capture, type ChatMessage, DEFAULT_SETTINGS, type MemoryEvent, type NudgeId, type PrefPayload, type Settings, type VisibleTag } from '../domain/types'
import {
  addDaysKey,
  dayKey,
  fmtDowLong,
  fmtLongDate,
  fmtTime,
  fromDayKey,
  inQuietHours,
  minOfDay,
  spell,
  uid,
  weekKeys,
} from '../domain/time'
import * as week from '../domain/week'
import { liveNow } from '../domain/liveNow'
import { aggregates, consolidate, interruptionsLastHour } from '../domain/memory'
import { computeInsights, proposeKinderPlan, taskDurations, type TaskDuration } from '../domain/insights'
import { pixieInputs } from '../domain/pixie'
import { dayShape } from '../domain/dayShape'
import { restInsertion, scoreSlots, type SlotQuery, type TimeWindow } from '../domain/scheduler'
import { buildCtx, evaluateEvent, evaluateTick, type EngineState } from '../domain/nudges/engine'
import type { NudgeInstance } from '../domain/nudges/library'
import { coalesceNudges } from '../domain/nudges/queue'
import { NEW_CALENDAR_DEFAULTS } from '../domain/project'
import { createDexieStorage, type StoragePort } from '../adapters/storage'
import { createGbrainHttp } from '../adapters/brain/gbrainHttp'
import type { BrainPort } from '../adapters/brain/types'
import { blockEventPage, chatBatchPage, debriefPage, knownProjectsFrom, makeChatBatcher, peopleFrom, prefPage, slugify } from '../adapters/brain/senses'
import { effectiveBrain, setSidecarBrain } from '../adapters/brain/sidecar'
import { applyPrefs } from '../domain/prefs'
import {
  applyUpdate,
  brainEndpoint,
  isTauri,
  latestBackupDate,
  onBrainEndpoint,
  onUpdateReady,
  readBackup,
  registerCloseFlush,
  writeBackup,
} from '../adapters/desktop'
import {
  selectAdapters,
  type ChatTurn,
  type FreeSpec,
  type PlaceSpec,
  type ToolExecutor,
  type WeekContext,
} from '../adapters/model'
import { createBrowserNotifier } from '../adapters/notify'
import { googleAccount } from '../adapters/calendar/google'
import { mergePull, runSync, syncWindow } from '../adapters/calendar/sync'
import { icsToRemoteEvents } from '../adapters/calendar/ics'
import type { RemoteCalendar } from '../adapters/calendar/types'
import { seed } from './seed'

const storage: StoragePort = createDexieStorage()
const notifier = createBrowserNotifier()

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
/** recall scope truth — the live toggle, so a 'Whole brain' choice reaches
    every recall site (heads-up, week-review, rollups), not just chat */
const brainScope = () => useMew.getState().settings.brainScope
/** exposed for the Settings health dot — same instance the store writes through */
export const mewBrain = brain

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
export function activePrefsFrom(memory: MemoryEvent[], fromBrain: PrefPayload[] | null): PrefPayload[] {
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
  return activePrefsFrom(memory, fromBrain).map((p) => `${p.match} → ${p.value} (stated: "${p.stated}")`)
}

/* Dev/design affordance: `?t=HH:MM` shifts the app clock so any moment of the
   day can be previewed deterministically (now-line, end-of-day, quiet hours). */
function clockOffsetMs(): number {
  if (typeof location === 'undefined') return 0
  const m = new URLSearchParams(location.search).get('t')?.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return 0
  const target = new Date()
  target.setHours(Number(m[1]), Number(m[2]), 0, 0)
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
  chat: ChatMessage[]
  memory: import('../domain/types').MemoryEvent[]
  settings: Settings

  page: 'week' | 'settings'
  view: 'focus' | 'week'
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

  hydrate(): Promise<void>
  tick(): void
  activity(): void
  interruption(): void
  speak(text: string): Promise<void>
  /** Stop the in-flight turn (the composer's ■ / Esc). Aborts the live
      stream/fetch and clears the turn state; whatever already streamed or
      committed stays — an abort is the user's call, never a rollback, and
      never replayed through a fallback. No-op when nothing is mewing. */
  stopSpeaking(): void
  /** Read-only history answer: real sums from the live week + brain recall
      color. Never mutates — chat is where the reply lands, via the tool. */
  queryBrain(question: string): Promise<string>
  toggleComplete(blockId: string): void
  nudgeAction(msgId: string, actionId: string): void
  focusDay(key: string | null): void
  setPage(page: 'week' | 'settings'): void
  setView(view: 'focus' | 'week'): void
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
}

/* ── helpers ──────────────────────────────────────────────────────── */

function mewMsg(body: string, observation?: string): ChatMessage {
  return { id: uid(), role: 'mew', body, ts: nowFn(), ...(observation ? { observation } : {}) }
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

function weekContext(s: MewState, recallLines: string[] = []): WeekContext {
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
      .map((b) => `${fmtTime(b.startMin)}\u2013${fmtTime(b.endMin)} ${b.title} [${week.contextMarkers(b)}]`)
      .join(' · ')
    summary.push(`${i === 0 ? 'today' : fmtDowLong(key)} (${key}): ${items}`)
  }
  return {
    todayKey,
    todayLabel: fmtLongDate(now),
    nowLabel: fmtTime(minOfDay(now)),
    weekSummary: summary,
    realisticBestH: agg.realisticBestH,
    mewsToday: live.mewsToday,
    insightLines: computeInsights(s.memory, agg, now).lines,
    recallLines,
    prefLines: prefLinesFrom(s.memory, brainOn() ? brainPrefs : null),
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
      console.warn('mew: auto-backup failed (will retry on the next change)', err)
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
  const persistSettings = (st: Settings) => {
    storage.putSettings(st).catch(() => {})
    queueBackup()
  }
  const persistCaptures = (cs: Capture[]) => {
    storage.putCaptures(cs).catch(() => {})
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
    const next = { ...cur, dismissedEvents: [...new Set([...(cur.dismissedEvents ?? []), ...keys])] }
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
     always-on rulebook, not only receive the senses' writes. */
  let sidecarSubscribed = false
  function connectSidecarBrain() {
    if (sidecarSubscribed || !isTauri()) return
    sidecarSubscribed = true
    onBrainEndpoint((e) => {
      setSidecarBrain(e)
      refreshBrainPrefs()
    })
    void brainEndpoint().then((e) => {
      if (e) {
        setSidecarBrain(e)
        refreshBrainPrefs()
      }
    })
  }

  /* chat → brain: user/mew turns batch into one timeline write per quiet
     minute (nudges stay out — engine chatter isn't the user's story) */
  const chatBatcher = makeChatBatcher((turns, day) => {
    const page = chatBatchPage(turns, day)
    if (page) void brain.ingest(page)
  })

  function post(msgs: ChatMessage[], opts?: { mirror?: boolean }) {
    if (!msgs.length) return
    set((s) => ({ chat: [...s.chat, ...msgs] }))
    persistChat(msgs)
    if (brainOn()) {
      const day = dayKey(new Date(get().nowMs))
      for (const m of msgs) if (m.role !== 'nudge') chatBatcher.add(m, day)
    }
    const last = msgs[msgs.length - 1]
    if (opts?.mirror && last.role === 'nudge') {
      notifier.mirror({
        title: `${get().settings.mewName} · MEW`,
        body: last.body.split('\n')[0],
        tag: last.id,
        onClick: () => {
          useMew.setState({ page: 'week', scrollToMsgId: last.id })
        },
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
    set((s) => ({
      engine: {
        lastFired: { ...s.engine.lastFired, [n.type]: { ts: nowMs, key: n.key } },
        lastDriftBlockId: n.type === 'drift' ? String(n.payload.blockId) : s.engine.lastDriftBlockId,
      },
    }))
    /* a drift check-in IS the drift signal — log it so insights can find where
       attention slips (driftBand reads these; weekly summaries count them) */
    if (n.type === 'drift') {
      logMemory({ kind: 'drift', dayKey: dayKey(new Date(nowMs)), ts: nowMs })
    }
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
            e.title!
              .split('—')[0]
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, ''),
          )
          .filter(Boolean),
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
      }),
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
      .recall(`debrief last week — week of ${addDaysKey(todayKey, -7)}`, { limit: 2, scope: brainScope() })
      .then((lines) => {
        weekColor = { day: todayKey, lines }
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
        .recall(`person ${names} recent interactions and outcomes`, { limit: 2, scope: brainScope() })
        .then((lines) => {
          personRecall[b.id] = lines
        })
        .catch(() => {
          personRecall[b.id] = [] // silence, not error — the floor never hears about it
        })
        .finally(() => personRecallPending.delete(b.id))
    }
  }

  function runTickEngine() {
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
        prefs: activePrefsFrom(s.memory, brainOn() ? brainPrefs : null),
        brainLinks: brainOn() ? brainLinks?.pairs : undefined,
        brainWeekLines: weekColor?.day === todayKey ? weekColor.lines : undefined,
        personRecall,
      },
      s.engine,
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
         is connected it lands on the day page for week-in-review to read */
      if (n.type === 'debrief' && brainOn()) {
        void brain.ingest(debriefPage(n.body, todayKey))
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
      event,
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
    if (!pendingNudgeQueue.length) return
    const drained = pendingNudgeQueue
    pendingNudgeQueue = []
    post(coalesceNudges(drained).map(eventNudgeMsg))
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
    for (const p of places) {
      const key = addDaysKey(todayKey, p.dayOffset)
      /* the standing rulebook fills what the user left open this message —
         their explicit times/durations always win over their own rules */
      const { spec: prefd, applied, usual } = applyPrefs(
        { title: p.title, startMin: p.startMin, durationMin: p.durationMin },
        prefs,
        hist,
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
                b.title.split('—')[0].trim().toLowerCase() === reBase,
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
        const best = scoreSlots(occupied, q, todayKey, minOfDay(now), prefs).find((c) => c.dayKey === key)
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
          `moved ${p.title.split('—')[0].trim()} to ${key === todayKey ? 'today' : fmtDowLong(key)} ${fmtTime(moved.startMin)}–${fmtTime(moved.endMin)}${clashNote(clash, prefs)}`,
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
        `${key === todayKey ? 'today' : fmtDowLong(key)} ${fmtTime(placed.startMin)}–${fmtTime(placed.endMin)} is held for ${p.title}${week.isBackground(placed) ? ' (running in the background)' : ''}${applied.length ? ' (your standing rule)' : usual ? ' (your usual)' : ''}${placed.due != null ? ` · due ${fmtTime(placed.due)}` : ''}${clashNote(clash, prefs)}`,
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
          restNotes.push(`tucked a ${rest.endMin - rest.startMin}-min breather into ${when} at ${fmtTime(rest.startMin)}`)
        }
      } else {
        restNotes.push(`${when} runs ${fmtTime(r.startMin)}–${fmtTime(r.endMin)} unbroken — want me to make room for a short breather?`)
      }
    }
    setBlocks(blocks)

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
          b.status !== 'rolled',
      ).length
      observation = ` That's your ${ordinal(deepCount)} deep-work block this week.`
      if (agg.realisticBestH != null) {
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
         none (e.g. the asked day is past the scorer horizon) (#80) */
      const q: SlotQuery = { title: target.title, tag: target.tag, durationMin: week.duration(target) }
      const best = scoreSlots(blocks.filter((b) => b.id !== target.id), q, todayKey, minOfDay(now), prefs).find(
        (c) => c.dayKey === toKey,
      )
      if (best) start = best.startMin
      else {
        const slot = week.findFreeSlot(
          blocks.filter((b) => b.id !== target.id),
          toKey,
          week.duration(target),
          toKey === todayKey ? minOfDay(now) + 15 : undefined,
        )
        if (!slot) return `${fmtDowLong(toKey)} can't hold it — want a different day?`
        start = slot.startMin
      }
    }
    const landed = week.conflictsWith(blocks, toKey, start, start + week.duration(target), target.id, prefs)
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
    },
  ): string {
    const s = get()
    const todayKey = dayKey(new Date(s.nowMs))
    const target = week.findByQuery(s.blocks, query, todayKey)
    if (!target) return `I couldn't find "${query}" to change — say it another way?`
    /* editing an imported event takes ownership (detach + tombstone) so the
       change survives a re-sync */
    if (target.external) dismissExternal([target])
    let startMin = patch.startMin ?? target.startMin
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
    const clash =
      week.isBackground(next) ? [] : week.conflictsWith(s.blocks, target.dayKey, startMin, endMin, target.id, prefs)
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

  /** History/entity answers: the live week supplies the NUMBERS (rollup over
      real blocks — never an estimate), the brain supplies citable color. The
      week of the question is this week; "eaten" means held clock time. The
      subject is matched as a title fragment, so projects, tasks, and people
      all answer — and a name only ever spoken to the keyless floor (which
      lowercases titles) still resolves. */
  async function execQueryBrain(question: string): Promise<string> {
    const s = get()
    const known = knownProjectsFrom(s.blocks.map((b) => b.title))
    const qSlug = `-${slugify(question)}-`
    /* subject: a declared project named in the question, else the noun the
       question's own shape points at ("how much has X eaten/taken") */
    const projectHit = [...known.entries()].find(([slug]) => qSlug.includes(`-${slug}-`))
    const asked =
      question.match(/\b(?:has|have|did)\s+(.+?)\s+(?:eaten|taken|cost|consumed|used)\b/i)?.[1] ??
      question.match(/\b(?:time|much|long)\s+(?:on|for|with)\s+(.+?)(?:\s+this\s+week|[?.!]|$)/i)?.[1] ??
      null
    const slug = projectHit?.[0] ?? (asked ? slugify(asked) : null)
    const name = projectHit?.[1] ?? asked?.trim() ?? null

    /* recall rides along when a brain is connected — capped, optional-path */
    let recall: string[] = []
    if (brainOn()) {
      recall = await Promise.race([
        brain.recall(question, { limit: 3, scope: brainScope() }),
        new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 1200)),
      ]).catch(() => [])
    }

    if (slug && name) {
      const days = weekKeys(new Date(s.nowMs))
      const r = week.rollup(s.blocks, days, (b) => slugify(b.title).includes(slug))
      if (r.plannedMin > 0 || r.rolled > 0) {
        const h = (min: number) =>
          min % 60 === 0 ? `${min / 60}h` : `${Math.round((min / 60) * 10) / 10}h`
        const parts = [
          `${name} this week: ${h(r.plannedMin)} across ${r.done + r.open} block${r.done + r.open === 1 ? '' : 's'}`,
          `${h(r.doneMin)} done, ${h(r.plannedMin - r.doneMin)} still open`,
        ]
        if (r.rolled) parts.push(`${r.rolled} rolled forward`)
        const lines = recall.length ? `\n${recall.join('\n')}` : ''
        return `${parts.join(' · ')}.${lines}`
      }
    }

    /* no local numbers — recall may still know it; absent both, say so honestly */
    if (recall.length) return recall.join('\n')
    return `I can't see ${name ?? 'that'} yet — nothing in this week's blocks${
      brainOn() ? ' or the brain' : ''
    } mentions it.`
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
      const tail = list.length === 2 ? `${list[0]} or ${list[1]}` : `${list.slice(0, -1).join(', ')}, or ${list[list.length - 1]}`
      const base = query.split('—')[0].trim()
      return `${candidates.length} "${base}" blocks ahead — ${tail}? Tell me which, or say "both" to drop them all.`
    }
    if (!matches.length) return `I couldn't find "${query}" ahead to remove — say it another way?`
    /* imported events CAN be removed now — tombstone them so a re-sync won't
       resurrect them; everything else just deletes */
    dismissExternal(matches)
    const keep = new Set(matches.map((b) => b.id))
    const kept = s.blocks.filter((b) => !keep.has(b.id))
    set({ blocks: kept, nowMs: nowFn() })
    persistBlocks(kept)
    storage.deleteBlocks(matches.map((b) => b.id)).catch(() => {})
    const fromCal = matches.filter((b) => b.external).length
    const names = matches
      .map((b) => `${b.title.split('—')[0].trim()} (${b.dayKey === todayKey ? 'today' : fmtDowLong(b.dayKey)} ${fmtTime(b.startMin)})`)
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
        `Placed — "${cap.title}" lives ${toDayKey === todayKey ? 'today' : fmtDowLong(toDayKey)} at ${fmtTime(startMin)}.`,
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
    notAfterMin?: number,
  ): string {
    const s = get()
    const todayKey = dayKey(new Date(s.nowMs))
    const key = addDaysKey(todayKey, dayOffset)
    const label = key === todayKey ? 'today' : fmtDowLong(key)
    const floor = Math.max(
      notBeforeMin ?? week.DAY_START,
      key === todayKey ? minOfDay(new Date(s.nowMs)) + 5 : 0,
    )
    const ceil = notAfterMin ?? 22 * 60 + 30
    const fit = week
      .freeWindows(s.blocks, key, floor, ceil)
      .find((w) => w.endMin - w.startMin >= durationMin)
    if (fit) {
      return `Clear window ${label}: ${fmtTime(fit.startMin)}–${fmtTime(fit.startMin + durationMin)} (checked against every time-holding block${notAfterMin ? `, ends before ${fmtTime(ceil)}` : ''}).`
    }
    /* honest alternatives: same day without the ceiling, then tomorrow */
    const later = week
      .freeWindows(s.blocks, key, floor, 22 * 60 + 30)
      .find((w) => w.endMin - w.startMin >= durationMin)
    const nextKey = addDaysKey(key, 1)
    const nextDay = week
      .freeWindows(s.blocks, nextKey, 9 * 60, 22 * 60 + 30)
      .find((w) => w.endMin - w.startMin >= durationMin)
    const alts = [
      later ? `later ${label} ${fmtTime(later.startMin)}–${fmtTime(later.startMin + durationMin)}` : null,
      nextDay ? `${nextKey === addDaysKey(todayKey, 1) ? 'tomorrow' : fmtDowLong(nextKey)} ${fmtTime(nextDay.startMin)}–${fmtTime(nextDay.startMin + durationMin)}` : null,
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
    window?: TimeWindow,
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
    const ranked = scoreSlots(s.blocks, q, todayKey, minOfDay(now), prefs)
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
    if (!removed.length) return `Nothing to clear ${scope === 'upcoming' ? 'ahead' : scope} — it's already a blank page.`
    const kept = s.blocks.filter((b) => !inScope(b))
    const keptExternal = s.blocks.filter(
      (b) => b.external && b.status === 'open' && b.dayKey >= todayKey,
    ).length
    set({ blocks: kept })
    persistBlocks(kept)
    storage.deleteBlocks(removed.map((b) => b.id)).catch(() => {})
    const scopeLabel =
      scope === 'today' ? 'today' : scope === 'tomorrow' ? 'tomorrow' : scope === 'week' ? 'this week' : 'ahead'
    /* a deliberate blank page is a temporal landmark — offer the fresh start */
    setTimeout(() => fireEventNudges({ justCleared: { scope, count: removed.length } }), 0)
    return `Cleared — ${removed.length} open block${removed.length === 1 ? '' : 's'} ${scopeLabel} removed. Your mews stay counted${keptExternal ? `, and ${keptExternal} synced calendar event${keptExternal === 1 ? '' : 's'} stay (not mine to delete)` : ''}. A blank page — say the word and we'll shape it.`
  }

  /** Chat history → model thread. Nudges ride along as labeled assistant turns. */
  function buildThread(chat: ChatMessage[]): ChatTurn[] {
    return chat
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
    memory: [],
    settings: DEFAULT_SETTINGS,

    page: 'week',
    view: 'focus',
    weekOffset: 0,
    focusedDayKey: null,
    nowMs: nowFn(),
    scrollToMsgId: null,
    celebratePulse: 0,
    thinking: false,
    workingStatus: null,
    promptDraft: '',

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

    queryBrain(question: string) {
      return execQueryBrain(question)
    },

    async hydrate() {
      subscribeUpdateOffers()
      connectSidecarBrain()
      const loaded = await storage.load()
      if (loaded.blocks.length === 0 && loaded.memory.length === 0) {
        const s = seed(new Date(nowFn()))
        set({
          blocks: s.blocks,
          memory: s.memory,
          chat: s.chat,
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
        set({
          blocks: loaded.blocks,
          captures: loaded.captures,
          chat: loaded.chat,
          memory: loaded.memory,
          // merge so settings keys added in newer versions (pet, themeMode, …) backfill
          settings: { ...DEFAULT_SETTINGS, ...(loaded.settings ?? {}) },
          hydrated: true,
          nowMs: nowFn(),
        })
      }
      runTickEngine()
      /* an update announced during boot waits for chat to exist */
      if (stagedUpdateVersion) {
        offerUpdate(stagedUpdateVersion)
        stagedUpdateVersion = null
      }
      refreshBrainPrefs()
    },

    tick() {
      const prevDay = get().lastTickDay
      const nowMs = nowFn()
      const todayKey = dayKey(new Date(nowMs))
      set({ nowMs })

      if (todayKey !== prevDay) {
        /* day rollover: log whether yesterday's rest was honored */
        const s = get()
        const yRest = week
          .blocksForDay(s.blocks, prevDay)
          .find((b) => b.tag === 'rest')
        if (yRest) {
          const workLeftOpen = week.openItems(s.blocks, prevDay).length > 0
          logMemory({ kind: workLeftOpen ? 'rest_skipped' : 'rest_kept', dayKey: prevDay, ts: nowMs })
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
      /* fresh cancel handle for this turn; .signal rides into the adapter so a
         user 'stop' aborts the live stream/fetch (#117) */
      const abort = new AbortController()
      turnAbort = abort

      let acted = false // once the week mutated, never re-run the message through a fallback
      /* one short, positive label per tool — what MEW is doing right now. The
         thinking row shows it while `thinking`; speak's finally clears it. */
      const working = (label: string) => set({ workingStatus: label })
      const exec: ToolExecutor = {
        plan: (places, frees) => {
          acted = true
          working('placing blocks…')
          return execPlan(places, frees)
        },
        complete: (q) => {
          acted = true
          working('marking it done…')
          return execComplete(q)
        },
        move: (q, d, t) => {
          acted = true
          working('moving it…')
          return execMove(q, d, t)
        },
        capture: (t) => {
          acted = true
          working('jotting it down…')
          return execCapture(t)
        },
        clear: (scope) => {
          acted = true
          working('clearing the time…')
          return execClear(scope)
        },
        edit: (q, patch) => {
          acted = true
          working('reshaping it…')
          return execEdit(q, patch)
        },
        remove: (q, opts) => {
          acted = true
          working('taking it off…')
          return execRemove(q, opts)
        },
        analyze: (d) => {
          working('reading your week…')
          return execAnalyze(d) // read-only: not an action
        },
        findSlot: (dur, d, nb, na) => {
          working('finding a slot…')
          return execFindSlot(dur, d, nb, na) // read-only
        },
        suggestSlots: (t, tag, dur, due, win) => {
          working('finding a slot…')
          return execSuggestSlots(t, tag, dur, due, win) // read-only
        },
        queryBrain: (q) => {
          working('checking what I know…')
          return execQueryBrain(q) // read-only
        },
        remember: (pref) => {
          acted = true
          working('remembering that…')
          return execRemember(pref)
        },
      }

      try {
        /* hybrid recall rides into context — capped so a slow brain can
           never hold the turn hostage (history informs; liveNow decides) */
        let recallLines: string[] = []
        if (brainOn()) {
          const today = week
            .blocksForDay(get().blocks, dayKey(new Date(get().nowMs)))
            .map((b) => b.title.split('—')[0].trim())
            .join(', ')
          recallLines = await Promise.race([
            brain.recall(`${text} · today: ${today}`, { limit: 5, scope: brainScope() }),
            new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 1500)),
          ])
        }
        const ctx = weekContext(get(), recallLines)
        const thread = buildThread(get().chat)
        const adapters = selectAdapters(get().settings, () => new Date(nowFn()))
        const failed: string[] = []

        for (const adapter of adapters) {
          let msgId: string | null = null
          let buffer = ''
          const flush = () => {
            if (msgId == null) {
              msgId = uid()
              const msg: ChatMessage = { id: msgId, role: 'mew', body: buffer, ts: nowFn() }
              set((s) => ({ thinking: false, chat: [...s.chat, msg] }))
            } else {
              const id = msgId
              set((s) => ({ chat: s.chat.map((m) => (m.id === id ? { ...m, body: buffer } : m)) }))
            }
          }
          try {
            for await (const chunk of adapter.converse(thread, ctx, exec, abort.signal)) {
              if (!chunk) continue
              buffer += chunk
              flush()
            }
            if (msgId) {
              const final = get().chat.find((m) => m.id === msgId)
              if (final?.body.trim()) {
                persistChat([final])
                /* streamed replies bypass post() — feed the sense directly,
                   same brain-on gate as post() */
                if (brainOn()) chatBatcher.add(final, dayKey(new Date(get().nowMs)))
              }
              else if (final) set((s) => ({ chat: s.chat.filter((m) => m.id !== msgId) }))
            }
            if (failed.length && adapter.id === 'rules') {
              /* the adapter failed even after the in-adapter backoff retried any
                 transient blip (#116) — say so kindly and carry the turn here */
              post([
                mewMsg(
                  failed.includes('anthropic')
                    ? `(the model was busy — i retried, then handled it myself.)`
                    : `(the local model was busy — i retried, then handled it myself.)`,
                ),
              ])
            }
            return
          } catch {
            if (msgId) {
              const final = get().chat.find((m) => m.id === msgId)
              if (final?.body.trim()) {
                persistChat([final])
                /* streamed replies bypass post() — feed the sense directly,
                   same brain-on gate as post() */
                if (brainOn()) chatBatcher.add(final, dayKey(new Date(get().nowMs)))
              }
              else if (final) set((s) => ({ chat: s.chat.filter((m) => m.id !== msgId) }))
            }
            if (abort.signal.aborted) {
              /* the user pressed stop — a clean end, not a failure. Whatever
                 streamed or committed stays; never retry, never fall to the
                 rules floor (#117). The signal is the truth here, not the error
                 type, so a stop reads the same however the stream rejected. */
              post([mewMsg(`(stopped — what's above stands.)`)])
              return
            }
            if (acted || buffer.trim()) {
              /* the week already changed (or MEW already spoke) — finish honestly, don't replay */
              post([mewMsg(`(The connection hiccuped mid-thought — everything above did go through.)`)])
              return
            }
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
      }
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
          .find((e) => e.kind === 'completed' && e.dayKey === target.dayKey && e.plannedMin === week.duration(target))
        setBlocks(week.uncomplete(s.blocks, blockId))
        if (evIdx) set((st) => ({ memory: st.memory.filter((e) => e.id !== evIdx.id) }))
        return
      }
      if (target.status !== 'open') return
      const nowMs = nowFn()
      setBlocks(week.complete(s.blocks, blockId, nowMs))
      void brain.ingest(
        blockEventPage(target, 'completed', target.dayKey, minOfDay(new Date(nowMs)), knownProjectsFrom(s.blocks.map((b) => b.title)).keys()),
      )
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
            const todaySlot = week.findFreeSlot(without, todayKey, week.duration(target), minOfDay(now) + 15)
            const slot = todaySlot ?? week.findFreeSlot(without, addDaysKey(todayKey, 1), week.duration(target), 9 * 60)
            if (slot) {
              const toKey = todaySlot ? todayKey : addDaysKey(todayKey, 1)
              setBlocks(week.move(s.blocks, id, toKey, slot.startMin))
              post([mewMsg(`Moved — it lives ${toKey === todayKey ? 'later today' : 'tomorrow'} at ${fmtTime(slot.startMin)}.`)])
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
            post([mewMsg(`Guarded until ${fmtTime(target.endMin)} — nothing non-urgent gets through.`)])
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
            post([mewMsg(`Held — review & notes ${fmtTime(start)}–${fmtTime(start + 15)}. Capture it while it's warm.`)])
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
                    `Right-sized — ${candidate.title.split('—')[0].trim()} moved to ${fmtDowLong(toKey)} ${fmtTime(slot.startMin)}. ${fmtDowLong(heavyKey)} breathes again.`,
                  ),
                ])
                moved = true
              }
            }
            if (!moved) post([mewMsg(`The week is tight everywhere — want to look at it together?`)])
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
            void brain.ingest(
              blockEventPage(target, 'rolled', target.dayKey, minOfDay(new Date(s.nowMs)), knownProjectsFrom(s.blocks.map((b) => b.title)).keys()),
            )
            logMemory({
              kind: 'rolled',
              dayKey: target.dayKey,
              tag: target.tag,
              plannedMin: week.duration(target),
              deep: week.isDeep(target),
              title: target.title,
              startMin: target.startMin,
              endMin: target.endMin,
            })
            const dayLabel = toKey === addDaysKey(todayKey, 1) ? 'tomorrow' : fmtDowLong(toKey)
            post([
              mewMsg(
                `Held — ${target.title.split('—')[0].trim()} lives ${dayLabel} at ${fmtTime(toStart)}. Let it go for tonight.`,
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
                `Kept. I can't move their meeting, but the rest stays on your calendar — they see you as busy.`,
              ),
            ])
            accept()
            break
          }
          if (intruder) {
            const fromMin = intruder.dayKey === dayKey(new Date(s.nowMs)) ? minOfDay(new Date(s.nowMs)) : 0
            const next = week.nextSlotAfter(s.blocks, intruder, fromMin)
            if (next) {
              setBlocks(week.move(s.blocks, intruder.id, next.dayKey, next.startMin))
              const dayLabel = next.dayKey === intruder.dayKey ? '' : ' tomorrow'
              post([mewMsg(`Kept. ${intruder.title.split('—')[0].trim()} moved${dayLabel} to ${fmtTime(next.startMin)} — the rest stays yours.`)])
            } else {
              post([mewMsg(`Kept — the rest stays. I couldn't find a later slot for ${intruder.title.split('—')[0].trim()}, so it's still where it was; move it where you like.`)])
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
            const slot = week.findFreeSlot(s.blocks.filter((b) => b.id !== restId), rest.dayKey, week.duration(rest), rest.endMin)
            if (slot) {
              setBlocks(week.move(s.blocks, restId, rest.dayKey, slot.startMin))
              post([mewMsg(`Moved — rest now starts at ${fmtTime(slot.startMin)}. It still happens; that's the deal.`)])
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
                `The days ahead already fit inside your realistic best${agg.realisticBestH != null ? ` (~${agg.realisticBestH}h deep work a day)` : ''} — the shape is kind. The carry-over story is about size, not placement: try booking blocks a touch longer than instinct says.`,
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
            const moves = JSON.parse(String(payload.moves)) as import('../domain/insights').KinderMove[]
            let blocks = s.blocks
            const applied: string[] = []
            for (const m of moves) {
              const target = blocks.find((b) => b.id === m.blockId && b.status === 'open')
              if (!target) continue
              blocks = week.move(blocks, m.blockId, m.toDayKey, m.toStartMin)
              applied.push(`${m.title} → ${fmtDowLong(m.toDayKey).toLowerCase()} ${fmtTime(m.toStartMin)}`)
            }
            setBlocks(blocks)
            post([
              mewMsg(
                applied.length
                  ? `Done — ${joinHuman(applied)}. The week breathes again.`
                  : `Those blocks moved on their own since I proposed this — the shape may already be kinder.`,
              ),
            ])
          } catch {
            post([mewMsg(`That proposal went stale — ask me for a kinder shape again and I'll recompute it.`)])
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
              `Good. Give me the one thing that matters most — "block tomorrow morning for the deck" works — and I'll place the rest around it${agg.realisticBestH != null ? `, keeping every day inside ~${agg.realisticBestH}h of deep work` : ''}.`,
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
                  `Placed — a 25-minute starter for "${title}" ${toKey === todayKey ? 'today' : fmtDowLong(toKey).toLowerCase()} at ${fmtTime(toStart)}. Crack it open; the rest follows.`,
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
                `The restart didn't take — ${err instanceof Error ? err.message : 'unknown error'}. The update stays staged; relaunching will pick it up.`,
              ),
            ])
          })
          break
        }
        case 'update:later':
        /* restore is a system offer, not an engine nudge — no outcome stats */
        case 'restore:accept': {
          void (async () => {
            const json = await readBackup()
            if (json) await get().importData(json)
            else post([mewMsg(`The backup file isn't readable anymore — check Documents/MEW/mew-backup.json.`)])
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
              }),
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
      if (target.startedAt != null && target.dayKey === dayKey(now) && target.startMin <= nowMin && nowMin < target.endMin) {
        post([mewMsg(`${target.title.split('—')[0].trim()} is already running — finish it for the mew, or interrupt it to park the rest.`)])
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
        post([mewMsg(`Nowhere kind to park the rest this week — it stays open; say the word and we'll find it a home.`)])
        return
      }
      const { blocks: rolled, rolled: next } = week.roll(s.blocks, blockId, toKey, slot.startMin)
      setBlocks(rolled)
      void brain.ingest(
        blockEventPage(target, 'interrupted', target.dayKey, nowMin, knownProjectsFrom(s.blocks.map((b) => b.title)).keys()),
      )
      logMemory({ kind: 'rolled', dayKey: target.dayKey, title: target.title, plannedMin: week.duration(target), startMin: target.startMin })
      logMemory({ kind: 'interruption', dayKey: todayKey })
      const base = target.title.split('—')[0].trim()
      post([
        mewMsg(
          `Paused — no blame, things land mid-block. The remaining ${remaining} min of ${base} now lives ${toKey === todayKey ? 'today' : fmtDowLong(toKey)} at ${fmtTime(slot.startMin)}.`,
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
      const todaySlot = week.findFreeSlot(without, todayKey, week.duration(target), minOfDay(now) + 15)
      const slot = todaySlot ?? week.findFreeSlot(without, addDaysKey(todayKey, 1), week.duration(target), 9 * 60)
      if (!slot) {
        post([mewMsg(`Nowhere kind to put it yet — want to look at the week together?`)])
        return
      }
      const toKey = todaySlot ? todayKey : addDaysKey(todayKey, 1)
      setBlocks(week.move(s.blocks, blockId, toKey, slot.startMin))
      post([
        mewMsg(
          `Moved — ${target.title.split('—')[0].trim()} now lives ${toKey === todayKey ? 'today' : 'tomorrow'} at ${fmtTime(slot.startMin)}.`,
        ),
      ])
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
        post([mewMsg(`The week can't hold "${cap.title}" yet — say where it should live and I'll make room.`)])
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
            : `Held — ${target.title.split('—')[0].trim()} is protected: I won't move it, and connected calendars show you busy there.`,
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
            ? { ...c, defaultTag: order[(order.indexOf(c.defaultTag ?? 'work') + 1) % order.length] }
            : c,
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
      post([mewMsg(`Restored — the week, captures, chat, and memory are back. Keys stay per-device; check Settings if the brain needs one.`)])
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
          `Imported ${sourceName} — ${merged.added} event${merged.added === 1 ? '' : 's'} in this window landed in the week${merged.updated ? `, ${merged.updated} updated` : ''}${merged.removed ? `, ${merged.removed} gone since last import` : ''}${optionalCount ? `, ${optionalCount} tentative/free (thin tint — they don't hold time)` : ''}${skipped}. They're calendar facts: I plan around them, never over them.`,
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
        name: cal.primary ? 'Google · Primary' : `Google · ${cal.summary}`,
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
      try {
        const report = await runSync({
          account: googleAccount(s.settings.googleClientId.trim()),
          calendars: live,
          matrix: get().settings.matrix,
          now: new Date(nowFn()),
          dismissed: dismissedSet(),
          getBlocks: () => get().blocks,
          setBlocks: (blocks, removedIds) => {
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
            ),
          ])
        }
      } catch (e) {
        set({
          lastSyncAt: nowFn(), // back off; don't hammer a failing API every tick
          syncError: e instanceof Error ? e.message : 'sync failed',
        })
      } finally {
        set({ syncing: false })
      }
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
    s.chat.some((m) => m.role === 'nudge' && !m.resolved && (m.actions?.length ?? 0) > 0),
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
    /** Dev/scenario helper: drive the turn-in-flight UI (typing-indicator /
        working-status visual proofs) without a live model. */
    __mewSetTurn?: (thinking: boolean, workingStatus?: string | null) => void
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
  window.__mewSetTurn = (thinking, workingStatus = null) => {
    useMew.setState({ thinking, workingStatus })
  }
}
