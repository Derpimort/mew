/* Round-3 pin (#147 review): MEW's own scaffolding can never become a PAUSED
   thread in the loose-threads rail. That rail is safe today for a reason worth
   holding: `paused` lists open blocks a ROLLED block points at, and a seeded meal
   or a tucked-in breather can never be rolled — isRollCandidate carries
   !placedBy (#123) and rollForward re-checks that gate on the ids handed to it,
   so even a stray id refuses. Nothing pinned the two together, so an edit to the
   roll gate could quietly re-open the surface #147 just closed. Test-only; real
   store, adapters faked at their seams (the roll-forward harness); no jsdom. */

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

/* the brain's ingest records every page, so a pin can hear a roll the way the
   brain does (a block page tagged with its event kind) */
const brainIngest = vi.hoisted(() => ({ pages: [] as { tags?: string[]; body?: string }[] }))
vi.mock('../../adapters/brain/gbrainHttp', () => ({
  createGbrainHttp: () => ({
    ingest: async (page: { tags?: string[]; body?: string }) => {
      brainIngest.pages.push(page)
    },
    recall: async () => [],
    health: async () => false,
    listPrefs: async () => [],
    links: async () => [],
  }),
}))

/* a scripted local model — the undo pin needs a keyed turn that fires
   exec.undoLast() (the keyless floor has no undo route). Provider 'ollama'
   (modelLocation:'local') runs midTurn; nothing touches the network. */
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

import * as week from '../../domain/week'
import { useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const FRI = new Date(2026, 5, 12, 10, 0) // Friday June 12 2026, the review's day
const TODAY = '2026-06-12'
const NEXT = '2026-06-15' // next week's Monday: the roll's target week
const WED = '2026-06-10'

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Roadmap draft',
    tag: 'work',
    dayKey: WED,
    startMin: 10 * 60,
    endMin: 11 * 60,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

async function fresh(
  blocks: Block[],
  memory: MemoryEvent[] = [],
  location: 'remote' | 'local' = 'remote'
) {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  memory.forEach((e) => fakeDb.memory.set(e.id, e))
  fakeDb.settings = { ...pristine.settings, modelLocation: location }
  vi.setSystemTime(FRI)
  useMew.setState(
    { ...pristine, lastTickDay: TODAY, nowMs: FRI.getTime(), lastActivityMs: FRI.getTime() },
    true
  )
  await useMew.getState().hydrate()
}

const blocks = () => useMew.getState().blocks
const byId = (id: string) => blocks().find((b) => b.id === id)
const titled = (title: string) => blocks().filter((b) => b.title === title)
const roll = (ids: string[]) => useMew.getState().rollForward(ids, NEXT)
/** the review's carried ids among `ids` (hydrate's day scaffold adds today's
    meals, which are carried too and not this suite's business) */
const carriedIds = (...ids: string[]) =>
  useMew
    .getState()
    .openWeeklyReview()
    .carried.map((b) => b.id)
    .filter((id) => ids.includes(id))
    .sort()

beforeEach(() => {
  vi.useFakeTimers()
  brainIngest.pages.length = 0
})
afterEach(() => {
  vi.useRealTimers()
  scriptedModel.reset()
})

/* ── the roll moves the work ─────────────────────────────────────── */
/* ── the pin ─────────────────────────────────────────────────────── */

const paused = () => {
  const s = useMew.getState()
  return week
    .looseThreads(s.blocks, s.captures, TODAY, 12 * 60)
    .paused.map((b) => b.id)
    .sort()
}
const own = () =>
  block({ id: 'deck', title: 'Deck polish', dayKey: TODAY, startMin: 9 * 60, endMin: 10 * 60 })
const seededLunch = () =>
  block({
    id: 'lunch',
    title: 'Lunch',
    tag: 'private',
    dayKey: TODAY,
    startMin: 12 * 60,
    endMin: 12 * 60 + 45,
    placedBy: 'sustenance',
  })
const breather = () =>
  block({
    id: 'breather',
    title: 'Breather',
    tag: 'rest',
    dayKey: TODAY,
    startMin: 15 * 60,
    endMin: 15 * 60 + 15,
    placedBy: 'pacing',
  })

describe("MEW's own scaffolding never becomes a paused thread (#147 review)", () => {
  it("the mechanism is live: the owner's own block, rolled, IS a paused thread", async () => {
    /* the control — without it, an empty `paused` would prove nothing */
    await fresh([own()])
    roll(['deck'])
    expect(byId('deck')!.status).toBe('rolled')
    expect(paused()).toEqual([byId('deck')!.rolledToId!].sort())
  })

  it('a seeded meal and a breather handed straight to rollForward refuse, so the rail stays empty', async () => {
    await fresh([seededLunch(), breather()])
    roll(['lunch', 'breather'])
    /* nothing rolled, nothing copied, and nothing points at them */
    expect(byId('lunch')!.status).toBe('open')
    expect(byId('breather')!.status).toBe('open')
    expect(byId('lunch')!.rolledToId).toBeUndefined()
    expect(byId('breather')!.rolledToId).toBeUndefined()
    expect(titled('Lunch').length).toBe(1)
    expect(titled('Breather').length).toBe(1)
    expect(paused()).toEqual([])
  })

  it("a mixed pick rolls only the owner's own work, and only that shows as paused", async () => {
    /* the shape that would slip past a meals-only reading of the gate */
    await fresh([own(), seededLunch(), breather()])
    roll(['deck', 'lunch', 'breather'])
    expect(byId('deck')!.status).toBe('rolled')
    expect(byId('lunch')!.status).toBe('open')
    expect(byId('breather')!.status).toBe('open')
    expect(paused()).toEqual([byId('deck')!.rolledToId!].sort())
  })

  it('a follow-up that is finished leaves the rail: paused is open work only', async () => {
    /* found by mutating the rail rather than the gate — nothing across the three
       loose-threads suites required `paused` to be OPEN, so a ticked-off
       follow-up would have kept sitting there as a loose end */
    await fresh([own()])
    roll(['deck'])
    const copy = byId('deck')!.rolledToId!
    expect(paused()).toEqual([copy])
    useMew.getState().toggleComplete(copy)
    expect(byId(copy)!.status).toBe('done')
    expect(paused()).toEqual([])
  })

  it('and the review never offers them, so the id could only ever arrive by mistake', async () => {
    await fresh([own(), seededLunch(), breather()])
    expect(carriedIds('deck', 'lunch', 'breather')).toEqual(['deck'])
  })
})
