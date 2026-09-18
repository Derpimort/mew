/* #113 follow-up (the peer review's J5): a capture placed by a tap is WRITTEN
   as placed, with its block, and "undo that" writes it back as open with the
   block gone. A reload shows what the screen showed: the item in the inbox or
   its block in the week, never both and never neither. Through the REAL store
   against the fake storage; a reload is a fresh hydrate from what was written.
   A scripted local model fires the undo; no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, Capture, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
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

/* a scripted local model — the recurrence-on-duplicate pin needs a keyed turn
   that fires exec.duplicate() with an rrule (keyless carries no recurrence).
   Provider 'ollama' (modelLocation:'local') runs midTurn; nothing touches net. */
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

async function fresh(
  blocks: Block[],
  memory: MemoryEvent[] = [],
  location: 'remote' | 'local' = 'remote'
) {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  memory.forEach((e) => fakeDb.memory.set(e.id, e))
  /* a connected calendar (id 'c') so external blocks survive hydrate's
     adopt-orphaned-externals sweep; 'import' kind ⇒ no background live sync. */
  fakeDb.settings = {
    ...pristine.settings,
    modelLocation: location,
    calendars: [
      { id: 'c', name: 'Work', who: 'me', provider: 'google', kind: 'import', readOnly: true },
    ],
  }
  vi.setSystemTime(TUE(8, 30))
  useMew.setState(
    {
      ...pristine,
      lastTickDay: TODAY,
      nowMs: TUE(8, 30).getTime(),
      lastActivityMs: TUE(8, 30).getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

const blocks = () => useMew.getState().blocks
const byId = (id: string) => blocks().find((b) => b.id === id)
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

const WED = '2026-06-10'

/** what storage holds for a capture, and whether its block was written */
const stored = (captureId: string) => fakeDb.captures.get(captureId) as Capture | undefined
const storedBlock = (blockId: string) => fakeDb.blocks.has(blockId)

/** a reload: a fresh store hydrated from what was written, same morning */
async function reload() {
  useMew.setState(
    {
      ...pristine,
      lastTickDay: TODAY,
      nowMs: TUE(8, 30).getTime(),
      lastActivityMs: TUE(8, 30).getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

const captureById = (id: string) => useMew.getState().captures.find((c) => c.id === id)

async function placeViaInbox(title: string) {
  const res = useMew.getState().capture(title, { durationMin: 45 })
  const id = res.item!.id
  const offer = useMew
    .getState()
    .inboxOffers()
    .find((o) => o.itemId === id)!
  expect(useMew.getState().placeFromInbox(id, offer)).toBe(true)
  await settle()
  return { id, blockId: captureById(id)!.placedBlockId! }
}

describe('#113 follow-up — a tap-placed capture is written the way it shows', () => {
  it('the inbox confirm writes the capture as placed, with its block; a reload shows the block, not an inbox item', async () => {
    await fresh([])
    const { id, blockId } = await placeViaInbox('email the printer repair')

    expect(stored(id)).toMatchObject({ status: 'placed', placedBlockId: blockId })
    expect(storedBlock(blockId)).toBe(true)

    await reload()
    expect(captureById(id)).toMatchObject({ status: 'placed', placedBlockId: blockId })
    expect(byId(blockId)).toMatchObject({ title: 'email the printer repair', dayKey: TODAY })
  })

  it("the rail's place writes the same", async () => {
    await fresh([])
    await say('call the bank')
    await settle()
    const cap = useMew.getState().captures.find((c) => /call the bank/i.test(c.title))!
    expect(stored(cap.id)).toMatchObject({ status: 'open' })
    useMew.getState().placeCapture(cap.id)
    await settle()
    const blockId = captureById(cap.id)!.placedBlockId!

    expect(stored(cap.id)).toMatchObject({ status: 'placed', placedBlockId: blockId })
    expect(storedBlock(blockId)).toBe(true)

    await reload()
    expect(captureById(cap.id)).toMatchObject({ status: 'placed', placedBlockId: blockId })
    expect(byId(blockId)).toBeDefined()
  })

  it('"undo that" writes the capture back as open and deletes its block; a reload shows the item in the inbox and no block', async () => {
    /* a keyed turn needs a week that isn't brand new (a first run keeps the floor) */
    await fresh(
      [block({ id: 'gym', title: 'Gym', tag: 'health', dayKey: WED, startMin: 420, endMin: 480 })],
      [],
      'local'
    )
    const weekBefore = blocks()
      .map((b) => b.id)
      .sort()
    const { id, blockId } = await placeViaInbox('email the printer repair')
    scriptedModel.midTurn = (exec) => {
      exec.undoLast()
    }
    await say('undo that')
    await settle()

    expect(stored(id)!.status).toBe('open')
    expect(stored(id)!.placedBlockId).toBeUndefined()
    expect(storedBlock(blockId)).toBe(false)

    await reload()
    expect(captureById(id)!.status).toBe('open')
    expect(captureById(id)!.placedBlockId).toBeUndefined()
    expect(byId(blockId)).toBeUndefined()
    expect(
      blocks()
        .map((b) => b.id)
        .sort()
    ).toEqual(weekBefore)
  })
})
