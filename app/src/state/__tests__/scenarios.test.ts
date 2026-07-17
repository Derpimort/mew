/* Scenario suite — whole user days simulated through the REAL store:
   seed → ticks → conversation → nudges → actions → memory. Adapters are
   faked (in-memory storage, captured notifications); the brain is the
   keyless rules floor, so every scenario is deterministic and offline. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../domain/types'
import type { ChatMessage, MemoryEvent, PrefPayload, Settings } from '../../domain/types'
import { addDaysKey, dayKey, uid, weekKey, weekKeys as domainWeekKeys } from '../../domain/time'
import { CHAT_BOOT_PAGE, chatOrder, stripSecrets } from '../../adapters/storage-port'
import { applyWeekKey } from '../../ui/components/weekKeys'

/* ── fakes ────────────────────────────────────────────────────────── */

const mirrors: { title: string; body: string; tag?: string; onClick?: () => void }[] = []

const fakeDb = {
  blocks: new Map<string, unknown>(),
  captures: new Map<string, unknown>(),
  chat: new Map<string, unknown>(),
  memory: new Map<string, unknown>(),
  settings: null as Settings | null,
  sync: new Map<string, unknown>(),
  /** the chat table in storage order — the paging seam reads through this */
  chatAsc(): ChatMessage[] {
    return ([...this.chat.values()] as ChatMessage[]).sort(chatOrder)
  },
  reset() {
    this.blocks.clear()
    this.captures.clear()
    this.chat.clear()
    this.memory.clear()
    this.sync.clear()
    this.settings = null
  },
}

/* the desktop shell, faked at the adapter seam (web runs leave tauri=false) */
const desktopFake = {
  tauri: false,
  backup: null as string | null,
  backupDate: null as string | null,
  written: [] as string[],
  updateReady: null as ((v: string) => void) | null,
  applied: 0,
  brain: null as { url: string; token: string } | null,
  brainLastBeat: null as string | null,
  brainReady: null as ((e: { url: string; token: string }) => void) | null,
  brainBeat: null as ((s: string) => void) | null,
  shellTick: null as (() => void) | null,
  trayAction: null as ((a: string) => void) | null,
  trayPushes: [] as { state: string; tooltip: string }[],
  hotkeyCalls: [] as (string | null)[],
  hotkeyRefuse: false, // models the OS holding the binding for another app
  reset() {
    this.tauri = false
    this.backup = null
    this.backupDate = null
    this.written = []
    /* updateReady/brainReady/brainBeat/shellTick/trayAction survive reset:
       the real listeners register once per app process and outlive any data
       wipe — the fake models that lifetime */
    this.applied = 0
    this.brain = null
    this.brainLastBeat = null
    this.trayPushes = []
    this.hotkeyCalls = []
    this.hotkeyRefuse = false
  },
}

vi.mock('../../adapters/storage', () => ({
  createDexieStorage: () => ({
    load: async () => ({
      blocks: [...fakeDb.blocks.values()],
      captures: [...fakeDb.captures.values()],
      /* the boot window, same contract as the real vehicles (#250 phase 2) */
      chat: fakeDb.chatAsc().slice(-CHAT_BOOT_PAGE),
      memory: [...fakeDb.memory.values()],
      settings: fakeDb.settings,
    }),
    putBlocks: async (bs: { id: string }[]) => bs.forEach((b) => fakeDb.blocks.set(b.id, b)),
    deleteBlocks: async (ids: string[]) => ids.forEach((i) => fakeDb.blocks.delete(i)),
    putCaptures: async (cs: { id: string }[]) => cs.forEach((c) => fakeDb.captures.set(c.id, c)),
    deleteCaptures: async (ids: string[]) => ids.forEach((i) => fakeDb.captures.delete(i)),
    putChat: async (ms: { id: string }[]) => ms.forEach((m) => fakeDb.chat.set(m.id, m)),
    countChat: async () => fakeDb.chat.size,
    loadChatBefore: async (ts: number, id: string, limit: number) =>
      fakeDb
        .chatAsc()
        .filter((m) => m.ts < ts || (m.ts === ts && m.id < id))
        .slice(-limit),
    loadChatOlderThan: async (ts: number) => fakeDb.chatAsc().filter((m) => m.ts < ts),
    deleteChat: async (ids: string[]) => ids.forEach((i) => fakeDb.chat.delete(i)),
    putMemory: async (es: { id: string }[]) => es.forEach((e) => fakeDb.memory.set(e.id, e)),
    deleteMemory: async (ids: string[]) => ids.forEach((i) => fakeDb.memory.delete(i)),
    putSettings: async (s: Settings) => {
      fakeDb.settings = s
    },
    loadSyncMap: async () => [],
    saveSyncMap: async () => {},
    deleteSyncForCalendar: async () => {},
    /* real round-trip semantics so backup/restore scenarios exercise the
       same shape the dexie adapter produces — keys stripped on the way out
       via the same stripSecrets the real vehicles use (so the fake can't
       under-strip, e.g. forget brainToken) */
    exportJson: async () => {
      return JSON.stringify({
        blocks: [...fakeDb.blocks.values()],
        captures: [...fakeDb.captures.values()],
        chat: fakeDb.chatAsc(), // the WHOLE table — a backup is never windowed
        memory: [...fakeDb.memory.values()],
        settings: stripSecrets(fakeDb.settings),
      })
    },
    importJson: async (json: string) => {
      const state = JSON.parse(json)
      fakeDb.reset()
      for (const b of state.blocks ?? []) fakeDb.blocks.set(b.id, b)
      for (const c of state.captures ?? []) fakeDb.captures.set(c.id, c)
      for (const m of state.chat ?? []) fakeDb.chat.set(m.id, m)
      for (const e of state.memory ?? []) fakeDb.memory.set(e.id, e)
      fakeDb.settings = state.settings ?? null
    },
    getAuditLog: async () => [],
    wipe: async () => fakeDb.reset(),
  }),
}))

vi.mock('../../adapters/desktop', () => ({
  isTauri: () => desktopFake.tauri,
  readBackup: async () => desktopFake.backup,
  latestBackupDate: async () => desktopFake.backupDate,
  writeBackup: async (json: string) => {
    desktopFake.written.push(json)
  },
  /* the store registers this once during its module init (before this file's
     consts exist — hence the hoisted ref, same as brainCfg); afterEach invokes
     it to model the shell's on-close backup flush */
  registerCloseFlush: (_dirty: () => boolean, flush: () => Promise<void>) => {
    closeFlushRef.current = flush
  },
  backupPath: () => 'Documents/MEW/mew-backup.json',
  openBackupFolder: async () => {},
  onUpdateReady: (cb: (v: string) => void) => {
    desktopFake.updateReady = cb
  },
  applyUpdate: async () => {
    desktopFake.applied++
  },
  brainEndpoint: async () => desktopFake.brain,
  brainStatus: async () => desktopFake.brainLastBeat,
  onBrainEndpoint: (cb: (e: { url: string; token: string }) => void) => {
    desktopFake.brainReady = cb
  },
  onBrainStatus: (cb: (s: string) => void) => {
    desktopFake.brainBeat = cb
  },
  onShellTick: (cb: () => void) => {
    desktopFake.shellTick = cb
  },
  onTrayAction: (cb: (a: string) => void) => {
    desktopFake.trayAction = cb
  },
  updateTray: async (state: string, tooltip: string) => {
    desktopFake.trayPushes.push({ state, tooltip })
  },
  setCaptureHotkey: async (accel: string | null) => {
    desktopFake.hotkeyCalls.push(accel)
    return !desktopFake.hotkeyRefuse
  },
}))

vi.mock('../../adapters/notify', () => {
  const stub = () => ({ mirror: (o: { title: string; body: string }) => mirrors.push(o) })
  // store now selects via createNotifier(); keep createBrowserNotifier for any
  // other reader of this mock (#168)
  return { createNotifier: stub, createBrowserNotifier: stub }
})

vi.mock('../../adapters/calendar/google', () => ({
  googleAccount: () => {
    throw new Error('no network in scenarios')
  },
}))

/* the brain, faked at the factory seam — scenarios count what MEW writes,
   control what the graph holds and what it asks back (recall is behavior),
   the scope it asks with, and read the live config closures to see where the
   port would point. The cfg ref is hoisted: the factory runs during the
   store's module init, before any const in this file initializes. */
const brainCfg = vi.hoisted(() => ({
  current: null as { url(): string; token(): string; enabled(): boolean } | null,
}))
/* the store's on-close backup flush — captured at store module init */
const closeFlushRef = vi.hoisted(() => ({ current: null as (() => Promise<void>) | null }))
const brainFake = {
  ingests: [] as { slug: string; links?: string[] }[],
  /* replaces the default push when set — a backfill test scripts a hang
     (the app "quits" mid-replay) or a mid-replay brain switch with it */
  ingestImpl: null as null | ((page: { slug: string }) => void | Promise<void>),
  links: {} as Record<string, string[]>,
  recalls: [] as string[],
  recallOpts: [] as { limit?: number; scope?: string }[],
  /* null = the brain didn't answer (degraded, #249); a pending-forever
     promise scripts a hang for the race-timeout scenarios */
  recallImpl: null as null | ((q: string) => string[] | null | Promise<string[] | null>),
  recallLines: [] as string[],
  prefs: [] as PrefPayload[],
  /* models the real port's swallowed write failure (ingest NEVER throws —
     it warns and flips health): the page just doesn't land, so a read-back
     (links) finds nothing. The condensation proof scenarios flip this. */
  dropIngests: false,
  reset() {
    this.ingests = []
    this.ingestImpl = null
    this.links = {}
    this.recalls = []
    this.recallOpts = []
    this.recallImpl = null
    this.recallLines = []
    this.prefs = []
    this.dropIngests = false
  },
}
vi.mock('../../adapters/brain/gbrainHttp', () => ({
  createGbrainHttp: (cfg: { url(): string; token(): string; enabled(): boolean }) => {
    brainCfg.current = cfg
    return {
      ingest: async (page: { slug: string; links?: string[] }) => {
        /* dropIngests models the port's swallowed write failure (#250); the
           enabled() gate is the off-brain no-op — either way nothing lands. */
        if (!cfg.enabled() || brainFake.dropIngests) return
        if (brainFake.ingestImpl) return brainFake.ingestImpl(page)
        brainFake.ingests.push(page)
        /* a landed page's links are readable back (gbrain's add_link is
           additive) — the condensation prune-proof reads through this */
        if (page.links?.length) {
          const cur = brainFake.links[page.slug] ?? []
          brainFake.links[page.slug] = [...new Set([...cur, ...page.links])]
        }
      },
      recall: async (q: string, opts?: { limit?: number; scope?: string }) => {
        if (!cfg.enabled()) return []
        brainFake.recalls.push(q)
        brainFake.recallOpts.push(opts ?? {})
        if (brainFake.recallImpl) return brainFake.recallImpl(q)
        return brainFake.recallLines
      },
      health: async () => false,
      listPrefs: async () => (cfg.enabled() ? brainFake.prefs : []),
      links: async (slug: string) => (cfg.enabled() ? (brainFake.links[slug] ?? []) : []),
    }
  },
}))

/* a scripted model adapter (#115): lets a test stream reply text and fire a
   tool call mid-turn, then observe whether the nudge was held until the turn
   completes. Default chain stays the keyless rules floor; only the deferral
   scenarios opt in via modelLocation:'local'. */
const scriptedModel = {
  chunks: [] as string[],
  /** an optional pre-tool reasoning snapshot (#166), yielded first like the real
      AI adapter so the store's reasoning routing is exercised end-to-end. */
  reasoning: null as string | null,
  /** the WeekContext the turn handed the model — the recall-honesty scenarios
      read the degraded flag off it (#249) */
  lastCtx: null as import('../../adapters/model').WeekContext | null,
  /** the ChatTurn[] the store built for the turn — the buildThread exclusion
      pin reads it (#282: tool receipts never ride the model thread) */
  lastThread: null as import('../../adapters/model').ChatTurn[] | null,
  /** runs between the first and last chunk — fire executors, snapshot state.
      Gets the turn's abort signal too, so a test can press stop mid-stream. */
  midTurn: null as
    null | ((exec: import('../../adapters/model').ToolExecutor, signal?: AbortSignal) => void),
  throwAfter: false, // simulate a connection hiccup once the tool has acted
  /** what the next remote (anthropic/openai) turn throws — a classifiable
      failure for the honest-copy scenarios (#153); default = transient. */
  remoteError: null as unknown,
  /** thrown by the scripted local adapter before anything yields (#153). */
  localError: null as unknown,
  reset() {
    this.chunks = []
    this.reasoning = null
    this.lastCtx = null
    this.lastThread = null
    this.midTurn = null
    this.throwAfter = false
    this.remoteError = null
    this.localError = null
  },
}
/* Every non-rules provider routes through the unified AI-SDK adapter (#152);
   these scenarios run modelLocation 'local', so the scripted stand-in answers
   as the ollama adapter would. vi.mock is hoisted and intercepts the lazy
   dynamic import inside selectAdapters. */
vi.mock('../../adapters/model/aiAdapter', () => ({
  createAiAdapter: (spec: { provider: string }) => ({
    id: spec.provider,
    async *converse(
      thread: unknown,
      ctx: unknown,
      exec: import('../../adapters/model').ToolExecutor,
      signal?: AbortSignal
    ) {
      scriptedModel.lastCtx = ctx as import('../../adapters/model').WeekContext
      scriptedModel.lastThread = thread as import('../../adapters/model').ChatTurn[]
      /* remote providers stay unreachable in scenarios — no scenario ever
         scripts them, and no test may touch the network. Throwing a transient
         (as the real SDK would offline) lands the chain on the rules floor,
         exactly where the pre-#152 path ended up. (lastCtx is captured first so
         the #258 recall-context assertions still see it on the local path.) */
      if (spec.provider !== 'ollama') {
        throw (
          scriptedModel.remoteError ??
          Object.assign(new Error('remote unavailable in scenarios'), { statusCode: 503 })
        )
      }
      if (scriptedModel.localError) throw scriptedModel.localError
      // the plan lands ahead of any text/tool, exactly as the AI adapter emits it
      if (scriptedModel.reasoning) yield { reasoning: scriptedModel.reasoning }
      const [first, ...rest] = scriptedModel.chunks
      if (first) yield first
      scriptedModel.midTurn?.(exec, signal)
      /* a real stream rejects with an AbortError once the user stops; model the
         same so the store's signal.aborted branch is exercised end-to-end */
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      if (scriptedModel.throwAfter) throw new Error('connection hiccup')
      for (const c of rest) yield c
    },
  }),
}))

import { setSidecarBrain } from '../../adapters/brain/sidecar'
import { setLoggerSink } from '../../adapters/logger'
import { mealClassOf } from '../../domain/sustenance'
import { TOOL_ERROR_NOTE } from '../../domain/toolCard'
import { scenariosActive } from '../../domain/choices'
import { validateScenario } from '../../domain/scenarios'
import { runToolWithCard, useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────── */

const pristine = useMew.getState()

/** Tuesday, June 9 2026 — the canonical seeded week. */
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m)

function at(d: Date) {
  vi.setSystemTime(d)
  useMew.getState().tick()
}

