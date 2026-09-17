/* #122, through the REAL store: work placed over a protected rest is named in
   the placement reply. The rest never drifts (protect-rest owns sacred rest) and
   protect-rest asks once per rest per day (#326, #115), so once the owner kept
   a rest, a new placement over that same rest used to go unmentioned
   everywhere. Now the reply says the time it runs over, whether or not the rest
   has been asked about. Keyless; adapters faked at their seams (the
   batch-blocks harness); no jsdom. */

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
    sustenance: 'off', // the fixtures are the whole week: no seeded meals
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

const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body
const restAsks = () => chat().filter((m) => / is set to run over your /.test(m.body))
const walk = () =>
  block({ id: 'walk', title: 'Evening walk', tag: 'rest', startMin: 18 * 60, endMin: 18 * 60 + 45 })
const deck = () =>
  block({
    id: 'deck',
    title: 'Deck',
    protected: false,
    startMin: 17 * 60 + 30,
    endMin: 18 * 60 + 30,
  })
const tickAt = (h: number, m = 0) => {
  vi.setSystemTime(TUE(h, m))
  useMew.getState().tick()
}

describe('#122 — a new placement over a kept rest still names the overlap', () => {
  it('the issue: Keep it, then "block 30 min for the report at 18:00" names the walk it runs over', async () => {
    await fresh([walk(), deck()])
    tickAt(17, 0)
    await settle()
    const ask = restAsks().at(-1)!
    expect(ask.body).toBe('Deck is set to run over your evening walk — keep it?')
    useMew.getState().nudgeAction(ask.id, 'keeprest')
    await settle()
    expect(lastMew()).toMatch(/^Kept\. Deck moved to 18:45/)

    await say('block 30 min for the report at 18:00')
    await settle()
    expect(lastMew()).toBe(
      'Done — today 18:00–18:30 is held for report — it runs over your evening walk 18:00–18:45.'
    )
    /* the walk stays exactly where the owner kept it */
    expect(blocks().find((b) => b.id === 'walk')).toMatchObject({
      startMin: 18 * 60,
      endMin: 18 * 60 + 45,
    })

    /* one ask per rest per day still holds: no second protect-rest ask */
    const asksBefore = restAsks().length
    tickAt(17, 25)
    await settle()
    expect(restAsks()).toHaveLength(asksBefore)
  })

  it('a placement over a protected rest names it before any ask too', async () => {
    await fresh([walk()])
    await say('block 30 min for the report at 18:15')
    await settle()
    expect(lastMew()).toBe(
      'Done — today 18:15–18:45 is held for report — it runs over your evening walk 18:00–18:45.'
    )
  })

  it('a placement clear of the rest says nothing about it', async () => {
    await fresh([walk()])
    await say('block 30 min for the report at 17:00')
    await settle()
    expect(lastMew()).toBe('Done — today 17:00–17:30 is held for report.')
  })
})
