/* #126, through the REAL store: a reply's asides end each sentence once. The
   pacing pass's wall-to-wall note is already a question ("want me to make room
   for a short breather?"), so it stands as its own sentence and is never given a
   period after it ("?."); statements still join into one sentence with its
   period. Keyless; adapters faked at their seams (the batch-blocks harness). */

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

const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body

describe('#126 — a question aside keeps its "?" and nothing after it', () => {
  it('the issue: a placement that leaves a wall-to-wall stretch ends "…a short breather?"', async () => {
    await fresh([
      block({ id: 'deck', title: 'Deck', startMin: 17 * 60, endMin: 18 * 60, protected: false }),
      block({
        id: 'gym',
        title: 'Gym',
        tag: 'health',
        startMin: 18 * 60,
        endMin: 19 * 60,
        protected: false,
      }),
    ])
    await say('block 1h for report at 18:00')
    await settle()
    const reply = lastMew()
    expect(reply).toMatch(/ unbroken — want me to make room for a short breather\?$/)
    expect(reply).not.toContain('?.')
  })

  it('a split that leaves a wall-to-wall stretch asks once, "?" and nothing after it', async () => {
    await fresh([
      block({ id: 'deck', title: 'Deck', startMin: 9 * 60, endMin: 13 * 60, protected: false }),
      block({
        id: 'budget',
        title: 'Budget',
        startMin: 13 * 60,
        endMin: 18 * 60 + 30,
        protected: false,
      }),
    ])
    await say('split the deck around 10:00-10:30')
    await settle()
    const reply = lastMew()
    expect(reply).toMatch(/^Split — /)
    expect(reply).toMatch(/ unbroken — want me to make room for a short breather\?/)
    expect(reply).not.toContain('?.')
  })

  it('a statement aside still ends with its period', async () => {
    await fresh([
      block({ id: 'a', title: 'Deck', startMin: 9 * 60, endMin: 11 * 60, protected: false }),
      block({ id: 'b', title: 'Budget', startMin: 11 * 60, endMin: 13 * 60, protected: false }),
    ])
    await say('block 1h for report at 13:00')
    await settle()
    const reply = lastMew()
    expect(reply).toMatch(/ Tucked a \d+-min breather into today at \d+:\d\d\.$/)
    expect(reply).not.toContain('?.')
  })

  it('two days at once: the statement sentence comes first, the question stands last (#143 review Q1)', async () => {
    /* the pacing pass walks the days it touched, so the question ("today runs …
       unbroken?") is raised BEFORE the breather it tucked into Wednesday — the
       reply still reads as one statement sentence, then the question */
    await fresh(
      [
        block({ id: 'a', title: 'Deck', startMin: 8 * 60, endMin: 17 * 60 + 30, protected: false }),
        block({
          id: 'b',
          title: 'Budget',
          dayKey: '2026-06-10',
          startMin: 9 * 60,
          endMin: 11 * 60,
          protected: false,
        }),
      ],
      [],
      'local'
    )
    let reply = ''
    scriptedModel.midTurn = (exec) => {
      reply = exec.plan(
        [
          {
            title: 'report',
            tag: 'work',
            dayOffset: 0,
            startMin: 17 * 60 + 30,
            startStated: true,
            durationMin: 60,
            durationStated: true,
          },
          {
            title: 'review',
            tag: 'work',
            dayOffset: 1,
            startMin: 11 * 60,
            startStated: true,
            durationMin: 60,
            durationStated: true,
          },
        ],
        []
      )
    }
    await say('put the report at 5:30 today and the review at 11 tomorrow')
    await settle()
    expect(reply).toContain(
      ' Tucked a 15-min breather into Wednesday at 12:00. Today runs 8:00–18:30 unbroken — want me to make room for a short breather?'
    )
    expect(reply).toMatch(/breather\?$/)
    expect(reply).not.toContain('?.')
  })
})
