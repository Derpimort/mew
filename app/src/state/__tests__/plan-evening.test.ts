/* #117, through the REAL store: "tonight", "this evening" and "after dinner"
   place in the evening, from the classic day's end (18:30) and inside the
   plannable hours, and "after dinner" after that day's dinner too. When the
   evening has no room, MEW says "left tonight" and offers tomorrow EVENING,
   never the afternoon (#116's floor holds). A daytime ask is untouched.
   Keyless; adapters faked at their seams (the batch-blocks harness); no jsdom. */

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

const WED = '2026-06-10'
const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)
const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body
const at = (title: string) =>
  blocks()
    .filter((b) => b.title === title)
    .map((b) => [b.dayKey, b.startMin, b.endMin])
/** the week isn't brand new: a standup tomorrow morning */
const anchor = () =>
  block({ id: 'anchor', title: 'Standup', dayKey: WED, startMin: 540, endMin: 555 })
const clock = (h: number, m = 0) => vi.setSystemTime(TUE(h, m))

describe('#117 — the evening, said the way people say it', () => {
  it('at 14:00 "block 2h for writing tonight" lands in the evening, from 18:30', async () => {
    await fresh([anchor()])
    clock(14, 0)
    await say('block 2h for writing tonight')
    await settle()
    expect(at('writing')).toEqual([[TODAY, 18 * 60 + 30, 20 * 60 + 30]])
  })

  it('"this evening" too, and the title is just the task', async () => {
    await fresh([anchor()])
    clock(14, 0)
    await say('block 1h for reading this evening')
    await settle()
    expect(at('reading')).toEqual([[TODAY, 18 * 60 + 30, 19 * 60 + 30]])
    expect(blocks().some((b) => /this|evening/.test(b.title))).toBe(false)
  })

  it('"after dinner" waits for that day\'s dinner to end', async () => {
    await fresh([
      anchor(),
      block({ id: 'dinner', title: 'Dinner', tag: 'private', startMin: 19 * 60, endMin: 20 * 60 }),
    ])
    clock(14, 0)
    await say('block 30 min for a walk after dinner')
    await settle()
    const [[day, start]] = at('walk') as [string, number, number][]
    expect(day).toBe(TODAY)
    expect(start).toBeGreaterThanOrEqual(20 * 60) // after Dinner 19:00–20:00
  })

  it('the dinner floor is "after dinner"\'s alone: with one gap before dinner and one after, "tonight" takes the earlier, "after dinner" the later', async () => {
    const evening = () => [
      anchor(),
      block({ id: 'dinner', title: 'Dinner', tag: 'private', startMin: 19 * 60, endMin: 20 * 60 }),
      block({ id: 'prep', title: 'Board prep', startMin: 20 * 60 + 30, endMin: 22 * 60 + 30 }),
    ]
    await fresh(evening())
    clock(14, 0)
    await say('block 30 min for a walk tonight')
    await settle()
    expect(at('walk')).toEqual([[TODAY, 18 * 60 + 30, 19 * 60]])

    await fresh(evening())
    clock(14, 0)
    await say('block 30 min for a walk after dinner')
    await settle()
    expect(at('walk')).toEqual([[TODAY, 20 * 60, 20 * 60 + 30]])
  })

  it('a daytime ask is untouched: "block 1h for email" at 14:00 stays in the afternoon', async () => {
    await fresh([anchor()])
    clock(14, 0)
    await say('block 1h for email')
    await settle()
    const [[day, start]] = at('email') as [string, number, number][]
    expect(day).toBe(TODAY)
    expect(start).toBeLessThan(18 * 60 + 30)
  })

  it('no room tonight: nothing lands in the afternoon; "left tonight" and tomorrow evening is offered', async () => {
    await fresh([
      anchor(),
      block({ id: 'eve', title: 'Board prep', startMin: 18 * 60 + 30, endMin: 22 * 60 + 30 }),
    ])
    clock(14, 0)
    await say('block 2h for writing tonight')
    await settle()
    expect(at('writing')).toEqual([])
    const offer = chipMsgs().at(-1)!
    expect(offer.body).toMatch(
      /^No 120-min window is left tonight for "writing" inside the hours I plan in \(8:00–22:30\)\./
    )
    expect(offer.body).toContain('Tomorrow 18:30–20:30 is open.')
    expect(offer.choices!.map((c) => [c.label, c.reply])).toEqual([
      ['tomorrow 18:30', 'block 2h for writing tomorrow at 18:30'],
      ['not now', 'ok, not now'],
    ])
  })

  it('late in the evening with too little left: the same honest line, never earlier today', async () => {
    await fresh([anchor()])
    clock(21, 40)
    await say('block 2h for writing tonight')
    await settle()
    expect(at('writing')).toEqual([])
    expect(lastMew()).toMatch(/^No 120-min window is left tonight for "writing"/)
  })

  it('three evening asks in one message place directly, never through the plan picker', async () => {
    await fresh([anchor()])
    clock(14, 0)
    await say('block writing tonight, block reading this evening, block a walk after dinner')
    await settle()
    expect(chat().some((m) => (m.scenarios?.length ?? 0) > 0)).toBe(false)
    for (const t of ['writing', 'reading', 'walk'])
      expect((at(t)[0] as [string, number, number])[1]).toBeGreaterThanOrEqual(18 * 60 + 30)
  })
})
