/* #62 — a time-pinned remove never deletes across days, through the REAL store.
   "remove the lunch at 12:00" with a 12:00 Lunch on several days asks which one,
   with chips that name each block's day, and removes nothing until a pick. A pick
   removes exactly that day's Lunch. A single match is still removed directly, an
   explicit all still sweeps, a recurring series keeps its this/following/series
   ask, and a keyed remove_blocks behaves the same (dayOffset pins the day).
   Adapters faked at their seams (the granular-ops harness). No jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import { CHOICES_POSTED, type ToolExecutor } from '../../adapters/model/types'

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

const scriptedModel = {
  midTurn: null as null | ((exec: ToolExecutor) => void),
  reset() {
    this.midTurn = null
  },
}
vi.mock('../../adapters/model/aiAdapter', () => ({
  createAiAdapter: (spec: { provider: string }) => ({
    id: spec.provider,
    async *converse(_thread: unknown, _ctx: unknown, exec: ToolExecutor) {
      if (spec.provider !== 'ollama') throw Object.assign(new Error('offline'), { statusCode: 503 })
      yield 'on it.'
      scriptedModel.midTurn?.(exec)
    },
  }),
}))

import { useMew } from '../store'

const pristine = useMew.getState()
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m) // Tuesday, June 9
const TODAY = '2026-06-09'
const WED = '2026-06-10'
const THU = '2026-06-11'

function lunch(id: string, dayKey: string, over: Partial<Block> = {}): Block {
  return {
    id,
    title: 'Lunch',
    tag: 'private',
    dayKey,
    startMin: 12 * 60,
    endMin: 12 * 60 + 45,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}
const threeLunches = () => [lunch('tue', TODAY), lunch('wed', WED), lunch('thu', THU)]

async function fresh(blocks: Block[], location: 'remote' | 'local' = 'remote') {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  fakeDb.settings = { ...pristine.settings, modelLocation: location, sustenance: 'off' }
  vi.setSystemTime(TUE(9, 0))
  useMew.setState(
    {
      ...pristine,
      lastTickDay: TODAY,
      nowMs: TUE(9, 0).getTime(),
      lastActivityMs: TUE(9, 0).getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

const chat = () => useMew.getState().chat
const lunchIds = () =>
  useMew
    .getState()
    .blocks.filter((b) => b.title === 'Lunch')
    .map((b) => b.id)
    .sort()
const chipMsgs = () => chat().filter((m: ChatMessage) => (m.choices?.length ?? 0) > 0)
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

describe('#62 — keyless: a time alone never reaches across days', () => {
  it('"remove the lunch at 12:00" with three 12:00 Lunches asks which, and removes nothing', async () => {
    await fresh(threeLunches())
    await say('remove the lunch at 12:00')
    await settle()
    expect(lunchIds()).toEqual(['thu', 'tue', 'wed'])
    const ask = chipMsgs()
    expect(ask).toHaveLength(1)
    expect(ask[0].body).toMatch(/^3 "lunch" blocks ahead/)
    expect(ask[0].choices!.map((c) => ({ label: c.label, reply: c.reply }))).toEqual([
      { label: 'today 12:00', reply: 'remove lunch today at 12:00' },
      { label: 'tomorrow 12:00', reply: 'remove lunch tomorrow at 12:00' },
      { label: 'thursday 12:00', reply: 'remove lunch on thursday at 12:00' },
      { label: 'all of them', reply: 'remove all lunch' },
    ])
  })

  it("a day chip removes exactly that day's Lunch", async () => {
    await fresh(threeLunches())
    await say('remove the lunch at 12:00')
    await settle()
    const ask = chipMsgs()[0]
    await useMew
      .getState()
      .pickChoice(ask.id, ask.choices!.find((c) => c.label === 'thursday 12:00')!.id)
    await settle()
    expect(lunchIds()).toEqual(['tue', 'wed'])
    expect(chat()[chat().length - 1].body).toMatch(/^Removed — /)
  })

  it('typing the day works the same way', async () => {
    await fresh(threeLunches())
    await say('remove the lunch tomorrow at 12:00')
    await settle()
    expect(lunchIds()).toEqual(['thu', 'tue'])
    expect(chipMsgs()).toHaveLength(0)
  })

  it('a single 12:00 Lunch from today on is still removed directly', async () => {
    await fresh([
      lunch('tue', TODAY),
      lunch('wed-late', WED, { startMin: 13 * 60, endMin: 13 * 60 + 45 }),
    ])
    await say('remove the lunch at 12:00')
    await settle()
    expect(lunchIds()).toEqual(['wed-late'])
    expect(chipMsgs()).toHaveLength(0)
  })

  it('an explicit all still removes every 12:00 Lunch', async () => {
    await fresh([
      ...threeLunches(),
      lunch('wed-late', WED, { startMin: 13 * 60, endMin: 13 * 60 + 45 }),
    ])
    await say('remove all lunch at 12:00')
    await settle()
    expect(lunchIds()).toEqual(['wed-late'])
  })

  it('a recurring series keeps its this / following / series ask', async () => {
    const series = threeLunches().map((b) => ({ ...b, recurringBlockId: 'lunch-series' }))
    await fresh(series)
    await say('remove the lunch at 12:00')
    await settle()
    expect(lunchIds()).toEqual(['thu', 'tue', 'wed'])
    const labels = chipMsgs()[0].choices!.map((c) => c.label.toLowerCase())
    expect(labels.some((l) => l.includes('series'))).toBe(true)
  })
})

describe('#62 — keyed remove_blocks behaves the same', () => {
  it('at alone asks (chips on screen) and removes nothing; dayOffset removes exactly one', async () => {
    await fresh(threeLunches(), 'local')
    let asked = ''
    scriptedModel.midTurn = (exec) => {
      asked = exec.remove('lunch', { at: '12:00' })
    }
    await say('drop the 12 o clock lunch')
    await settle()
    expect(asked.startsWith(CHOICES_POSTED)).toBe(true)
    expect(lunchIds()).toEqual(['thu', 'tue', 'wed'])

    let removed = ''
    scriptedModel.midTurn = (exec) => {
      removed = exec.remove('lunch', { at: '12:00', dayOffset: 1 })
    }
    await say('the one tomorrow')
    await settle()
    expect(removed).toMatch(/^Removed — /)
    expect(lunchIds()).toEqual(['thu', 'tue'])
  })
})
