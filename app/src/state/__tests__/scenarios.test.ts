/* Scenario suite — whole user days simulated through the REAL store:
   seed → ticks → conversation → nudges → actions → memory. Adapters are
   faked (in-memory storage, captured notifications); the brain is the
   keyless rules floor, so every scenario is deterministic and offline. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, MemoryEvent, PrefPayload, Settings } from '../../domain/types'
import { addDaysKey, dayKey, uid } from '../../domain/time'

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
       same shape the dexie adapter produces — keys stripped on the way out */
    exportJson: async () => {
      const settings = fakeDb.settings ? { ...fakeDb.settings, anthropicKey: '', openaiKey: '' } : fakeDb.settings
      return JSON.stringify({
        blocks: [...fakeDb.blocks.values()],
        captures: [...fakeDb.captures.values()],
        chat: [...fakeDb.chat.values()],
        memory: [...fakeDb.memory.values()],
        settings,
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

vi.mock('../../adapters/notify', () => ({
  createBrowserNotifier: () => ({
    mirror: (o: { title: string; body: string }) => mirrors.push(o),
  }),
}))

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

import { setSidecarBrain } from '../../adapters/brain/sidecar'
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
  useMew.setState({ ...pristine, lastTickDay: dayKey(start), nowMs: start.getTime(), lastActivityMs: start.getTime() }, true)
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
    expect(blocks.some((b) => b.dayKey === thu && /deck/i.test(b.title) && b.startMin === 540)).toBe(true)
    expect(blocks.some((b) => b.dayKey === fri && b.title === 'Kept free' && b.tag === 'rest')).toBe(true)
    expect(lastMsg().body).toMatch(/^Done — /)
  })

  it('a mew celebrates, remembers — and an early finish offers the next task', async () => {
    await fresh(TUE(9, 40))
    const current = useMew.getState().blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(9, 40)))!
    useMew.getState().toggleComplete(current.id)
    expect(chat().some((m) => /That's a mew — one today/.test(m.body))).toBe(true)
    const ev = useMew.getState().memory.findLast((e: MemoryEvent) => e.kind === 'completed')!
    expect(ev).toMatchObject({ title: current.title, startMin: current.startMin, endMin: current.endMin, deep: true })

    /* 110 minutes reclaimed inside the block → next-up offers what fits */
    const nu = lastNudge('next-up')
    expect(nu).toBeDefined()
    expect(nu.body).toMatch(/reclaimed.*fits/i)
    act(nu, 'pull')
    expect(lastMsg().body).toMatch(/Started — /)
  })

  it('an early finish after a long unbroken stretch suggests a micro-break instead', async () => {
    await fresh(TUE(11, 0)) // 2h into the morning, no rest yet
    const current = useMew.getState().blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(0)))!
    useMew.getState().toggleComplete(current.id)
    const mb = lastNudge('micro-break')
    expect(mb).toBeDefined()
    expect(mb.footnote).toContain('Albulescu')
    act(mb, 'take')
    expect(useMew.getState().blocks.some((b) => /Micro-break/.test(b.title) && b.tag === 'rest')).toBe(true)
  })

  it('edits a block in place — "make the prod release 45 mins" actually resizes it', async () => {
    await fresh(TUE(9, 40))
    await say('block thursday morning for the prod release')
    const thu = addDaysKey(dayKey(TUE(9, 40)), 2)
    const before = useMew.getState().blocks.find((b) => b.dayKey === thu && /prod release/i.test(b.title))!
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

  it('"drop the prod release" removes both matching blocks and nothing else', async () => {
    await fresh(TUE(9, 40))
    await say('block 45m for prod release today at 2pm')
    await say('block 45m for prod release tomorrow at 10am')
    const before = useMew.getState().blocks.filter((b) => b.status === 'open').length
    await say('drop the prod release')
    const after = useMew.getState().blocks
    expect(after.filter((b) => /prod release/i.test(b.title))).toHaveLength(0)
    expect(after.filter((b) => b.status === 'open')).toHaveLength(before - 2)
    expect(lastMsg().body).toMatch(/^Removed — /)
  })

  it('placing over an interview names the collision in the reply', async () => {
    await fresh(TUE(9, 40))
    await say('block 1h for interview with pooran today at 1:30pm')
    await say('block 15m for pooran prep today at 1:30pm')
    expect(lastMsg().body).toMatch(/heads up: it overlaps .*interview with pooran 13:30–14:30 \(fixed — it can't move\)/i)
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
    const deck = useMew.getState().blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(9, 40)))!
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
    const followUp = after.find((b) => b.status === 'open' && /Q3 deck/.test(b.title) && b.id !== deck.id)!
    expect(followUp).toBeDefined()
    expect(followUp.startMin).toBeGreaterThan(9 * 60 + 40)
    expect(useMew.getState().memory.some((e) => e.kind === 'rolled' && /Q3 deck/.test(e.title ?? ''))).toBe(true)
    expect(lastMsg().body).toMatch(/Paused — no blame/)
  })

  it('answers "how is my week looking?" from its own pattern history', async () => {
    await fresh(TUE(9, 40))
    await say('how is my week looking?')
    expect(lastMsg().body).toMatch(/history says/i)
    expect(lastMsg().body).toMatch(/mornings hold/i)
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
      useMew.getState().memory.some((e: MemoryEvent) => (e.kind === 'rest_kept' || e.kind === 'rest_skipped') && e.dayKey === dayKey(TUE(0))),
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
    const after = useMew.getState().blocks.filter((b) => b.status === 'open' && b.dayKey >= dayKey(TUE(0)))
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
    expect(useMew.getState().blocks.some((b) => /planning/i.test(b.title) && b.status === 'open')).toBe(true)
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
    expect(useMew.getState().blocks.some((b) => b.title === 'Starter: inbox sweep' && b.status === 'open')).toBe(true)
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
        heavy.push({ id: uid(), ts: TUE(9).getTime(), kind: 'completed', dayKey: mon, plannedMin: 60 })
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
    const deck = useMew.getState().blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(9, 40)))!
    useMew.getState().toggleComplete(deck.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(brainFake.ingests).toHaveLength(0)
  })

  it('brain on: a completion ingests the task page with the day timeline', async () => {
    await fresh(TUE(9, 40))
    useMew.getState().updateSettings({ brainEnabled: true })
    const deck = useMew.getState().blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(9, 40)))!
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
    const deck = useMew.getState().blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(9, 40)))!
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
    useMew.getState().updateSettings({ brainEnabled: true, brainUrl: 'http://my-brain:9999', brainToken: 'mine' })
    expect(brainCfg.current!.url()).toBe('http://my-brain:9999')
    expect(brainCfg.current!.token()).toBe('mine')
    await vi.advanceTimersByTimeAsync(30_000) // drain the queued desktop backup — no ghost timer across tests
  })

  it('desktop sidecar: the rulebook is live too — a brain-held rule shapes the plan, Settings still off', async () => {
    /* the named failure mode of a half-on sidecar: senses writing while the
       always-on rulebook stays dark. The rule lives ONLY in the brain, so the
       sole path to the plan is handshake → pref-cache refresh → applyPrefs. */
    desktopFake.tauri = true
    brainFake.prefs = [{ kind: 'time-default', match: 'gym', value: 'starts 07:00', stated: 'gym is always at 7am' }]
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
    const cap = useMew.getState().captures.find((c) => /hand the doc review thread to robin/i.test(c.title))
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
    const deck = useMew.getState().blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === TUE_KEY)!
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
      '2 mews; the reply to sam slipped 40 past its window; rest held.\ntomorrow opens heavy — 8h against your 5.5.',
    )
    expect(db[0].actions ?? []).toHaveLength(0)

    /* durable, not just chat: the story lands on the day page's timeline */
    await vi.advanceTimersByTimeAsync(0)
    const page = brainFake.ingests.find(
      (p) =>
        p.slug === `week/${TUE_KEY}` &&
        (p as { timeline?: { summary: string }[] }).timeline?.[0]?.summary.startsWith('debrief:'),
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
    await say('delete standup')
    expect(useMew.getState().blocks.find((x) => x.id === 'cal-1')).toBeUndefined()
    expect(useMew.getState().settings.dismissedEvents).toContain('work@acme:ev-standup')
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
    useMew.setState((st) => ({ memory: [...st.memory, prepDone(2, 40), prepDone(5, 40), prepDone(9, 40)] }))
    await say('block interview prep tomorrow')
    const placed = useMew.getState().blocks.find((b) => /interview prep/i.test(b.title) && b.status === 'open')
    expect(placed).toBeDefined()
    expect(placed!.endMin - placed!.startMin).toBe(40)
    expect(lastMsg().body).toContain('(your usual)')
  })

  it('an explicit duration always wins over the usual', async () => {
    await fresh(TUE(9, 40))
    useMew.setState((st) => ({ memory: [...st.memory, prepDone(2, 40), prepDone(5, 40), prepDone(9, 40)] }))
    /* 50m fits tomorrow's 60-minute gap; 40 is the usual — explicit wins */
    await say('block 50m for interview prep tomorrow')
    const placed = useMew.getState().blocks.find((b) => /interview prep/i.test(b.title) && b.status === 'open')
    expect(placed!.endMin - placed!.startMin).toBe(50)
    expect(lastMsg().body).not.toContain('(your usual)')
  })

  it('two preps are an anecdote: the 60-minute floor stands, uncredited', async () => {
    await fresh(TUE(9, 40))
    useMew.setState((st) => ({ memory: [...st.memory, prepDone(2, 40), prepDone(5, 40)] }))
    await say('block interview prep tomorrow')
    const placed = useMew.getState().blocks.find((b) => /interview prep/i.test(b.title) && b.status === 'open')
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
    const deck = useMew.getState().blocks.find((b) => /Q3 deck/.test(b.title) && b.dayKey === dayKey(TUE(9, 40)))!
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
    desktopFake.backup = JSON.stringify({ blocks: [], captures: [], chat: [], memory: [], settings: null })
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
    desktopFake.backup = JSON.stringify({ blocks: [restored], captures: [], chat: [], memory: [], settings: null })
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
    desktopFake.backup = JSON.stringify({ blocks: [], captures: [], chat: [], memory: [], settings: null })
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
    const dep = useMew.getState().blocks.find((b) => b.dayKey === tomorrow && /deploy/i.test(b.title))!
    expect(dep.endMin - dep.startMin).toBe(45)
  })

  it('move-collision wording follows the rulebook: landing on a pref-flexed sync reads flexible', async () => {
    await fresh(TUE(9, 40))
    await say('remember that the design sync always moves')
    await say('block design sync tomorrow at 10')
    await say('block deck work tomorrow at 14')
    await say('move deck work to tomorrow at 10')
    expect(lastMsg().body).toContain('flexible — it can shift')
    expect(lastMsg().body).not.toContain("can't move")
  })
})

/* ── pref-drift: the rulebook follows the life it describes ──────────── */

describe('pref-drift validation', () => {
  /** seed the rule, then live three gym evenings against it */
  async function liveAgainstTheRule() {
    await fresh(TUE(9, 40))
    await say('remember that gym is always at 7am')
    for (const [day, hour] of [[-3, 18], [-2, 18.5], [-1, 19]] as const) {
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
      useMew.getState().blocks.filter((b) => /sprint planning/i.test(b.title) && b.status === 'open'),
    ).toHaveLength(1)
    await say('block 1h for sprint planning today at 4pm') // plan-not-move: would have twinned
    const open = useMew.getState().blocks.filter((b) => /sprint planning/i.test(b.title) && b.status === 'open')
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