async function fresh(start: Date) {
  fakeDb.reset()
  mirrors.length = 0
  vi.setSystemTime(start)
  useMew.setState(
    {
      ...pristine,
      lastTickDay: dayKey(start),
      nowMs: start.getTime(),
      lastActivityMs: start.getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

const chat = () => useMew.getState().chat
const lastMsg = () => chat()[chat().length - 1]
const nudges = (type?: string) =>
  chat().filter((m) => m.role === 'nudge' && (!type || m.nudgeType === type))
const lastNudge = (type?: string) => nudges(type)[nudges(type).length - 1]

async function say(text: string) {
  await useMew.getState().speak(text)
}

/** Drain a fire-and-forget microtask chain (the backfill replay awaits one
    ingest per event) without touching the fake timer clock. */
async function settle(turns = 400) {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

function act(msg: ChatMessage, actionId: string) {
  useMew.getState().nudgeAction(msg.id, actionId)
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(async () => {
  /* the desktop shell flushes the pending backup on close (registerCloseFlush)
     — model that lifecycle, so a backup timer armed in one scenario (e.g. the
     boot brief's settings write, #285) can't leak a stale handle into the
     next: useFakeTimers() discards pending timers but not the store's token */
  await closeFlushRef.current?.()
  vi.useRealTimers()
  brainFake.reset()
  desktopFake.reset()
  scriptedModel.reset()
  setSidecarBrain(null) // module state — a sidecar from one scenario must not haunt the next
})

/* ── scenarios ────────────────────────────────────────────────────── */

describe('a seeded Tuesday morning', () => {
  it('greets, sees tomorrow honestly, and the right-size nudge is in chat (not queued)', async () => {
    await fresh(TUE(9, 40))
    /* the boot tick belongs to the morning brief (#285) — the ritual opener;
       right-sizing follows on the next minute, exactly one nudge per tick */
    expect(lastNudge('morning-brief')).toBeDefined()
    at(TUE(9, 41))
    const rs = lastNudge('right-size')
    expect(rs).toBeDefined()
    expect(rs.body).toMatch(/8 hours of deep work/i)
    expect(rs.body).toContain('5.5')
    expect(useMew.getState().queuedNudges).toHaveLength(0)
  })

  it('speaks the canonical sentence into existence (acceptance #1, store-level)', async () => {
    await fresh(TUE(9, 40))
    await say('block thursday morning for the deck, keep friday afternoon free')
    const blocks = useMew.getState().blocks
    const thu = addDaysKey(dayKey(TUE(9, 40)), 2)
    const fri = addDaysKey(thu, 1)
    expect(
      blocks.some((b) => b.dayKey === thu && /deck/i.test(b.title) && b.startMin === 540)
    ).toBe(true)
    expect(
      blocks.some((b) => b.dayKey === fri && b.title === 'Kept free' && b.tag === 'rest')
    ).toBe(true)
    /* the reply speaks; the day-load meter (#301) may follow it on this
       fixture's marginally-over thursday — find the reply, don't pin "last" */
    expect(chat().some((m) => m.role === 'mew' && /^Done — /.test(m.body))).toBe(true)
  })

  it('a mew celebrates, remembers — and an early finish offers the next task', async () => {
    await fresh(TUE(9, 40))
    const current = useMew
      .getState()
      .blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(9, 40)))!
    useMew.getState().toggleComplete(current.id)
    expect(chat().some((m) => /That's a mew — one today/.test(m.body))).toBe(true)
    const ev = useMew.getState().memory.findLast((e: MemoryEvent) => e.kind === 'completed')!
    expect(ev).toMatchObject({
      title: current.title,
      startMin: current.startMin,
      endMin: current.endMin,
      deep: true,
    })

    /* 110 minutes reclaimed inside the block → next-up offers what fits */
    const nu = lastNudge('next-up')
    expect(nu).toBeDefined()
    expect(nu.body).toMatch(/reclaimed.*fits/i)
    act(nu, 'pull')
    expect(lastMsg().body).toMatch(/Started — /)
  })

  it('an early finish after a long unbroken stretch suggests a micro-break instead', async () => {
    await fresh(TUE(11, 0)) // 2h into the morning, no rest yet
    const current = useMew
      .getState()
      .blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(0)))!
    useMew.getState().toggleComplete(current.id)
    const mb = lastNudge('micro-break')
    expect(mb).toBeDefined()
    expect(mb.footnote).toContain('Albulescu')
    act(mb, 'take')
    expect(
      useMew.getState().blocks.some((b) => /Micro-break/.test(b.title) && b.tag === 'rest')
    ).toBe(true)
  })

  it('edits a block in place — "make the prod release 45 mins" actually resizes it', async () => {
    await fresh(TUE(9, 40))
    await say('block thursday morning for the prod release')
    const thu = addDaysKey(dayKey(TUE(9, 40)), 2)
    const before = useMew
      .getState()
      .blocks.find((b) => b.dayKey === thu && /prod release/i.test(b.title))!
    expect(before).toBeDefined()
    expect(before.endMin - before.startMin).not.toBe(45)

    await say('make the prod release 45 mins')
    const after = useMew.getState().blocks.find((b) => b.id === before.id)!
    expect(after.startMin).toBe(before.startMin) // resize keeps the start
    expect(after.endMin - after.startMin).toBe(45)
    expect(lastMsg().body).toMatch(/Updated — prod release .* \(45 min\)/i)
  })

  it('"done with lunch" completes Lunch, never the Order-lunch errand', async () => {
    await fresh(TUE(9, 40))
    await say('block 15m for order lunch today at 11')
    await say('block 45m for lunch today at 1pm')
    await say('done with lunch')
    const blocks = useMew.getState().blocks
    const meal = blocks.find((b) => b.title.split('—')[0].trim().toLowerCase() === 'lunch')!
    const errand = blocks.find((b) => /order lunch/i.test(b.title))!
    expect(meal.status).toBe('done')
    expect(errand.status).toBe('open')
  })

  it('"drop both prod release blocks" removes both matching blocks and nothing else', async () => {
    await fresh(TUE(9, 40))
    await say('block 45m for prod release today at 2pm')
    await say('block 45m for prod release tomorrow at 10am')
    const before = useMew.getState().blocks.filter((b) => b.status === 'open').length
    await say('drop both prod release blocks')
    const after = useMew.getState().blocks
    expect(after.filter((b) => /prod release/i.test(b.title))).toHaveLength(0)
    expect(after.filter((b) => b.status === 'open')).toHaveLength(before - 2)
    expect(lastMsg().body).toMatch(/^Removed — /)
  })

  it('"drop the prod release" with two matches asks which, dropping nothing', async () => {
    await fresh(TUE(9, 40))
    await say('block 45m for prod release today at 2pm')
    await say('block 45m for prod release tomorrow at 10am')
    const before = useMew.getState().blocks.filter((b) => /prod release/i.test(b.title))
    await say('drop the prod release')
    const after = useMew.getState().blocks.filter((b) => /prod release/i.test(b.title))
    expect(after).toHaveLength(before.length) // nothing dropped — a guess would be data loss
    expect(lastMsg().body).toMatch(/2 "prod release" blocks ahead/)
    expect(lastMsg().body).toMatch(/14:00/)
    expect(lastMsg().body).toMatch(/10:00/)
  })

  it('a start time pins which of several same-named blocks to drop', async () => {
    await fresh(TUE(9, 40))
    await say('block 45m for prod release today at 2pm')
    await say('block 45m for prod release tomorrow at 10am')
    await say('drop the prod release at 2pm')
    const after = useMew
      .getState()
      .blocks.filter((b) => /prod release/i.test(b.title) && b.status === 'open')
    expect(after).toHaveLength(1)
    expect(after[0].startMin).toBe(10 * 60) // the 14:00 went; tomorrow's 10:00 stands
    expect(lastMsg().body).toMatch(/^Removed — /)
  })

  /* #254 — offer_choices: MEW's enumerable questions and offers as clickable
     chips. The keyless remove disambiguation is the floor's own chips flow, so
     these scenarios run the REAL store end to end: chips post → a pick posts
     the reply as an ordinary user turn → the week changes only via the tool. */
  describe('#254 — clickable option chips', () => {
    const twoProdReleases = async () => {
      await fresh(TUE(9, 40))
      await say('block 45m for prod release today at 2pm')
      await say('block 45m for prod release tomorrow at 10am')
      await say('drop the prod release')
      return lastMsg()
    }

    it('keyless disambiguation posts ONE chips message — no prose echo behind it', async () => {
      const msg = await twoProdReleases()
      expect(msg.role).toBe('mew')
      expect(msg.body).toMatch(/2 "prod release" blocks ahead/)
      expect(msg.choices).toBeDefined()
      expect(msg.choices!.map((c) => c.label)).toEqual(['the 14:00', 'the 10:00', 'both'])
      expect(msg.choices!.find((c) => c.label === 'the 14:00')!.reply).toBe(
        'remove prod release 14:00'
      )
      expect(msg.choices!.find((c) => c.label === 'both')!.reply).toBe('remove all prod release')
      /* the floor stayed quiet: exactly one message asks, nothing dropped yet */
      expect(chat().filter((m) => /blocks ahead/.test(m.body))).toHaveLength(1)
      expect(useMew.getState().blocks.filter((b) => /prod release/i.test(b.title))).toHaveLength(2)
    })

    it('a pick posts the reply as a user turn, resolves the removal, and goes inert', async () => {
      const msg = await twoProdReleases()
      const pick = msg.choices!.find((c) => c.label === 'the 14:00')!
      await useMew.getState().pickChoice(msg.id, pick.id)

      /* the pick IS an ordinary user message — the model saw a normal turn */
      const userTurns = chat().filter((m) => m.role === 'user')
      expect(userTurns[userTurns.length - 1].body).toBe('remove prod release 14:00')
      expect(lastMsg().body).toMatch(/^Removed — /)

      /* the week changed through the remove tool, not through the chips */
      const open = useMew
        .getState()
        .blocks.filter((b) => /prod release/i.test(b.title) && b.status === 'open')
      expect(open).toHaveLength(1)
      expect(open[0].startMin).toBe(10 * 60)

      /* picked is marked and persisted; the chips are now inert */
      const after = chat().find((m) => m.id === msg.id)!
      expect(after.choices!.find((c) => c.id === pick.id)!.picked).toBe(true)
      const stored = fakeDb.chat.get(msg.id) as ChatMessage
      expect(stored.choices!.find((c) => c.id === pick.id)!.picked).toBe(true)
    })

    it('a second pick after the first is a no-op — one question, one answer', async () => {
      const msg = await twoProdReleases()
      await useMew.getState().pickChoice(msg.id, msg.choices![0].id)
      const turns = chat().length
      const blocks = useMew.getState().blocks.length
      await useMew.getState().pickChoice(msg.id, msg.choices![1].id)
      expect(chat()).toHaveLength(turns) // no new user turn, no new reply
      expect(useMew.getState().blocks).toHaveLength(blocks)
    })

    it('any newer user message supersedes the chips — a stale pick changes nothing', async () => {
      const msg = await twoProdReleases()
      await say('hello')
      const turns = chat().length
      await useMew.getState().pickChoice(msg.id, msg.choices![0].id)
      expect(chat()).toHaveLength(turns)
      expect(
        useMew.getState().blocks.filter((b) => /prod release/i.test(b.title) && b.status === 'open')
      ).toHaveLength(2) // both still stand — the question expired unanswered
    })

    it('chips persist and rehydrate across a reload, picked state intact', async () => {
      const msg = await twoProdReleases()
      await useMew.getState().pickChoice(msg.id, msg.choices![0].id)

      /* reload: same storage, fresh store state — the delta putChat must have
         carried the choices, and picked survives so the chips wake up inert */
      useMew.setState(
        { ...pristine, lastTickDay: dayKey(TUE(9, 41)), nowMs: TUE(9, 41).getTime() },
        true
      )
      await useMew.getState().hydrate()
      const back = chat().find((m) => m.id === msg.id)!
      expect(back.choices).toBeDefined()
      expect(back.choices!.map((c) => c.label)).toEqual(['the 14:00', 'the 10:00', 'both'])
      expect(back.choices![0].picked).toBe(true)
    })

    it('the offer_choices executor posts chips mid-turn and tells the model to end (suggestions engine)', async () => {
      await fresh(TUE(9, 40))
      useMew.getState().updateSettings({ modelLocation: 'local' }) // the scripted model
      let result = ''
      scriptedModel.chunks = ['on it.']
      scriptedModel.midTurn = (exec) => {
        result = exec.offerChoices('where should the deck live?', [
          { label: '15:00', reply: 'place the deck at 15:00' },
          { label: '16:30', reply: 'place the deck at 16:30' },
          { label: 'pick for me', reply: 'pick a slot for the deck yourself' },
        ])
      }
      await say('find a slot for the deck')

      expect(result).toMatch(/^The options are on screen as clickable chips/)
      expect(result).toMatch(/END your turn/)
      const offer = chat().find((m) => m.choices?.length === 3)!
      expect(offer.role).toBe('mew')
      expect(offer.body).toBe('where should the deck live?')
      expect(offer.choices!.map((c) => c.label)).toEqual(['15:00', '16:30', 'pick for me'])

      /* a pick posts the offer's reply as the next ordinary user turn */
      scriptedModel.midTurn = null
      await useMew.getState().pickChoice(offer.id, offer.choices![0].id)
      const userTurns = chat().filter((m) => m.role === 'user')
      expect(userTurns[userTurns.length - 1].body).toBe('place the deck at 15:00')
    })
  })

  it('placing over an interview names the collision in the reply', async () => {
    await fresh(TUE(9, 40))
    await say('block 1h for interview with pooran today at 1:30pm')
    await say('block 15m for pooran prep today at 1:30pm')
    expect(lastMsg().body).toMatch(
      /note: it overlaps .*interview with pooran 13:30–14:30 \(fixed — it can't move\)/i
    )
  })

  it('a chat completion celebrates exactly once (no duplicate mew lines)', async () => {
    await fresh(TUE(9, 40))
    await say('done with the deck')
    const celebrations = chat().filter((m) => /that's a mew/i.test(m.body))
    expect(celebrations).toHaveLength(1)
    expect(celebrations[0].role).toBe('mew') // the reply itself, not a second nudge line
  })

  it('start is a state: a started block cannot be re-started, and interrupt parks the rest', async () => {
    await fresh(TUE(9, 40))
    const deck = useMew
      .getState()
      .blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(9, 40)))!
    useMew.getState().startNow(deck.id)
    const started = useMew.getState().blocks.find((b) => b.id === deck.id)!
    expect(started.startedAt).toBeDefined()
    expect(started.startMin).toBe(9 * 60 + 40)

    /* mashing Start again moves nothing */
    useMew.getState().startNow(deck.id)
    const again = useMew.getState().blocks.find((b) => b.id === deck.id)!
    expect(again.startMin).toBe(9 * 60 + 40)
    expect(lastMsg().body).toMatch(/already running/i)

    /* interrupt: original rolls, the remainder gets a later home */
    useMew.getState().interruptBlock(deck.id)
    const after = useMew.getState().blocks
    expect(after.find((b) => b.id === deck.id)!.status).toBe('rolled')
    const followUp = after.find(
      (b) => b.status === 'open' && /Q3 deck/.test(b.title) && b.id !== deck.id
    )!
    expect(followUp).toBeDefined()
    expect(followUp.startMin).toBeGreaterThan(9 * 60 + 40)
    expect(
      useMew.getState().memory.some((e) => e.kind === 'rolled' && /Q3 deck/.test(e.title ?? ''))
    ).toBe(true)
    expect(lastMsg().body).toMatch(/Paused — no blame/)
  })

  it('answers "how is my week looking?" from its own pattern history', async () => {
    await fresh(TUE(9, 40))
    await say('how is my week looking?')
    expect(lastMsg().body).toMatch(/history says/i)
    expect(lastMsg().body).toMatch(/mornings hold/i)
  })

  /* drag-to-reschedule (#158) — the store's dragMove is the only mutation path
     for the week-grid drag, so its outcomes are asserted here, DOM-free. */
  describe('dragMove — direct manipulation on the week grid', () => {
    const reply = () =>
      useMew
        .getState()
        .blocks.find((b) => /Reply to Sam/.test(b.title) && b.dayKey === dayKey(TUE(0)))!

    it('a clear drop moves the block instantly and persists it (acceptance #1)', async () => {
      await fresh(TUE(9, 40))
      const r = reply()
      const dur = r.endMin - r.startMin
      const out = useMew.getState().dragMove(r.id, r.dayKey, 20 * 60) // 20:00, empty evening
      expect(out).toBe('moved')
      const after = useMew.getState().blocks.find((b) => b.id === r.id)!
      expect(after.startMin).toBe(20 * 60)
      expect(after.endMin).toBe(20 * 60 + dur) // length preserved
      expect(fakeDb.blocks.get(r.id)).toMatchObject({ startMin: 20 * 60 }) // synced to storage
      expect(lastMsg().body).toMatch(/^Moved — Reply to Sam/)
    })

    it('a drop onto a meeting is bounced — conflict, week untouched, no move (acceptance #2)', async () => {
      await fresh(TUE(9, 40))
      const r = reply()
      const before = { day: r.dayKey, start: r.startMin }
      // the deck holds 9:00–11:30; dropping Reply onto 10:00 collides with it
      const out = useMew.getState().dragMove(r.id, r.dayKey, 10 * 60)
      expect(out).toBe('conflict')
      const after = useMew.getState().blocks.find((b) => b.id === r.id)!
      expect({ day: after.dayKey, start: after.startMin }).toEqual(before) // returned to origin
    })

    it('a protected/held block drags normally — protected is a rule, not a lock (acceptance #3)', async () => {
      await fresh(TUE(9, 40))
      const walk = useMew
        .getState()
        .blocks.find((b) => /Walk/.test(b.title) && b.dayKey === dayKey(TUE(0)) && b.protected)!
      const out = useMew.getState().dragMove(walk.id, walk.dayKey, 20 * 60)
      expect(out).toBe('moved')
      expect(useMew.getState().blocks.find((b) => b.id === walk.id)!.startMin).toBe(20 * 60)
    })

    it('a calendar event is never moved — the drop is ignored and chat explains (acceptance #5)', async () => {
      await fresh(TUE(9, 40))
      const tue = dayKey(TUE(0))
      const ext = {
        id: 'ext-1',
        title: 'Synced 1:1',
        tag: 'work' as const,
        dayKey: tue,
        startMin: 15 * 60,
        endMin: 15 * 60 + 30,
        protected: true,
        status: 'open' as const,
        calendarRefs: [],
        estimateSource: 'user' as const,
        external: { calId: 'cal-a', eventId: 'evt-1' },
      }
      useMew.setState({ blocks: [...useMew.getState().blocks, ext] })
      const out = useMew.getState().dragMove('ext-1', tue, 20 * 60)
      expect(out).toBe('external')
      const after = useMew.getState().blocks.find((b) => b.id === 'ext-1')!
      expect(after.startMin).toBe(15 * 60) // never moved
      expect(after.external).toBeDefined() // still the calendar's
      expect(lastMsg().body).toMatch(/from your calendar/i)
    })

    it('a drop back onto the same slot is a no-op (a click, not a move)', async () => {
      await fresh(TUE(9, 40))
      const r = reply()
      const chatLen = chat().length
      const out = useMew.getState().dragMove(r.id, r.dayKey, r.startMin)
      expect(out).toBe('noop')
      expect(chat().length).toBe(chatLen) // no chat line for a non-move
    })
  })
})

/* keyboard-first week (#303) — Shift/Alt arrows commit through the SAME
   dragMove door the drag gesture uses (spied real action, no second path);
   the optional durationMin arm of that door (keyboard resize) is asserted
   here store-side, exactly like the drag outcomes above. */
describe('#303 — keyboard week commits through the drag door', () => {
  const week = () => domainWeekKeys(TUE(0))
  const find = (re: RegExp, key: string) =>
    useMew.getState().blocks.find((b) => re.test(b.title) && b.dayKey === key)!
  const reply = () => find(/Reply to Sam/, dayKey(TUE(0)))
  const silentDeps = { moveFocus: () => {}, announce: () => {} }

  it('a keyboard nudge IS a dragMove — same action, same commit, persisted', async () => {
    await fresh(TUE(9, 40))
    const r = reply()
    const real = useMew.getState().dragMove
    const calls: unknown[][] = []
    const spy: typeof real = (...a) => {
      calls.push([...a])
      return real(...a)
    }
    const spoken: string[] = []
    applyWeekKey(
      useMew.getState().blocks,
      week(),
      r,
      { kind: 'nudge', deltaMin: 15, deltaDay: 0 },
      { dragMove: spy, moveFocus: () => {}, announce: (l) => spoken.push(l) }
    )
    expect(calls).toEqual([[r.id, r.dayKey, r.startMin + 15]]) // the one door, once
    const after = useMew.getState().blocks.find((b) => b.id === r.id)!
    expect(after.startMin).toBe(14 * 60 + 45)
    expect(fakeDb.blocks.get(r.id)).toMatchObject({ startMin: 14 * 60 + 45 }) // synced
    expect(lastMsg().body).toMatch(/^Moved — Reply to Sam/) // the door's own voice
    expect(spoken).toEqual(['Reply to Sam, 14:30 to 15:00, moved to 14:45'])
  })

  it('a keyboard day hop rides the same door to the neighbouring day', async () => {
    await fresh(TUE(9, 40))
    const rest = find(/Rest — earned/, dayKey(TUE(0)))
    const spoken: string[] = []
    applyWeekKey(
      useMew.getState().blocks,
      week(),
      rest,
      { kind: 'nudge', deltaMin: 0, deltaDay: 1 },
      { dragMove: useMew.getState().dragMove, moveFocus: () => {}, announce: (l) => spoken.push(l) }
    )
    const after = useMew.getState().blocks.find((b) => b.id === rest.id)!
    expect(after.dayKey).toBe(addDaysKey(dayKey(TUE(0)), 1))
    expect(after.startMin).toBe(18 * 60) // start held through the hop
    expect(spoken).toEqual(['Rest, 18:00 to 19:00, moved to wednesday at 18:00'])
  })

  it('a keyboard resize commits through the door (durationMin arm) and persists', async () => {
    await fresh(TUE(9, 40))
    const r = reply()
    const spoken: string[] = []
    applyWeekKey(
      useMew.getState().blocks,
      week(),
      r,
      { kind: 'resize', deltaMin: 15 },
      { dragMove: useMew.getState().dragMove, moveFocus: () => {}, announce: (l) => spoken.push(l) }
    )
    const after = useMew.getState().blocks.find((b) => b.id === r.id)!
    expect(after.startMin).toBe(14 * 60 + 30) // start untouched
    expect(after.endMin).toBe(15 * 60 + 15) // end grew one step
    expect(fakeDb.blocks.get(r.id)).toMatchObject({ endMin: 15 * 60 + 15 })
    expect(lastMsg().body).toMatch(/^Resized — Reply to Sam now runs 14:30–15:15 \(45 min\)/)
    expect(spoken).toEqual(['Reply to Sam, now 14:30 to 15:15'])
  })

  it('a resize into a held slot is bounced — conflict, week untouched', async () => {
    await fresh(TUE(9, 40))
    const r = reply()
    // growing 14:30–15:00 to 105 min would cross Walk at 16:00
    const out = useMew.getState().dragMove(r.id, r.dayKey, r.startMin, 105)
    expect(out).toBe('conflict')
    const after = useMew.getState().blocks.find((b) => b.id === r.id)!
    expect(after.endMin).toBe(15 * 60) // untouched
  })

  it('a calendar event refuses a resize the same way it refuses a move', async () => {
    await fresh(TUE(9, 40))
    const tue = dayKey(TUE(0))
    const ext = {
      id: 'ext-2',
      title: 'Synced review',
      tag: 'work' as const,
      dayKey: tue,
      startMin: 20 * 60,
      endMin: 20 * 60 + 30,
      protected: true,
      status: 'open' as const,
      calendarRefs: [],
      estimateSource: 'user' as const,
      external: { calId: 'cal-a', eventId: 'evt-2' },
    }
    useMew.setState({ blocks: [...useMew.getState().blocks, ext] })
    const out = useMew.getState().dragMove('ext-2', tue, 20 * 60, 60)
    expect(out).toBe('external')
    const after = useMew.getState().blocks.find((b) => b.id === 'ext-2')!
    expect(after.endMin).toBe(20 * 60 + 30) // never resized
    expect(lastMsg().body).toMatch(/from your calendar/i)
  })

  it('same slot at the same length is a noop even with durationMin passed', async () => {
    await fresh(TUE(9, 40))
    const r = reply()
    const chatLen = chat().length
    const out = useMew.getState().dragMove(r.id, r.dayKey, r.startMin, r.endMin - r.startMin)
    expect(out).toBe('noop')
    expect(chat().length).toBe(chatLen)
  })

  it('an edge press never reaches the executor — spoken, not silent, no mutation', async () => {
    await fresh(TUE(9, 40))
    const walk = find(/Walk/, dayKey(TUE(0)))
    const calls: unknown[][] = []
    const spoken: string[] = []
    // Walk sits mid-week on the seeded Tuesday; hop it left past Monday's edge
    applyWeekKey(
      useMew.getState().blocks,
      week(),
      walk,
      { kind: 'nudge', deltaMin: 0, deltaDay: -1 },
      {
        dragMove: (...a) => {
          calls.push(a)
          return useMew.getState().dragMove(...a)
        },
        moveFocus: silentDeps.moveFocus,
        announce: (l) => spoken.push(l),
      }
    )
    expect(calls.length).toBe(1) // Monday is a real day — this one commits
    // …but from Monday, one more hop left is the week's edge: announced, no door call
    const moved = useMew.getState().blocks.find((b) => b.id === walk.id)!
    const calls2: unknown[][] = []
    const spoken2: string[] = []
    applyWeekKey(
      useMew.getState().blocks,
      week(),
      moved,
      { kind: 'nudge', deltaMin: 0, deltaDay: -1 },
      {
        dragMove: (...a) => {
          calls2.push(a)
          return useMew.getState().dragMove(...a)
        },
        moveFocus: silentDeps.moveFocus,
        announce: (l) => spoken2.push(l),
      }
    )
    expect(calls2).toEqual([]) // the edge stopped it before the executor
    expect(spoken2).toEqual(["that's the start of this week — Walk stays on monday"])
    expect(useMew.getState().blocks.find((b) => b.id === walk.id)!.dayKey).toBe(
      addDaysKey(dayKey(TUE(0)), -1)
    )
  })
})

describe('drift and the guard', () => {
  it('catches 12 idle minutes, guards on request, and stays quiet behind the guard', async () => {
    await fresh(TUE(9, 40))
    useMew.setState({ lastActivityMs: TUE(9, 28).getTime() })
    at(TUE(9, 41))
    const drift = lastNudge('drift')
    expect(drift).toBeDefined()
    expect(drift.body).toMatch(/Still on Q3 deck/)

    act(drift, 'guard')
    expect(useMew.getState().guardUntilMin).toBe(11.5 * 60)
    useMew.setState({ lastActivityMs: TUE(9, 30).getTime() })
    at(TUE(10, 0))
    expect(nudges('drift')).toHaveLength(1) // guarded — no second check-in
  })
})

describe('the end of the day', () => {
  it('closes the loop in the wind-down, rolls gracefully, and logs the roll', async () => {
    await fresh(TUE(9, 40))
    at(TUE(18, 5)) // 18:00 wind-down before 18:30 quiet hours
    const cl = lastNudge('close-loop')
    expect(cl).toBeDefined()
    expect(cl.body).toMatch(/isn't done — shall it live/)
    /* Wednesday is the seeded heavy day with no room — the loop still closes
       by finding the next day that CAN hold it, and says so honestly */
    const proposedDay = String(cl.payload!.toDayKey)
    expect(proposedDay > dayKey(TUE(0))).toBe(true)
    if (proposedDay !== addDaysKey(dayKey(TUE(0)), 1)) {
      expect(cl.body).not.toMatch(/tomorrow/)
    }

    const blockId = String(cl.payload!.blockId)
    act(cl, 'roll')
    const s = useMew.getState()
    const original = s.blocks.find((b) => b.id === blockId)!
    expect(original.status).toBe('rolled')
    const rolledTo = s.blocks.find((b) => b.id === original.rolledToId)!
    expect(rolledTo.dayKey).toBe(proposedDay)
    expect(s.memory.findLast((e: MemoryEvent) => e.kind === 'rolled')?.title).toBe(original.title)
  })

  it('quiet hours queue nudges; morning flushes them and the night consolidates', async () => {
    await fresh(TUE(19, 0)) // inside quiet hours — seeded right-size must queue
    expect(nudges('right-size')).toHaveLength(0)
    expect(useMew.getState().queuedNudges.length).toBeGreaterThanOrEqual(1)

    at(new Date(2026, 5, 10, 8, 45)) // Wednesday morning
    expect(nudges().length).toBeGreaterThanOrEqual(1) // flushed into chat
    expect(useMew.getState().queuedNudges).toHaveLength(0)
    /* rollover logged yesterday's rest honestly (seed leaves work open at 19:00) */
    expect(
      useMew
        .getState()
        .memory.some(
          (e: MemoryEvent) =>
            (e.kind === 'rest_kept' || e.kind === 'rest_skipped') && e.dayKey === dayKey(TUE(0))
        )
    ).toBe(true)
  })
})

describe('clear → fresh start → replan (the restart journey)', () => {
  it('clears only what is MEW’s, offers the fresh start, and shapes again', async () => {
    await fresh(TUE(9, 40))
    const before = useMew.getState().blocks.filter((b) => b.status === 'open').length
    expect(before).toBeGreaterThan(5)

    await say('cleanup my calendar so that i could restart and plan')
    expect(lastMsg().body).toMatch(/^Cleared — \d+ open blocks/)
    const after = useMew
      .getState()
      .blocks.filter((b) => b.status === 'open' && b.dayKey >= dayKey(TUE(0)))
    expect(after).toHaveLength(0)
    /* done mews from earlier today survive — positive only */
    expect(useMew.getState().blocks.some((b) => b.status === 'done')).toBe(true)

    await vi.advanceTimersByTimeAsync(1) // flush the deferred event nudge
    const fs = lastNudge('fresh-start')
    expect(fs).toBeDefined()
    expect(fs.body).toMatch(/blank page/i)
    act(fs, 'shape')
    expect(lastMsg().body).toMatch(/one thing that matters/)

    await say('block 2h for planning tomorrow at 9')
    expect(
      useMew.getState().blocks.some((b) => /planning/i.test(b.title) && b.status === 'open')
    ).toBe(true)
  })

  it('Monday morning opens the fresh-start window on its own', async () => {
    await fresh(new Date(2026, 5, 8, 9, 0)) // Monday 9:00
    at(new Date(2026, 5, 8, 9, 1)) // the boot tick carried the morning brief (#285)
    const fs = lastNudge('fresh-start')
    expect(fs).toBeDefined()
    /* with seeded history the opener now leads with last week's story (#36);
       the window, the actions, and the footnote are what this test pins */
    expect(fs.body).toMatch(/^last week: /)
    expect(fs.footnote).toContain('Dai, Milkman & Riis')
  })
})

describe('the brain at work', () => {
  it('break-it-smaller: the seeded chronic roller gets a concrete starter', async () => {
    await fresh(TUE(9, 40))
    /* the seed itself contains the pattern: "Inbox sweep" rolled 6× over 3 weeks,
       with an open Inbox sweep block on Thursday — the brain should notice */
    at(TUE(9, 44)) // the boot tick carried the morning brief (#285) …
    at(TUE(9, 45)) // … right-size took the next; this one belongs to the roller
    const bs = lastNudge('break-smaller')
    expect(bs).toBeDefined()
    expect(bs.body).toMatch(/"inbox sweep" has rolled forward six times/i)
    expect(bs.footnote).toContain('Bandura & Schunk')

    act(bs, 'starter')
    expect(
      useMew
        .getState()
        .blocks.some((b) => b.title === 'Starter: inbox sweep' && b.status === 'open')
    ).toBe(true)
    expect(lastMsg().body).toMatch(/25-minute starter/)
  })

  it('kinder plan: four heavy weeks → a concrete, applicable shape', async () => {
    await fresh(TUE(9, 40))
    at(TUE(9, 41)) // boot tick = morning brief (#285); right-size fires here instead
    const todayKey = dayKey(TUE(0))
    /* four trailing weeks at >30% carry */
    const heavy: MemoryEvent[] = []
    for (let w = 1; w <= 4; w++) {
      const mon = addDaysKey(todayKey, -7 * w - 1)
      for (let i = 0; i < 6; i++)
        heavy.push({
          id: uid(),
          ts: TUE(9).getTime(),
          kind: 'completed',
          dayKey: mon,
          plannedMin: 60,
        })
      for (let i = 0; i < 4; i++)
        heavy.push({ id: uid(), ts: TUE(9).getTime(), kind: 'rolled', dayKey: mon, plannedMin: 60 })
    }
    useMew.setState((s) => ({
      memory: [...s.memory, ...heavy],
      /* keep this scenario about the kinder plan: silence the seeded roller
         (drop its open block) and stay active so drift doesn't take the slot.
         right-size stays suppressed by its own 9:41 cooldown. */
      blocks: s.blocks.filter((b) => !/inbox sweep/i.test(b.title) || b.status !== 'open'),
      lastActivityMs: TUE(10, 29).getTime(),
    }))
    at(TUE(10, 30))
    const kp = lastNudge('kinder-plan')
    expect(kp).toBeDefined()

    act(kp, 'kinder')
    const proposal = lastNudge('kinder-plan')
    expect(proposal.id).not.toBe(kp.id)
    expect(proposal.body).toMatch(/kinder shape/)
    const moves = JSON.parse(String(proposal.payload!.moves))
    expect(moves.length).toBeGreaterThanOrEqual(1)

    act(proposal, 'apply')
    expect(lastMsg().body).toMatch(/^Done — .*The week breathes again/)
    for (const m of moves) {
      const b = useMew.getState().blocks.find((x) => x.id === m.blockId)!
      expect(b.dayKey).toBe(m.toDayKey)
    }
  })

  it('outcome learning: two declined drifts stretch the next check-in to 3× the cooldown', async () => {
    await fresh(TUE(9, 40))
    useMew.setState({ lastActivityMs: TUE(9, 28).getTime() })
    at(TUE(9, 41))
    expect(nudges('drift')).toHaveLength(1)

    /* the user declines twice (no accepts) → multiplier 3 → 30min base becomes 90 */
    const todayKey = dayKey(TUE(0))
    const declines: MemoryEvent[] = [1, 2].map(() => ({
      id: uid(),
      ts: TUE(9, 50).getTime(),
      kind: 'nudge_outcome',
      dayKey: todayKey,
      nudgeType: 'drift',
      outcome: 'declined',
    }))
    useMew.setState((s) => ({
      memory: [...s.memory, ...declines],
      lastActivityMs: TUE(9, 45).getTime(),
      engine: { ...s.engine, lastDriftBlockId: null },
    }))
    at(TUE(10, 41)) // 60 min after the first — inside the stretched window
    expect(nudges('drift')).toHaveLength(1)

    useMew.setState((s) => ({
      lastActivityMs: TUE(10, 55).getTime(),
      engine: { ...s.engine, lastDriftBlockId: null },
    }))
    at(TUE(11, 12)) // 91 min after the first — the stretched window has passed
    expect(nudges('drift')).toHaveLength(2)
  })
})

describe('the mirror', () => {
  it('nudges mirror to notifications only through the notifier port', async () => {
    await fresh(TUE(9, 40))
    expect(mirrors.length).toBeGreaterThanOrEqual(1)
    /* the boot tick is the morning brief — it announces itself by name, and
       the notification body is the brief's first line (#285) */
    expect(mirrors[0].title).toBe('mew — morning brief')
    expect(mirrors[0].body).toMatch(/^today: /)
    /* every other nudge keeps the companion's own title */
    at(TUE(9, 41)) // right-size
    expect(mirrors.length).toBeGreaterThanOrEqual(2)
    expect(mirrors[mirrors.length - 1].title).toContain('Pixie')
  })
})

/* ── the daily rituals: morning brief & evening wrap (#285) ──────────── */

describe('the daily rituals (#285)', () => {
  const queuedBriefs = () =>
    useMew.getState().queuedNudges.filter((m) => m.nudgeType === 'morning-brief')
  /** same storage, fresh webview — the mid-day relaunch */
  const restartAt = async (d: Date) => {
    vi.setSystemTime(d)
    useMew.setState(
      { ...pristine, lastTickDay: dayKey(d), nowMs: d.getTime(), lastActivityMs: d.getTime() },
      true
    )
    await useMew.getState().hydrate()
  }

  it('the brief fires exactly once per day across an app restart — the key is persisted', async () => {
    await fresh(TUE(9, 40))
    expect(nudges('morning-brief')).toHaveLength(1)
    expect(nudges('morning-brief')[0].body).toMatch(/^today: /)
    /* the dedupe key rides Settings as machine state — already on disk */
    expect(fakeDb.settings?.nudgeLastFired?.['morning-brief']?.key).toBe(dayKey(TUE(0)))

    await restartAt(TUE(10, 30))
    at(TUE(10, 31))
    expect(nudges('morning-brief')).toHaveLength(1) // the persisted key held
  })

  it('default quiet hours end at 8:30 = default briefMin — the boundary posts at 8:30', async () => {
    await fresh(TUE(8, 29)) // one minute inside quiet hours: the brief is not yet due
    expect(nudges('morning-brief')).toHaveLength(0)
    expect(queuedBriefs()).toHaveLength(0) // not fired at all — nothing parked
    at(TUE(8, 30)) // the boundary: quiet is over AND the brief is due — straight to chat
    expect(nudges('morning-brief')).toHaveLength(1)
    expect(queuedBriefs()).toHaveLength(0)
  })

  it('a brief due inside quiet hours parks and posts once at the morning flush — never twice', async () => {
    await fresh(TUE(6, 0))
    useMew.getState().updateSettings({ briefMin: 7 * 60 })
    at(TUE(7, 0)) // due, but 7:00 is quiet: fired into the queue, chat untouched
    expect(nudges('morning-brief')).toHaveLength(0)
    expect(queuedBriefs()).toHaveLength(1)
    at(TUE(7, 30)) // still quiet — the once-per-day key holds the queue to one
    expect(queuedBriefs()).toHaveLength(1)
    at(TUE(8, 30)) // quiet ends: the flush delivers exactly one card
    expect(nudges('morning-brief')).toHaveLength(1)
    at(TUE(8, 31))
    at(TUE(9, 0))
    expect(nudges('morning-brief')).toHaveLength(1) // engine key + queue never double-post
    expect(queuedBriefs()).toHaveLength(0)
  })

  it('restart while parked: a burned key with no delivered card heals — one brief, never zero, never two', async () => {
    await fresh(TUE(6, 0))
    useMew.getState().updateSettings({ briefMin: 7 * 60 })
    at(TUE(7, 0)) // parks: key burned, queue holds 1, chat 0
    expect(queuedBriefs()).toHaveLength(1)
    expect(nudges('morning-brief')).toHaveLength(0)
    expect(fakeDb.settings?.nudgeLastFired?.['morning-brief']?.key).toBe(dayKey(TUE(0)))

    /* the queue dies with the app — restart before the morning flush. Chat is
       the source of truth: hydrate sees today's key with no delivered card
       and drops it, so the ritual can fire again (still into the queue). */
    await restartAt(TUE(7, 40))
    at(TUE(7, 45)) // still quiet — re-fired into the queue, chat untouched
    expect(nudges('morning-brief')).toHaveLength(0)
    expect(queuedBriefs()).toHaveLength(1)
    at(TUE(8, 30)) // quiet ends: the flush delivers exactly one card
    expect(nudges('morning-brief')).toHaveLength(1)
    at(TUE(9, 0))
    expect(nudges('morning-brief')).toHaveLength(1) // once — never twice

    /* and the heal never over-corrects: a DELIVERED brief keeps its key
       across yet another restart */
    await restartAt(TUE(9, 30))
    at(TUE(9, 31))
    expect(nudges('morning-brief')).toHaveLength(1)
  })

  it('a 14:00 launch: the brief lands on the first tick (late is honest); the wrap waits for wrapMin', async () => {
    await fresh(TUE(14, 0))
    expect(nudges('morning-brief')).toHaveLength(1)
    expect(nudges('evening-wrap')).toHaveLength(0)
    useMew.setState({ lastActivityMs: TUE(17, 30).getTime() })
    at(TUE(17, 30))
    expect(nudges('evening-wrap')).toHaveLength(1)
    expect(lastNudge('evening-wrap').body.split('\n')).toHaveLength(3)
    at(TUE(17, 45))
    expect(nudges('evening-wrap')).toHaveLength(1) // once a day, the wrap too
  })

  it('the brief mirrors once — named title, first line as body, click lands on the card', async () => {
    await fresh(TUE(9, 40))
    const briefMirrors = mirrors.filter((m) => m.title === 'mew — morning brief')
    expect(briefMirrors).toHaveLength(1)
    expect(briefMirrors[0].body).toMatch(/^today: /)
    expect(briefMirrors[0].body).not.toContain('\n')
    briefMirrors[0].onClick?.()
    expect(useMew.getState().page).toBe('week')
    expect(useMew.getState().scrollToMsgId).toBe(nudges('morning-brief')[0].id)
  })

  it('the wrap mirrors under its own name too', async () => {
    await fresh(TUE(17, 45)) // evening boot: the wrap outranks the (late) brief this tick
    expect(mirrors.filter((m) => m.title === 'mew — evening wrap')).toHaveLength(1)
    expect(mirrors[0].body).toBe(lastNudge('evening-wrap').body.split('\n')[0])
    at(TUE(17, 46)) // the day never got its brief — late is honest, next tick is its
    expect(nudges('morning-brief')).toHaveLength(1)
  })

  it('settings rows persist and re-schedule: a later briefMin cannot re-fire a fired day', async () => {
    await fresh(TUE(9, 40)) // the boot tick fired the brief
    useMew.getState().updateSettings({ briefMin: 11 * 60 })
    expect(fakeDb.settings?.briefMin).toBe(11 * 60) // persisted
    useMew.setState({ lastActivityMs: TUE(11, 0).getTime() })
    at(TUE(11, 0))
    at(TUE(11, 1))
    expect(nudges('morning-brief')).toHaveLength(1)
  })

  it('not yet fired: a same-day move to a later time governs the fire', async () => {
    await fresh(TUE(8, 0)) // inside quiet hours, before briefMin — nothing fired
    expect(queuedBriefs()).toHaveLength(0)
    useMew.getState().updateSettings({ briefMin: 10 * 60 })
    /* stay active through the morning so a drift check-in (higher priority,
       one nudge per tick) never takes the brief's tick */
    useMew.setState({ lastActivityMs: TUE(9, 0).getTime() })
    at(TUE(9, 0)) // past the old default, before the new time — silent
    expect(nudges('morning-brief')).toHaveLength(0)
    expect(queuedBriefs()).toHaveLength(0)
    useMew.setState({ lastActivityMs: TUE(10, 0).getTime() })
    at(TUE(10, 0))
    expect(nudges('morning-brief')).toHaveLength(1)
  })
})

/* ── the sustenance scaffold (#299, v0.5 16b): fed and paced by default ──
   The whole suite runs the keyless rules floor, so every pin here doubles as
   the keyless-identical proof: the scaffold is pure domain + executor and
   never consults a model. */

describe('the sustenance scaffold (#299)', () => {
  const TODAY = () => dayKey(TUE(0))
  const scaffoldLines = () =>
    chat().filter((m) => m.role === 'mew' && m.body.startsWith('fed and paced'))
  const planCards = () => chat().filter((m) => m.role === 'tool' && m.tool?.name === 'plan')
  const titled = (title: string) =>
    useMew.getState().blocks.filter((b) => b.dayKey === TODAY() && b.title === title)
  /** same storage, fresh webview — the mid-day relaunch (the rituals' helper) */
  const restartAt = async (d: Date) => {
    vi.setSystemTime(d)
    useMew.setState(
      { ...pristine, lastTickDay: dayKey(d), nowMs: d.getTime(), lastActivityMs: d.getTime() },
      true
    )
    await useMew.getState().hydrate()
  }

  it('the seeded morning gains only what it lacks — dinner + a breather, through the executor, one line', async () => {
    await fresh(TUE(9, 40))
    /* the seeded Tuesday already holds a lunch: no second lunch, ever */
    const day = useMew.getState().blocks.filter((b) => b.dayKey === TODAY())
    expect(day.filter((b) => mealClassOf(b.title) === 'lunch')).toHaveLength(1)
    expect(titled('Dinner')).toHaveLength(1)
    expect(titled('Dinner')[0]).toMatchObject({
      tag: 'private',
      protected: false,
      status: 'open',
      startMin: 19 * 60,
      endMin: 20 * 60,
    })
    expect(titled('Breather')).toHaveLength(1)
    expect(titled('Breather')[0]).toMatchObject({
      tag: 'rest',
      protected: false,
      startMin: 12 * 60,
      endMin: 12 * 60 + 15,
    })
    /* one plain line, exact voice — and the executor's receipt precedes it
       (#282/#294: the card IS the proof the apply went through the plan door) */
    expect(scaffoldLines()).toHaveLength(1)
    expect(scaffoldLines()[0].body).toBe(
      'fed and paced: dinner 19:00, a breather at 12:00 — say the word to reshape'
    )
    expect(planCards()).toHaveLength(1)
    expect(planCards()[0].tool).toMatchObject({
      name: 'plan',
      verb: 'placing blocks',
      state: 'done',
    })
    expect(chat().indexOf(planCards()[0])).toBeLessThan(chat().indexOf(scaffoldLines()[0]))
    /* the shared tick, ordered: the brief composed AFTER the scaffold, so its
       shape line already counts the meals (8 blocks, day ends at dinner) */
    expect(lastNudge('morning-brief').body).toMatch(/^today: 8 blocks, 9:00–20:00/)
    /* the key burned and persisted; nothing celebrated — a mew is a completion */
    expect(fakeDb.settings?.nudgeLastFired?.sustenance?.key).toBe(TODAY())
    expect(nudges('celebrate')).toHaveLength(0)
  })

  it('once per day across a restart: the persisted key holds, the one line stays one', async () => {
    await fresh(TUE(9, 40))
    await restartAt(TUE(10, 30))
    at(TUE(10, 31))
    expect(titled('Dinner')).toHaveLength(1)
    expect(titled('Breather')).toHaveLength(1)
    expect(scaffoldLines()).toHaveLength(1) // the stored line, not a fresh one
  })

  it('heal, direction one: a burned key with no blocks and no line re-arms — one pass, never zero', async () => {
    await fresh(TUE(8, 0)) // pre-brief boot: nothing fired yet
    await say('clear today') // the day empties — no meal-class block remains
    at(TUE(8, 31))
    expect(scaffoldLines()).toHaveLength(1)
    expect(titled('Lunch')).toHaveLength(1)
    expect(titled('Dinner')).toHaveLength(1)
    /* the crash window the heal exists for: the key persisted, the delivery
       (blocks + line) never made it to disk */
    for (const [id, b] of [...fakeDb.blocks]) {
      const t = (b as { title: string }).title
      if (t === 'Lunch' || t === 'Dinner') fakeDb.blocks.delete(id)
    }
    for (const [id, m] of [...fakeDb.chat]) {
      if ((m as ChatMessage).body?.startsWith('fed and paced')) fakeDb.chat.delete(id)
    }
    await restartAt(TUE(9, 0))
    expect(scaffoldLines()).toHaveLength(1) // re-ran once — late is honest, never twice
    expect(titled('Lunch')).toHaveLength(1)
    expect(titled('Dinner')).toHaveLength(1)
    expect(fakeDb.settings?.nudgeLastFired?.sustenance?.key).toBe(TODAY())
  })

  it('heal, direction two: the spoken line alone keeps the key — a cleared day never re-scaffolds', async () => {
    await fresh(TUE(9, 40)) // scaffold delivered: blocks + line
    await say('clear today') // the user unwinds the day; the line stays in chat
    expect(titled('Dinner')).toHaveLength(0)
    await restartAt(TUE(11, 0))
    at(TUE(11, 1))
    expect(scaffoldLines()).toHaveLength(1) // chat as truth: it already spoke today
    expect(titled('Dinner')).toHaveLength(0)
  })

  it('off: byte-identical week, no line, no card, no key — the rituals themselves untouched', async () => {
    await fresh(TUE(8, 0))
    useMew.getState().updateSettings({ sustenance: 'off' })
    const weekBefore = JSON.stringify(useMew.getState().blocks)
    const chatBefore = chat().length
    at(TUE(8, 31))
    expect(JSON.stringify(useMew.getState().blocks)).toBe(weekBefore)
    expect(scaffoldLines()).toHaveLength(0)
    expect(planCards()).toHaveLength(0)
    expect(useMew.getState().settings.nudgeLastFired?.sustenance).toBeUndefined()
    expect(nudges('morning-brief')).toHaveLength(1)
    /* the tick adds only the engine's own nudge cards (brief; the seeded
       heavy tomorrow earns right-size) — never a mew or tool row */
    for (const m of chat().slice(chatBefore)) expect(m.role).toBe('nudge')
  })

  it('a fully-fed morning stays silent — the key still burns (checked, not needed)', async () => {
    await fresh(TUE(8, 0))
    await say('block 1h for dinner today at 7pm') // lunch is seeded; dinner is yours now
    const cardsBefore = planCards().length // the turn's own receipt
    const blocksBefore = useMew.getState().blocks.length
    at(TUE(8, 31))
    expect(useMew.getState().blocks.length).toBe(blocksBefore) // no meals, no breathers
    expect(scaffoldLines()).toHaveLength(0)
    expect(planCards()).toHaveLength(cardsBefore) // the pass never opened the door
    expect(fakeDb.settings?.nudgeLastFired?.sustenance?.key).toBe(TODAY())
  })

  it('a remembered "lunch is always at 1pm" personalizes the scaffold end-to-end', async () => {
    await fresh(TUE(8, 0))
    await say('remember that lunch is always at 1pm')
    await say('clear today')
    at(TUE(8, 31))
    expect(titled('Lunch')).toHaveLength(1)
    expect(titled('Lunch')[0].startMin).toBe(13 * 60)
    expect(scaffoldLines()[0].body).toContain('lunch 13:00')
  })
})

/* ── the brain is optional-path: off = invisible, on = a sense ───────── */

describe('brain senses', () => {
  it('brain off (the default): completing a block writes nothing anywhere new', async () => {
    await fresh(TUE(9, 40))
    const deck = useMew
      .getState()
      .blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(9, 40)))!
    useMew.getState().toggleComplete(deck.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(brainFake.ingests).toHaveLength(0)
  })

  it('brain on: a completion ingests the task page with the day timeline', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    const deck = useMew
      .getState()
      .blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(9, 40)))!
    useMew.getState().toggleComplete(deck.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(brainFake.ingests.map((p) => p.slug)).toContain('task/q3-deck')
    await vi.advanceTimersByTimeAsync(60_000) // drain the chat batcher's window
  })

  it('chat turns batch into one quiet-minute write, nudges stay out', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.reset()
    await say('block 30m for inbox today at 15')
    expect(brainFake.ingests.filter((p) => p.slug.startsWith('week/'))).toHaveLength(0) // debounce open
    await vi.advanceTimersByTimeAsync(60_000)
    const weekWrites = brainFake.ingests.filter((p) => p.slug.startsWith('week/'))
    expect(weekWrites).toHaveLength(1) // user turn + mew reply coalesced
  })

  it('desktop sidecar: the shell handshake turns the brain on, Settings untouched', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh' })
    const deck = useMew
      .getState()
      .blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(9, 40)))!
    useMew.getState().toggleComplete(deck.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(brainFake.ingests.map((p) => p.slug)).toContain('task/q3-deck')
    expect(brainCfg.current!.url()).toBe('http://127.0.0.1:43217')
    /* zero user setup also means zero settings mutation — suggest, don't seize */
    expect(useMew.getState().settings.brainEnabled).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000) // drain the chat batcher's window
  })

  it('desktop sidecar: a restart hands over fresh credentials; explicit Settings outrank both', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:1000', token: 'gbrain_a' })
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:2000', token: 'gbrain_b' })
    expect(brainCfg.current!.url()).toBe('http://127.0.0.1:2000')
    expect(brainCfg.current!.token()).toBe('gbrain_b')
    useMew
      .getState()
      .updateSettings({ brainEnabled: true, brainUrl: 'http://my-brain:9999', brainToken: 'mine' })
    expect(brainCfg.current!.url()).toBe('http://my-brain:9999')
    expect(brainCfg.current!.token()).toBe('mine')
    await vi.advanceTimersByTimeAsync(30_000) // drain the queued desktop backup — no ghost timer across tests
  })

  it('desktop sidecar: the rulebook is live too — a brain-held rule shapes the plan, Settings still off', async () => {
    /* the named failure mode of a half-on sidecar: senses writing while the
       always-on rulebook stays dark. The rule lives ONLY in the brain, so the
       sole path to the plan is handshake → pref-cache refresh → applyPrefs. */
    desktopFake.tauri = true
    brainFake.prefs = [
      { kind: 'time-default', match: 'gym', value: 'starts 07:00', stated: 'gym is always at 7am' },
    ]
    await fresh(TUE(9, 40))
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh' })
    await vi.advanceTimersByTimeAsync(0) // the handshake's listPrefs settles
    await say('add gym tomorrow')
    const tomorrow = addDaysKey(dayKey(TUE(9, 40)), 1)
    const gym = useMew.getState().blocks.find((b) => b.dayKey === tomorrow && /gym/i.test(b.title))!
    expect(gym.startMin).toBe(7 * 60) // the standing rule chose the slot
    expect(lastMsg().body).toContain('(your standing rule)')
    expect(useMew.getState().settings.brainEnabled).toBe(false) // sidecar-only, zero settings mutation
    await vi.advanceTimersByTimeAsync(60_000) // drain the chat batcher
  })

  it('desktop sidecar: shell lifecycle beats land in state — a dead brain is visibly dead (#249)', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    expect(useMew.getState().brainSidecar).toBe('off') // no beat yet
    desktopFake.brainBeat?.('starting')
    expect(useMew.getState().brainSidecar).toBe('starting')
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:43217', token: 'gbrain_fresh' })
    expect(useMew.getState().brainSidecar).toBe('connected')
    expect(brainCfg.current!.enabled()).toBe(true)
    /* the child dies, the shell respawns, then spends its restart budget:
       retrying keeps the brain effective (fresh credentials are imminent) */
    desktopFake.brainBeat?.('retrying')
    expect(useMew.getState().brainSidecar).toBe('retrying')
    expect(brainCfg.current!.enabled()).toBe(true)
    /* the final give-up hands back the floor: recall/senses stop dialing the
       dead port, and the prompt gets its <brain-recall off/> marker */
    desktopFake.brainBeat?.('unavailable')
    expect(useMew.getState().brainSidecar).toBe('unavailable')
    expect(brainCfg.current!.enabled()).toBe(false)
    /* the beats are display state only — they never mutate Settings */
    expect(useMew.getState().settings.brainEnabled).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000) // drain the handshake's chat batcher window
  })
})

