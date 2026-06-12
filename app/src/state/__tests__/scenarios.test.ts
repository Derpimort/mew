/* Scenario suite — whole user days simulated through the REAL store:
   seed → ticks → conversation → nudges → actions → memory. Adapters are
   faked (in-memory storage, captured notifications); the brain is the
   keyless rules floor, so every scenario is deterministic and offline. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, MemoryEvent, Settings } from '../../domain/types'
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
  reset() {
    this.tauri = false
    this.backup = null
    this.backupDate = null
    this.written = []
    /* updateReady survives reset: the real listener registers once per app
       process and outlives any data wipe — the fake models that lifetime */
    this.applied = 0
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
  desktopFake.reset()
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
    expect(fs.body).toMatch(/Monday/)
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
