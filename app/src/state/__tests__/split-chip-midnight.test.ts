/* #107 follow-up, through the REAL store: a split chip picked after midnight
   (#94). A chip that names its day as a weekday ("… on thursday") still reaches
   the same block around the same gap, so it splits; one that names it "today"
   now means another day, so nothing changes and MEW says when it was offered.
   The split suite's harness (a scripted local model, calendar 'c'); no jsdom. */

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

const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)
const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body
const snapshot = () =>
  JSON.stringify(
    [...blocks()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((b) => [b.id, b.title, b.dayKey, b.startMin, b.endMin, b.status, b.recurringBlockId])
  )
const part2 = (title = 'Deck (part 2)') => blocks().find((b) => b.title === title)

const occurrence = (id: string, day: string) =>
  block({
    id,
    title: 'Standup',
    dayKey: day,
    startMin: 9 * 60,
    endMin: 10 * 60,
    recurringBlockId: 'standup-series',
    rrule: { freq: 'DAILY', interval: 1 },
  })
const WED = '2026-06-10'
const THU = '2026-06-11'

const WED_0005 = new Date(2026, 5, 10, 0, 5)
const afterMidnight = () => {
  vi.setSystemTime(WED_0005)
  useMew.getState().tick()
}

describe('#107 follow-up — a split chip picked after midnight', () => {
  it('a weekday chip ("… on thursday") still splits the block it was offered for', async () => {
    await fresh([
      block({
        id: 'deck-am',
        title: 'Deck',
        dayKey: THU,
        startMin: 8 * 60 + 30,
        endMin: 10 * 60 + 30,
      }),
      block({ id: 'deck-thu', title: 'Deck', dayKey: THU, startMin: 12 * 60, endMin: 15 * 60 }),
    ])
    await say('split the deck around 13:00-13:45 on thursday')
    await settle()
    const offer = chipMsgs().at(-1)!
    expect(offer.choices!.map((c) => c.reply)).toEqual([
      'split deck at 8:30 around 13:00-13:45 on thursday',
      'split deck at 12:00 around 13:00-13:45 on thursday',
    ])

    afterMidnight()
    await useMew.getState().pickChoice(offer.id, offer.choices![1].id)
    await settle()
    expect(byId('deck-thu')).toMatchObject({ dayKey: THU, startMin: 720, endMin: 780 })
    expect(part2()).toMatchObject({ dayKey: THU, startMin: 825, endMin: 945 })
    expect(byId('deck-am')).toMatchObject({ startMin: 510, endMin: 630 })
  })

  it('a "today" series scope chip picked after midnight changes nothing, and says when it was offered', async () => {
    await fresh([occurrence('su-tue', TODAY), occurrence('su-wed', WED), occurrence('su-thu', THU)])
    await say('split the standup around 9:30-9:45')
    await settle()
    const offer = chipMsgs().at(-1)!
    const before = snapshot()

    afterMidnight()
    await useMew.getState().pickChoice(offer.id, offer.choices![0].id)
    await settle()
    expect(snapshot()).toBe(before)
    expect(lastMew()).toBe(
      'That choice was offered on Tuesday ("just this one"), so everything stays as it is.'
    )
  })

  it('control: the same "today" chip picked on the day it was offered splits', async () => {
    await fresh([occurrence('su-tue', TODAY), occurrence('su-wed', WED), occurrence('su-thu', THU)])
    await say('split the standup around 9:30-9:45')
    await settle()
    const offer = chipMsgs().at(-1)!
    await useMew.getState().pickChoice(offer.id, offer.choices![0].id)
    await settle()
    expect(byId('su-tue')).toMatchObject({ startMin: 540, endMin: 570 })
    expect(part2('Standup (part 2)')).toMatchObject({ dayKey: TODAY, startMin: 585, endMin: 615 })
  })
})