/* ── backfill on connect: a brain is offered what it missed, exactly once ── */

describe('brain backfill on connect (#249 fix 4)', () => {
  /* the seed carries 3 earlier weeks × 5 days × 2 block events with the full
     block shape (title/tag/times) — the replayable history of a fresh install.
     Same-week seeded events carry no titles, so they honestly stay local. */
  const SEEDED_REPLAYABLE = 30

  it('the first sidecar handshake replays the recent history, oldest first — and claims the ledger before sending', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    expect(brainFake.ingests).toHaveLength(0)
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:43217', token: 'gbrain_x' })
    /* each event is claimed ahead of its send (the first claim lands
       synchronously with the handshake) — a quit mid-replay can only lose
       the event in flight, never double one */
    expect(useMew.getState().settings.brainBackfillAt?.sidecar).toBeGreaterThan(0)
    await settle()
    const replayed = brainFake.ingests.map((p) => p.slug)
    expect(replayed).toHaveLength(SEEDED_REPLAYABLE)
    expect(replayed[0]).toBe('task/deep-work') // three Mondays back — history reads forward
    expect(replayed.at(-1)).toBe('task/q3-deck') // last Friday's late polish
    /* a sidecar restart hands fresh credentials — nothing is offered twice */
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:50000', token: 'gbrain_y' })
    await settle()
    expect(brainFake.ingests).toHaveLength(SEEDED_REPLAYABLE)
    await vi.advanceTimersByTimeAsync(30_000) // drain the settings-claim backup timer
  })

  it('events that land while the brain is down are replayed on the next connect — never twice', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:43217', token: 'gbrain_x' })
    await settle()
    const afterConnect = brainFake.ingests.length
    /* the shell spends its restart budget — the brain is off for the session */
    desktopFake.brainBeat?.('unavailable')
    at(TUE(9, 41))
    const deck = useMew
      .getState()
      .blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(9, 41)))!
    useMew.getState().toggleComplete(deck.id)
    await settle()
    expect(brainFake.ingests).toHaveLength(afterConnect) // live ingest no-ops, event NOT claimed
    /* next launch's shell spawns fresh: exactly the missed mew is replayed */
    at(TUE(9, 42))
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:50001', token: 'gbrain_z' })
    await settle()
    expect(brainFake.ingests).toHaveLength(afterConnect + 1)
    expect(brainFake.ingests.at(-1)!.slug).toBe('task/q3-deck')
    /* and only once — the replay claimed it */
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:50002', token: 'gbrain_w' })
    await settle()
    expect(brainFake.ingests).toHaveLength(afterConnect + 1)
    await vi.advanceTimersByTimeAsync(30_000)
  })

  it('the ledger is per-brain: a newly configured endpoint gets the history the sidecar already saw', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:43217', token: 'gbrain_x' })
    await settle()
    expect(brainFake.ingests).toHaveLength(SEEDED_REPLAYABLE)
    at(TUE(9, 41))
    /* the user points MEW at their own brain — it has seen NONE of this */
    useMew
      .getState()
      .updateSettings({ brainEnabled: true, brainUrl: 'http://my-brain:9999', brainToken: 'mine' })
    await settle()
    expect(brainFake.ingests).toHaveLength(SEEDED_REPLAYABLE * 2)
    expect(
      useMew.getState().settings.brainBackfillAt?.['endpoint:http://my-brain:9999']
    ).toBeGreaterThan(0)
    /* toggling back falls to the sidecar, whose ledger is current — no re-offer */
    useMew.getState().updateSettings({ brainEnabled: false })
    await settle()
    expect(brainFake.ingests).toHaveLength(SEEDED_REPLAYABLE * 2)
    await vi.advanceTimersByTimeAsync(30_000)
  })

  it('a quit mid-replay resumes where it left off — the tail is not forfeited, nothing rides twice', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    /* the app "quits" at event 10: its send never settles, the loop parks */
    brainFake.ingestImpl = (page) => {
      brainFake.ingests.push(page)
      if (brainFake.ingests.length === 10) return new Promise(() => {})
    }
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:43217', token: 'gbrain_x' })
    await settle()
    expect(brainFake.ingests).toHaveLength(10) // claimed+sent 1–10; 11–30 still unsent
    /* relaunch: same storage (the per-event claims persisted), fresh webview */
    brainFake.ingestImpl = null
    setSidecarBrain(null)
    vi.setSystemTime(TUE(9, 45))
    useMew.setState(
      {
        ...pristine,
        lastTickDay: dayKey(TUE(9, 45)),
        nowMs: TUE(9, 45).getTime(),
        lastActivityMs: TUE(9, 45).getTime(),
      },
      true
    )
    await useMew.getState().hydrate()
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:60000', token: 'gbrain_next' })
    await settle()
    /* the mark stopped at event 10, so the resume offers exactly 11–30 */
    expect(brainFake.ingests).toHaveLength(SEEDED_REPLAYABLE)
    const identities = brainFake.ingests.map((p) =>
      JSON.stringify((p as { timeline?: unknown }).timeline ?? p.slug)
    )
    expect(new Set(identities).size).toBe(identities.length) // every event exactly once
    await vi.advanceTimersByTimeAsync(30_000)
  })

  it('a brain switch mid-replay aborts the old pass — each brain still gets every event exactly once', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    /* at event 5 of the sidecar replay, the user points MEW at their own
       brain — the port reads config live, so an unguarded loop would leak
       the remainder onto the NEW brain under the OLD ledger key */
    brainFake.ingestImpl = (page) => {
      brainFake.ingests.push(page)
      if (brainFake.ingests.length === 5) {
        useMew.getState().updateSettings({
          brainEnabled: true,
          brainUrl: 'http://my-brain:9999',
          brainToken: 'mine',
        })
      }
    }
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:43217', token: 'gbrain_x' })
    await settle()
    /* sidecar stream stopped at the switch (5); the endpoint ran its own
       clean full pass (30) under its own key — no event doubled on it */
    expect(brainFake.ingests).toHaveLength(5 + SEEDED_REPLAYABLE)
    /* switching back resumes the sidecar exactly where its ledger stopped:
       events 6–30 (25 more), so both brains end at every event exactly once
       — 30 each, 60 sends total */
    brainFake.ingestImpl = null
    useMew.getState().updateSettings({ brainEnabled: false })
    await settle()
    expect(brainFake.ingests).toHaveLength(SEEDED_REPLAYABLE * 2)
    await vi.advanceTimersByTimeAsync(30_000)
  })

  it('a second connect beat mid-replay supersedes the first pass — no event rides twice', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    /* the endpoint event and the snapshot pull can land together; a sidecar
       can also restart while the first replay drains — same shape */
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:43217', token: 'gbrain_a' })
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:43218', token: 'gbrain_b' })
    await settle()
    expect(brainFake.ingests).toHaveLength(SEEDED_REPLAYABLE)
    const identities = brainFake.ingests.map((p) =>
      JSON.stringify((p as { timeline?: unknown }).timeline ?? p.slug)
    )
    expect(new Set(identities).size).toBe(identities.length)
    await vi.advanceTimersByTimeAsync(30_000)
  })

  it('the ledger survives a restart: a reload replays nothing it already offered', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:43217', token: 'gbrain_x' })
    await settle()
    expect(brainFake.ingests).toHaveLength(SEEDED_REPLAYABLE)
    await vi.advanceTimersByTimeAsync(30_000)
    /* the app restarts: storage persists, the webview state does not */
    brainFake.reset()
    setSidecarBrain(null)
    vi.setSystemTime(TUE(9, 45))
    useMew.setState(
      {
        ...pristine,
        lastTickDay: dayKey(TUE(9, 45)),
        nowMs: TUE(9, 45).getTime(),
        lastActivityMs: TUE(9, 45).getTime(),
      },
      true
    )
    await useMew.getState().hydrate()
    desktopFake.brainReady?.({ url: 'http://127.0.0.1:60000', token: 'gbrain_next' })
    await settle()
    expect(brainFake.ingests).toHaveLength(0) // the persisted mark: everything already offered
  })
})

/* ── recall honesty: "didn't answer" is not "answered empty" (#249 fix 6) ── */

describe('recall honesty — degraded vs empty', () => {
  it('query_brain, brain answered empty: the honest miss names the brain as checked', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    await settle() // let the enable-connect replay drain out of the way
    brainFake.recallImpl = () => []
    const out = await useMew.getState().queryBrain('how did the pottery class go last week')
    expect(out).toContain('or the brain mentions it')
    expect(out).not.toContain(`didn't answer`)
  })

  it("query_brain, brain errored: MEW says the brain didn't answer — never that it was empty", async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    await settle()
    brainFake.recallImpl = () => {
      throw new Error('brain down')
    }
    const out = await useMew.getState().queryBrain('how did the pottery class go last week')
    expect(out).toContain(`The brain didn't answer just now`)
    expect(out).not.toContain('or the brain')
  })

  it('query_brain, brain hung: the race frees the answer at ~2500ms (raised from 1200) and says so', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    await settle()
    brainFake.recallImpl = () => new Promise<string[]>(() => {})
    let out: string | undefined
    void useMew
      .getState()
      .queryBrain('how did the pottery class go last week')
      .then((s) => {
        out = s
      })
    await vi.advanceTimersByTimeAsync(2_400)
    expect(out).toBeUndefined() // still waiting well past the old 1200ms bound
    await vi.advanceTimersByTimeAsync(200)
    expect(out).toContain(`didn't answer`)
  })

  it('chat turn: a hung brain marks the context degraded — the model is told recall is missing, not empty', async () => {
    const { contextBlock } = await import('../../adapters/model/types')
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true, modelLocation: 'local' })
    await settle()
    brainFake.recallImpl = () => new Promise<string[]>(() => {})
    scriptedModel.chunks = ['okay.']
    const p = say('what do you remember about my gym weeks?')
    await vi.advanceTimersByTimeAsync(1_500) // the turn's tight race frees the context
    await p
    expect(scriptedModel.lastCtx?.recallDegraded).toBe(true)
    expect(contextBlock(scriptedModel.lastCtx!)).toContain('<brain-recall degraded')
    await vi.advanceTimersByTimeAsync(60_000) // drain the chat batcher
  })

  it('chat turn: a real empty answer stays silent — absence that means itself', async () => {
    const { contextBlock } = await import('../../adapters/model/types')
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true, modelLocation: 'local' })
    await settle()
    brainFake.recallImpl = () => []
    scriptedModel.chunks = ['okay.']
    await say('what do you remember about my gym weeks?')
    expect(scriptedModel.lastCtx?.recallDegraded).toBe(false)
    expect(contextBlock(scriptedModel.lastCtx!)).not.toContain('<brain-recall')
    await vi.advanceTimersByTimeAsync(60_000)
  })
})

/* ── preferences: stated once, applied every turn ─────────────────────── */

describe('remember (the standing rulebook)', () => {
  it('floor path: "remember that gym is always at 7am" persists and reaches the pref slice', async () => {
    const { prefLinesFrom } = await import('../store')
    await fresh(TUE(9, 40))
    await say('remember that gym is always at 7am')
    expect(lastMsg().body).toBe('Remembered — gym starts 07:00.')
    const ev = useMew.getState().memory.findLast((e: MemoryEvent) => e.kind === 'preference')!
    expect(ev.pref).toMatchObject({ kind: 'time-default', match: 'gym', value: 'starts 07:00' })
    const lines = prefLinesFrom(useMew.getState().memory, null)
    expect(lines).toEqual(['gym → starts 07:00 (stated: "gym is always at 7am")'])
  })

  it('upsert: restating replaces — one line, newest value wins', async () => {
    const { prefLinesFrom } = await import('../store')
    await fresh(TUE(9, 40))
    await say('remember that gym is always at 7am')
    await say('remember that gym is always at 8am')
    const lines = prefLinesFrom(useMew.getState().memory, null)
    expect(lines.filter((l) => l.startsWith('gym →'))).toHaveLength(1)
    expect(lines[0]).toContain('starts 08:00')
  })

  it('one-off moves write zero prefs', async () => {
    await fresh(TUE(9, 40))
    await say('move gym to 8 today')
    expect(useMew.getState().memory.some((e: MemoryEvent) => e.kind === 'preference')).toBe(false)
  })

  it('brain on: the pref page rides to the brain with the upsert slug', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.reset()
    await say('remember that the standup always takes 15 min')
    await vi.advanceTimersByTimeAsync(0)
    expect(brainFake.ingests.map((p) => p.slug)).toContain('pref/duration-default-standup')
    await vi.advanceTimersByTimeAsync(60_000) // drain the chat batcher
  })
})

/* ── delegation: recurring task×person pairs, suggested at week-shaping ── */

describe('delegate (handoff candidates)', () => {
  const MON = (h: number, m = 0) => new Date(2026, 5, 8, h, m)
  const drain = () => vi.advanceTimersByTimeAsync(0)
  const seedHistory = () => {
    const now = useMew.getState().nowMs
    const mkEv = (daysAgo: number, title: string) => ({
      id: `dlg-${daysAgo}-${title}`,
      ts: now - daysAgo * 24 * 60 * 60 * 1000,
      kind: 'completed' as const,
      dayKey: dayKey(new Date(now - daysAgo * 24 * 60 * 60 * 1000)),
      title,
    })
    useMew.setState((st) => ({
      memory: [
        ...st.memory,
        mkEv(2, 'Doc review — Robin'),
        mkEv(7, 'Doc review — Robin'),
        mkEv(12, 'Doc review — Robin'),
        mkEv(4, 'Doc review'),
      ],
    }))
  }

  it('Monday morning, brain on: the opener lands first, the handoff rides the next tick; accept → a capture', async () => {
    await fresh(MON(9, 0))
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.links['task/doc-review'] = ['person/robin', 'week/2026-06-04']
    seedHistory()
    at(MON(9, 1)) // first window tick: links fetch kicks off; fresh-start owns the nudge
    await drain()
    expect(nudges('fresh-start').length).toBeGreaterThan(0)
    expect(nudges('delegate')).toHaveLength(0)

    at(MON(9, 2)) // links cached now; the opener is cooling — delegate's turn
    const dlg = nudges('delegate')
    expect(dlg).toHaveLength(1)
    expect(dlg[0].body).toContain('doc review has run with Robin three times this month')
    expect(dlg[0].body).not.toMatch(/missed|overdue|failed/)

    act(dlg[0], 'capture')
    await drain()
    const cap = useMew
      .getState()
      .captures.find((c) => /hand the doc review thread to robin/i.test(c.title))
    expect(cap).toBeDefined()
    expect(cap!.status).toBe('open')
    /* suggest, don't seize: nothing was placed or reassigned by the accept itself */
    expect(useMew.getState().blocks.some((b) => /hand the doc review/i.test(b.title))).toBe(false)

    at(MON(9, 4)) // same pair, same week — once is once
    expect(nudges('delegate')).toHaveLength(1)
  })

  it('brain off: same history, no graph, no nudge — silent, not degraded', async () => {
    await fresh(MON(9, 0))
    brainFake.links['task/doc-review'] = ['person/robin']
    seedHistory()
    at(MON(9, 1))
    await drain()
    at(MON(9, 2))
    expect(nudges('delegate')).toHaveLength(0)
  })
})

/* ── day debrief: the evening story, two kind lines ──────────────────── */

describe('day debrief', () => {
  const TUE_KEY = '2026-06-09'
  const awake = (d: Date) => {
    /* idle resets so drift can't outrank the wind-down nudges (one per tick) */
    useMew.setState({ lastActivityMs: d.getTime() })
    at(d)
  }

  it('TUE 18:15: close-loop gets the open thread first, then the story — exact two lines', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.reset()
    /* the day happens: deck done on time, Sam reply slips 40 */
    at(TUE(11, 30))
    const deck = useMew
      .getState()
      .blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === TUE_KEY)!
    useMew.getState().toggleComplete(deck.id)
    at(TUE(15, 40))
    const sam = useMew.getState().blocks.find((b) => /Reply to Sam/.test(b.title))!
    useMew.getState().toggleComplete(sam.id)

    awake(TUE(18, 15)) // wind-down opens: the open standup gets its plan first
    expect(nudges('close-loop').length).toBeGreaterThan(0)
    expect(nudges('debrief')).toHaveLength(0)

    awake(TUE(18, 16)) // loop is cooling — the story lands
    const db = nudges('debrief')
    expect(db).toHaveLength(1)
    expect(db[0].body).toBe(
      '2 mews; the reply to sam slipped 40 past its window; rest held.\ntomorrow opens heavy — 8h against your 5.5.'
    )
    expect(db[0].actions ?? []).toHaveLength(0)

    /* durable, not just chat: the story lands on the day page's timeline */
    await vi.advanceTimersByTimeAsync(0)
    const page = brainFake.ingests.find(
      (p) =>
        p.slug === `week/${TUE_KEY}` &&
        (p as { timeline?: { summary: string }[] }).timeline?.[0]?.summary.startsWith('debrief:')
    )
    expect(page).toBeDefined()

    awake(TUE(18, 20)) // once per evening
    expect(nudges('debrief')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000) // drain the chat batcher
  })

  it('inside quiet hours the story waits in the queue like every other nudge', async () => {
    await fresh(TUE(9, 40))
    awake(TUE(18, 45)) // quiet hours began 18:30 — close-loop queues
    awake(TUE(18, 46)) // debrief queues behind it
    const queued = useMew.getState().queuedNudges
    expect(queued.some((m) => m.nudgeType === 'debrief')).toBe(true)
    expect(nudges('debrief')).toHaveLength(0) // chat stays quiet
  })
})

