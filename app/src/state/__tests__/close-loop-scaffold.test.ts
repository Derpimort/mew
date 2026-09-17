/* close-the-loop never lists MEW's own scaffolding (#123's class on another
   surface, from coderpb's #138 review): a lunch or dinner the sustenance
   scaffold seeded isn't unfinished work. It doesn't hold the day open, the
   evening close-the-loop never offers to roll it, and the day-end rest log
   doesn't count it as work left open. A meal the owner named still is theirs.
   Real store (keyless floor); no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import * as week from '../../domain/week'

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

/* a scripted local model for the steps the keyless floor has no words for (an
   "undo that" fires exec.undoLast()). Provider 'ollama' (modelLocation:'local')
   runs midTurn; any other provider throws offline, so the floor answers. Nothing
   touches the network. */
const scriptedModel = {
  chunks: [] as string[],
  midTurn: null as null | ((exec: import('../../adapters/model').ToolExecutor) => void),
  reset() {
    this.chunks = []
    this.midTurn = null
  },
}
vi.mock('../../adapters/model/aiAdapter', () => ({
  createAiAdapter: (spec: { provider: string }) => ({
    id: spec.provider,
    async *converse(
      _thread: unknown,
      _ctx: unknown,
      exec: import('../../adapters/model').ToolExecutor
    ) {
      if (spec.provider !== 'ollama') throw Object.assign(new Error('offline'), { statusCode: 503 })
      const [first, ...rest] = scriptedModel.chunks
      if (first) yield first
      scriptedModel.midTurn?.(exec)
      for (const c of rest) yield c
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

const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** a fresh store on `at` (default Tuesday 8:30), hydrated from exactly `seed`:
    no seeded meals unless a journey asks for them, a connected calendar 'c' so
    [calendar] blocks survive hydrate, and the keyless floor unless `location`
    says 'local' (a scripted model then runs midTurn). */
async function fresh(
  seed: Block[],
  opts: {
    at?: Date
    location?: 'remote' | 'local'
    memory?: MemoryEvent[]
    settings?: Partial<Settings>
  } = {}
) {
  const at = opts.at ?? TUE(8, 30)
  fakeDb.reset()
  seed.forEach((b) => fakeDb.blocks.set(b.id, b))
  ;(opts.memory ?? []).forEach((e) => fakeDb.memory.set(e.id, e))
  fakeDb.settings = {
    ...pristine.settings,
    modelLocation: opts.location ?? 'remote',
    sustenance: 'off',
    calendars: [
      { id: 'c', name: 'Work', who: 'me', provider: 'google', kind: 'import', readOnly: true },
    ],
    ...opts.settings,
  }
  vi.setSystemTime(at)
  useMew.setState(
    {
      ...pristine,
      lastTickDay: keyOf(at),
      nowMs: at.getTime(),
      lastActivityMs: at.getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

const chat = () => useMew.getState().chat
const blocks = () => useMew.getState().blocks
const settle = async () => {
  await Promise.resolve()
  vi.advanceTimersByTime(1)
  await Promise.resolve()
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  scriptedModel.reset()
})

/* ── fixtures ─────────────────────────────────────────────────────── */

const seeded = { settings: { sustenance: 'on' as const }, at: TUE(8, 45) }
const deck = () => block({ id: 'deck', title: 'Deck', startMin: 540, endMin: 600 })
const nudges = (from: number) =>
  chat()
    .slice(from)
    .filter((m) => m.role === 'nudge')
    .map((m) => `${m.nudgeType}: ${m.body}`)

describe("close-the-loop and the day's open items leave MEW's seeded meals out", () => {
  it("the repro: the owner's work is done, so the day is clear and 18:05 offers nothing to roll", async () => {
    await fresh([deck()], seeded)
    expect(
      blocks()
        .filter((b) => b.placedBy === 'sustenance')
        .map((b) => b.title)
    ).toEqual(['Lunch', 'Dinner'])
    useMew.getState().toggleComplete('deck')
    await settle()
    expect(week.openItems(blocks(), TODAY)).toEqual([])
    expect(week.dayClear(blocks(), TODAY)).toBe(true)

    const from = chat().length
    vi.setSystemTime(TUE(18, 5))
    useMew.getState().tick()
    await settle()
    expect(nudges(from).filter((n) => n.startsWith('close-loop'))).toEqual([])
  })

  it('a meal the owner named is still theirs: close-the-loop offers it', async () => {
    await fresh(
      [
        deck(),
        block({ id: 'sam', title: 'lunch with sam', tag: 'private', startMin: 780, endMin: 840 }),
      ],
      seeded
    )
    useMew.getState().toggleComplete('deck')
    await settle()
    expect(week.openItems(blocks(), TODAY).map((b) => b.title)).toEqual(['lunch with sam'])

    const from = chat().length
    vi.setSystemTime(TUE(18, 5))
    useMew.getState().tick()
    await settle()
    expect(nudges(from).filter((n) => n.startsWith('close-loop'))).toEqual([
      "close-loop: lunch with sam isn't done — shall it live tomorrow at 9:00? Then let it go for tonight.",
    ])
  })

  it("the day-end rest log doesn't count a seeded meal as work left open", async () => {
    await fresh(
      [
        deck(),
        block({ id: 'walk', title: 'Evening walk', tag: 'rest', startMin: 1200, endMin: 1245 }),
      ],
      seeded
    )
    useMew.getState().toggleComplete('deck')
    await settle()
    vi.setSystemTime(new Date(2026, 5, 10, 0, 5))
    useMew.getState().tick()
    await settle()
    const restLog = useMew
      .getState()
      .memory.filter(
        (e) => (e.kind === 'rest_kept' || e.kind === 'rest_skipped') && e.dayKey === TODAY
      )
      .map((e) => e.kind)
    expect(restLog).toEqual(['rest_kept'])
  })

  it("the scaffold marks only what it placed: the owner's blocks already on the day stay unmarked (#138 R5)", async () => {
    await fresh(
      [
        deck(),
        block({ id: 'sam', title: 'lunch with sam', tag: 'private', startMin: 780, endMin: 840 }),
      ],
      seeded
    )
    expect(blocks().filter((b) => b.placedBy).length).toBeGreaterThan(0)
    expect(blocks().find((b) => b.id === 'deck')!.placedBy).toBeUndefined()
    expect(blocks().find((b) => b.id === 'sam')!.placedBy).toBeUndefined()
  })
})
