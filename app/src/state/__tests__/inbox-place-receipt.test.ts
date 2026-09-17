/* #21 polish, through the REAL store: placing a captured item (the inbox's
   confirm, or the loose-threads rail's "place") goes through the tool path
   every placement takes: one receipt card in the log, and "undo that" takes the
   block back and returns the item to the inbox. Where it lands is unchanged:
   the placed blocks match rows captured on the RC before this change (bd3c5e1).
   The granular-ops harness (a scripted local model fires undo); no jsdom. */

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

const chat = () => useMew.getState().chat
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

/** the placed block, every field but its fresh id */
const placedRow = (captureId: string) => {
  const cap = useMew.getState().captures.find((c) => c.id === captureId)!
  const { id: _id, ...rest } = byId(cap.placedBlockId!)!
  return rest
}
const toolCards = () => chat().filter((m) => m.role === 'tool')

async function inboxConfirm() {
  const res = useMew.getState().capture('email the printer repair', { durationMin: 45 })
  const id = res.item!.id
  const offer = useMew
    .getState()
    .inboxOffers()
    .find((o) => o.itemId === id)!
  return { id, place: () => useMew.getState().placeFromInbox(id, offer) }
}

describe('#21 — a capture placed from the inbox or the rail leaves a receipt', () => {
  it('the inbox confirm: one receipt card, then the same "Placed" line, on the same block as before', async () => {
    await fresh([])
    const { id, place } = await inboxConfirm()
    const before = chat().length
    expect(place()).toBe(true)

    expect(
      chat()
        .slice(before)
        .map((m) => [m.role, m.body, m.tool ?? null])
    ).toEqual([
      [
        'tool',
        '',
        { name: 'plan', verb: 'placing blocks', target: 'today 12:15–13:00', state: 'done' },
      ],
      ['mew', 'Placed — "email the printer repair" lives today at 12:15.', null],
    ])
    expect(placedRow(id)).toEqual({
      title: 'email the printer repair',
      tag: 'work',
      dayKey: TODAY,
      startMin: 735,
      endMin: 780,
      protected: true,
      status: 'open',
      calendarRefs: [],
      estimateSource: 'user',
    })
  })

  it("the rail's place: the same receipt, on the same block as before", async () => {
    await fresh([])
    await say('call the bank')
    await settle()
    const cap = useMew.getState().captures.find((c) => /call the bank/i.test(c.title))!
    const cards = toolCards().length
    useMew.getState().placeCapture(cap.id)

    expect(toolCards()).toHaveLength(cards + 1)
    expect(toolCards().at(-1)!.tool).toEqual({
      name: 'plan',
      verb: 'placing blocks',
      target: 'today 12:15–12:45',
      state: 'done',
    })
    expect(placedRow(cap.id)).toEqual({
      title: 'call the bank',
      tag: 'work',
      dayKey: TODAY,
      startMin: 735,
      endMin: 765,
      protected: true,
      status: 'open',
      calendarRefs: [],
      estimateSource: 'user',
    })
  })

  it('a slot on another day: the receipt names that day', async () => {
    await fresh([])
    const res = useMew.getState().capture('renew the passport', { durationMin: 45 })
    expect(
      useMew
        .getState()
        .placeFromInbox(res.item!.id, { dayKey: '2026-06-11', startMin: 600, durationMin: 45 })
    ).toBe(true)
    expect(toolCards().at(-1)!.tool).toMatchObject({ target: 'thursday 10:00–10:45' })
  })

  it('"undo that" right after takes the block back and returns the item to the inbox', async () => {
    /* a keyed turn needs a week that isn't brand new (a first run keeps the floor) */
    await fresh(
      [block({ id: 'gym', title: 'Gym', tag: 'health', dayKey: WED, startMin: 420, endMin: 480 })],
      [],
      'local'
    )
    const { id, place } = await inboxConfirm()
    const blocksBefore = blocks().length
    place()
    const placedId = useMew.getState().captures.find((c) => c.id === id)!.placedBlockId!
    expect(byId(placedId)).toBeDefined()

    let undone = ''
    scriptedModel.midTurn = (exec) => {
      undone = exec.undoLast()
    }
    await say('undo that')
    await settle()

    expect(byId(placedId)).toBeUndefined()
    expect(blocks()).toHaveLength(blocksBefore)
    const item = useMew.getState().captures.find((c) => c.id === id)!
    expect(item.status).toBe('open')
    expect(item.placedBlockId).toBeUndefined()
    expect(undone).toBe("Undone — took back the email the printer repair block I'd just placed.")
  })
})