/* ── week-in-review: Monday opens with last week's truth ─────────────── */

describe('week-in-review (fresh-start upgraded)', () => {
  const MON = (h: number, m = 0) => new Date(2026, 5, 8, h, m)

  it('seeded Monday: the opener leads with last week and keeps its actions', async () => {
    await fresh(MON(9, 0))
    at(MON(9, 1)) // the boot tick carried the morning brief (#285)
    const fs = lastNudge('fresh-start')
    expect(fs).toBeDefined()
    /* the seed's three prior weeks put 7 completions and 3 rolls in last week */
    expect(fs.body).toMatch(/^last week: 7 mews, carry-over 30%/)
    expect(fs.body).toContain('mornings held 5/5')
    expect(fs.body).toContain('Shape this week the same?')
    expect(fs.body).toContain('5.5h of deep work')
    expect(fs.actions?.map((a) => a.id)).toEqual(['shape', 'later'])
    expect(fs.body).not.toMatch(/missed|overdue|failed/)
  })

  it('week one (empty history): the original Monday copy, no invented claims', async () => {
    await fresh(MON(9, 0))
    /* wipe history and let the engine re-open the day fresh — the morning
       brief keeps its once-a-day key (#285) so the tick belongs to the opener */
    useMew.setState((st) => ({
      memory: [],
      chat: st.chat.filter((m) => m.nudgeType !== 'fresh-start'),
      engine: {
        lastFired: { 'morning-brief': st.engine.lastFired['morning-brief'] },
        lastDriftBlockId: null,
      },
      lastActivityMs: MON(9, 5).getTime(),
    }))
    at(MON(9, 5))
    const fs = lastNudge('fresh-start')
    expect(fs).toBeDefined()
    expect(fs.body).toMatch(/^Monday — a new accounting period/)
    expect(fs.body).not.toContain('last week:')
  })
})

/* ── pre-meeting recall: a heads-up before fixed blocks with people ──── */

describe('heads-up (pre-meeting recall)', () => {
  /* the seeded week puts "1:1 with Dana" two days out at 13:00 */
  const THU = (h: number, m = 0) => new Date(2026, 5, 11, h, m)
  const drain = () => vi.advanceTimersByTimeAsync(0)

  it('fetches recall for the imminent fixed block only, once, and speaks the lines verbatim', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.reset()
    brainFake.recallImpl = () => [
      'task/q3-deck — last 1:1 ran over +20m',
      'person/dana — asked for the roadmap pre-read',
    ]
    at(THU(12, 46)) // 14 min out: inside the fetch window, before the speak window
    await drain()
    const danaQueries = brainFake.recalls.filter((q) => q.includes('dana'))
    expect(danaQueries).toHaveLength(1)
    expect(danaQueries[0]).toContain('person dana')
    expect(nudges('heads-up')).toHaveLength(0) // information waits for its moment

    at(THU(12, 50)) // 10 min out — the heads-up window
    await drain()
    expect(brainFake.recalls.filter((q) => q.includes('dana'))).toHaveLength(1) // cached, not re-asked
    const hu = nudges('heads-up')
    expect(hu).toHaveLength(1)
    expect(hu[0].body).toContain('task/q3-deck — last 1:1 ran over +20m')
    expect(hu[0].body).toContain('person/dana — asked for the roadmap pre-read')
    expect(hu[0].body).not.toMatch(/missed|overdue|failed/)

    at(THU(12, 52)) // still in the window — the per-block key holds it to once
    expect(nudges('heads-up')).toHaveLength(1)
  })

  it('a failed recall is silence, never an error in chat', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.reset()
    brainFake.recallImpl = () => {
      throw new Error('brain unreachable')
    }
    at(THU(12, 46))
    await drain()
    at(THU(12, 50))
    await drain()
    expect(brainFake.recalls.length).toBeGreaterThan(0) // it did ask
    expect(nudges('heads-up')).toHaveLength(0) // and said nothing
    expect(chat().some((m) => /unreachable|error/i.test(m.body))).toBe(false)
  })

  it('brain off: the brain is never asked and the nudge never exists', async () => {
    await fresh(TUE(9, 40))
    brainFake.reset()
    at(THU(12, 50))
    await drain()
    expect(brainFake.recalls).toHaveLength(0)
    expect(nudges('heads-up')).toHaveLength(0)
  })
})

/* ── project rollups: history questions answered with real numbers ───── */

describe('queryBrain (project rollups)', () => {
  it('"how much has spicanova eaten this week" sums the real blocks', async () => {
    await fresh(TUE(9, 40))
    await say('block 1h for prep for Spicanova today at 15')
    await say('block 90m for deck for Spicanova tomorrow at 9')
    const done = useMew.getState().blocks.find((b) => /prep for spicanova/i.test(b.title))!
    useMew.getState().toggleComplete(done.id)
    const reply = await useMew.getState().queryBrain('how much has spicanova eaten this week')
    expect(reply).toContain('2.5h across 2 blocks')
    expect(reply).toContain('1h done')
    expect(reply).toContain('1.5h still open')
    expect(reply).not.toMatch(/missed|overdue|failed/)
  })

  it('unknown project: honest "can\'t see", no invented numbers', async () => {
    await fresh(TUE(9, 40))
    const reply = await useMew.getState().queryBrain('how much has nebulon eaten this week')
    expect(reply).toMatch(/can't see nebulon yet/i)
    expect(reply).not.toMatch(/\d+h/)
  })

  it('brain on: recall lines ride under the real numbers', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.recallLines = ['project/spicanova — kickoff ran over +20m']
    await say('block 1h for prep for Spicanova today at 15')
    const reply = await useMew.getState().queryBrain('how much has spicanova eaten this week')
    expect(reply).toContain('1h across 1 block')
    expect(reply).toContain('kickoff ran over +20m')
    await vi.advanceTimersByTimeAsync(60_000) // drain the chat batcher
  })

  it('completing a project-named block links its task page to the project', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.reset()
    /* proper-cased title (a remote-model placement keeps user casing; the
       keyless floor lowercases, which deliberately cannot declare projects) */
    const b = {
      id: 'spica-1',
      title: 'Deck for Spicanova',
      tag: 'work' as const,
      dayKey: dayKey(TUE(9, 40)),
      startMin: 15 * 60,
      endMin: 16 * 60,
      protected: false,
      status: 'open' as const,
      calendarRefs: [],
      estimateSource: 'user' as const,
    }
    useMew.setState((st) => ({ blocks: [...st.blocks, b] }))
    useMew.getState().toggleComplete('spica-1')
    await vi.advanceTimersByTimeAsync(0)
    const task = brainFake.ingests.find((p) => p.slug === 'task/deck-for-spicanova')
    expect(task).toBeDefined()
    expect(task!.links).toContain('project/spicanova')
    await vi.advanceTimersByTimeAsync(60_000)
  })
})

/* ── past weeks (#249 fix 2): history persists forever, so "last week"
   answers with real sums — brain OFF — and the reply names its week ──── */

describe('queryBrain (past weeks)', () => {
  /* the canonical week is Mon Jun 8 – Sun Jun 14; last week = Jun 1–7 */
  const gymDone = (id: string, day: string) => ({
    id,
    title: 'Gym — strength',
    tag: 'health' as const,
    dayKey: day,
    startMin: 7 * 60,
    endMin: 9 * 60 + 30, // 2.5h, twice → the 5h the reply sums
    protected: false,
    status: 'done' as const,
    calendarRefs: [],
    estimateSource: 'user' as const,
  })
  const seedLastWeekGym = () =>
    useMew.setState((st) => ({
      blocks: [...st.blocks, gymDone('gym-lw-1', '2026-06-03'), gymDone('gym-lw-2', '2026-06-05')],
    }))

  it('"how much time did gym take last week" sums the past week and names it', async () => {
    await fresh(TUE(9, 40))
    seedLastWeekGym()
    const reply = await useMew.getState().queryBrain('how much time did gym take last week')
    expect(reply).toContain('gym last week: 5h across 2 blocks')
    expect(reply).toContain('5h done')
    expect(reply).not.toContain('still open') // the week finished clean — no 0h tail
    expect(reply).not.toContain('this week')
    expect(reply).not.toMatch(/missed|overdue|failed/)
  })

  it('the field phrasing works brain-off: "how were my gym sessions last week"', async () => {
    await fresh(TUE(9, 40))
    brainFake.reset()
    seedLastWeekGym()
    const reply = await useMew.getState().queryBrain('how were my gym sessions last week?')
    expect(reply).toContain('gym last week: 5h across 2 blocks')
    expect(reply).not.toContain('or the brain')
    expect(brainFake.recalls).toHaveLength(0) // never asked — the sums are local
  })

  it('no time phrase still means the live week', async () => {
    await fresh(TUE(9, 40))
    /* 5h of pottery sit in LAST week; only today's 1h may answer (the seed
       holds no pottery, so the sums are exact) */
    useMew.setState((st) => ({
      blocks: [
        ...st.blocks,
        { ...gymDone('pot-lw-1', '2026-06-03'), title: 'Pottery' },
        { ...gymDone('pot-lw-2', '2026-06-05'), title: 'Pottery' },
      ],
    }))
    await say('block 1h for pottery today at 15')
    const reply = await useMew.getState().queryBrain('how much time on pottery')
    expect(reply).toContain('pottery this week: 1h across 1 block')
    expect(reply).not.toContain('5h')
  })

  it('an empty past week is honest and names the week it looked at', async () => {
    await fresh(TUE(9, 40))
    seedLastWeekGym() // data sits in week -1, the question asks about -2
    const reply = await useMew.getState().queryBrain('how much time did gym take two weeks ago')
    expect(reply).toMatch(/can't see gym two weeks ago/i)
    expect(reply).toContain("that week's blocks")
    expect(reply).not.toContain("this week's")
    expect(reply).not.toMatch(/missed|overdue|failed/)
  })

  it('brain on: recall rides under past-week sums, asked with the question verbatim', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.reset()
    brainFake.recallLines = ['task/gym — fridays run heavy']
    seedLastWeekGym()
    const reply = await useMew.getState().queryBrain('how much time did gym take last week')
    expect(reply).toContain('gym last week: 5h across 2 blocks')
    expect(reply).toContain('fridays run heavy')
    expect(brainFake.recalls[0]).toContain('last week') // the brain hears the week phrase
    await vi.advanceTimersByTimeAsync(60_000) // drain the chat batcher
  })

  it('a pronoun or quantifier before "sessions" is never a subject — honest, not a wrong sum', async () => {
    await fresh(TUE(9, 40))
    /* "many" hides inside germany, "my" inside anatomy — the substring
       rollup must never be reached with a bare function word */
    useMew.setState((st) => ({
      blocks: [
        ...st.blocks,
        { ...gymDone('de-lw-1', '2026-06-03'), title: 'Germany trip planning' },
        { ...gymDone('an-lw-1', '2026-06-05'), title: 'Anatomy study' },
      ],
    }))
    const many = await useMew.getState().queryBrain('how many sessions did I do last week')
    expect(many).toMatch(/can't see that last week/i) // not Germany's 2.5h
    expect(many).not.toMatch(/\dh across/)
    const my = await useMew.getState().queryBrain('how were my sessions last week?')
    expect(my).toMatch(/can't see that last week/i) // not Anatomy's 2.5h
    expect(my).not.toMatch(/\dh across/)
  })

  it('a block NAMED with week words, asked by name, is the subject — live week, no mis-window', async () => {
    await fresh(TUE(9, 40))
    useMew.setState((st) => ({
      blocks: [
        ...st.blocks,
        {
          ...gymDone('lwr-1', dayKey(TUE(9, 40))),
          title: 'Last week review',
          startMin: 10 * 60,
          endMin: 11 * 60,
        },
      ],
    }))
    const reply = await useMew.getState().queryBrain('how much time did last week review take?')
    expect(reply).toContain('Last week review this week: 1h across 1 block')
    expect(reply).toContain('1h done')
  })

  it('a subject containing "take" keeps its full name — never shrunk to "the"', async () => {
    await fresh(TUE(9, 40))
    useMew.setState((st) => ({
      blocks: [
        ...st.blocks,
        {
          ...gymDone('to-tw-1', dayKey(TUE(9, 40))),
          title: 'The take out order',
          startMin: 12 * 60,
          endMin: 13 * 60,
        },
        {
          ...gymDone('to-lw-1', '2026-06-04'),
          title: 'The take out order',
          startMin: 12 * 60,
          endMin: 13 * 60,
        },
      ],
    }))
    /* current-week phrasing rides the pre-existing verb list — byte-identical */
    const eaten = await useMew
      .getState()
      .queryBrain('how much time has the take out order eaten this week')
    expect(eaten).toContain('the take out order this week: 1h across 1 block')
    /* duration shape: the FINAL "take" is the verb, the noun keeps its "take" */
    const took = await useMew
      .getState()
      .queryBrain('how much time did the take out order take last week')
    expect(took).toContain('the take out order last week: 1h across 1 block')
    expect(took).toContain('1h done')
  })
})

/* ── calendar agency: chat can take over imported events ──────────────── */

describe('calendar agency — chat takes over imported events', () => {
  const ext = (over: Record<string, unknown> = {}) => ({
    id: 'cal-1',
    title: 'standup',
    tag: 'work' as const,
    dayKey: dayKey(TUE(10, 0)),
    startMin: 9 * 60,
    endMin: 9 * 60 + 30,
    protected: false,
    status: 'open' as const,
    calendarRefs: ['work@acme'],
    estimateSource: 'user' as const,
    external: { calId: 'work@acme', eventId: 'ev-standup' },
    ...over,
  })

  it('moving an imported event detaches it and tombstones the source', async () => {
    await fresh(TUE(10, 0))
    useMew.setState((st) => ({ blocks: [...st.blocks, ext()] }))
    await say('move standup to thursday')
    const b = useMew.getState().blocks.find((x) => x.id === 'cal-1')
    expect(b).toBeDefined()
    expect(b!.external).toBeUndefined() // taken over — no longer the calendar's
    expect(b!.dayKey).not.toBe(dayKey(TUE(10, 0)))
    expect(useMew.getState().settings.dismissedEvents).toContain('work@acme:ev-standup')
  })

  it('deleting an imported event removes it and tombstones it', async () => {
    await fresh(TUE(10, 0))
    useMew.setState((st) => ({ blocks: [...st.blocks, ext()] }))
    // seed already holds "Team standup" at 11:30 — the start time pins the
    // imported 9:00 one, so only it is dropped (and tombstoned)
    await say('delete standup at 9')
    expect(useMew.getState().blocks.find((x) => x.id === 'cal-1')).toBeUndefined()
    expect(useMew.getState().settings.dismissedEvents).toContain('work@acme:ev-standup')
    expect(useMew.getState().blocks.find((b) => /Team standup/.test(b.title))).toBeDefined()
  })

  it('marking an imported event done keeps it — status survives a re-sync', async () => {
    await fresh(TUE(10, 0))
    useMew.setState((st) => ({ blocks: [...st.blocks, ext()] }))
    await say('done with standup')
    expect(useMew.getState().blocks.find((x) => x.id === 'cal-1')!.status).toBe('done')
  })
})

/* ── entity-aware durations: this task's real median sizes the block ──── */

describe('entity-aware durations', () => {
  const TUE_KEY = '2026-06-09'
  const prepDone = (daysAgo: number, actualMin: number) => {
    const day = addDaysKey(TUE_KEY, -daysAgo)
    const d = new Date(day + 'T00:00:00')
    d.setMinutes(9 * 60 + actualMin)
    return {
      id: `prep-${daysAgo}`,
      ts: d.getTime(),
      kind: 'completed' as const,
      dayKey: day,
      title: 'Interview prep',
      startMin: 9 * 60,
      plannedMin: 60,
    }
  }

  it('three 40-minute preps make "block interview prep tomorrow" a 40-minute block, credited', async () => {
    await fresh(TUE(9, 40))
    useMew.setState((st) => ({
      memory: [...st.memory, prepDone(2, 40), prepDone(5, 40), prepDone(9, 40)],
    }))
    await say('block interview prep tomorrow')
    const placed = useMew
      .getState()
      .blocks.find((b) => /interview prep/i.test(b.title) && b.status === 'open')
    expect(placed).toBeDefined()
    expect(placed!.endMin - placed!.startMin).toBe(40)
    /* the credit rides the plan reply; the day-load meter (#301) follows it
       on the seeded-heavy tomorrow — find the reply, don't pin "last" */
    const reply = chat().find((m) => m.role === 'mew' && /^Done — /.test(m.body))
    expect(reply?.body).toContain('(your usual)')
  })

  it('an explicit duration always wins over the usual', async () => {
    await fresh(TUE(9, 40))
    useMew.setState((st) => ({
      memory: [...st.memory, prepDone(2, 40), prepDone(5, 40), prepDone(9, 40)],
    }))
    /* 50m fits tomorrow's 60-minute gap; 40 is the usual — explicit wins */
    await say('block 50m for interview prep tomorrow')
    const placed = useMew
      .getState()
      .blocks.find((b) => /interview prep/i.test(b.title) && b.status === 'open')
    expect(placed!.endMin - placed!.startMin).toBe(50)
    expect(lastMsg().body).not.toContain('(your usual)')
  })

  it('two preps are an anecdote: the 60-minute floor stands, uncredited', async () => {
    await fresh(TUE(9, 40))
    useMew.setState((st) => ({ memory: [...st.memory, prepDone(2, 40), prepDone(5, 40)] }))
    await say('block interview prep tomorrow')
    const placed = useMew
      .getState()
      .blocks.find((b) => /interview prep/i.test(b.title) && b.status === 'open')
    expect(placed!.endMin - placed!.startMin).toBe(60)
    expect(lastMsg().body).not.toContain('(your usual)')
  })
})

/* ── cross-agent recall: scope is opt-in, default narrow ─────────────── */

describe('recall scope (cross-agent)', () => {
  it('defaults to MEW-only, round-trips through settings, and rides every recall', async () => {
    await fresh(TUE(9, 40))
    expect(useMew.getState().settings.brainScope).toBe('mew')
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.reset()
    await say('what does tomorrow look like')
    expect(brainFake.recallOpts.length).toBeGreaterThan(0)
    expect(brainFake.recallOpts[0].scope).toBe('mew')

    useMew.getState().updateSettings({ brainScope: 'all' })
    expect(useMew.getState().settings.brainScope).toBe('all')
    brainFake.reset()
    await say('what shipped last week')
    expect(brainFake.recallOpts[0].scope).toBe('all')
    await vi.advanceTimersByTimeAsync(60_000) // drain the chat batcher
  })
})

/* ── desktop self-update (phase 4 of the shell) ──────────────────────── */

describe('desktop self-update', () => {
  it('a staged update becomes a quiet chat offer; install runs only on accept', async () => {
    await fresh(TUE(9, 40))
    desktopFake.applied = 0
    desktopFake.updateReady?.('0.2.0')
    const offer = nudges('update')
    expect(offer).toHaveLength(1)
    expect(offer[0].body).toContain('v0.2.0')
    expect(offer[0].body).toMatch(/restart when you like/)
    expect(desktopFake.applied).toBe(0) // staged ≠ installed: never on its own

    useMew.getState().nudgeAction(offer[0].id, 'restart')
    await vi.advanceTimersByTimeAsync(0)
    expect(desktopFake.applied).toBe(1)
  })

  it('announced before hydration, the offer waits for chat to exist', async () => {
    useMew.setState({ hydrated: false })
    desktopFake.updateReady?.('0.3.0')
    await fresh(TUE(9, 40))
    expect(nudges('update')).toHaveLength(1)
    expect(nudges('update')[0].body).toContain('v0.3.0')
  })

  it('"not now" keeps the current version running and resolves the nudge', async () => {
    await fresh(TUE(9, 40))
    desktopFake.applied = 0
    desktopFake.updateReady?.('0.2.0')
    const offer = nudges('update')[0]
    useMew.getState().nudgeAction(offer.id, 'later')
    await vi.advanceTimersByTimeAsync(0)
    expect(desktopFake.applied).toBe(0)
    expect(chat().find((m) => m.id === offer.id)?.resolved).toBeTruthy()
  })

  it('"not now" never falls through into a backup-restore', async () => {
    /* the update arm sat above restore:accept with no break — "later" silently
       ran readBackup + importData, wiping the live week with a stale backup.
       Seed a backup that would inject a block; "later" must leave it untouched. */
    const ghost = {
      id: uid(),
      title: 'the backup ghost — should never restore',
      tag: 'work',
      dayKey: dayKey(TUE(9)),
      startMin: 9 * 60,
      endMin: 10 * 60,
      status: 'open',
    }
    desktopFake.tauri = true
    desktopFake.backup = JSON.stringify({
      blocks: [ghost],
      captures: [],
      chat: [],
      memory: [],
      settings: null,
    })
    await fresh(TUE(9, 40))
    desktopFake.updateReady?.('0.2.0')
    const offer = nudges('update')[0]
    useMew.getState().nudgeAction(offer.id, 'later')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(useMew.getState().blocks.some((b) => b.title === ghost.title)).toBe(false)
  })
})

/* ── the attention model: background blocks, due, start-by ───────────── */

describe('background attention through the keyless floor', () => {
  it('"swap iphone 3h in the background due 1pm" round-trips into the real block', async () => {
    await fresh(TUE(9, 40))
    await say('swap iphone 3h in the background due 1pm')
    const b = useMew.getState().blocks.find((x) => /swap iphone/i.test(x.title))!
    expect(b).toBeDefined()
    expect(b.attention).toBe('background')
    expect(b.due).toBe(780)
    expect(b.endMin - b.startMin).toBe(180)
    expect(lastMsg().body).toMatch(/running in the background/)
    expect(lastMsg().body).toMatch(/due 13:00/)
  })

  it('a meeting placed over a live background block: no clash note, meeting owns the center', async () => {
    await fresh(TUE(9, 40))
    /* clear the seeded morning so only the background block holds 9–12 */
    await say('clear today')
    await say('swap iphone 3h in the background at 9')
    await say('block 1h for design sync today at 10')
    const reply = lastMsg().body
    expect(reply).toMatch(/^Done — /)
    expect(reply).not.toMatch(/overlap/i)

    const { liveNow } = await import('../../domain/liveNow')
    const s = useMew.getState()
    const live = liveNow(s.blocks, dayKey(TUE(10, 15)), 10 * 60 + 15)
    expect(live.current?.title).toMatch(/design sync/i)
    expect(live.headline).not.toMatch(/iphone/i)
  })

  it('with only background running, the center reads "Nothing holds you."', async () => {
    await fresh(TUE(9, 40))
    await say('clear today')
    await say('swap iphone 3h in the background at 9')
    const { liveNow } = await import('../../domain/liveNow')
    const s = useMew.getState()
    const live = liveNow(s.blocks, dayKey(TUE(10, 0)), 10 * 60)
    expect(live.headline).toBe('Nothing holds you.')
    expect(live.meta[0]).toMatch(/everything is running on its own/)
  })

  it('start-by fires once at the latest-start boundary; accepting starts the block', async () => {
    await fresh(TUE(9, 40))
    await say('clear today')
    /* 2h job due 13:00 → latest start 11:00; warning opens after 10:50 */
    await say('data export 2h in the background due 1pm')
    at(TUE(10, 45))
    expect(nudges('start-by')).toHaveLength(0)
    at(TUE(10, 55))
    const fired = nudges('start-by')
    expect(fired).toHaveLength(1)
    expect(fired[0].body).toMatch(/start data export by 11:00 or it misses 13:00/)
    at(TUE(10, 58)) // ticks again inside the window — once means once
    expect(nudges('start-by')).toHaveLength(1)

    act(fired[0], 'start')
    const b = useMew.getState().blocks.find((x) => /data export/i.test(x.title))!
    expect(b.startedAt).not.toBeNull()
    expect(b.startMin).toBe(10 * 60 + 58) // startNow moves it to the accept-moment clock
  })

  it('acknowledging leaves everything unstarted — suggest, never seize', async () => {
    await fresh(TUE(9, 40))
    await say('clear today')
    await say('data export 2h in the background due 1pm')
    at(TUE(10, 55))
    const offer = nudges('start-by')[0]
    act(offer, 'ack')
    const b = useMew.getState().blocks.find((x) => /data export/i.test(x.title))!
    expect(b.startedAt).toBeUndefined()
    expect(chat().find((m) => m.id === offer.id)?.resolved).toBeTruthy()
  })
})

/* ── orbit promotion/demotion — clicks write attention ───────────────── */

describe('setAttention (one-click priority from the orbit)', () => {
  it('demote then promote round-trips through liveNow (the center swap)', async () => {
    await fresh(TUE(9, 40))
    const { liveNow } = await import('../../domain/liveNow')
    const s0 = useMew.getState()
    const deck = s0.blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(9, 40)))!
    expect(liveNow(s0.blocks, dayKey(TUE(9, 40)), 9 * 60 + 40).current?.id).toBe(deck.id)

    useMew.getState().setAttention(deck.id, 'background')
    const demoted = liveNow(useMew.getState().blocks, dayKey(TUE(9, 40)), 9 * 60 + 40)
    expect(demoted.current).toBeUndefined()
    expect(demoted.headline).toBe('Nothing holds you.')

    useMew.getState().setAttention(deck.id, 'focus')
    const promoted = liveNow(useMew.getState().blocks, dayKey(TUE(9, 40)), 9 * 60 + 40)
    expect(promoted.current?.id).toBe(deck.id)
  })

  it('is quiet (no chat) and idempotent', async () => {
    await fresh(TUE(9, 40))
    const before = chat().length
    const deck = useMew
      .getState()
      .blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(9, 40)))!
    useMew.getState().setAttention(deck.id, 'background')
    useMew.getState().setAttention(deck.id, 'background') // no-op
    expect(chat().length).toBe(before)
    expect(useMew.getState().blocks.find((b) => b.id === deck.id)!.attention).toBe('background')
  })
})

/* ── the thread rail's "place": a capture lands like when-where's accept ── */

describe('placeCapture (loose-threads rail)', () => {
  it('lands an open capture in the first 30-min slot after now+15 and tells the chat', async () => {
    await fresh(TUE(9, 40))
    await say('call the bank')
    const cap = useMew.getState().captures.find((c) => /call the bank/i.test(c.title))!
    expect(cap.status).toBe('open')

    useMew.getState().placeCapture(cap.id)
    const after = useMew.getState()
    const placedCap = after.captures.find((c) => c.id === cap.id)!
    expect(placedCap.status).toBe('placed')
    const block = after.blocks.find((b) => b.id === placedCap.placedBlockId)!
    expect(block.endMin - block.startMin).toBe(30)
    expect(block.startMin).toBeGreaterThanOrEqual(9 * 60 + 55) // now+15, rounded into free air
    expect(lastMsg().body).toMatch(/^Placed — "call the bank" lives/)
  })

  it('is idempotent: placing a placed capture does nothing', async () => {
    await fresh(TUE(9, 40))
    await say('call the bank')
    const cap = useMew.getState().captures.find((c) => /call the bank/i.test(c.title))!
    useMew.getState().placeCapture(cap.id)
    const blocksAfterFirst = useMew.getState().blocks.length
    useMew.getState().placeCapture(cap.id)
    expect(useMew.getState().blocks.length).toBe(blocksAfterFirst)
  })
})

/* ── desktop auto-backup + first-boot restore (phase 2 of the shell) ── */

