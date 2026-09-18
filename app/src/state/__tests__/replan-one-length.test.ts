/* #135, through the REAL store: re-planning a block that already lives on the
   day is a move (#89), and it now has ONE length for choosing the slot and for
   the block that lands there: the length the owner stated this turn, else the
   block's own. Before, the slot was scored with the ask's length and the move
   kept the block's, so "block 30 min for a walk" moved a 90-min Walk into a
   30-min gap, over the next block. Keyless; adapters faked at their seams (the
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

const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body
const walkAt = () =>
  blocks()
    .filter((b) => b.title === 'Walk')
    .map((b) => [b.dayKey, b.startMin, b.endMin])
const clock = (h: number, m = 0) => vi.setSystemTime(TUE(h, m))
/** a 90-min Walk this morning, and the afternoon taken from 14:30 */
const day = () => [
  block({
    id: 'walk',
    title: 'Walk',
    tag: 'health',
    startMin: 9 * 60,
    endMin: 10 * 60 + 30,
    protected: false,
  }),
  block({
    id: 'review',
    title: 'Review',
    startMin: 14 * 60 + 30,
    endMin: 22 * 60 + 30,
    protected: false,
  }),
]

describe('#135 — a re-plan scores and moves with one length', () => {
  it('the issue: "block 30 min for a walk" moves the Walk into the 30-min gap AT 30 min, never over Review', async () => {
    await fresh(day())
    clock(14, 0)
    await say('block 30 min for a walk')
    await settle()
    expect(walkAt()).toEqual([[TODAY, 14 * 60, 14 * 60 + 30]])
    expect(lastMew()).toBe('Done — moved walk to today 14:00–14:30.')
    expect(blocks().find((b) => b.id === 'review')).toMatchObject({ startMin: 14 * 60 + 30 })
  })

  it("with no length stated, the slot is chosen for the block's own 90 min: no 90-min gap, so it never lands over Review", async () => {
    await fresh(day())
    clock(14, 0)
    await say('block a walk')
    await settle()
    const [[, start, end]] = walkAt() as [string, number, number][]
    expect(end - start).toBe(90)
    /* wherever it is, it doesn't share time with Review */
    expect(start >= 22 * 60 + 30 || end <= 14 * 60 + 30).toBe(true)
  })

  it('with no length stated and a 60-min gap, it still never lands a 90-min Walk over the next block', async () => {
    await fresh([
      block({
        id: 'walk',
        title: 'Walk',
        tag: 'health',
        startMin: 9 * 60,
        endMin: 10 * 60 + 30,
        protected: false,
      }),
      block({
        id: 'review',
        title: 'Review',
        startMin: 15 * 60,
        endMin: 22 * 60 + 30,
        protected: false,
      }),
    ])
    clock(14, 0)
    await say('block a walk')
    await settle()
    const [[, start, end]] = walkAt() as [string, number, number][]
    expect(end - start).toBe(90)
    expect(start >= 22 * 60 + 30 || end <= 15 * 60).toBe(true)
  })

  it("a remembered length doesn't resize the owner's existing block: only a length said this turn does", async () => {
    await fresh(day())
    clock(8, 30)
    await say('remember walk always takes 45 min')
    await settle()
    await say('block a walk at 12:00')
    await settle()
    expect(walkAt()).toEqual([[TODAY, 12 * 60, 12 * 60 + 90]])
  })

  it('the meal guardrail reads the one length too: 13:30 fits the lunch window at 30 min (#145 review R4)', async () => {
    /* the lunch window ends at 14:00: a 30-min lunch at 13:30 sits inside it,
       while the block's own 60 would run past it and earn a warning aside */
    await fresh([
      block({
        id: 'lunch',
        title: 'Lunch',
        tag: 'private',
        startMin: 12 * 60,
        endMin: 13 * 60,
        protected: false,
      }),
    ])
    clock(8, 30)
    await say('block 30 min for lunch at 13:30')
    await settle()
    expect(
      blocks()
        .filter((b) => b.title === 'Lunch')
        .map((b) => [b.startMin, b.endMin])
    ).toEqual([[13 * 60 + 30, 14 * 60]])
    expect(lastMew()).toBe('Done — moved lunch to today 13:30–14:00.')
  })

  it('keyed: a granted overlap is judged on the one length, so a 30-min walk at 14:00 clears a fixed call at 14:30 (#145 review R5)', async () => {
    /* allowOverlap only reaches execPlan from a keyed model (#49): the window it
       checks is landStart + the one length, not the block's own 90 */
    await fresh(
      [
        block({
          id: 'walk',
          title: 'Walk',
          tag: 'health',
          startMin: 9 * 60,
          endMin: 10 * 60 + 30,
          protected: false,
        }),
        block({ id: 'call', title: 'Client call', startMin: 14 * 60 + 30, endMin: 15 * 60 }),
      ],
      [],
      'local'
    )
    clock(8, 30)
    let reply = ''
    scriptedModel.midTurn = (exec) => {
      reply = exec.plan({
        places: [
          {
            title: 'walk',
            tag: 'health',
            dayOffset: 0,
            startMin: 14 * 60,
            startStated: true,
            durationMin: 30,
            durationStated: true,
            allowOverlap: true,
          },
        ],
        frees: [],
      })
    }
    await say('move the walk to 2pm for half an hour, sharing time is fine')
    await settle()
    expect(reply).not.toContain('stays unplaced')
    expect(walkAt()).toEqual([[TODAY, 14 * 60, 14 * 60 + 30]])
  })

  it('a stated length with a stated time resizes as it moves', async () => {
    await fresh(day())
    clock(8, 30)
    await say('block 45 min for a walk at 12:00')
    await settle()
    expect(walkAt()).toEqual([[TODAY, 12 * 60, 12 * 60 + 45]])
  })
})
