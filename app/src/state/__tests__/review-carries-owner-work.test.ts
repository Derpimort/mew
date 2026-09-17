/* #123: the weekly review's "carried" list is the owner's unfinished work. The
   breathers MEW's pacing tucks in and the meals its sustenance scaffold places
   are MEW's own scaffolding: marked when placed (placedBy), never offered to
   roll into next week, and never rolled even when their ids are handed in. A
   meal or rest the owner named stays rollable. Through the REAL store; no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'

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
const say = (text: string) => useMew.getState().speak(text)
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

const FRI = (h: number, m = 0) => new Date(2026, 5, 12, h, m)
const FRIDAY = '2026-06-12'
const WED = '2026-06-10'
const NEXT_MON = '2026-06-15'
const carried = () =>
  useMew
    .getState()
    .openWeeklyReview()
    .carried.map((b) => b.title)
    .sort()
/** Friday: a Wednesday draft, and a spec review with a calendar call inside it */
const friday = () => [
  block({
    id: 'roadmap',
    title: 'Roadmap draft',
    dayKey: WED,
    startMin: 600,
    endMin: 660,
    protected: false,
  }),
  block({ id: 'spec', title: 'Spec review', dayKey: FRIDAY, startMin: 780, endMin: 900 }),
  block({
    id: 'call',
    title: 'Client call',
    dayKey: FRIDAY,
    startMin: 840,
    endMin: 870,
    protected: false,
    calendarRefs: ['c'],
    external: { calId: 'c', eventId: 'cc' },
  }),
]

describe("#123 — carried is the owner's work, not MEW's scaffolding", () => {
  it("a split's pacing breather is marked MEW's and isn't carried; the split's pieces are", async () => {
    await fresh(friday(), { at: FRI(10, 0) })
    await say('split the spec review around the 2pm call')
    await settle()
    const breather = blocks().find((b) => b.title === 'Breather')!
    expect(breather).toMatchObject({ tag: 'rest', placedBy: 'pacing' })
    expect(carried()).toEqual(['Roadmap draft', 'Spec review', 'Spec review (part 2)'])
  })

  it("the sustenance scaffold's meals are marked MEW's and aren't carried; a lunch the owner named is", async () => {
    await fresh(friday(), { at: FRI(10, 0), settings: { sustenance: 'on' } })
    const meals = blocks().filter((b) => b.title === 'Lunch' || b.title === 'Dinner')
    expect(meals.map((b) => [b.title, b.placedBy])).toEqual([
      ['Lunch', 'sustenance'],
      ['Dinner', 'sustenance'],
    ])
    await say('block 1h for lunch with sam at 13:00 tomorrow')
    await settle()
    expect(blocks().find((b) => b.title === 'lunch with sam')?.placedBy).toBeUndefined()

    expect(carried()).toContain('lunch with sam')
    expect(carried()).not.toContain('Lunch')
    expect(carried()).not.toContain('Dinner')
  })

  it('handing a breather to rollForward rolls nothing: the gate is the same predicate', async () => {
    await fresh(friday(), { at: FRI(10, 0) })
    await say('split the spec review around the 2pm call')
    await settle()
    const breather = blocks().find((b) => b.title === 'Breather')!
    const before = chat().length

    useMew.getState().rollForward([breather.id], NEXT_MON)
    await settle()
    expect(blocks().find((b) => b.id === breather.id)!.status).toBe('open')
    expect(blocks().filter((b) => b.dayKey >= NEXT_MON)).toEqual([])
    expect(chat().length).toBe(before)
  })

  it('the mark is stored: after a reload the breather is still not carried', async () => {
    await fresh(friday(), { at: FRI(10, 0) })
    await say('split the spec review around the 2pm call')
    await settle()
    const id = blocks().find((b) => b.title === 'Breather')!.id
    expect((fakeDb.blocks.get(id) as Block).placedBy).toBe('pacing')

    useMew.setState(
      {
        ...pristine,
        lastTickDay: FRIDAY,
        nowMs: FRI(10, 5).getTime(),
        lastActivityMs: FRI(10, 5).getTime(),
      },
      true
    )
    await useMew.getState().hydrate()
    expect(carried()).toEqual(['Roadmap draft', 'Spec review', 'Spec review (part 2)'])
  })
})