describe('desktop backup & restore', () => {
  const drain = () => vi.advanceTimersByTimeAsync(0)

  it('web build never offers a restore and never writes a backup', async () => {
    desktopFake.backup = JSON.stringify({
      blocks: [],
      captures: [],
      chat: [],
      memory: [],
      settings: null,
    })
    await fresh(TUE(9, 40))
    await drain()
    expect(nudges('restore')).toHaveLength(0)
    await useMew.getState().speak('block 1h for spec review today at 15')
    await vi.advanceTimersByTimeAsync(31_000)
    expect(desktopFake.written).toHaveLength(0)
  })

  it('first boot on an empty DB offers the disk backup; accept round-trips the week', async () => {
    const restored = {
      id: uid(),
      title: 'the restored block — deep work',
      tag: 'work',
      dayKey: dayKey(TUE(9)),
      startMin: 9 * 60,
      endMin: 10 * 60,
      status: 'open',
    }
    desktopFake.tauri = true
    desktopFake.backup = JSON.stringify({
      blocks: [restored],
      captures: [],
      chat: [],
      memory: [],
      settings: null,
    })
    desktopFake.backupDate = '2026-06-08'

    await fresh(TUE(9, 40))
    await drain()
    const offer = nudges('restore')
    expect(offer).toHaveLength(1)
    expect(offer[0].body).toContain('2026-06-08')
    expect(offer[0].body).toContain('Documents/MEW')
    /* suggest, don't seize: the seeded week is still standing */
    expect(useMew.getState().blocks.some((b) => b.title === restored.title)).toBe(false)

    useMew.getState().nudgeAction(offer[0].id, 'accept')
    await drain()
    await drain()
    expect(useMew.getState().blocks.some((b) => b.title === restored.title)).toBe(true)
    expect(lastMsg().body).toMatch(/^Restored —/)
  })

  it('declining the offer keeps the fresh week and resolves the nudge', async () => {
    desktopFake.tauri = true
    desktopFake.backup = JSON.stringify({
      blocks: [],
      captures: [],
      chat: [],
      memory: [],
      settings: null,
    })
    await fresh(TUE(9, 40))
    await drain()
    const offer = nudges('restore')[0]
    useMew.getState().nudgeAction(offer.id, 'decline')
    await drain()
    const resolved = chat().find((m) => m.id === offer.id)
    expect(resolved?.resolved).toBeTruthy()
    expect(useMew.getState().blocks.length).toBeGreaterThan(0) // seed stands
  })

  it('changes coalesce into one keys-stripped snapshot 30s later', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    await drain()
    useMew.getState().updateSettings({ anthropicKey: 'sk-secret', mewName: 'Pixie' })
    await useMew.getState().speak('block 1h for spec review today at 15')
    await useMew.getState().speak('block 30m for inbox today at 16:30')
    expect(desktopFake.written).toHaveLength(0) // debounce window still open
    await vi.advanceTimersByTimeAsync(30_000)
    expect(desktopFake.written).toHaveLength(1) // coalesced
    const snapshot = JSON.parse(desktopFake.written[0])
    expect(snapshot.blocks.length).toBeGreaterThan(0)
    expect(snapshot.settings.anthropicKey).toBe('') // keys never travel
    /* next change opens a fresh window */
    await useMew.getState().speak('block 30m for review today at 17:30')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(desktopFake.written).toHaveLength(2)
  })
})

/* ── brain engine choice: three doors, one wire contract ─────────────── */

describe('brain mode setting', () => {
  it('round-trips through settings persistence with the merge-defaults backfill', async () => {
    await fresh(TUE(9, 40))
    expect(useMew.getState().settings.brainMode).toBe('endpoint') // the default
    useMew.getState().updateSettings({
      brainMode: 'supabase',
      brainEnabled: true,
      brainUrl: 'https://brain.example.dev',
      brainToken: 'mew-serve-key', // the serve's API key — persists locally, never rides in backups
    })
    expect(useMew.getState().settings.brainMode).toBe('supabase')
    /* a fresh hydrate from the same storage keeps the choice */
    await useMew.getState().hydrate()
    expect(useMew.getState().settings.brainMode).toBe('supabase')
    expect(useMew.getState().settings.brainUrl).toBe('https://brain.example.dev')
    expect(useMew.getState().settings.brainToken).toBe('mew-serve-key')
    await vi.advanceTimersByTimeAsync(60_000) // drain any batcher window
  })

  it('mode is presentation; placement is mode-independent and never waits on the brain', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainMode: 'supabase', brainEnabled: true })
    await say('block 30m for inbox today at 15')
    expect(useMew.getState().blocks.some((b) => /inbox/i.test(b.title))).toBe(true) // the week never blocks
    await vi.advanceTimersByTimeAsync(60_000)
  })
})

/* ── interface font setting: presentation-only, persisted, backfilled ──── */

describe('interface font setting', () => {
  it('defaults to hanken so existing users see no change', async () => {
    await fresh(TUE(9, 40))
    expect(useMew.getState().settings.uiFont).toBe('hanken')
  })

  it('round-trips an override through settings persistence', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ uiFont: 'open-sans' })
    expect(useMew.getState().settings.uiFont).toBe('open-sans')
    /* a fresh hydrate from the same storage keeps the choice */
    await useMew.getState().hydrate()
    expect(useMew.getState().settings.uiFont).toBe('open-sans')
    await vi.advanceTimersByTimeAsync(60_000) // drain any batcher window
  })

  it('backfills the default when a pre-uiFont snapshot is restored', async () => {
    await fresh(TUE(9, 40))
    /* a backup written before this field existed — restore must not crash and
       the merge-defaults backfill fills uiFont with the default */
    const legacy = { ...useMew.getState().settings } as Partial<Settings>
    delete legacy.uiFont
    await useMew.getState().importData(JSON.stringify({ settings: legacy }))
    expect(useMew.getState().settings.uiFont).toBe('hanken')
    await vi.advanceTimersByTimeAsync(60_000)
  })
})

/* ── first-run concept tour gate (#160) ──────────────────────────────── */

describe('onboarding tour first-run flag', () => {
  it('defaults to unseen on a fresh seed so the tour shows once', async () => {
    await fresh(TUE(9, 40))
    expect(useMew.getState().settings.hasSeenOnboarding).toBe(false)
  })

  it('dismiss sets the flag, persists it, and a reload keeps the tour gone', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().dismissOnboarding()
    expect(useMew.getState().settings.hasSeenOnboarding).toBe(true)
    expect(fakeDb.settings?.hasSeenOnboarding).toBe(true) // written to storage
    /* re-hydrate from the same storage — the tour must not reappear */
    await useMew.getState().hydrate()
    expect(useMew.getState().settings.hasSeenOnboarding).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
  })

  it('dismiss is idempotent — already-seen never re-persists', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().dismissOnboarding()
    fakeDb.settings = null // prove a second dismiss writes nothing new
    useMew.getState().dismissOnboarding()
    expect(fakeDb.settings).toBeNull()
    expect(useMew.getState().settings.hasSeenOnboarding).toBe(true)
  })

  it('backfills the default when a pre-onboarding snapshot is restored', async () => {
    await fresh(TUE(9, 40))
    /* a backup written before this field existed — the tour treats a missing
       flag as unseen, so a returning user gets the one-time tour, never a crash */
    const legacy = { ...useMew.getState().settings } as Partial<Settings>
    delete legacy.hasSeenOnboarding
    await useMew.getState().importData(JSON.stringify({ settings: legacy }))
    expect(useMew.getState().settings.hasSeenOnboarding).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
  })
})

/* ── onboarding v2 guided cursor (#306) ──────────────────────────────── */

describe('onboarding v2 guided steps (#306)', () => {
  it('advance walks tour → keys → calendar → plan, gate still closed', async () => {
    await fresh(TUE(9, 40))
    expect(useMew.getState().onboardingStep).toBe('tour')
    useMew.getState().advanceOnboarding()
    expect(useMew.getState().onboardingStep).toBe('keys')
    useMew.getState().advanceOnboarding()
    expect(useMew.getState().onboardingStep).toBe('calendar')
    useMew.getState().advanceOnboarding()
    expect(useMew.getState().onboardingStep).toBe('plan')
    expect(useMew.getState().settings.hasSeenOnboarding).toBe(false) // nothing completed yet
    await vi.advanceTimersByTimeAsync(60_000)
  })

  it('advancing past plan completes onboarding and resets the (non-persisted) cursor', async () => {
    await fresh(TUE(9, 40))
    for (let i = 0; i < 3; i++) useMew.getState().advanceOnboarding() // → plan
    expect(useMew.getState().onboardingStep).toBe('plan')
    useMew.getState().advanceOnboarding() // plan → done
    expect(useMew.getState().settings.hasSeenOnboarding).toBe(true)
    expect(fakeDb.settings?.hasSeenOnboarding).toBe(true)
    expect(useMew.getState().onboardingStep).toBe('tour')
    await vi.advanceTimersByTimeAsync(60_000)
  })

  it('every step’s "later" leaves clean defaults — no key, no client ID written', async () => {
    await fresh(TUE(9, 40))
    const before = useMew.getState().settings
    for (let i = 0; i < 4; i++) useMew.getState().advanceOnboarding() // walk all the way through
    const after = useMew.getState().settings
    expect(after.anthropicKey).toBe(before.anthropicKey) // keyless floor intact
    expect(after.openaiKey).toBe(before.openaiKey)
    expect(after.googleClientId).toBe(before.googleClientId) // local-only intact
    expect(after.planMode).toBe(before.planMode)
    expect(after.hasSeenOnboarding).toBe(true) // the only thing that flips is the gate
    await vi.advanceTimersByTimeAsync(60_000)
  })

  it('skip-all mid-flow resets the cursor and closes for good', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().advanceOnboarding() // → keys
    useMew.getState().advanceOnboarding() // → calendar
    useMew.getState().dismissOnboarding() // "Skip all"
    expect(useMew.getState().onboardingStep).toBe('tour')
    expect(useMew.getState().settings.hasSeenOnboarding).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
  })
})

/* ── preferences change mechanics, not just prose ────────────────────── */

describe('prefs applied at placement', () => {
  it('gym → 07:00 set: "add gym tomorrow" auto-places at 07:00 and credits the rule', async () => {
    await fresh(TUE(9, 40))
    await say('remember that gym is always at 7am')
    await say('add gym tomorrow')
    const tomorrow = addDaysKey(dayKey(TUE(9, 40)), 1)
    const gym = useMew.getState().blocks.find((b) => b.dayKey === tomorrow && /gym/i.test(b.title))!
    expect(gym.startMin).toBe(7 * 60)
    expect(lastMsg().body).toContain('(your standing rule)')
  })

  it('explicit wins: "add gym tomorrow at 6pm" places 18:00, no credit', async () => {
    await fresh(TUE(9, 40))
    await say('remember that gym is always at 7am')
    await say('add gym tomorrow at 6pm')
    const tomorrow = addDaysKey(dayKey(TUE(9, 40)), 1)
    const gym = useMew.getState().blocks.find((b) => b.dayKey === tomorrow && /gym/i.test(b.title))!
    expect(gym.startMin).toBe(18 * 60)
    expect(lastMsg().body).not.toContain('standing rule')
  })

  it('duration-default sizes an unstated block', async () => {
    await fresh(TUE(9, 40))
    await say('remember the deploy always takes 45 min')
    await say('add deploy tomorrow at 9')
    const tomorrow = addDaysKey(dayKey(TUE(9, 40)), 1)
    const dep = useMew
      .getState()
      .blocks.find((b) => b.dayKey === tomorrow && /deploy/i.test(b.title))!
    expect(dep.endMin - dep.startMin).toBe(45)
  })

  it('move-collision wording follows the rulebook: landing on a pref-flexed sync reads flexible', async () => {
    await fresh(TUE(9, 40))
    await say('remember that the design sync always moves')
    await say('block design sync tomorrow at 10')
    await say('block deck work tomorrow at 14')
    await say('move deck work to tomorrow at 10')
    expect(lastMsg().body).toContain('flexible — offer to drift it')
    expect(lastMsg().body).not.toContain("can't move")
  })
})

/* ── pref-drift: the rulebook follows the life it describes ──────────── */

describe('pref-drift validation', () => {
  /** seed the rule, then live three gym evenings against it */
  async function liveAgainstTheRule() {
    await fresh(TUE(9, 40))
    await say('remember that gym is always at 7am')
    for (const [day, hour] of [
      [-3, 18],
      [-2, 18.5],
      [-1, 19],
    ] as const) {
      useMew.setState((s) => ({
        memory: [
          ...s.memory,
          {
            id: uid(),
            ts: TUE(12).getTime(),
            kind: 'completed' as const,
            dayKey: addDaysKey(dayKey(TUE(9, 40)), day),
            title: 'Gym',
            startMin: hour * 60,
            endMin: hour * 60 + 60,
          },
        ],
      }))
    }
    /* stay "active" so drift never outranks the rulebook check (one nudge
       per tick, priority order). The boot tick carried the morning brief
       (#285), so right-size, the roller, then the rulebook each take one. */
    useMew.setState({ lastActivityMs: TUE(10, 29).getTime() })
    at(TUE(10, 30)) // right-size
    useMew.setState({ lastActivityMs: TUE(10, 59).getTime() })
    at(TUE(11, 0)) // break-smaller (the seeded roller)
    useMew.setState({ lastActivityMs: TUE(11, 29).getTime() })
    at(TUE(11, 30)) // pref-drift
  }

  it('three contradictions → exactly one nudge with live update/keep actions', async () => {
    await liveAgainstTheRule()
    const drifts = nudges('pref-drift')
    expect(drifts).toHaveLength(1)
    expect(drifts[0].body).toContain('your rule says gym starts 07:00')
    expect(drifts[0].actions!.map((a) => a.id)).toEqual(['update', 'keep'])
  })

  it('update rewrites the rule — the rulebook upserts to the observed value', async () => {
    const { prefLinesFrom } = await import('../store')
    await liveAgainstTheRule()
    act(nudges('pref-drift')[0], 'update')
    const lines = prefLinesFrom(useMew.getState().memory, null)
    expect(lines.filter((l) => l.startsWith('gym →'))).toHaveLength(1)
    expect(lines.find((l) => l.startsWith('gym →'))).toContain('starts 18:30')
    expect(lastMsg().body).toBe('Remembered — gym starts 18:30.')
  })

  it('keep resolves quietly and the cooldown holds the peace', async () => {
    await liveAgainstTheRule()
    const offer = nudges('pref-drift')[0]
    act(offer, 'keep')
    expect(chat().find((m) => m.id === offer.id)?.resolved).toBeTruthy()
    useMew.setState({ lastActivityMs: TUE(11, 29).getTime() })
    at(TUE(11, 30))
    useMew.setState({ lastActivityMs: TUE(11, 59).getTime() })
    at(TUE(12, 0))
    expect(nudges('pref-drift')).toHaveLength(1) // no re-fire inside the cooldown
  })
})

describe('scheduler slice 2 — scored placement + de-dup (#80, #89)', () => {
  it('re-planning an existing block moves it instead of leaving a twin (#89)', async () => {
    await fresh(TUE(9, 40))
    await say('block 1h for sprint planning today at 2pm')
    expect(
      useMew
        .getState()
        .blocks.filter((b) => /sprint planning/i.test(b.title) && b.status === 'open')
    ).toHaveLength(1)
    await say('block 1h for sprint planning today at 4pm') // plan-not-move: would have twinned
    const open = useMew
      .getState()
      .blocks.filter((b) => /sprint planning/i.test(b.title) && b.status === 'open')
    expect(open).toHaveLength(1) // moved onto the new slot, no second copy
    expect(open[0].startMin).toBe(16 * 60)
    expect(lastMsg().body.toLowerCase()).toContain('moved')
  })

  it('a distinct errand is never collapsed into a similarly-named block', async () => {
    await fresh(TUE(9, 40))
    await say('block 15m for order lunch today at 11')
    await say('block 45m for lunch today at 1pm')
    const open = useMew.getState().blocks.filter((b) => b.status === 'open')
    expect(open.some((b) => /^order lunch/i.test(b.title.trim()))).toBe(true)
    expect(open.some((b) => b.title.split('—')[0].trim().toLowerCase() === 'lunch')).toBe(true) // both survive
  })

  it('auto-placed work lands in free air, never over an existing block (#80 floor)', async () => {
    await fresh(TUE(9, 40))
    await say('block 1h for standup today at 10am')
    await say('block 1h for deep work today') // no time → the oracle picks a conflict-free slot
    const open = useMew.getState().blocks.filter((b) => b.status === 'open')
    const standup = open.find((b) => /standup/i.test(b.title))!
    const deep = open.find((b) => /deep work/i.test(b.title))!
    expect(deep).toBeDefined()
    const overlaps = deep.startMin < standup.endMin && standup.startMin < deep.endMin
    expect(overlaps).toBe(false)
  })
})

describe('scheduler: honor explicit times, place-then-offer-drift (#102)', () => {
  it('an explicit time lands as asked over a soft conflict and offers to drift, not reshape', async () => {
    await fresh(TUE(9, 40))
    await say('block 1h for deep work today at 2pm') // a flexible work block at 14:00
    await say('block 1h for call with sam today at 2pm') // explicit time, same slot
    const open = useMew.getState().blocks.filter((b) => b.status === 'open')
    // exact-title match — the demo seed carries several "… — deep work" blocks; mine is titled exactly "deep work"
    const call = open.find((b) => b.title.toLowerCase() === 'call with sam')!
    const deep = open.find((b) => b.title.toLowerCase() === 'deep work')!
    expect(call).toBeDefined()
    expect(deep).toBeDefined()
    expect(call.startMin).toBe(14 * 60) // placed exactly as the user asked
    expect(deep.startMin).toBe(14 * 60) // the flexible block was NOT auto-moved out from under it
    // the reply offers to drift the flexible side rather than silently reshaping
    expect(lastMsg().body.toLowerCase()).toMatch(/overlap|drift|nudge/)
  })
})

describe('scheduler: a long continuous run earns a pacing rest (#103)', () => {
  const SAT = () => addDaysKey(dayKey(TUE(9, 40)), 4) // Saturday — clear afternoon air

  const restsOn = (key: string) =>
    useMew
      .getState()
      .blocks.filter((b) => b.dayKey === key && b.tag === 'rest' && b.status === 'open')

  it('inserts exactly one short, unprotected breather into a >90-min stretch', async () => {
    await fresh(TUE(9, 40))
    // two back-to-back work blocks → 11:30–14:30 continuous (180 min), seam after at 14:30
    await say('block 1.5h for the migration on saturday at 11:30')
    await say('block 1.5h for the rollout on saturday at 13')
    const rests = restsOn(SAT())
    expect(rests).toHaveLength(1)
    const breather = rests[0]
    expect(breather.protected).toBe(false) // absorbable on the next reshape, not sacred rest
    expect(breather.endMin - breather.startMin).toBeLessThanOrEqual(20)
    expect(breather.endMin - breather.startMin).toBeGreaterThanOrEqual(10)
    expect(lastMsg().body.toLowerCase()).toContain('breather')
  })

  it('re-running a reshape over the same day stacks no second rest (idempotent)', async () => {
    await fresh(TUE(9, 40))
    await say('block 1.5h for the migration on saturday at 11:30')
    await say('block 1.5h for the rollout on saturday at 13')
    expect(restsOn(SAT())).toHaveLength(1)
    // a later plan touches the same day again — the pass must not add a twin
    await say('block 30m for inbox on saturday at 16:30')
    expect(restsOn(SAT())).toHaveLength(1)
  })

  it('a short, isolated block gets no breather added', async () => {
    await fresh(TUE(9, 40))
    // 13:00–13:45 sits clear of the seed's Saturday blocks (Groceries ≤11:30,
    // Reading ≥15:00) — a 45-min run, well under the cap, nothing to pace
    await say('block 45m for a quick fix on saturday at 13')
    expect(restsOn(SAT())).toHaveLength(0)
  })
})

/* #115 — a nudge is reflection, not an interrupt: executors' nudges are held
   until the assistant turn finishes, never spliced into the live stream. */

describe('nudges defer until the turn completes', () => {
  const deckToday = () =>
    useMew.getState().blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(0)))!

  it('a model-driven completion parks its nudge after the streamed reply, in order', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    const target = deckToday() // 9:00–11:30 deck; completing at 9:40 reclaims ~110 min → next-up
    /* the model streams a two-part reply and completes the deck between the
       parts — exactly the mid-stream tool call that used to splice a card in */
    scriptedModel.chunks = ['On it — ', 'marked done.']
    scriptedModel.midTurn = (exec) => exec.complete(target.title)
    await say('finish the deck')

    const nu = lastNudge('next-up')
    expect(nu).toBeDefined()
    const c = chat()
    const replyIdx = c.findIndex((m) => m.role === 'mew' && m.body.includes('marked done'))
    const nudgeIdx = c.findIndex((m) => m.id === nu.id)
    expect(replyIdx).toBeGreaterThanOrEqual(0)
    // the card lands AFTER the whole reply — parked, not spliced into the stream
    expect(nudgeIdx).toBeGreaterThan(replyIdx)
  })

  it('observes mid-stream that no nudge card exists until the turn ends', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' }) // route through the scripted adapter
    const target = deckToday()
    let midTurnCount = -1
    scriptedModel.chunks = ['Marking that done… ', 'done.']
    scriptedModel.midTurn = (exec) => {
      // first chunk already streamed (thinking flipped false) — the nudge fired
      // here must STILL be held by the in-flight turn, not posted
      exec.complete(target.title)
      midTurnCount = chat().filter((m) => m.role === 'nudge' && m.nudgeType === 'next-up').length
    }
    await say('finish the deck')
    expect(midTurnCount).toBe(0) // held during the turn, even after the first token
    expect(lastNudge('next-up')).toBeDefined() // … then flushed once it ended
  })

  it('a pre-tool reasoning snapshot lands on the reply message, ahead of the mutation (#166)', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    const target = deckToday()
    // the model thinks first, then completes the deck between the reply parts
    scriptedModel.reasoning = 'the deck is the one open block today — completing it.'
    scriptedModel.chunks = ['On it — ', 'marked done.']
    let plannedBeforeAction: string | undefined
    scriptedModel.midTurn = (exec) => {
      // the reasoning is already pinned to the streamed reply before the tool runs
      const streaming = chat().find((m) => m.role === 'mew' && m.body.includes('On it'))
      plannedBeforeAction = streaming?.reasoning
      exec.complete(target.title)
    }
    await say('finish the deck')

    /* the tool call closes the streamed row (#282: text → card → text), so the
       plan stays pinned to the row it streamed into — the one on the record
       BEFORE the mutation — and is never re-pinned to the post-tool row */
    const reply = chat().find((m) => m.role === 'mew' && m.body.includes('On it'))!
    expect(reply.reasoning).toBe('the deck is the one open block today — completing it.')
    const tail = chat().find((m) => m.role === 'mew' && m.body.includes('marked done'))!
    expect(tail.reasoning).toBeUndefined()
    // it was on the record BEFORE the executor mutated the week
    expect(plannedBeforeAction).toBe('the deck is the one open block today — completing it.')
  })

  it('no reasoning chunk ⇒ no reasoning field (the keyless/opt-out default)', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    scriptedModel.chunks = ['done — thursday is held.']
    await say('block thursday morning')
    const reply = chat().find((m) => m.role === 'mew' && m.body.includes('thursday is held'))!
    expect(reply.reasoning).toBeUndefined()
  })

  it('a turn that errors after acting still flushes its parked nudges', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    const target = deckToday()
    scriptedModel.chunks = ['Working on it… ']
    scriptedModel.throwAfter = true // hiccup after the tool call
    scriptedModel.midTurn = (exec) => {
      exec.complete(target.title)
    }
    await say('finish the deck')
    expect(useMew.getState().thinking).toBe(false)
    // the connection hiccuped, but nothing fired mid-turn is lost
    expect(lastNudge('next-up')).toBeDefined()
  })

  it('an idle tick nudge (no turn in flight) still posts immediately', async () => {
    // tick nudges post straight to chat: the boot tick's morning brief (#285),
    // then the seeded Tuesday-morning right-size on the next minute
    await fresh(TUE(9, 40))
    expect(lastNudge('morning-brief')).toBeDefined()
    at(TUE(9, 41))
    expect(lastNudge('right-size')).toBeDefined()
    expect(useMew.getState().queuedNudges).toHaveLength(0)
  })
})

/* #118 — the live working status: each tool sets a short, positive label while
   MEW is mid-turn; speak's finally clears it so the composer is never left
   showing a stale "doing…". */

describe('the working-status label tracks the turn', () => {
  const deckToday = () =>
    useMew.getState().blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(0)))!
  const working = () => useMew.getState().workingStatus

  it('is null at rest, set while a tool runs, and cleared once the turn ends', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' }) // route through the scripted adapter
    expect(working()).toBe(null) // nothing in flight

    const target = deckToday()
    let midTurnLabel: string | null = '<unset>'
    scriptedModel.chunks = ['On it — ', 'marked done.']
    scriptedModel.midTurn = (exec) => {
      exec.complete(target.title) // the executor sets the live label
      midTurnLabel = working()
    }
    await say('finish the deck')

    expect(midTurnLabel).toBe('marking it done…') // shown while the tool ran
    expect(working()).toBe(null) // cleared in speak's finally
  })

  it('shows the latest tool in a multi-step turn (last label wins)', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    const target = deckToday()
    const labels: (string | null)[] = []
    scriptedModel.chunks = ['Working… ', 'all set.']
    scriptedModel.midTurn = (exec) => {
      exec.capture('a stray thought')
      labels.push(working())
      exec.complete(target.title)
      labels.push(working())
    }
    await say('jot a thought then finish the deck')

    expect(labels).toEqual(['jotting it down…', 'marking it done…'])
    expect(working()).toBe(null)
  })

  it('stays null through a chat-only turn (no tool fired)', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    let midTurnLabel: string | null = '<unset>'
    scriptedModel.chunks = ['Hey — ', 'what should the week hold?']
    scriptedModel.midTurn = () => {
      midTurnLabel = working() // no executor ran, so no label was set
    }
    await say('hi')

    expect(midTurnLabel).toBe(null)
    expect(working()).toBe(null)
  })
})

/* #117 — cancellable turns: a stop control aborts the in-flight turn. The abort
   reaches the adapter's stream; the turn ends within a beat, the partial reply
   stays, committed actions stay, and nothing replays through the rules floor. */

describe('a turn can be stopped mid-stream', () => {
  const deckToday = () =>
    useMew.getState().blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(0)))!

  it('stops cleanly: keeps the partial, clears turn state, fires no fallback', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    /* the model streams the first part, then the user presses stop before the
       rest — the partial that already landed must stay */
    scriptedModel.chunks = ['Working on it — ', 'here is the rest.']
    scriptedModel.midTurn = () => useMew.getState().stopSpeaking()
    await say('plan my afternoon')

    const partial = chat().find((m) => m.role === 'mew' && m.body.includes('Working on it'))
    expect(partial).toBeDefined() // the streamed partial is kept
    expect(partial!.body).not.toContain('here is the rest') // … only what arrived before stop
    // a kind, positive stop note — not a failure, not a "say continue"
    expect(lastMsg().body).toMatch(/stopped — what's above stands/i)
    // never the rules-fallback apology (#116): an abort is not a model failure
    expect(chat().some((m) => /handled it myself|connection hiccuped/i.test(m.body))).toBe(false)
    // turn state is fully cleared
    expect(useMew.getState().thinking).toBe(false)
    expect(useMew.getState().workingStatus).toBe(null)
  })

  it('keeps actions committed before the stop — no rollback', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    const target = deckToday()
    /* the tool fires (the week mutates), then the user stops mid-turn */
    scriptedModel.chunks = ['On it — ', 'and more.']
    scriptedModel.midTurn = (exec) => {
      exec.complete(target.title)
      useMew.getState().stopSpeaking()
    }
    await say('finish the deck and tidy the rest')

    // the completion that already committed stays done (honest: tools are the
    // only way the week changes, and a stop never rolls one back)
    const after = useMew.getState().blocks.find((b) => b.id === target.id)!
    expect(after.status).toBe('done')
    // the stop note posted; a parked reflection nudge (#115) may flush after it,
    // so assert presence, not that it's the very last line
    expect(chat().some((m) => /stopped — what's above stands/i.test(m.body))).toBe(true)
    expect(chat().some((m) => /handled it myself|connection hiccuped/i.test(m.body))).toBe(false)
  })

  it('threads the abort signal into the adapter', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    let sawSignal = false
    let abortedInTurn = false
    scriptedModel.chunks = ['Thinking… ', 'done.']
    scriptedModel.midTurn = (_exec, signal) => {
      sawSignal = signal instanceof AbortSignal
      useMew.getState().stopSpeaking()
      abortedInTurn = signal?.aborted ?? false
    }
    await say('what should I do next')

    expect(sawSignal).toBe(true) // the store passes a real signal through
    expect(abortedInTurn).toBe(true) // stopSpeaking() aborts the live turn's signal
  })

  it('a fresh turn after a stop is not aborted by the prior stop', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    // turn 1: stopped mid-stream
    scriptedModel.chunks = ['First — ', 'tail.']
    scriptedModel.midTurn = () => useMew.getState().stopSpeaking()
    await say('start something')
    expect(lastMsg().body).toMatch(/stopped — what's above stands/i)

    // turn 2: runs to completion — the cleared handle must not abort it
    scriptedModel.chunks = ['Second turn — ', 'all done.']
    scriptedModel.midTurn = null
    await say('now finish it')
    expect(lastMsg().body).toContain('all done')
    expect(useMew.getState().thinking).toBe(false)
  })
})

