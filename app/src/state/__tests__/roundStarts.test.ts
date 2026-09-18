/* #22 slice C — round start times, through the REAL store. AC4 end to end: a
   time-less plan asked at 10:07 lands at 10:30 and find_slot hands the model a
   round window. AC5 as a property over the executor paths the issue names —
   plan (auto-place), move (scorer + first-fit fallback), moveToNextFree, the
   drift nudge's "move" and interrupt: at ragged clocks, around ragged calendar
   events, every block MEW places starts on the 5-minute grid. Adapters faked at
   their seams (the evening.test harness); a scripted local turn hands the test
   the executor. No jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import type { ToolExecutor, WeekContext } from '../../adapters/model/types'

/* ── fakes ────────────────────────────────────────────────────────── */

const fakeDb = {
  blocks: new Map<string, unknown>(),
  captures: new Map<string, unknown>(),
  chat: new Map<string, unknown>(),
  memory: new Map<string, unknown>(),
  settings: null as Settings | null,
  chatAsc(): ChatMessage[] {
    return ([...this.chat.values()] as ChatMessage[]).sort(chatOrder)
  },
  reset() {
    this.blocks.clear()
    this.captures.clear()
    this.chat.clear()
    this.memory.clear()
    this.settings = null
  },
}

vi.mock('../../adapters/storage', () => ({
  createDexieStorage: () => ({
    load: async () => ({
      blocks: [...fakeDb.blocks.values()],
      captures: [...fakeDb.captures.values()],
      chat: fakeDb.chatAsc(),
      memory: [...fakeDb.memory.values()],
      settings: fakeDb.settings,
    }),
    putBlocks: async (bs: { id: string }[]) => bs.forEach((b) => fakeDb.blocks.set(b.id, b)),
    deleteBlocks: async (ids: string[]) => ids.forEach((i) => fakeDb.blocks.delete(i)),
    putCaptures: async (cs: { id: string }[]) => cs.forEach((c) => fakeDb.captures.set(c.id, c)),
    deleteCaptures: async (ids: string[]) => ids.forEach((i) => fakeDb.captures.delete(i)),
    putChat: async (ms: { id: string }[]) => ms.forEach((m) => fakeDb.chat.set(m.id, m)),
    countChat: async () => fakeDb.chat.size,
    loadChatBefore: async () => [],
    loadChatOlderThan: async () => [],
    deleteChat: async (ids: string[]) => ids.forEach((i) => fakeDb.chat.delete(i)),
    putMemory: async (es: { id: string }[]) => es.forEach((e) => fakeDb.memory.set(e.id, e)),
    deleteMemory: async (ids: string[]) => ids.forEach((i) => fakeDb.memory.delete(i)),
    putSettings: async (s: Settings) => {
      fakeDb.settings = s
    },
    loadSyncMap: async () => [],
    saveSyncMap: async () => {},
    deleteSyncForCalendar: async () => {},
    exportJson: async () => '{}',
    importJson: async () => {},
    getAuditLog: async () => [],
    wipe: async () => fakeDb.reset(),
  }),
}))

vi.mock('../../adapters/desktop', () => ({
  isTauri: () => false,
  readBackup: async () => null,
  latestBackupDate: async () => null,
  writeBackup: async () => {},
  registerCloseFlush: () => {},
  backupPath: () => '',
  openBackupFolder: async () => {},
  onUpdateReady: () => {},
  applyUpdate: async () => {},
  brainEndpoint: async () => null,
  brainStatus: async () => null,
  onBrainEndpoint: () => {},
  onBrainStatus: () => {},
  onShellTick: () => {},
  onTrayAction: () => {},
  updateTray: async () => {},
}))

vi.mock('../../adapters/notify', () => {
  const stub = () => ({ mirror: () => {} })
  return { createNotifier: stub, createBrowserNotifier: stub }
})

vi.mock('../../adapters/brain/gbrainHttp', () => ({
  createGbrainHttp: () => ({
    ingest: async () => {},
    recall: async () => [],
    health: async () => false,
    listPrefs: async () => [],
    links: async () => [],
  }),
}))

