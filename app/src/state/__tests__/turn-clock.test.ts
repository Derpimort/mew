/* #96, through the REAL store: one clock per turn. The store clock (nowMs) only
   moves on a tick, so in the seconds after midnight before one lands, the wall
   clock is already Wednesday while the store still says Tuesday. A turn now
   brings the store clock to now first, and the rules floor counts day words from
   that same clock, so "on thursday" means Thursday for the parse AND for the
   executor that resolves it — keyless and keyed alike. Adapters faked at their
   seams (the dayload harness + a scripted local model); no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import type { ToolExecutor } from '../../adapters/model/types'

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

/* a scripted local model: hands the turn the real executor (the keyed path) */
const scripted = {
  midTurn: null as null | ((exec: ToolExecutor) => void),
  ctxToday: null as string | null,
}
vi.mock('../../adapters/model/aiAdapter', () => ({
  createAiAdapter: (spec: { provider: string }) => ({
    id: spec.provider,
    async *converse(_thread: unknown, ctx: { todayKey: string }, exec: ToolExecutor) {
      if (spec.provider !== 'ollama') throw Object.assign(new Error('offline'), { statusCode: 503 })
      scripted.ctxToday = ctx.todayKey
      yield 'on it.'
      scripted.midTurn?.(exec)
    },
  }),
}))

import { useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const TUE = '2026-06-09'
const WED = '2026-06-10'
const THU = '2026-06-11'
const TUE_235958 = new Date(2026, 5, 9, 23, 59, 58)
const WED_000002 = new Date(2026, 5, 10, 0, 0, 2)

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Groceries',
    tag: 'private',
    dayKey: WED,
    startMin: 14 * 60,
    endMin: 15 * 60,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/** Boots at Tue 23:59:58 and ticks there, then lets the wall clock pass
    midnight WITHOUT a tick: the store still says Tuesday, the wall Wednesday. */
async function atTheSeam(blocks: Block[], location: 'remote' | 'local' = 'remote') {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  fakeDb.settings = { ...pristine.settings, modelLocation: location, sustenance: 'off' }
  vi.setSystemTime(TUE_235958)
  useMew.setState(
    {
      ...pristine,
      lastTickDay: TUE,
      nowMs: TUE_235958.getTime(),
      lastActivityMs: TUE_235958.getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
  /* hydrate seeds its own settings on a first run; the model location rides in after */
  useMew.getState().updateSettings({ modelLocation: location, sustenance: 'off' })
  useMew.getState().tick()
  vi.setSystemTime(WED_000002) // midnight passes; no tick has landed yet
  expect(useMew.getState().nowMs).toBe(TUE_235958.getTime())
}

const blocks = () => useMew.getState().blocks
const byId = (id: string) => blocks().find((b) => b.id === id)
const say = (text: string) => useMew.getState().speak(text)
const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  scripted.midTurn = null
  scripted.ctxToday = null
})
afterEach(() => {
  vi.useRealTimers()
})

describe('#96 — a turn in the seconds after midnight reads one clock', () => {
  it('the probe: "remove the Groceries on thursday at 14:00" removes Thursday\'s, never Wednesday\'s', async () => {
    await atTheSeam([block({ id: 'g-wed' }), block({ id: 'g-thu', dayKey: THU })])
    await say('remove the Groceries on thursday at 14:00')
    await settle()
    expect(byId('g-thu')).toBeUndefined()
    expect(byId('g-wed')).toBeDefined()
    expect(useMew.getState().nowMs).toBe(WED_000002.getTime()) // the turn's clock is now
  })

  it('a move: "move the Deck polish to thursday" lands on Thursday', async () => {
    await atTheSeam([
      block({ id: 'deck', title: 'Deck polish', tag: 'work', startMin: 10 * 60, endMin: 11 * 60 }),
    ])
    await say('move the Deck polish to thursday')
    await settle()
    expect(byId('deck')!.dayKey).toBe(THU)
  })

  it('a plan: "tomorrow", said on Wednesday, is Thursday', async () => {
    await atTheSeam([])
    await say('block 1h for the budget review tomorrow at 9')
    await settle()
    expect(blocks().find((b) => b.title === 'budget review')).toMatchObject({
      dayKey: THU,
      startMin: 9 * 60,
    })
  })

  it('keyed: the model is told Wednesday, and a tool call for day +1 lands on Thursday', async () => {
    await atTheSeam([], 'local')
    scripted.midTurn = (exec) => {
      exec.plan(
        [{ title: 'budget review', tag: 'work', dayOffset: 1, startMin: 9 * 60, durationMin: 60 }],
        []
      )
    }
    await say('put the budget review tomorrow at 9')
    await settle()
    expect(scripted.ctxToday).toBe(WED)
    expect(blocks().find((b) => b.title === 'budget review')!.dayKey).toBe(THU)
  })

  it('the rules floor follows the store clock when the wall clock steps back', async () => {
    await atTheSeam([block({ id: 'g-wed' }), block({ id: 'g-thu', dayKey: THU })])
    /* the store already says Wednesday (a tick landed), then the wall clock steps
       back a few seconds (a clock correction) */
    useMew.setState({ nowMs: WED_000002.getTime(), lastTickDay: WED })
    vi.setSystemTime(TUE_235958)
    await say('remove the Groceries on thursday at 14:00')
    await settle()
    expect(byId('g-thu')).toBeUndefined() // Thursday counted from Wednesday by parse AND executor
    expect(byId('g-wed')).toBeDefined()
  })

  it('the turn clock never runs backwards: a model turn after a wall-clock step back is still told Wednesday', async () => {
    await atTheSeam([], 'local')
    useMew.setState({ nowMs: WED_000002.getTime(), lastTickDay: WED })
    vi.setSystemTime(TUE_235958)
    await say('what does thursday look like')
    await settle()
    expect(scripted.ctxToday).toBe(WED)
  })
})