/* #280 — type while MEW works: the composer never locks. send() decides by
   turn phase (idle speaks; mid-turn queues), a second Enter merges into ONE
   combined turn, and every settle path — success, hiccup, stop — drains the
   slot exactly once via speak's finally. Stop with a queued message IS
   stop-and-send: same stopSpeaking(), the settle drain does the send. */

describe('a message typed while MEW works queues, then sends exactly once', () => {
  const userBodies = () =>
    chat()
      .filter((m) => m.role === 'user')
      .map((m) => m.body)
  const queued = () => useMew.getState().queuedSpeak
  const draft = () => useMew.getState().promptDraft

  it('send while idle speaks immediately: no queue, draft consumed', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    scriptedModel.chunks = ['hey — the morning looks clear.']
    useMew.getState().setPromptDraft('hello mew')
    useMew.getState().send('hello mew')
    await settle()
    expect(userBodies().filter((b) => b === 'hello mew')).toHaveLength(1)
    expect(queued()).toBe(null)
    expect(draft()).toBe('') // send() consumed the draft
    expect(lastMsg().body).toContain('the morning looks clear')
  })

  it('send mid-turn queues, then sends as its own next turn — exactly once', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    scriptedModel.chunks = ['on the first thing — ', 'done.']
    let queuedDuring: string | null = null
    scriptedModel.midTurn = () => {
      scriptedModel.midTurn = null // one-shot: the drained turn runs clean
      useMew.getState().send('a thought that arrived mid-turn')
      queuedDuring = queued()
      scriptedModel.chunks = ['and the queued thought — handled.']
    }
    await say('first ask')
    expect(queuedDuring).toBe('a thought that arrived mid-turn')
    await settle() // the drain rides a microtask, then runs a whole turn
    expect(userBodies().filter((b) => b === 'a thought that arrived mid-turn')).toHaveLength(1)
    expect(queued()).toBe(null)
    expect(lastMsg().body).toContain('queued thought — handled')
  })

  it('two Enters mid-turn merge into one combined queued turn', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    scriptedModel.chunks = ['working — ', 'done.']
    scriptedModel.midTurn = () => {
      scriptedModel.midTurn = null
      useMew.getState().send('first thought')
      useMew.getState().send('second thought')
    }
    await say('start')
    await settle()
    const merged = 'first thought\nsecond thought'
    expect(userBodies().filter((b) => b === merged)).toHaveLength(1) // ONE combined turn
    expect(userBodies()).not.toContain('first thought') // never sent alone
    expect(userBodies()).not.toContain('second thought')
    expect(queued()).toBe(null)
  })

  it('a model hiccup still drains the queue — exactly once', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    scriptedModel.chunks = ['partial — ']
    scriptedModel.throwAfter = true // the connection dies after the queue lands
    scriptedModel.midTurn = () => {
      scriptedModel.midTurn = null
      useMew.getState().send('queued past the hiccup')
    }
    await say('start')
    await settle()
    expect(userBodies().filter((b) => b === 'queued past the hiccup')).toHaveLength(1)
    expect(queued()).toBe(null)
    // the failure stayed honest (#116) — and still drained
    expect(chat().some((m) => /connection hiccuped/i.test(m.body))).toBe(true)
  })

  it('stop with a queued message IS stop-and-send: partial stays, stop note first', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    scriptedModel.chunks = ['partial answer — ', 'never arrives.']
    scriptedModel.midTurn = () => {
      scriptedModel.midTurn = null
      useMew.getState().send('the parked follow-up')
      useMew.getState().stopSpeaking() // plain stop — no second code path
      scriptedModel.chunks = ['fresh answer to the parked follow-up.']
    }
    await say('start something')
    await settle()
    // the partial that streamed before the stop is kept, unfinished tail and all
    const partial = chat().find((m) => m.role === 'mew' && m.body.includes('partial answer'))
    expect(partial).toBeDefined()
    expect(partial!.body).not.toContain('never arrives')
    // the stop contract, word-for-word, BEFORE the queued send fires
    const stopIdx = chat().findIndex((m) => m.body === `(stopped — what's above stands.)`)
    const queuedIdx = chat().findIndex(
      (m) => m.role === 'user' && m.body === 'the parked follow-up'
    )
    expect(stopIdx).toBeGreaterThan(-1)
    expect(queuedIdx).toBeGreaterThan(stopIdx)
    // exactly once, and the drained turn ran to completion un-aborted
    expect(userBodies().filter((b) => b === 'the parked follow-up')).toHaveLength(1)
    expect(lastMsg().body).toContain('fresh answer')
    expect(queued()).toBe(null)
  })

  it('cancel returns the queued text to the draft intact — nothing sends', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    scriptedModel.chunks = ['working — ', 'done.']
    scriptedModel.midTurn = () => {
      scriptedModel.midTurn = null
      useMew.getState().send('a reconsidered thought')
      useMew.getState().cancelQueuedSpeak()
    }
    await say('start')
    await settle()
    expect(draft()).toBe('a reconsidered thought') // back in the composer, whole
    expect(queued()).toBe(null)
    expect(userBodies()).not.toContain('a reconsidered thought') // the drain had nothing to send
  })

  it('cancel keeps newer typing too: queued text lands above the draft-in-progress', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    scriptedModel.chunks = ['working — ', 'done.']
    scriptedModel.midTurn = () => {
      scriptedModel.midTurn = null
      useMew.getState().send('queued first')
      useMew.getState().setPromptDraft('typed after')
      useMew.getState().cancelQueuedSpeak()
    }
    await say('start')
    await settle()
    expect(draft()).toBe('queued first\ntyped after') // both thoughts kept, send order
    expect(queued()).toBe(null)
  })

  it('a chip pick mid-turn no-ops — same phase gate as send, no concurrent turn (#254)', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    scriptedModel.chunks = ['pick one — ', 'your call.']
    let thinkingAtPick: boolean | null = null
    scriptedModel.midTurn = (exec) => {
      scriptedModel.midTurn = null
      /* the chips land mid-turn (fresh, unsuperseded — only the phase gate
         can park them), and the pick fires while the SAME turn still runs:
         `thinking` is already false (a token streamed) but turnInFlight holds */
      exec.offerChoices('where should the deck live?', [
        { label: '15:00', reply: 'place the deck at 15:00' },
      ])
      const offer = chat().find((m) => m.choices?.length === 1)!
      thinkingAtPick = useMew.getState().thinking
      void useMew.getState().pickChoice(offer.id, offer.choices![0].id)
    }
    await say('find a slot for the deck')
    expect(thinkingAtPick).toBe(false) // a thinking-only gate would have let the pick through
    await settle()
    // the mid-turn pick never became a user turn and never marked the chip
    expect(userBodies()).not.toContain('place the deck at 15:00')
    const offer = chat().find((m) => m.choices?.length === 1)!
    expect(offer.choices![0].picked).toBeUndefined()
    // …and once the turn settles, the same pick acts normally
    await useMew.getState().pickChoice(offer.id, offer.choices![0].id)
    expect(userBodies()).toContain('place the deck at 15:00')
  })
})

/* ── power-user surface: quick-capture (#171) + global search (#170) ──────
   The palette is UI; its store contract is what we pin here. Quick-capture is
   the one capture path that fires NO when-where nudge and writes NO chat turn —
   the whole point of "jot it and move on" — so these scenarios guard exactly
   that, plus the auto-place fallback and the read-only search. */
describe('quick-capture (#171) — no chat turn, no when-where nudge', () => {
  it('open mode: creates an open capture, no chat entry, no when-where nudge', async () => {
    await fresh(TUE(9, 40))
    const chatBefore = chat().length
    const res = useMew.getState().quickCapture('Call bank', false)
    expect(res).toEqual({ kind: 'open', message: 'Captured: Call bank' })
    const caps = useMew.getState().captures
    expect(caps.some((c) => c.title === 'Call bank' && c.status === 'open')).toBe(true)
    // the chat thread is untouched — a quick-capture lives in parallel data
    expect(chat().length).toBe(chatBefore)
    expect(nudges('when-where')).toHaveLength(0)
  })

  it('auto-place mode: lands a 30-min block in the first free slot today, no chat turn', async () => {
    await fresh(TUE(12, 0)) // standup just ended 12:00; lunch is 13:00 → a clear gap
    const chatBefore = chat().length
    const res = useMew.getState().quickCapture('Call bank', true)
    expect(res.kind).toBe('placed')
    expect(res.message).toMatch(/^Placed: Call bank \d\d?:\d\d/)
    const blocks = useMew.getState().blocks
    const placed = blocks.find((b) => b.title === 'Call bank' && b.dayKey === dayKey(TUE(12, 0)))!
    expect(placed).toBeDefined()
    expect(placed.endMin - placed.startMin).toBe(30)
    expect(placed.startMin).toBeGreaterThanOrEqual(12 * 60 + 15) // after now+15 floor
    // the capture is recorded as placed and linked to the block
    const cap = useMew.getState().captures.find((c) => c.title === 'Call bank')!
    expect(cap.status).toBe('placed')
    expect(cap.placedBlockId).toBe(placed.id)
    // still no chat turn
    expect(chat().length).toBe(chatBefore)
    expect(nudges('when-where')).toHaveLength(0)
  })

  it('auto-place with no free slot today → falls back to an open capture, honest copy', async () => {
    await fresh(TUE(9, 40))
    /* fill the rest of today so no 30-min slot remains after now+15 */
    const today = dayKey(TUE(9, 40))
    const wall: import('../../domain/types').Block[] = [
      {
        id: uid(),
        title: 'Wall',
        tag: 'work',
        dayKey: today,
        startMin: 9 * 60,
        endMin: 23 * 60,
        protected: true,
        status: 'open',
        calendarRefs: [],
        estimateSource: 'user',
      },
    ]
    useMew.setState((s) => ({ blocks: [...s.blocks.filter((b) => b.dayKey !== today), ...wall] }))
    const res = useMew.getState().quickCapture('Call bank', true)
    expect(res.kind).toBe('open')
    expect(res.message).toMatch(/no free slot today/i)
    expect(
      useMew.getState().captures.some((c) => c.title === 'Call bank' && c.status === 'open')
    ).toBe(true)
  })

  it('respects the quickCaptureMode setting when autoPlace is omitted', async () => {
    await fresh(TUE(12, 0))
    useMew.getState().updateSettings({ quickCaptureMode: 'auto-place' })
    const res = useMew.getState().quickCapture('Email Dana')
    expect(res.kind).toBe('placed')
  })

  it('rapid captures all land, each with its own result (acceptance: 3× in a row)', async () => {
    await fresh(TUE(9, 40))
    const a = useMew.getState().quickCapture('First', false)
    const b = useMew.getState().quickCapture('Second', false)
    const c = useMew.getState().quickCapture('Third', false)
    expect([a.kind, b.kind, c.kind]).toEqual(['open', 'open', 'open'])
    const titles = useMew.getState().captures.map((x) => x.title)
    expect(titles).toEqual(expect.arrayContaining(['First', 'Second', 'Third']))
  })

  it('empty / whitespace input is a gentle no-op (button stays disabled in UI)', async () => {
    await fresh(TUE(9, 40))
    const capsBefore = useMew.getState().captures.length
    const res = useMew.getState().quickCapture('   ', false)
    expect(res.kind).toBe('empty')
    expect(useMew.getState().captures.length).toBe(capsBefore)
  })

  it('clamps a very long title to the 120-char Block.title constraint', async () => {
    await fresh(TUE(9, 40))
    const long = 'x'.repeat(200)
    useMew.getState().quickCapture(long, false)
    const cap = useMew.getState().captures.find((c) => c.title.startsWith('x'))!
    expect(cap.title.length).toBe(120)
  })
})

describe('global search (#170) — read-only, store-level', () => {
  it('searchAll finds a seeded block by partial title and never mutates the week', async () => {
    await fresh(TUE(9, 40))
    const blocksBefore = useMew.getState().blocks
    const r = useMew.getState().searchAll('deck')
    expect(r.block.length).toBeGreaterThan(0)
    expect(r.block.some((h) => /deck/i.test(h.title))).toBe(true)
    // read-only: the block array is the very same reference afterwards
    expect(useMew.getState().blocks).toBe(blocksBefore)
  })

  it('a quick-captured open item is findable in search (the "did I jot X?" answer)', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().quickCapture('Renew passport', false)
    const r = useMew.getState().searchAll('passport')
    expect(r.capture.some((h) => h.title === 'Renew passport' && h.detail === 'unplaced')).toBe(
      true
    )
  })

  it('an empty query returns no hits (the palette shows commands instead)', async () => {
    await fresh(TUE(9, 40))
    const r = useMew.getState().searchAll('')
    expect(r.block.length + r.capture.length + r.chat.length).toBe(0)
  })
})

describe('command palette open/close (#169) — store flag', () => {
  it('opens and closes; closing a closed palette is a no-op', async () => {
    await fresh(TUE(9, 40))
    expect(useMew.getState().commandPaletteOpen).toBe(false)
    useMew.getState().openCommandPalette()
    expect(useMew.getState().commandPaletteOpen).toBe(true)
    useMew.getState().closeCommandPalette()
    expect(useMew.getState().commandPaletteOpen).toBe(false)
    useMew.getState().closeCommandPalette() // idempotent
    expect(useMew.getState().commandPaletteOpen).toBe(false)
  })

  it('revealBlock routes to the week view and focuses the block’s day', async () => {
    await fresh(TUE(9, 40))
    const target = useMew.getState().blocks.find((b) => /Q3 deck/.test(b.title))!
    useMew.getState().revealBlock(target.id)
    const s = useMew.getState()
    expect(s.page).toBe('week')
    expect(s.view).toBe('week')
    expect(s.focusedDayKey).toBe(target.dayKey)
  })

  it('revealChatMessage routes to the week page and sets the scroll target', async () => {
    await fresh(TUE(9, 40))
    const msg = chat()[0]
    useMew.getState().revealChatMessage(msg.id)
    expect(useMew.getState().scrollToMsgId).toBe(msg.id)
    expect(useMew.getState().page).toBe('week')
  })
})

/* RFC 5545 RRULE for user-created recurring blocks (#159) — driven through the
   real store: a plan_blocks call carrying a recurrence expands into one linked
   block per occurrence; a single delete drops one, an explicit-all drops the
   whole series; a save/load cycle preserves the rule on every block. Titles
   ("Pilates", "Journal") are deliberately absent from the seed so the counts
   are exactly the expansion, and the executor's own result string is captured
   from the tool call — the streamed reply chunks aren't the tool_result. */
describe('recurring blocks (#159)', () => {
  // Pilates every Mon & Wed at 7:00–8:00 for 12 weeks → 24 blocks (2 × 12)
  const weeklyRule = {
    freq: 'WEEKLY' as const,
    interval: 1,
    byday: ['MO' as const, 'WE' as const],
    count: 24,
  }
  let toolResult = ''

  async function placePilates() {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' }) // route through the scripted adapter
    toolResult = ''
    scriptedModel.chunks = ['On it — ', 'placed.']
    scriptedModel.midTurn = (exec) => {
      toolResult = exec.plan(
        [
          {
            title: 'Pilates',
            tag: 'health',
            dayOffset: 0,
            startMin: 7 * 60,
            durationMin: 60,
            rrule: weeklyRule,
          },
        ],
        []
      )
    }
    await say('pilates every monday and wednesday at 7 for 12 weeks')
  }

  it('expands a 12-week Mon/Wed rule into 24 linked blocks at the right times', async () => {
    await placePilates()
    const blocks = useMew.getState().blocks.filter((b) => b.title === 'Pilates')
    expect(blocks).toHaveLength(24)
    // every block carries the same (truthy) series id and the rule itself
    const ids = new Set(blocks.map((b) => b.recurringBlockId))
    expect(ids.size).toBe(1)
    expect([...ids][0]).toBeTruthy()
    expect(
      blocks.every((b) => b.rrule?.freq === 'WEEKLY' && b.startMin === 420 && b.endMin === 480)
    ).toBe(true)
    // only Mondays and Wednesdays, 12 of each
    const dows = blocks.map((b) => new Date(b.dayKey + 'T00:00:00').getDay())
    expect(dows.filter((d) => d === 1)).toHaveLength(12) // Monday
    expect(dows.filter((d) => d === 3)).toHaveLength(12) // Wednesday
    expect(toolResult).toMatch(/repeats Mon & Wed/i)
    expect(toolResult).toMatch(/24 blocks/)
  })

  it('deleting one occurrence leaves the rule and the rest of the series intact', async () => {
    await placePilates()
    const series = useMew.getState().blocks.filter((b) => b.title === 'Pilates')
    const seriesId = series[0].recurringBlockId
    // a single occurrence comes off (what a per-block delete does) — the series
    // link stays on every other block, so "delete this one" never severs the rest.
    const victim = [...series].sort((a, b) => a.dayKey.localeCompare(b.dayKey))[3]
    useMew.setState({ blocks: useMew.getState().blocks.filter((b) => b.id !== victim.id) })

    const after = useMew.getState().blocks.filter((b) => b.title === 'Pilates')
    expect(after).toHaveLength(23)
    expect(after.every((b) => b.recurringBlockId === seriesId && b.rrule?.freq === 'WEEKLY')).toBe(
      true
    )
    expect(after.some((b) => b.dayKey === victim.dayKey)).toBe(false) // that one day is gone
  })

  it('deleting all sessions through the remove tool clears the whole series and its link', async () => {
    await placePilates()
    let removeResult = ''
    scriptedModel.chunks = ['Okay — ', 'cleared them all.']
    scriptedModel.midTurn = (exec) => {
      removeResult = exec.remove('pilates', { all: true })
    }
    await say('cancel all my pilates sessions')
    expect(useMew.getState().blocks.some((b) => b.title === 'Pilates')).toBe(false)
    expect(useMew.getState().blocks.some((b) => b.recurringBlockId)).toBe(false) // link drops with the series
    expect(removeResult).toMatch(/Pilates × 24 sessions/)
  })

  it('preserves the rule on every block across a save/load cycle', async () => {
    await placePilates()
    const before = useMew.getState().blocks.filter((b) => b.title === 'Pilates').length
    expect(before).toBe(24)
    // reload the store straight from the faked storage (what dexie persisted)
    await useMew.getState().hydrate()
    const after = useMew.getState().blocks.filter((b) => b.title === 'Pilates')
    expect(after).toHaveLength(before)
    expect(
      after.every(
        (b) =>
          b.rrule?.freq === 'WEEKLY' && b.rrule?.byday?.join() === 'MO,WE' && b.recurringBlockId
      )
    ).toBe(true)
  })

  it('caps an open-ended daily rule at the 52-week window, never flooding the week', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    scriptedModel.chunks = ['On it.']
    scriptedModel.midTurn = (exec) =>
      exec.plan(
        [
          {
            title: 'Journal',
            tag: 'private',
            dayOffset: 0,
            startMin: 6 * 60,
            durationMin: 15,
            rrule: { freq: 'DAILY', interval: 1 },
          },
        ],
        []
      )
    await say('journal every day')
    // open-ended daily → today + 52 weeks (≈365 days), bounded well under 800
    const journals = useMew.getState().blocks.filter((b) => b.title === 'Journal')
    expect(journals.length).toBeGreaterThan(360)
    expect(journals.length).toBeLessThanOrEqual(800)
    expect(journals.every((b) => b.recurringBlockId === journals[0].recurringBlockId)).toBe(true)
  })
})

/* #162 — undo an AI action: undo_last_action reverses the turn's most recent
   mutating tool. The store snapshots the week before each mutating tool and
   restores it; chat (the reply about the undone action) stays as context. */

describe('undo an AI action (#162)', () => {
  const deckToday = () =>
    useMew.getState().blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(0)))!
  const blocksById = (id: string) => useMew.getState().blocks.find((b) => b.id === id)

  it('reverses everything the last plan call placed (the whole tool effect)', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    const before = useMew.getState().blocks.length
    /* the model places blocks (a long run may also earn an auto-breather), then
       the user says "undo that" — the same turn reverses exactly that plan call,
       breather and all, so the week is byte-for-byte where it started */
    let placedReply = ''
    let undoReply = ''
    let placedCount = 0
    scriptedModel.chunks = ['On it — ', 'and undone.']
    scriptedModel.midTurn = (exec) => {
      placedReply = exec.plan(
        [
          { title: 'audit prep', tag: 'work', dayOffset: 1, startMin: 9 * 60, durationMin: 30 },
          { title: 'budget pass', tag: 'work', dayOffset: 1, startMin: 11 * 60, durationMin: 60 },
          { title: 'vendor sync', tag: 'work', dayOffset: 1, startMin: 13 * 60, durationMin: 30 },
        ],
        []
      )
      placedCount = useMew.getState().blocks.length - before
      undoReply = exec.undoLast()
    }
    await say('block three things tomorrow — actually, undo that')

    expect(placedReply).toMatch(/^Done — /)
    expect(placedCount).toBeGreaterThanOrEqual(3) // the three asked, plus any auto-breather
    expect(undoReply).toMatch(/^Undone — /)
    expect(undoReply).toMatch(/blocks I'd just placed/) // names the reversal, MEW's voice
    // every placed block (and any auto-breather) is gone — the week is exactly as it was
    expect(useMew.getState().blocks.length).toBe(before)
    expect(
      useMew.getState().blocks.some((b) => /audit prep|budget pass|vendor sync/.test(b.title))
    ).toBe(false)
  })

  it('a model that says "undo that" removes the most recent placed blocks (acceptance)', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    const tomorrow = addDaysKey(dayKey(TUE(0)), 1)
    scriptedModel.chunks = ['placed it — ', 'and rolled it back.']
    scriptedModel.midTurn = (exec) => {
      exec.plan(
        [{ title: 'dentist', tag: 'health', dayOffset: 1, startMin: 15 * 60, durationMin: 60 }],
        []
      )
      exec.undoLast()
    }
    await say('book the dentist tomorrow at 3 — no wait, undo')
    expect(
      useMew.getState().blocks.some((b) => b.dayKey === tomorrow && /dentist/.test(b.title))
    ).toBe(false)
  })

  it('reverses a move — the block returns to its original day and time', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    const deck = deckToday()
    const { id, dayKey: origDay, startMin: origStart } = deck
    scriptedModel.chunks = ['moving it… ', 'put back.']
    scriptedModel.midTurn = (exec) => {
      exec.move(deck.title, 3, 14 * 60) // push to +3 days at 14:00
      undoSawMoved(id, origDay, origStart) // proves the move landed before undo
      exec.undoLast()
    }
    await say('push the deck to friday afternoon — actually never mind')

    const after = blocksById(id)!
    expect(after.dayKey).toBe(origDay)
    expect(after.startMin).toBe(origStart)
  })

  it('reverses a completion: the block reopens and the mew event is cleared', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    const deck = deckToday()
    const memBefore = useMew.getState().memory.filter((e) => e.kind === 'completed').length
    scriptedModel.chunks = ['nice — ', 'oh, reverted.']
    scriptedModel.midTurn = (exec) => {
      exec.complete(deck.title)
      exec.undoLast()
    }
    await say("finished the deck — wait that wasn't done, undo")

    expect(blocksById(deck.id)!.status).toBe('open') // reopened
    // the completion memory event logged by complete_task is gone again
    expect(useMew.getState().memory.filter((e) => e.kind === 'completed').length).toBe(memBefore)
    // and it's gone from storage too, not just live state
    expect(
      [...fakeDb.memory.values()].filter((e) => (e as { kind: string }).kind === 'completed').length
    ).toBe(memBefore)
  })

  it('reverses only the LAST tool in a multi-step turn (plan stays, move reverts)', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    const tomorrow = addDaysKey(dayKey(TUE(0)), 1)
    let movedDay = ''
    scriptedModel.chunks = ['working… ', 'last bit undone.']
    scriptedModel.midTurn = (exec) => {
      exec.plan(
        [{ title: 'briefing', tag: 'work', dayOffset: 1, startMin: 10 * 60, durationMin: 60 }],
        []
      )
      const placed = useMew.getState().blocks.find((b) => /briefing/.test(b.title))!
      exec.move(placed.title, 2, 16 * 60) // move it again — this is the LAST mutation
      movedDay = useMew.getState().blocks.find((b) => /briefing/.test(b.title))!.dayKey
      exec.undoLast() // reverses only the move, not the plan
    }
    await say('add a briefing tomorrow, then push it to thursday — undo the push')

    const briefing = useMew.getState().blocks.find((b) => /briefing/.test(b.title))
    expect(briefing).toBeDefined() // the plan SURVIVES — only the last action reverses
    expect(movedDay).toBe(addDaysKey(dayKey(TUE(0)), 2)) // it really had moved to thursday
    expect(briefing!.dayKey).toBe(tomorrow) // …and undo put it back to tomorrow
  })

  it('reverses a capture the same turn jotted', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    const before = useMew.getState().captures.length
    scriptedModel.chunks = ['jotted — ', 'taken back.']
    scriptedModel.midTurn = (exec) => {
      exec.capture('call the bank')
      exec.undoLast()
    }
    await say('I should call the bank — actually undo that')
    expect(useMew.getState().captures.length).toBe(before)
    expect(useMew.getState().captures.some((c) => /call the bank/.test(c.title))).toBe(false)
    expect(
      [...fakeDb.captures.values()].some((c) =>
        /call the bank/.test((c as { title: string }).title)
      )
    ).toBe(false)
  })

  it('is read-only when nothing has changed this turn — "nothing to undo"', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    const before = useMew.getState().blocks.length
    let reply = ''
    scriptedModel.chunks = ['hmm — ', 'ok.']
    scriptedModel.midTurn = (exec) => {
      reply = exec.undoLast() // no mutation happened first
    }
    await say('undo that')
    expect(reply).toMatch(/nothing to undo/i)
    expect(useMew.getState().blocks.length).toBe(before) // untouched
  })

  it('does not touch chat — the reply about the undone action stays as context', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    const userTurns = () => chat().filter((m) => m.role === 'user').length
    scriptedModel.chunks = ['placed — ', 'and undone, all good.']
    scriptedModel.midTurn = (exec) => {
      exec.plan(
        [{ title: 'errand', tag: 'work', dayOffset: 1, startMin: 12 * 60, durationMin: 30 }],
        []
      )
      exec.undoLast()
    }
    const before = userTurns()
    await say('block an errand tomorrow then undo it')

    // the user message + the streamed mew reply are both still in the log —
    // undo reverses the WEEK, never the conversation
    expect(userTurns()).toBe(before + 1)
    expect(chat().some((m) => m.role === 'mew' && /all good/.test(m.body))).toBe(true)
  })

  it('snapshot is per-turn: undo reaches the last action, then a fresh undo finds nothing', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    // turn 1: place then undo — the snapshot is consumed
    scriptedModel.chunks = ['done — ', 'undone.']
    scriptedModel.midTurn = (exec) => {
      exec.plan(
        [{ title: 'sync', tag: 'work', dayOffset: 1, startMin: 9 * 60, durationMin: 30 }],
        []
      )
      exec.undoLast()
    }
    await say('add a sync tomorrow then undo')

    // turn 2: a bare "undo that" with nothing new this turn has nothing to take back
    let secondUndo = ''
    scriptedModel.chunks = ['let me see — ', 'ok.']
    scriptedModel.midTurn = (exec) => {
      secondUndo = exec.undoLast()
    }
    await say('undo that')
    expect(secondUndo).toMatch(/nothing to undo/i)
  })
})

/** Assert a move committed before the undo runs (keeps the move test honest). */
function undoSawMoved(id: string, origDay: string, origStart: number) {
  const moved = useMew.getState().blocks.find((b) => b.id === id)!
  if (moved.dayKey === origDay && moved.startMin === origStart) {
    throw new Error('expected the block to have moved before undo')
  }
}