/* a scripted local model: the turn hands midTurn the real executor and keeps
   the week context it was given. Provider 'ollama' only; nothing touches net. */
const scriptedModel = {
  midTurn: null as null | ((exec: ToolExecutor) => void),
  lastCtx: null as WeekContext | null,
  reset() {
    this.midTurn = null
    this.lastCtx = null
  },
}
vi.mock('../../adapters/model/aiAdapter', () => ({
  createAiAdapter: (spec: { provider: string }) => ({
    id: spec.provider,
    async *converse(_thread: unknown, ctx: unknown, exec: ToolExecutor) {
      if (spec.provider !== 'ollama') throw Object.assign(new Error('offline'), { statusCode: 503 })
      scriptedModel.lastCtx = ctx as WeekContext
      yield 'looking.'
      scriptedModel.midTurn?.(exec)
    },
  }),
}))

import { useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m) // Tuesday, June 9
const TODAY = '2026-06-09'

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Deck',
    tag: 'work',
    dayKey: TODAY,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

async function fresh(blocks: Block[], start: Date) {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  /* a connected import-only calendar keeps ragged externals through hydrate;
     the morning scaffold stays off so the week is exactly as seeded */
  fakeDb.settings = {
    ...pristine.settings,
    modelLocation: 'local',
    sustenance: 'off',
    calendars: [
      { id: 'c', name: 'Work', who: 'me', provider: 'google', kind: 'import', readOnly: true },
    ],
  }
  vi.setSystemTime(start)
  useMew.setState(
    {
      ...pristine,
      lastTickDay: TODAY,
      nowMs: start.getTime(),
      lastActivityMs: start.getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

async function viaTool(call: (exec: ToolExecutor) => string): Promise<string> {
  let out = ''
  scriptedModel.midTurn = (exec) => {
    out = call(exec)
  }
  await useMew.getState().speak('find me time')
  return out
}

const blocks = () => useMew.getState().blocks
const byTitle = (t: string) => blocks().find((b) => b.title === t)
const onGrid = (min: number) => min % 5 === 0

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  scriptedModel.reset()
})

/* ── AC4 end to end ───────────────────────────────────────────────── */

describe('#22 AC4 — MEW proposes human times', () => {
  it('a time-less plan asked at 10:07 on an open morning lands at 10:30', async () => {
    const anchor = block({ id: 'a', title: 'Standup', startMin: 8 * 60, endMin: 8 * 60 + 15 })
    await fresh([anchor], TUE(10, 7))
    await viaTool((exec) =>
      exec.plan({
        places: [{ title: 'Email update', tag: 'work', dayOffset: 0, durationMin: 60 }],
        frees: [],
      })
    )
    expect(byTitle('Email update')).toMatchObject({ dayKey: TODAY, startMin: 10 * 60 + 30 })
  })

  it('find_slot hands the model a round window, never the ragged now', async () => {
    const anchor = block({ id: 'a', title: 'Standup', startMin: 8 * 60, endMin: 8 * 60 + 15 })
    await fresh([anchor], TUE(10, 7))
    const out = await viaTool((exec) => exec.findSlot({ durationMin: 60, dayOffset: 0 }))
    expect(out).toMatch(/^Clear window today: 10:30–11:30 /)
  })

  it('a find_slot fit squeezed by a meeting takes the next quarter instead', async () => {
    const meeting = block({
      id: 'm',
      title: 'Client call',
      startMin: 11 * 60 + 20,
      endMin: 12 * 60,
      external: { calId: 'c', eventId: 'call' },
    })
    await fresh([meeting], TUE(10, 7)) // floor 10:12; :30 would run past 11:20
    const out = await viaTool((exec) => exec.findSlot({ durationMin: 60, dayOffset: 0 }))
    expect(out).toMatch(/^Clear window today: 10:15–11:15 /)
  })
})

/* ── AC5: nothing lands off the 5-minute grid ─────────────────────── */

describe('#22 AC5 — every executor placement starts on the 5-minute grid', () => {
  let seed = 522
  const rand = (k: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed % k
  }
  /** a morning of ragged calendar events plus one flexible block to move */
  const raggedWeek = (): Block[] => {
    const out: Block[] = []
    for (let i = 0; i < 1 + rand(4); i++) {
      const start = 9 * 60 + rand(9 * 60)
      out.push(
        block({
          id: `ext${i}`,
          title: `Sync ${i}`,
          startMin: start,
          endMin: start + 7 + rand(80),
          external: { calId: 'c', eventId: `e${i}` },
        })
      )
    }
    out.push(
      block({
        id: 'flex',
        title: 'Reading',
        tag: 'private',
        startMin: 17 * 60,
        endMin: 17 * 60 + 45,
        protected: false,
      })
    )
    return out
  }
  const clock = () => TUE(9 + rand(10), rand(60))

  it('plan auto-place, move (scorer and first-fit), moveToNextFree, drift:move, interrupt', async () => {
    let checked = 0
    for (let trial = 0; trial < 12; trial++) {
      const expectPlaced = (id: string | undefined, before: Block | undefined) => {
        const b = blocks().find((x) => x.id === id)
        if (!b || (before && b.startMin === before.startMin && b.dayKey === before.dayKey)) return
        expect(onGrid(b.startMin), `${b.title} at ${b.startMin}`).toBe(true)
        checked++
      }

      // plan: the scoring oracle's auto-place (plus any pacing rest it tucks in)
      await fresh(raggedWeek(), clock())
      const before = new Set(blocks().map((b) => b.id))
      await viaTool((exec) =>
        exec.plan({
          places: [
            { title: 'Deep draft', tag: 'work', dayOffset: 0, durationMin: 45 + rand(4) * 15 },
            { title: 'Errand', tag: 'private', dayOffset: 0, durationMin: 20 + rand(3) * 5 },
          ],
          frees: [],
        })
      )
      for (const b of blocks().filter((x) => !before.has(x.id))) expectPlaced(b.id, undefined)

      // move with no time: scorer, then the first-fit fallback
      const flex0 = byTitle('Reading')
      await viaTool((exec) => exec.move({ query: 'Reading', toDayOffset: rand(2) }))
      expectPlaced('flex', flex0)

      // moveToNextFree (now + 15, ragged)
      await fresh(raggedWeek(), clock())
      const flex1 = byTitle('Reading')
      useMew.getState().moveToNextFree('flex')
      expectPlaced('flex', flex1)

      // the drift nudge's "move" action (now + 15, ragged)
      await fresh(raggedWeek(), clock())
      const flex2 = byTitle('Reading')
      const now = useMew.getState().nowMs
      useMew.setState((s) => ({
        chat: [
          ...s.chat,
          {
            id: 'drift-1',
            role: 'nudge',
            body: 'still on Reading?',
            ts: now,
            nudgeType: 'drift',
            actions: [{ id: 'move', label: 'move it', kind: 'primary' }],
            payload: { blockId: 'flex' },
          },
        ],
      }))
      useMew.getState().nudgeAction('drift-1', 'move')
      expectPlaced('flex', flex2)

      // interrupt: the remainder's new home (now + 15, ragged)
      await fresh(raggedWeek(), clock())
      const nowMin =
        new Date(useMew.getState().nowMs).getHours() * 60 +
        new Date(useMew.getState().nowMs).getMinutes()
      const live = block({
        id: 'live',
        title: 'Live work',
        startMin: nowMin - 20,
        endMin: nowMin + 40,
        protected: false,
      })
      useMew.setState((s) => ({ blocks: [...s.blocks, live] }))
      useMew.getState().interruptBlock('live')
      for (const b of blocks().filter((x) => x.title.startsWith('Live work') && x.id !== 'live'))
        expectPlaced(b.id, undefined)
    }
    expect(checked).toBeGreaterThan(24)
  })
})
