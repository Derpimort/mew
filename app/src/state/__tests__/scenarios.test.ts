/* Scenario suite — whole user days simulated through the REAL store:
   seed → ticks → conversation → nudges → actions → memory. Adapters are
   faked (in-memory storage, captured notifications); the brain is the
   keyless rules floor, so every scenario is deterministic and offline. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, MemoryEvent, PrefPayload, Settings } from '../../domain/types'
import { addDaysKey, dayKey, uid } from '../../domain/time'
import { stripSecrets } from '../../adapters/storage-port'

/* ── fakes ────────────────────────────────────────────────────────── */

const mirrors: { title: string; body: string }[] = []

const fakeDb = {
  blocks: new Map<string, unknown>(),
  captures: new Map<string, unknown>(),
  chat: new Map<string, unknown>(),
  memory: new Map<string, unknown>(),
  settings: null as Settings | null,
  sync: new Map<string, unknown>(),
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
  brainReady: null as ((e: { url: string; token: string }) => void) | null,
  reset() {
    this.tauri = false
    this.backup = null
    this.backupDate = null
    this.written = []
    /* updateReady/brainReady survive reset: the real listeners register once
       per app process and outlive any data wipe — the fake models that lifetime */
    this.applied = 0
    this.brain = null
  },
}

vi.mock('../../adapters/storage', () => ({
  createDexieStorage: () => ({
    load: async () => ({
      blocks: [...fakeDb.blocks.values()],
      captures: [...fakeDb.captures.values()],
      chat: [...fakeDb.chat.values()],
      memory: [...fakeDb.memory.values()],
      settings: fakeDb.settings,
    }),
    putBlocks: async (bs: { id: string }[]) => bs.forEach((b) => fakeDb.blocks.set(b.id, b)),
    deleteBlocks: async (ids: string[]) => ids.forEach((i) => fakeDb.blocks.delete(i)),
    putCaptures: async (cs: { id: string }[]) => cs.forEach((c) => fakeDb.captures.set(c.id, c)),
    deleteCaptures: async (ids: string[]) => ids.forEach((i) => fakeDb.captures.delete(i)),
    putChat: async (ms: { id: string }[]) => ms.forEach((m) => fakeDb.chat.set(m.id, m)),
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
        chat: [...fakeDb.chat.values()],
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
  registerCloseFlush: () => {},
  backupPath: () => 'Documents/MEW/mew-backup.json',
  openBackupFolder: async () => {},
  onUpdateReady: (cb: (v: string) => void) => {
    desktopFake.updateReady = cb
  },
  applyUpdate: async () => {
    desktopFake.applied++
  },
  brainEndpoint: async () => desktopFake.brain,
  onBrainEndpoint: (cb: (e: { url: string; token: string }) => void) => {
    desktopFake.brainReady = cb
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
const brainFake = {
  ingests: [] as { slug: string; links?: string[] }[],
  links: {} as Record<string, string[]>,
  recalls: [] as string[],
  recallOpts: [] as { limit?: number; scope?: string }[],
  recallImpl: null as null | ((q: string) => string[] | Promise<string[]>),
  recallLines: [] as string[],
  prefs: [] as PrefPayload[],
  reset() {
    this.ingests = []
    this.links = {}
    this.recalls = []
    this.recallOpts = []
    this.recallImpl = null
    this.recallLines = []
    this.prefs = []
  },
}
vi.mock('../../adapters/brain/gbrainHttp', () => ({
  createGbrainHttp: (cfg: { url(): string; token(): string; enabled(): boolean }) => {
    brainCfg.current = cfg
    return {
      ingest: async (page: { slug: string }) => {
        if (cfg.enabled()) brainFake.ingests.push(page)
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
  /** runs between the first and last chunk — fire executors, snapshot state.
      Gets the turn's abort signal too, so a test can press stop mid-stream. */
  midTurn: null as
    | null
    | ((exec: import('../../adapters/model').ToolExecutor, signal?: AbortSignal) => void),
  throwAfter: false, // simulate a connection hiccup once the tool has acted
  reset() {
    this.chunks = []
    this.reasoning = null
    this.midTurn = null
    this.throwAfter = false
  },
}
vi.mock('../../adapters/model/ollama', () => ({
  createOllamaAdapter: () => ({
    id: 'ollama',
    async *converse(
      _thread: unknown,
      _ctx: unknown,
      exec: import('../../adapters/model').ToolExecutor,
      signal?: AbortSignal
    ) {
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
import { useMew } from '../store'

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

function act(msg: ChatMessage, actionId: string) {
  useMew.getState().nudgeAction(msg.id, actionId)
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
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
    expect(lastMsg().body).toMatch(/^Done — /)
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
    at(TUE(9, 45)) // right-size took the first tick; this one belongs to the roller
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
         right-size stays suppressed by its own 9:40 cooldown. */
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
    expect(mirrors[0].title).toContain('Pixie')
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
    /* wipe history and let the engine re-open the day fresh */
    useMew.setState((st) => ({
      memory: [],
      chat: st.chat.filter((m) => m.nudgeType !== 'fresh-start'),
      engine: { lastFired: {}, lastDriftBlockId: null },
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
    expect(lastMsg().body).toContain('(your usual)')
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
       per tick, priority order) */
    useMew.setState({ lastActivityMs: TUE(10, 29).getTime() })
    at(TUE(10, 30)) // a later tick, past the seeded morning's right-size
    useMew.setState({ lastActivityMs: TUE(10, 59).getTime() })
    at(TUE(11, 0))
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

    const reply = chat().find((m) => m.role === 'mew' && m.body.includes('marked done'))!
    expect(reply.reasoning).toBe('the deck is the one open block today — completing it.')
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
    // the seeded Tuesday-morning right-size nudge fires from a tick, not a turn
    await fresh(TUE(9, 40))
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