describe('structured logging (#181) — a calendar sync failure is logged, not swallowed silently', () => {
  /* a recording sink installed on the app-wide logger (setLoggerSink), so we
     observe exactly what the store's `log` emits without depending on the test
     runner's console interception. */
  type LogCall = { level: string; args: unknown[] }
  const captured: LogCall[] = []
  const recorder = {
    error: (...args: unknown[]) => captured.push({ level: 'error', args }),
    warn: (...args: unknown[]) => captured.push({ level: 'warn', args }),
    info: (...args: unknown[]) => captured.push({ level: 'info', args }),
    debug: (...args: unknown[]) => captured.push({ level: 'debug', args }),
  }

  const triggerSyncFailure = async () => {
    /* a live Google calendar + a client id is all syncNow needs to run; the
       googleAccount mock throws (no network in scenarios), so the sync rejects
       and lands in the catch that now logs through the LoggerPort. */
    useMew.getState().updateSettings({
      googleClientId: 'fake-client-id',
      calendars: [{ id: 'cal-1', name: 'Work', who: 'me', provider: 'google', kind: 'live' }],
    })
    await useMew.getState().syncNow()
  }

  beforeEach(() => {
    captured.length = 0
    setLoggerSink(recorder)
  })
  afterEach(() => setLoggerSink(null))

  it("logs with label 'calendar/sync' and structured, redacted context", async () => {
    await fresh(TUE(9, 40))
    await triggerSyncFailure()

    /* the failure is surfaced to state for the honest Settings copy … */
    expect(useMew.getState().syncError).toBe('no network in scenarios')
    /* … AND logged with a calendar/sync label + structured context. */
    const sync = captured.find((c) => String(c.args[0]).endsWith('calendar/sync'))
    expect(sync, 'expected a calendar/sync error log').toBeDefined()
    const [head, ctx, err] = sync!.args
    expect(sync!.level).toBe('error')
    expect(head).toMatch(/ ERROR store\/calendar\/sync$/)
    expect(ctx).toEqual({ calendars: 1 })
    expect(err).toMatchObject({ name: 'Error', message: 'no network in scenarios' })
  })

  it('redacts a key/url/bearer that an error happens to carry (the privacy law)', async () => {
    await fresh(TUE(9, 40))
    await triggerSyncFailure()
    /* the standing mock message is secret-free; assert the path can't leak by
       checking nothing logged carries a raw key/bearer/https URL. */
    expect(captured.length).toBeGreaterThan(0)
    for (const call of captured) {
      const blob = JSON.stringify(call.args)
      expect(blob).not.toMatch(/sk-[A-Za-z0-9]/)
      expect(blob).not.toMatch(/Bearer\s+\S/)
      expect(blob).not.toMatch(/https?:\/\//)
    }
  })
})

/* ── #250 phase 2: paged boot hydration — the window, the pager, the export ── */
describe('paged boot hydration (#250 phase 2)', () => {
  const TUE_KEY = '2026-06-09'
  const drain = () => vi.advanceTimersByTimeAsync(0)
  /** an old chat row, deterministic (ts, id) so the window edge is exact */
  const oldMsg = (i: number, ts: number): ChatMessage => ({
    id: `old${String(i).padStart(4, '0')}`,
    role: i % 2 ? 'mew' : 'user',
    body: `line ${i}`,
    ts,
  })
  /** a big profile: `total` chat rows + one block so hydrate takes the loaded
      branch (an empty week would re-seed and hide the window) */
  async function freshBigProfile(start: Date, total: number) {
    fakeDb.reset()
    mirrors.length = 0
    vi.setSystemTime(start)
    /* a lived-in profile at 9:40 already had its morning brief AND its
       sustenance pass (#299): each persisted key travels with the artifact
       its hydrate heal checks — the brief with its delivered card in chat
       (#285), the scaffold with a meal block on today — so the boot tick
       stays silent and the window arithmetic below stays exact (re-fire
       honesty is pinned in the ritual/scaffold suites; here it must hold) */
    fakeDb.settings = {
      ...DEFAULT_SETTINGS,
      nudgeLastFired: {
        'morning-brief': { ts: start.getTime() - 70 * 60_000, key: dayKey(start) },
        sustenance: { ts: start.getTime() - 70 * 60_000, key: dayKey(start) },
      },
    }
    const base = start.getTime() - total * 60_000
    for (let i = 0; i < total; i++) {
      const m = oldMsg(i, base + i * 60_000)
      /* the newest row is that delivered brief card — same id/ts, so every
         window and cursor assertion below is untouched */
      fakeDb.chat.set(
        m.id,
        i === total - 1 ? { ...m, role: 'nudge' as const, nudgeType: 'morning-brief' as const } : m
      )
    }
    fakeDb.blocks.set('b-anchor', {
      id: 'b-anchor',
      title: 'Deep work',
      tag: 'work',
      dayKey: TUE_KEY,
      startMin: 9 * 60,
      endMin: 10 * 60,
      protected: false,
      status: 'open',
      calendarRefs: [],
      estimateSource: 'user',
    })
    /* the meal block the burned sustenance key answers to — without it the
       #299 heal reads the key as an undelivered pass and re-arms it */
    fakeDb.blocks.set('b-lunch', {
      id: 'b-lunch',
      title: 'Lunch',
      tag: 'private',
      dayKey: TUE_KEY,
      startMin: 13 * 60,
      endMin: 13 * 60 + 45,
      protected: false,
      status: 'open',
      calendarRefs: [],
      estimateSource: 'user',
    })
    useMew.setState(
      {
        ...pristine,
        lastTickDay: dayKey(start),
        nowMs: start.getTime(),
        lastActivityMs: start.getTime(),
      },
      true
    )
    await useMew.getState().hydrate()
  }

  it('boot hydrates only the newest 200 messages of a 260-message profile — and knows more wait in storage', async () => {
    await freshBigProfile(TUE(9, 40), 260)
    const s = useMew.getState()
    expect(s.chat.length).toBe(200)
    expect(s.chat[0].id).toBe('old0060') // the oldest 60 stayed in storage
    expect(s.chat[s.chat.length - 1].id).toBe('old0259')
    expect(s.chatHasEarlier).toBe(true)
    expect(fakeDb.chat.size).toBe(260) // hydration is a read, never a trim
  })

  it('loadEarlierChat prepends the previous page until storage is exhausted, then flips the flag', async () => {
    await freshBigProfile(TUE(9, 40), 260)
    expect(await useMew.getState().loadEarlierChat()).toBe(50)
    expect(useMew.getState().chat.length).toBe(250)
    expect(useMew.getState().chat[0].id).toBe('old0010')
    expect(useMew.getState().chatHasEarlier).toBe(true)
    /* the final, short page carries the rest and retires the sentinel */
    expect(await useMew.getState().loadEarlierChat()).toBe(10)
    expect(useMew.getState().chat.length).toBe(260)
    expect(useMew.getState().chat[0].id).toBe('old0000')
    expect(useMew.getState().chatHasEarlier).toBe(false)
    expect(await useMew.getState().loadEarlierChat()).toBe(0) // idempotent at the head
    /* the window prepends OLDER rows only — order stays (ts, id) ascending */
    const chatNow = useMew.getState().chat
    for (let i = 1; i < chatNow.length; i++)
      expect(chatNow[i].ts).toBeGreaterThanOrEqual(chatNow[i - 1].ts)
  })

  it('concurrent sentinel fires coalesce to ONE page — no doubled prepend', async () => {
    await freshBigProfile(TUE(9, 40), 260)
    const [a, b] = await Promise.all([
      useMew.getState().loadEarlierChat(),
      useMew.getState().loadEarlierChat(),
    ])
    expect(a).toBe(50)
    expect(b).toBe(50) // the same in-flight page, not a second one
    expect(useMew.getState().chat.length).toBe(250)
  })

  it('a small profile boots whole: no earlier flag, nothing to page', async () => {
    await freshBigProfile(TUE(9, 40), 40)
    expect(useMew.getState().chat.length).toBe(40)
    expect(useMew.getState().chatHasEarlier).toBe(false)
    expect(await useMew.getState().loadEarlierChat()).toBe(0)
  })

  it('the live tail is unmoved: speaking appends past the window exactly as before', async () => {
    await freshBigProfile(TUE(9, 40), 260)
    await say('block thursday morning for the deck')
    const s = useMew.getState()
    /* the turn appends user → tool receipt (#282) → reply, all past the window */
    expect(s.chat[s.chat.length - 1].body).toMatch(/^Done — /)
    expect(s.chat[s.chat.length - 2].role).toBe('tool')
    expect(s.chat[s.chat.length - 3].body).toBe('block thursday morning for the deck')
    await vi.advanceTimersByTimeAsync(60_000) // drain the chat batcher
  })

  it('export reads the TABLE: all 260 messages travel while the window holds 200', async () => {
    await freshBigProfile(TUE(9, 40), 260)
    expect(useMew.getState().chat.length).toBe(200)
    const backup = JSON.parse(await useMew.getState().exportData()) as { chat: ChatMessage[] }
    expect(backup.chat.length).toBe(260)
    expect(backup.chat.some((m) => m.id === 'old0000')).toBe(true) // beyond the window
    await drain()
  })
})

/* ── #250 phase 2: chat → facts condensation at the day-debrief moment ── */

describe('chat condensation at the debrief (#250 phase 2)', () => {
  const TUE_KEY = '2026-06-09'
  /** the condensation pass chains one await per step per day — drain a
      generous microtask budget without touching the fake-timer clock */
  const settle = async (turns = 60) => {
    for (let i = 0; i < turns; i++) await Promise.resolve()
  }
  const awake = (d: Date) => {
    useMew.setState({ lastActivityMs: d.getTime() })
    at(d)
  }
  /** plant a past day's chat directly in storage (the boot window doesn't
      reach it — exactly the shape of a long-lived profile) */
  const plantDay = (dayOffset: number, mkMsgs: (ts0: number) => ChatMessage[]): string[] => {
    /* 10:00 on TUE_KEY+dayOffset — JS Date normalizes the negative day */
    const ts0 = new Date(2026, 5, 9 + dayOffset, 10, 0).getTime()
    const msgs = mkMsgs(ts0)
    for (const m of msgs) fakeDb.chat.set(m.id, m)
    return msgs.map((m) => m.id)
  }
  const storyDay = (dayOffset: number) =>
    plantDay(dayOffset, (ts0) => [
      { id: `u-${dayOffset}`, role: 'user', body: 'block the deck review', ts: ts0 },
      {
        id: `m-${dayOffset}`,
        role: 'mew',
        body: 'Done — 9:00–10:00 is held for the deck review.',
        ts: ts0 + 1,
      },
      { id: `n-${dayOffset}`, role: 'nudge', body: 'time for a breather', ts: ts0 + 2 },
    ])
  /** the day must have a story for the debrief to fire: one completed block */
  const liveDayStory = () => {
    at(TUE(11, 30))
    const deck = useMew
      .getState()
      .blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === TUE_KEY)!
    useMew.getState().toggleComplete(deck.id)
  }
  const debriefMoment = async () => {
    awake(TUE(18, 15)) // close-loop takes the first wind-down slot
    awake(TUE(18, 16)) // the story lands — and the condensation pass runs
    await settle()
  }

  it('brain on: whole days older than 14 days distill into digests and prune; the boundary day stays', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.reset()
    const oldIds = storyDay(-15) // beyond the horizon — condenses
    const edgeIds = storyDay(-14) // the first kept day — must NOT condense
    liveDayStory()
    await debriefMoment()

    /* the digest landed: one recallable page, story only (nudges out) */
    const digest = brainFake.ingests.find(
      (p) => p.slug === `week/${addDaysKey(TUE_KEY, -15)}-chat`
    ) as { slug: string; body?: string } | undefined
    expect(digest).toBeDefined()
    expect(digest!.body).toContain('- you: block the deck review')
    expect(digest!.body).toContain('- mew: Done — 9:00–10:00 is held for the deck review.')
    expect(digest!.body).not.toContain('breather')
    /* the raw rows pruned — the nudge included (engine chatter) */
    for (const id of oldIds) expect(fakeDb.chat.has(id)).toBe(false)
    /* boundary exactness: day −14 is inside the horizon, untouched, no digest */
    for (const id of edgeIds) expect(fakeDb.chat.has(id)).toBe(true)
    expect(brainFake.ingests.some((p) => p.slug === `week/${addDaysKey(TUE_KEY, -14)}-chat`)).toBe(
      false
    )
    await vi.advanceTimersByTimeAsync(60_000) // drain the chat batcher
  })

  it('an ingest that silently fails prunes NOTHING — un-condensed history is never destroyed', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.reset()
    brainFake.dropIngests = true // the port swallows failures; the page never lands
    const oldIds = storyDay(-15)
    liveDayStory()
    await debriefMoment()
    for (const id of oldIds) expect(fakeDb.chat.has(id)).toBe(true) // still here, un-condensed
    await vi.advanceTimersByTimeAsync(60_000)
  })

  it('the failed pass retries at the next debrief and prunes once the digest provably lands', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.reset()
    brainFake.dropIngests = true
    const oldIds = storyDay(-15)
    liveDayStory()
    await debriefMoment()
    expect(fakeDb.chat.has(oldIds[0])).toBe(true)

    /* next evening: the brain is healthy again — same digest, now provable */
    brainFake.dropIngests = false
    const WED = (h: number, m = 0) => new Date(2026, 5, 10, h, m)
    useMew.setState({ lastActivityMs: WED(11, 0).getTime() })
    at(WED(11, 0))
    const wedBlock = useMew
      .getState()
      .blocks.find((b) => b.dayKey === addDaysKey(TUE_KEY, 1) && b.status === 'open' && !b.external)
    if (wedBlock) useMew.getState().toggleComplete(wedBlock.id)
    useMew.setState({ lastActivityMs: WED(18, 15).getTime() })
    at(WED(18, 15))
    useMew.setState({ lastActivityMs: WED(18, 16).getTime() })
    at(WED(18, 16))
    await settle()
    for (const id of oldIds) expect(fakeDb.chat.has(id)).toBe(false) // condensed this time
    await vi.advanceTimersByTimeAsync(60_000)
  })

  it('brain off: the debrief still speaks, but nothing condenses and nothing prunes — ever', async () => {
    await fresh(TUE(9, 40))
    const oldIds = storyDay(-15)
    liveDayStory()
    await debriefMoment()
    expect(nudges('debrief')).toHaveLength(1) // the story still lands in chat
    expect(brainFake.ingests).toHaveLength(0)
    for (const id of oldIds) expect(fakeDb.chat.has(id)).toBe(true) // brainless profiles prune nothing
  })

  it('a nudge-only old day prunes without a digest — engine chatter carries no story', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.reset()
    const nudgeIds = plantDay(-20, (ts0) => [
      { id: 'n-only', role: 'nudge', body: 'stretch break?', ts: ts0 },
    ])
    liveDayStory()
    await debriefMoment()
    expect(fakeDb.chat.has(nudgeIds[0])).toBe(false)
    expect(brainFake.ingests.some((p) => p.slug === `week/${addDaysKey(TUE_KEY, -20)}-chat`)).toBe(
      false
    )
    await vi.advanceTimersByTimeAsync(60_000)
  })

  it('after condensation the export carries exactly what the table still holds — the digest replaced the raw rows', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.reset()
    const oldIds = storyDay(-15)
    liveDayStory()
    await debriefMoment()
    const backup = JSON.parse(await useMew.getState().exportData()) as { chat: ChatMessage[] }
    const exported = new Set(backup.chat.map((m) => m.id))
    for (const id of oldIds) expect(exported.has(id)).toBe(false) // pruned rows are gone for real
    expect(backup.chat.length).toBe(fakeDb.chat.size) // and nothing else went missing
    await vi.advanceTimersByTimeAsync(60_000)
  })
})

/* #153 — honest fallback copy per failure class. When a model adapter fails and
   the rules floor answers, the note must say WHERE the fix lives: Settings for
   a dead key or model id, "rejected" for a model that refused the request (a
   tool-less local model does this every turn), "busy" only for real transients
   — and a retry is claimed ONLY where one actually ran (the local adapter's
   SDK backoff; remote fails fast to the chain, #156). */
describe('honest fallback copy per failure class (#153)', () => {
  /** an AI-SDK-shaped failure: APICallError carries `statusCode` */
  const sdkErr = (statusCode: number) =>
    Object.assign(new Error(`sdk ${statusCode}`), { statusCode })

  async function remoteFail(err: unknown) {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'remote', anthropicKey: 'sk-ant-test' })
    scriptedModel.remoteError = err
    await say('hello pixie')
  }
  async function localFail(err: unknown) {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    scriptedModel.localError = err
    await say('hello pixie')
  }
  const note = () =>
    chat()
      .filter((m) => m.role === 'mew' && m.body.startsWith('('))
      .pop()!

  it('a rejected key (401) points at Settings — never "busy"', async () => {
    await remoteFail(sdkErr(401))
    expect(note().body).toMatch(/your API key was rejected — open Settings to check it/)
    // the rules floor still answered — degradation stayed graceful
    expect(chat().some((m) => /what should the week hold/i.test(m.body))).toBe(true)
  })

  it('an unknown model id (404) points at the model name in Settings', async () => {
    await remoteFail(sdkErr(404))
    expect(note().body).toMatch(/couldn't reach that model — check the model name in Settings/)
  })

  it('a refused request (400) says rejected — not busy, not unreachable', async () => {
    await remoteFail(sdkErr(400))
    expect(note().body).toMatch(/the model rejected that request/)
  })

  it('a remote 429 reads busy WITHOUT claiming a retry that never ran', async () => {
    await remoteFail(sdkErr(429))
    expect(note().body).toMatch(/the model was busy/)
    expect(note().body).not.toMatch(/I retried/)
  })

  it('an unclassifiable failure stays honest: could not reach, no diagnosis invented', async () => {
    await remoteFail(new Error('mystery'))
    expect(note().body).toMatch(/couldn't reach the model just now/)
  })

  it('a local 503 claims its retry truthfully — the SDK backoff really ran (#116)', async () => {
    await localFail(sdkErr(503))
    expect(note().body).toMatch(/the local model was busy — I retried/)
  })

  it('a tool-less local model (400 every turn) reads rejected, not busy', async () => {
    await localFail(sdkErr(400))
    expect(note().body).toMatch(/the model rejected that request/)
    expect(note().body).not.toMatch(/busy/)
  })

  it('a local unknown model tag (404) points at Settings too', async () => {
    await localFail(sdkErr(404))
    expect(note().body).toMatch(/check the model name in Settings/)
  })
})

/* ── #282 — tool-call activity cards: every executor invocation leaves one
   receipt row in the log, born at the seam where tools actually run. The
   scenarios pin the whole lifecycle: append-as-running before the work,
   immutable settle after it, mid-turn chronology (text → card → text),
   persistence + the running→interrupted hydration mapping, the keyless floor,
   and the model-thread exclusion. */
describe('tool-call activity cards (#282)', () => {
  const toolCards = () => chat().filter((m) => m.role === 'tool')
  const deckToday = () =>
    useMew.getState().blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(0)))!

  it('a keyless rules-floor turn leaves one settled card through the same wrappers', async () => {
    /* pre-ritual boot: the cards counted here are the TURN's own — a 9:40
       boot adds the sustenance scaffold's plan receipt (#299, pinned there) */
    await fresh(TUE(8, 0))
    await say('block thursday morning for the deck')

    const cards = toolCards()
    expect(cards).toHaveLength(1)
    expect(cards[0].tool).toMatchObject({ name: 'plan', verb: 'placing blocks', state: 'done' })
    expect(cards[0].tool!.target).toContain('thursday')
    /* the receipt precedes the confirmation — strictly chronological */
    const c = chat()
    const replyIdx = c.findIndex((m) => m.role === 'mew' && /^Done — /.test(m.body))
    expect(c.indexOf(cards[0])).toBeGreaterThanOrEqual(0)
    expect(c.indexOf(cards[0])).toBeLessThan(replyIdx)
    /* persisted settled via the existing chat path */
    expect((fakeDb.chat.get(cards[0].id) as ChatMessage).tool!.state).toBe('done')
  })

  it('mid-turn ordering: a tool call closes the streamed row, so text → card → text lands as two mew rows', async () => {
    await fresh(TUE(8, 0)) // pre-ritual: the first role:'tool' row must be this turn's (#299)
    useMew.getState().updateSettings({ modelLocation: 'local' })
    const target = deckToday()
    scriptedModel.chunks = ['first — ', 'second.']
    scriptedModel.midTurn = (exec) => exec.complete(target.title)
    await say('finish the deck')

    const c = chat()
    const first = c.findIndex((m) => m.role === 'mew' && m.body === 'first — ')
    const card = c.findIndex((m) => m.role === 'tool')
    const second = c.findIndex((m) => m.role === 'mew' && m.body === 'second.')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(second).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(card)
    expect(card).toBeLessThan(second)
    expect(c[first].id).not.toBe(c[second].id) // a NEW mew row after the tool
    /* the closed row persisted at close, the tail at stream end, the card settled */
    expect(fakeDb.chat.get(c[first].id)).toBeDefined()
    expect(fakeDb.chat.get(c[second].id)).toBeDefined()
    expect(c[card].tool).toMatchObject({ name: 'complete', state: 'done' })
    expect(useMew.getState().blocks.find((b) => b.id === target.id)!.status).toBe('done')
  })

  it('the card is on screen as running BEFORE the tool settles (append precedes the work)', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    let midState: string | undefined
    scriptedModel.chunks = ['looking.']
    scriptedModel.midTurn = (exec) => {
      /* async tool: the receipt row exists (running) the moment the executor
         is invoked; it settles when the promise does */
      void exec.queryBrain('how much time has the deck taken this week')
      midState = toolCards().at(-1)?.tool?.state
    }
    await say('how much has the deck eaten')

    expect(midState).toBe('running')
    expect(toolCards().at(-1)!.tool).toMatchObject({
      name: 'queryBrain',
      verb: 'checking what I know',
      state: 'done',
    })
  })

  it('repeat calls in one turn leave distinct cards (one per invocation)', async () => {
    await fresh(TUE(8, 0)) // pre-ritual: card count is this turn's alone (#299)
    useMew.getState().updateSettings({ modelLocation: 'local' })
    scriptedModel.chunks = ['two reads.']
    scriptedModel.midTurn = (exec) => {
      exec.analyze(0)
      exec.analyze(1)
    }
    await say('read today and tomorrow')

    const cards = toolCards()
    expect(cards).toHaveLength(2)
    expect(cards[0].id).not.toBe(cards[1].id)
    expect(cards.map((m) => m.tool!.state)).toEqual(['done', 'done'])
    expect(cards.map((m) => m.tool!.target)).toEqual(['today', 'tomorrow'])
  })

  it('offerChoices leaves no card (its chips ARE the artifact); undo_last_action leaves one', async () => {
    await fresh(TUE(8, 0)) // pre-ritual: card names are this turn's alone (#299)
    useMew.getState().updateSettings({ modelLocation: 'local' })
    scriptedModel.chunks = ['on it.']
    scriptedModel.midTurn = (exec) => {
      exec.plan(
        [{ title: 'deep work', tag: 'work', dayOffset: 1, startMin: 540, durationMin: 60 }],
        []
      )
      exec.offerChoices('keep it?', [
        { label: 'yes', reply: 'keep it' },
        { label: 'no', reply: 'undo that' },
      ])
      exec.undoLast()
    }
    await say('plan tomorrow morning')

    expect(toolCards().map((m) => m.tool!.name)).toEqual(['plan', 'undoLast'])
    expect(toolCards()[1].tool).toMatchObject({ verb: 'putting it back', state: 'done' })
    expect(chat().some((m) => m.choices?.length === 2)).toBe(true) // the chips message itself
  })

  it('a tool that throws settles error with a MEW-voiced note, logs the raw error, and rethrows unchanged', async () => {
    await fresh(TUE(9, 40))
    const captured: { args: unknown[] }[] = []
    setLoggerSink({
      error: (...args: unknown[]) => captured.push({ args }),
      warn: () => {},
      info: () => {},
      debug: () => {},
    })
    try {
      const boom = new Error('ECONNRESET raw provider junk')
      let thrown: unknown = null
      try {
        runToolWithCard('plan', undefined, () => {
          throw boom
        })
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBe(boom) // identity preserved — the model sees the failure exactly as before

      const card = toolCards().at(-1)!
      expect(card.tool).toMatchObject({ name: 'plan', state: 'error', note: TOOL_ERROR_NOTE })
      expect(card.tool!.note).not.toMatch(/ECONNRESET/) // never a raw error in the transcript
      /* the raw error went to the devtools log, labeled by tool */
      const logged = captured.find((c) => String(c.args[0]).endsWith('tool/plan'))
      expect(logged).toBeDefined()
      expect(logged!.args[2]).toMatchObject({ message: 'ECONNRESET raw provider junk' })
      /* the error settle persisted */
      expect((fakeDb.chat.get(card.id) as ChatMessage).tool!.state).toBe('error')
    } finally {
      setLoggerSink(null)
    }
  })

  it('an async tool that rejects settles error and rethrows the same rejection', async () => {
    await fresh(TUE(9, 40))
    const boom = new Error('brain fell over')
    await expect(runToolWithCard('queryBrain', undefined, () => Promise.reject(boom))).rejects.toBe(
      boom
    )
    expect(toolCards().at(-1)!.tool).toMatchObject({ name: 'queryBrain', state: 'error' })
  })

  it('a crash mid-tool replays as interrupted — never a live shimmer from history', async () => {
    await fresh(TUE(9, 40))
    /* what openToolCard persists at append, never settled — the app "died" */
    const crashed: ChatMessage = {
      id: 'crash-1',
      role: 'tool',
      body: '',
      ts: TUE(9, 41).getTime(),
      tool: { name: 'plan', verb: 'placing blocks', target: 'thursday', state: 'running' },
    }
    fakeDb.chat.set(crashed.id, crashed)
    /* reboot over the SAME storage (fresh() would wipe it) */
    useMew.setState(
      {
        ...pristine,
        lastTickDay: dayKey(TUE(9, 42)),
        nowMs: TUE(9, 42).getTime(),
        lastActivityMs: TUE(9, 42).getTime(),
      },
      true
    )
    await useMew.getState().hydrate()

    const card = chat().find((m) => m.id === 'crash-1')!
    expect(card.tool!.state).toBe('interrupted')
    /* storage converged through the same delta putChat the live path uses */
    expect((fakeDb.chat.get('crash-1') as ChatMessage).tool!.state).toBe('interrupted')
  })

  it('buildThread keeps role:tool rows out of the model thread (receipts are for humans)', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' })
    /* even a card that (defensively) carries a body must never ride along */
    useMew.setState((s) => ({
      chat: [
        ...s.chat,
        {
          id: 'card-x',
          role: 'tool' as const,
          body: 'receipt text a model must never see',
          ts: TUE(9, 41).getTime(),
          tool: { name: 'plan', verb: 'placing blocks', state: 'done' as const },
        },
      ],
    }))
    scriptedModel.chunks = ['ok.']
    await say('hello again')

    const thread = scriptedModel.lastThread!
    expect(thread.length).toBeGreaterThan(0)
    expect(thread.some((t) => t.text.includes('receipt text'))).toBe(false)
  })
})

/* ── the tray companion (#283): remote controls, metronome, diff-gate ── */

describe('the tray companion (#283)', () => {
  const lastPush = () => desktopFake.trayPushes[desktopFake.trayPushes.length - 1]

  it('the shell metronome IS a store tick: the clock advances with no webview timer', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    expect(desktopFake.shellTick).toBeTypeOf('function')
    vi.setSystemTime(TUE(9, 47))
    desktopFake.shellTick!()
    expect(useMew.getState().nowMs).toBe(TUE(9, 47).getTime())
  })

  it('tray pushes are diff-gated: countdown-minute flips repaint, raw ticks do not', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    at(TUE(9, 43)) // deck live 9:00–11:30 → 107 min left
    expect(lastPush()).toEqual({ state: 'focus', tooltip: 'Q3 deck — 107 min left' })

    /* two more ticks inside the same minute — same shape, zero repaints */
    const n = desktopFake.trayPushes.length
    at(new Date(2026, 5, 9, 9, 43, 5))
    at(new Date(2026, 5, 9, 9, 43, 20))
    expect(desktopFake.trayPushes.length).toBe(n)

    /* the countdown flips a minute → exactly one repaint */
    at(TUE(9, 44))
    expect(desktopFake.trayPushes.length).toBe(n + 1)
    expect(lastPush().tooltip).toBe('Q3 deck — 106 min left')
  })

  it('the dot walks the day: focus while a block holds you, idle-with-next between, rest in rest', async () => {
    desktopFake.tauri = true
    await fresh(TUE(12, 10)) // standup ended 12:00; lunch at 13:00
    at(TUE(12, 10))
    expect(lastPush()).toEqual({
      state: 'idle',
      tooltip: 'next: Lunch, away from screen at 13:00',
    })
    at(TUE(18, 5)) // Rest — earned, 18:00–19:00
    expect(lastPush()).toEqual({ state: 'rest', tooltip: 'Rest — 55 min left' })
  })

  it("tray 'done' completes the LIVE block through the checkbox door: memory event + celebration", async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    desktopFake.trayAction!('done')
    const s = useMew.getState()
    const today = dayKey(TUE(9, 40))
    const deck = s.blocks.find((b) => b.title === 'Q3 deck — deep work' && b.dayKey === today)!
    expect(deck.status).toBe('done')
    expect(
      s.memory.some(
        (e) => e.kind === 'completed' && e.dayKey === today && e.title === 'Q3 deck — deep work'
      )
    ).toBe(true)
    expect(s.celebratePulse).toBeGreaterThan(0)
  })

  it("tray 'done' with nothing live degrades to a quiet toast — no error, no mutation", async () => {
    desktopFake.tauri = true
    await fresh(TUE(21, 0)) // every block of the day has ended
    const statuses = useMew.getState().blocks.map((b) => `${b.id}:${b.status}`)
    desktopFake.trayAction!('done')
    expect(mirrors.some((m) => m.body === 'nothing live right now — all yours')).toBe(true)
    expect(useMew.getState().blocks.map((b) => `${b.id}:${b.status}`)).toEqual(statuses)
  })

  it("tray 'start next' pulls the next block to now through startNow — the start-by nudge's own door", async () => {
    desktopFake.tauri = true
    await fresh(TUE(12, 10))
    desktopFake.trayAction!('start-next')
    const s = useMew.getState()
    const lunch = s.blocks.find(
      (b) => b.title === 'Lunch, away from screen' && b.dayKey === dayKey(TUE(12, 10))
    )!
    expect(lunch.startMin).toBe(12 * 60 + 10)
    expect(lunch.startedAt).toBe(TUE(12, 10).getTime())
    expect(chat().some((m) => m.role === 'mew' && /^Started — /.test(m.body))).toBe(true)
  })

  it("tray 'start next' with nothing queued stays quiet and positive", async () => {
    desktopFake.tauri = true
    await fresh(TUE(21, 0))
    desktopFake.trayAction!('start-next')
    expect(mirrors.some((m) => m.body === 'nothing queued today — the day is yours')).toBe(true)
  })

  it("tray 'quick-capture' opens the palette on the capture pane; 'open' mutates nothing", async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    const blocksBefore = useMew.getState().blocks
    const capturesBefore = useMew.getState().captures
    desktopFake.trayAction!('quick-capture')
    expect(useMew.getState().commandPaletteOpen).toBe(true)
    expect(useMew.getState().commandPaletteMode).toBe('capture')
    desktopFake.trayAction!('open')
    /* neither route mutates anything itself — the overlay (a human) does */
    expect(useMew.getState().blocks).toBe(blocksBefore)
    expect(useMew.getState().captures).toBe(capturesBefore)
  })

  it('a web run (no shell) never registers tray listeners through the store wire-up', async () => {
    /* the once-guard subscribes on the first tauri=true hydrate of this file;
       what stays pinned here is the observable web contract: with tauri=false
       every push is gated off — ticks repaint nothing */
    desktopFake.tauri = false
    await fresh(TUE(9, 40))
    const n = desktopFake.trayPushes.length
    at(TUE(9, 41))
    at(TUE(9, 42))
    expect(desktopFake.trayPushes.length).toBe(n)
  })
})

/* ── the OS-global capture hotkey (#284): hydrate registers, the shell
   validates rebinds, refusals stay kind ──────────────────────────────── */

describe('the global capture hotkey (#284)', () => {
  const store = () => useMew.getState()

  it('ships enabled by default; hydrate pushes the persisted binding to the shell', async () => {
    expect(DEFAULT_SETTINGS.globalCaptureHotkey).toBe('CmdOrCtrl+Shift+C')
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    expect(desktopFake.hotkeyCalls).toEqual(['CmdOrCtrl+Shift+C'])
    expect(store().hotkeyCollision).toBe(false)
    /* the default persists — the next boot reads it back, not the constant */
    expect((fakeDb.settings as Settings).globalCaptureHotkey).toBe('CmdOrCtrl+Shift+C')
  })

  it('a web run pushes nothing — the shell seam stays untouched', async () => {
    desktopFake.tauri = false
    await fresh(TUE(9, 40))
    expect(desktopFake.hotkeyCalls).toEqual([])
  })

  it('a rebind re-registers through the shell and persists only what the OS accepted', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    const ok = await store().applyCaptureHotkey('Alt+Space')
    expect(ok).toBe(true)
    expect(desktopFake.hotkeyCalls).toEqual(['CmdOrCtrl+Shift+C', 'Alt+Space'])
    expect(store().settings.globalCaptureHotkey).toBe('Alt+Space')
    await settle()
    expect((fakeDb.settings as Settings).globalCaptureHotkey).toBe('Alt+Space')
  })

  it('a refused binding flips the collision flag and keeps the old binding, in Settings and storage', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    desktopFake.hotkeyRefuse = true
    const ok = await store().applyCaptureHotkey('Ctrl+Alt+P')
    expect(ok).toBe(false)
    expect(store().hotkeyCollision).toBe(true)
    expect(store().settings.globalCaptureHotkey).toBe('CmdOrCtrl+Shift+C')
    await settle()
    expect((fakeDb.settings as Settings).globalCaptureHotkey).toBe('CmdOrCtrl+Shift+C')
    /* picking a free key clears the note in the same session — no restart */
    desktopFake.hotkeyRefuse = false
    await store().applyCaptureHotkey('Ctrl+Alt+M')
    expect(store().hotkeyCollision).toBe(false)
    expect(store().settings.globalCaptureHotkey).toBe('Ctrl+Alt+M')
  })

  it('disable releases immediately, persists null, and the next boot re-pushes the release', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    await store().applyCaptureHotkey(null)
    expect(desktopFake.hotkeyCalls).toEqual(['CmdOrCtrl+Shift+C', null])
    expect(store().settings.globalCaptureHotkey).toBeNull()
    await settle()
    /* a re-hydrate (relaunch, or a restore) reads the persisted null — the
       release is pushed again, never a resurrected binding */
    await store().hydrate()
    expect(desktopFake.hotkeyCalls).toEqual(['CmdOrCtrl+Shift+C', null, null])
    expect(store().settings.globalCaptureHotkey).toBeNull()
  })

  it('the trigger rides the tray route: a second fire while already open re-lands, never toggles', async () => {
    desktopFake.tauri = true
    await fresh(TUE(9, 40))
    desktopFake.trayAction!('quick-capture')
    desktopFake.trayAction!('quick-capture')
    expect(store().commandPaletteOpen).toBe(true)
    expect(store().commandPaletteMode).toBe('capture')
  })
})

/* ── #293 · plan mode: propose → pick → byte-exact apply ─────────────────
   Proposing is chat-only data (one picker message, week untouched); the pick
   is the one mutation, routed through the SAME plan executor plan_blocks
   uses. Keyless throughout: the braindump rides the rules floor. */

describe('#293 — plan mode scenario picker', () => {
  const BRAINDUMP =
    'block the deck, block budget review, block a gym session, block inbox sweep, block errands, block reading time'

  /** The keyless propose: braindump in, ONE picker message out. */
  const propose = async () => {
    await fresh(TUE(9, 40))
    await say(BRAINDUMP)
    return lastMsg()
  }

  it('a keyless 6-task braindump posts ONE picker message — ≥2 named, zero-overlap scenarios, week untouched', async () => {
    await fresh(TUE(9, 40))
    const blocksBefore = useMew.getState().blocks
    await say(BRAINDUMP)

    const pickers = chat().filter((m) => (m.scenarios?.length ?? 0) > 0)
    expect(pickers).toHaveLength(1)
    const msg = pickers[0]
    expect(msg.role).toBe('mew')
    expect(msg.body).toMatch(/ways this week could hold it — pick the one that feels right/)
    expect(msg.scenarios!.length).toBeGreaterThanOrEqual(2)
    for (const sc of msg.scenarios!) {
      expect(sc.name).toBeTruthy()
      expect(sc.line).toBeTruthy()
      expect(sc.places.length).toBeGreaterThan(0)
      /* zero-overlap preview: every stored place still lands conflict-free
         against the live week (the post-time validation, re-checked here) */
      expect(validateScenario(useMew.getState().blocks, sc)).toBe(true)
    }
    /* proposing mutated NOTHING — same blocks, and the floor stayed quiet
       (the picker IS the reply; no prose echo behind it) */
    expect(useMew.getState().blocks).toBe(blocksBefore)
    expect(lastMsg().id).toBe(msg.id)
    /* the picker persisted with its scenarios (replay fuel) */
    expect((fakeDb.chat.get(msg.id) as ChatMessage).scenarios!.length).toBe(msg.scenarios!.length)
  })

  it('the pick applies the STORED places byte-exactly through the plan executor', async () => {
    const msg = await propose()
    const sc = msg.scenarios![0]
    const before = useMew.getState().blocks
    const todayKey = dayKey(TUE(9, 40))

    useMew.getState().pickScenario(msg.id, sc.id)

    const after = useMew.getState().blocks
    const added = after.filter((b) => !before.some((p) => p.id === b.id))
    /* the quote landed verbatim: every stored place is a block at exactly the
       previewed day, start, length, title, and tag (outcome deep-equal — the
       executor received the stored places, nothing re-derived) */
    for (const p of sc.places) {
      const landed = added.filter(
        (b) =>
          b.title === p.title &&
          b.tag === p.tag &&
          b.dayKey === addDaysKey(todayKey, p.dayOffset) &&
          b.startMin === p.startMin &&
          b.endMin === p.startMin + p.durationMin
      )
      expect(landed).toHaveLength(1)
    }
    /* nothing else landed except the plan path's own pacing breathers —
       exactly what a plan_blocks call with these places would leave */
    const extras = added.filter((b) => !sc.places.some((p) => p.title === b.title))
    expect(extras.every((b) => b.title === 'Breather' && b.tag === 'rest')).toBe(true)

    /* the receipt card (one executor invocation) + the plan-voice confirmation */
    const card = chat().findLast((m) => m.role === 'tool')!
    expect(card.tool).toMatchObject({ name: 'plan', verb: 'placing blocks', state: 'done' })
    expect(lastMsg().body).toMatch(/^Done — /)

    /* picked persists with the message — the picker rehydrates settled */
    const settled = chat().find((m) => m.id === msg.id)!
    expect(settled.scenarios!.find((x) => x.id === sc.id)!.picked).toBe(true)
    expect(
      (fakeDb.chat.get(msg.id) as ChatMessage).scenarios!.find((x) => x.id === sc.id)!.picked
    ).toBe(true)
  })

  it('liveness is the chips grammar: picked → inert, newer user message → inert', async () => {
    const msg = await propose()
    useMew.getState().pickScenario(msg.id, msg.scenarios![0].id)
    const turns = chat().length
    const blocks = useMew.getState().blocks.length
    /* a second pick — same or sibling scenario — is a no-op */
    useMew.getState().pickScenario(msg.id, msg.scenarios![1].id)
    expect(chat()).toHaveLength(turns)
    expect(useMew.getState().blocks).toHaveLength(blocks)

    /* a fresh picker superseded by a newer user message goes inert unpicked */
    const msg2 = await propose()
    await say('hello')
    const turns2 = chat().length
    const blocks2 = useMew.getState().blocks.length
    useMew.getState().pickScenario(msg2.id, msg2.scenarios![0].id)
    expect(chat()).toHaveLength(turns2)
    expect(useMew.getState().blocks).toHaveLength(blocks2)
    expect(
      scenariosActive(
        chat(),
        chat().find((m) => m.id === msg2.id)!
      )
    ).toBe(false)
  })

  it('a pick mid-turn parks — turnInFlight gates it exactly like pickChoice', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ modelLocation: 'local' }) // the scripted model
    const blocksBefore = useMew.getState().blocks.length
    scriptedModel.chunks = ['on it.']
    scriptedModel.midTurn = (exec) => {
      /* the model posts the picker mid-turn, then a click lands while the
         turn is still mewing — the phase gate must swallow it */
      exec.proposeScenarios('', [
        { title: 'deck', tag: 'work' },
        { title: 'budget review', tag: 'work' },
        { title: 'inbox sweep', tag: 'work' },
      ])
      const m = chat().find((x) => (x.scenarios?.length ?? 0) > 0)!
      useMew.getState().pickScenario(m.id, m.scenarios![0].id)
    }
    await say('plan my week for me')
    expect(useMew.getState().blocks).toHaveLength(blocksBefore) // the mid-turn pick parked

    /* the same pick works once the turn settled — the cards were never dead,
       only parked (what looks pickable is pickable again) */
    const m = chat().find((x) => (x.scenarios?.length ?? 0) > 0)!
    useMew.getState().pickScenario(m.id, m.scenarios![0].id)
    expect(useMew.getState().blocks.length).toBeGreaterThan(blocksBefore)
  })

  it('a stale scenario refuses kindly and re-offers — never a lying apply', async () => {
    const msg = await propose()
    const sc = msg.scenarios![0]
    const todayKey = dayKey(TUE(9, 40))
    /* the week moves under the plan without any user message (a drag, a sync):
       land a fixture block exactly on the first previewed slot */
    const p = sc.places[0]
    useMew.setState((s) => ({
      blocks: [
        ...s.blocks,
        {
          id: 'stale-squatter',
          title: 'Landed meeting',
          tag: 'work' as const,
          dayKey: addDaysKey(todayKey, p.dayOffset),
          startMin: p.startMin,
          endMin: p.startMin + 30,
          protected: true,
          status: 'open' as const,
          calendarRefs: [],
          estimateSource: 'user' as const,
        },
      ],
    }))
    const blocksBefore = useMew.getState().blocks.length

    useMew.getState().pickScenario(msg.id, sc.id)

    /* nothing applied — no previewed title landed, no picked flag */
    expect(useMew.getState().blocks.filter((b) => b.title === p.title)).toHaveLength(0)
    expect(
      chat()
        .find((m) => m.id === msg.id)!
        .scenarios!.some((x) => x.picked)
    ).toBe(false)
    /* the kind refusal + a fresh look (a new live picker or an honest line) */
    const refusal = chat().find((m) =>
      /the week moved under this plan — want a fresh look\?/.test(m.body)
    )
    expect(refusal).toBeDefined()
    const pickers = chat().filter((m) => (m.scenarios?.length ?? 0) > 0)
    expect(pickers.length).toBeGreaterThanOrEqual(2) // the stale one + the fresh offer
    const freshOffer = pickers[pickers.length - 1]
    expect(freshOffer.id).not.toBe(msg.id)
    for (const s2 of freshOffer.scenarios!) {
      expect(validateScenario(useMew.getState().blocks, s2)).toBe(true)
    }
    /* and the squatter's week stands untouched beyond the fixture itself */
    expect(useMew.getState().blocks).toHaveLength(blocksBefore)
  })

  it('"undo that" as the very next turn takes the picked plan back (#162 reach)', async () => {
    const msg = await propose()
    const sc = msg.scenarios![0]
    const before = useMew.getState().blocks
    useMew.getState().pickScenario(msg.id, sc.id)
    expect(useMew.getState().blocks.length).toBeGreaterThan(before.length)

    useMew.getState().updateSettings({ modelLocation: 'local' })
    let undoReply = ''
    scriptedModel.chunks = ['undoing — ', 'done.']
    scriptedModel.midTurn = (exec) => {
      undoReply = exec.undoLast()
    }
    await say('undo that — wrong shape')
    expect(undoReply).toMatch(/^Undone — /)
    expect(useMew.getState().blocks).toHaveLength(before.length)
    expect(useMew.getState().blocks.filter((b) => b.title === sc.places[0].title)).toHaveLength(0)
  })

  it("planMode 'off' keeps the one-pass place; 'always' proposes already at two", async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ planMode: 'off' })
    await say(BRAINDUMP)
    expect(chat().some((m) => (m.scenarios?.length ?? 0) > 0)).toBe(false)
    expect(lastMsg().body).toMatch(/^Done — /) // placed in one pass, today's behavior
    expect(useMew.getState().blocks.some((b) => b.title === 'deck')).toBe(true)

    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ planMode: 'always' })
    await say('block the deck, block budget review')
    const msg = lastMsg()
    expect(msg.scenarios!.length).toBeGreaterThanOrEqual(2)
    expect(useMew.getState().blocks.some((b) => b.title === 'deck')).toBe(false) // still a proposal
  })

  it('the picker replays from persisted chat — settled flags intact, no re-validation at render', async () => {
    const msg = await propose()
    useMew.getState().pickScenario(msg.id, msg.scenarios![0].id)

    /* reload: same storage, fresh store — scenarios and the picked flag came
       back; liveness derives settled without ever touching the week */
    useMew.setState(
      { ...pristine, lastTickDay: dayKey(TUE(9, 41)), nowMs: TUE(9, 41).getTime() },
      true
    )
    await useMew.getState().hydrate()
    const back = chat().find((m) => m.id === msg.id)!
    expect(back.scenarios!.length).toBeGreaterThanOrEqual(2)
    expect(back.scenarios![0].picked).toBe(true)
    expect(scenariosActive(chat(), back)).toBe(false)
  })

  it('one honest shape falls through to prose — no picker theater', async () => {
    await fresh(TUE(9, 40))
    await say('cleanup my calendar so that i could restart and plan')
    useMew.getState().updateSettings({ modelLocation: 'local' })
    let result = ''
    scriptedModel.chunks = ['looking.']
    scriptedModel.midTurn = (exec) => {
      /* one huge task on an empty week: every profile collapses to the same
         earliest fit, the engine dedupes to ONE scenario, and the executor
         suggests it in prose instead of a one-card picker */
      result = exec.proposeScenarios('', [{ title: 'mega build', tag: 'work', durationMin: 600 }])
    }
    await say('plan the mega build')
    expect(result).toMatch(/^One shape fits — /)
    expect(result).toMatch(/mega build/)
    expect(chat().some((m) => (m.scenarios?.length ?? 0) > 0)).toBe(false)
    expect(useMew.getState().blocks.some((b) => b.title === 'mega build')).toBe(false)
  })
})

/* ── #304 — the weekly planning ritual ──────────────────────────────────
   Sunday's shaping invite (once per ISO week, persisted weekKey, heal-safe)
   and the "plan my week" turn: a pure composition of EXISTING tools —
   read-only generation through the #293 picker, one apply on the pick. The
   suite runs the keyless rules floor, so every flow pin here doubles as the
   zero-key proof; the scripted-model scenario pins the keyed shape. */

describe('#304 — the weekly planning ritual', () => {
  /** Sunday, June 14 2026 — its ISO week's Monday is June 8. */
  const SUN = (h: number, m = 0) => new Date(2026, 5, 14, h, m)
  const RITUAL_WEEK = weekKey(SUN(0))
  const restartAt = async (d: Date) => {
    vi.setSystemTime(d)
    useMew.setState(
      { ...pristine, lastTickDay: dayKey(d), nowMs: d.getTime(), lastActivityMs: d.getTime() },
      true
    )
    await useMew.getState().hydrate()
  }
  const queuedRituals = () =>
    useMew.getState().queuedNudges.filter((m) => m.nudgeType === 'weekly-ritual')

  it('fires once on Sunday at the set time — key persisted, restarts held, next ticks silent', async () => {
    await fresh(SUN(17, 5)) // boot tick belongs to the (late) morning brief
    at(SUN(17, 6))
    expect(nudges('weekly-ritual')).toHaveLength(1)
    const card = lastNudge('weekly-ritual')
    expect(card.body).toMatch(/shape the coming week/)
    expect(card.actions).toEqual([{ id: 'plan', label: 'plan my week', kind: 'primary' }])
    /* the dedupe key rides Settings as machine state — one per ISO week */
    expect(fakeDb.settings?.nudgeLastFired?.['weekly-ritual']?.key).toBe(RITUAL_WEEK)
    /* it announces itself by name in the mirror, like the daily rituals */
    expect(mirrors.some((m) => m.title === 'mew — weekly ritual')).toBe(true)

    at(SUN(17, 7))
    at(SUN(17, 20))
    expect(nudges('weekly-ritual')).toHaveLength(1) // once — the key holds

    /* a mid-evening relaunch: the delivered card keeps its key */
    await restartAt(SUN(17, 40))
    at(SUN(17, 41))
    expect(nudges('weekly-ritual')).toHaveLength(1)
  })

  it('restart while parked in quiet hours: the heal re-arms it — one invite, never zero, never two', async () => {
    await fresh(SUN(18, 0))
    useMew.getState().updateSettings({ weeklyRitualMin: 19 * 60 }) // inside default quiet
    /* one nudge per tick: the wind-down cards (debrief, wrap) own the first
       quiet ticks; the ritual takes its own a couple of minutes in — exactly
       the minute-ticker cadence production runs on */
    for (let m = 0; m <= 3 && !queuedRituals().length; m++) {
      useMew.setState({ lastActivityMs: SUN(19, m).getTime() })
      at(SUN(19, m)) // due, but quiet: fired into the queue, chat untouched
    }
    expect(nudges('weekly-ritual')).toHaveLength(0)
    expect(queuedRituals()).toHaveLength(1)
    expect(fakeDb.settings?.nudgeLastFired?.['weekly-ritual']?.key).toBe(RITUAL_WEEK)

    /* the queue dies with the app — chat is the source of truth: this week's
       key with no delivered card drops, so the invite can fire again */
    await restartAt(SUN(19, 30))
    for (let m = 31; m <= 34 && !queuedRituals().length; m++) {
      useMew.setState({ lastActivityMs: SUN(19, m).getTime() })
      at(SUN(19, m))
    }
    expect(nudges('weekly-ritual')).toHaveLength(0)
    expect(queuedRituals()).toHaveLength(1)

    /* Monday morning: quiet ends, the flush delivers exactly one card — and
       Monday itself can never re-fire a Sunday ritual */
    useMew.setState({ lastActivityMs: new Date(2026, 5, 15, 8, 30).getTime() })
    at(new Date(2026, 5, 15, 8, 30))
    expect(nudges('weekly-ritual')).toHaveLength(1)
    at(new Date(2026, 5, 15, 8, 31))
    expect(nudges('weekly-ritual')).toHaveLength(1)
    expect(queuedRituals()).toHaveLength(0)
  })

  it("the chip's words become an ordinary user turn — the nudge invites, the turn works", async () => {
    await fresh(SUN(17, 5))
    at(SUN(17, 6))
    const card = lastNudge('weekly-ritual')
    const blocksBefore = useMew.getState().blocks

    act(card, 'plan')
    await settle()

    /* the chip posted its words through the same speak() door typing uses */
    const userTurns = chat().filter((m) => m.role === 'user')
    expect(userTurns[userTurns.length - 1].body).toBe('plan my week')
    expect(chat().find((m) => m.id === card.id)?.resolved).toBe('plan my week')
    /* the keyless route answered with ONE picker — zero shaping questions
       (the floor has none to ask: fewer questions, same picker) */
    const pickers = chat().filter((m) => (m.scenarios?.length ?? 0) > 0)
    expect(pickers).toHaveLength(1)
    expect(pickers[0].scenarios!.length).toBeGreaterThanOrEqual(2)
    expect(chat().filter((m) => (m.choices?.length ?? 0) > 0)).toHaveLength(0)
    /* generation is read-only — the week is untouched until the pick */
    expect(useMew.getState().blocks).toBe(blocksBefore)
    /* the invite accepted into outcome learning */
    expect(
      useMew
        .getState()
        .memory.some(
          (e: MemoryEvent) =>
            e.kind === 'nudge_outcome' &&
            e.nudgeType === 'weekly-ritual' &&
            e.outcome === 'accepted'
        )
    ).toBe(true)
  })

  it('a seeded 12-meeting week: picker honors the meetings and best hours; the pick lands byte-exact (#102: one apply)', async () => {
    await fresh(SUN(17, 5))
    /* twelve fixed inbound meetings across Mon–Thu afternoons — external by
       source, so "never moved" is the law being exercised, not a courtesy */
    const meetings: typeof pristine.blocks = []
    for (let d = 0; d < 4; d++) {
      for (const [i, startMin] of [13 * 60, 14.5 * 60, 16 * 60].entries()) {
        meetings.push({
          id: `mtg-${d}-${i}`,
          title: `Sync ${d + 1}.${i + 1}`,
          tag: 'work',
          dayKey: addDaysKey(dayKey(SUN(0)), d + 1),
          startMin,
          endMin: startMin + 45,
          protected: true,
          status: 'open',
          calendarRefs: [],
          estimateSource: 'user',
          external: { calId: 'cal-a', eventId: `evt-${d}-${i}` },
        })
      }
    }
    useMew.setState((s) => ({ blocks: [...s.blocks, ...meetings] }))
    const before = useMew.getState().blocks

    await say('plan my week')

    /* ≤3 questions (keyless: zero) → ONE picker, ≥2 scenarios, all valid
       against the live week including all twelve meetings (zero overlaps) */
    expect(chat().filter((m) => (m.choices?.length ?? 0) > 0)).toHaveLength(0)
    const pickers = chat().filter((m) => (m.scenarios?.length ?? 0) > 0)
    expect(pickers).toHaveLength(1)
    const msg = pickers[0]
    expect(msg.scenarios!.length).toBeGreaterThanOrEqual(2)
    for (const sc of msg.scenarios!) {
      expect(sc.places.length).toBeGreaterThan(0)
      expect(validateScenario(useMew.getState().blocks, sc)).toBe(true)
    }
    /* best hours honored: the seeded history wins mornings, so one shape
       lays every deep-work anchor before noon */
    expect(
      msg.scenarios!.some((sc) => {
        const deeps = sc.places.filter((p) => /^Deep work/.test(p.title))
        return deeps.length > 0 && deeps.every((p) => p.startMin < 12 * 60)
      })
    ).toBe(true)
    expect(useMew.getState().blocks).toBe(before) // generation read-only

    /* the pick: stored places land byte-exact through ONE plan invocation */
    const cardsBefore = chat().filter((m) => m.role === 'tool').length
    const sc = msg.scenarios![0]
    useMew.getState().pickScenario(msg.id, sc.id)
    const after = useMew.getState().blocks
    const added = after.filter((b) => !before.some((p) => p.id === b.id))
    for (const p of sc.places) {
      const landed = added.filter(
        (b) =>
          b.title === p.title &&
          b.tag === p.tag &&
          b.dayKey === addDaysKey(sc.todayKey, p.dayOffset) &&
          b.startMin === p.startMin &&
          b.endMin === p.startMin + p.durationMin
      )
      expect(landed).toHaveLength(1)
    }
    const extras = added.filter((b) => !sc.places.some((p) => p.title === b.title))
    expect(extras.every((b) => b.title === 'Breather' && b.tag === 'rest')).toBe(true)
    /* #102 pinned: exactly one executor invocation applied the whole plan */
    const planCards = chat()
      .filter((m) => m.role === 'tool')
      .slice(cardsBefore)
    expect(planCards).toHaveLength(1)
    expect(planCards[0].tool).toMatchObject({ name: 'plan', state: 'done' })
    /* every meeting stands exactly where the calendar put it */
    for (const m of meetings) {
      expect(after.find((b) => b.id === m.id)).toMatchObject({
        dayKey: m.dayKey,
        startMin: m.startMin,
        endMin: m.endMin,
      })
    }
  })

  it('keyed shape: chip questions one per turn, then ONE propose — read-only until the pick', async () => {
    await fresh(SUN(17, 5))
    useMew.getState().updateSettings({ modelLocation: 'local' }) // the scripted model
    const blocksBefore = useMew.getState().blocks

    /* round 1 — the recipe's shaping question rides offer_choices and ends the turn */
    let asked = ''
    scriptedModel.chunks = ['reading the week.']
    scriptedModel.midTurn = (exec) => {
      asked = exec.offerChoices('what matters most this week?', [
        { label: 'the deck', reply: 'the deck matters most — plan the week around it' },
        { label: 'the roadmap', reply: 'the roadmap matters most — plan the week around it' },
      ])
    }
    await say('plan my week')
    expect(asked).toMatch(/^The options are on screen as clickable chips/)
    const question = chat().find((m) => (m.choices?.length ?? 0) > 0)!
    expect(useMew.getState().blocks).toBe(blocksBefore)

    /* the answer arrives as the next user turn; the model closes with ONE propose */
    scriptedModel.chunks = ['here are the shapes.']
    scriptedModel.midTurn = (exec) => {
      exec.proposeScenarios('', [
        { title: 'The deck', tag: 'work', durationMin: 120 },
        { title: 'Deep work I', tag: 'work', durationMin: 90 },
        { title: 'Deep work II', tag: 'work', durationMin: 90 },
      ])
    }
    await useMew.getState().pickChoice(question.id, question.choices![0].id)
    scriptedModel.midTurn = null

    /* one question round (≤3 by recipe), one picker, nothing placed yet */
    expect(chat().filter((m) => (m.choices?.length ?? 0) > 0)).toHaveLength(1)
    const picker = chat().find((m) => (m.scenarios?.length ?? 0) > 0)!
    expect(picker.scenarios!.length).toBeGreaterThanOrEqual(2)
    expect(useMew.getState().blocks).toBe(blocksBefore)

    /* the pick is the one apply */
    useMew.getState().pickScenario(picker.id, picker.scenarios![0].id)
    expect(
      useMew.getState().blocks.filter((b) => b.title === 'The deck' && b.status === 'open')
    ).toHaveLength(1)
  })

  it('the ritual invite survives outside the ritual: "plan my week" typed cold still opens the picker', async () => {
    await fresh(SUN(17, 5)) // no chip involved — the words alone route
    const pickersBefore = chat().filter((m) => (m.scenarios?.length ?? 0) > 0).length
    await say('plan the week')
    const pickers = chat().filter((m) => (m.scenarios?.length ?? 0) > 0)
    expect(pickers.length).toBe(pickersBefore + 1)
    /* and the block grammar never saw it — no "my week"/"the week" block */
    expect(useMew.getState().blocks.some((b) => /^(my|the) week$/i.test(b.title))).toBe(false)
  })
})
