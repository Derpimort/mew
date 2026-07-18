/* Granular calendar ops (#335) — resize / duplicate / relative-move, through the
   REAL store. Each op is exercised on the KEYLESS floor (a plain typed ask →
   parse.ts → runIntent → executor) and, where it needs a keyed turn (recurrence
   on duplicate), through a scripted local model that fires the exec method
   directly. The product laws are pinned as tests: every op flows through the one
   mutation path (setBlocks), external/fixed blocks are never moved or split-over,
   and duplicate honors recurrence (#159). Fakes at the storage/desktop/brain
   seams, mirroring the surgical-edits harness. No jsdom. */

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
const WED = '2026-06-10'
const FRI = '2026-06-12'

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
const lastMew = () => chat().findLast((m) => m.role === 'mew')!
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

/* ── resize: change the length, keep the start ────────────────────── */

describe('resize keeps the start and moves only the end (#335)', () => {
  it('keyless "make the deck 30 min longer" extends the end, start unchanged', async () => {
    await fresh([block({ id: 'deck', startMin: 10 * 60, endMin: 11 * 60 })])
    await say('make the deck 30 min longer')
    await settle()
    expect(byId('deck')!.startMin).toBe(10 * 60) // start never moves
    expect(byId('deck')!.endMin).toBe(11 * 60 + 30) // +30 on the end
  })

  it('keyless "resize the deck to 45" sets an absolute length from the same start', async () => {
    await fresh([block({ id: 'deck', startMin: 10 * 60, endMin: 11 * 60 })])
    await say('resize the deck to 45')
    await settle()
    expect(byId('deck')!.startMin).toBe(10 * 60)
    expect(byId('deck')!.endMin).toBe(10 * 60 + 45)
  })

  it('extending over a calendar event never moves the event (external respected)', async () => {
    const deck = block({ id: 'deck', startMin: 9 * 60, endMin: 10 * 60 })
    const meeting = block({
      id: 'mtg',
      title: 'Standup',
      startMin: 10 * 60,
      endMin: 11 * 60,
      external: { calId: 'c', eventId: 'e' },
    } as Partial<Block>)
    await fresh([deck, meeting])
    await say('make the deck 90 min longer')
    await settle()
    // the deck grew…
    expect(byId('deck')!.endMin).toBe(11 * 60 + 30)
    // …but the calendar event is untouched: same span, still external
    expect(byId('mtg')!.startMin).toBe(10 * 60)
    expect(byId('mtg')!.endMin).toBe(11 * 60)
    expect(byId('mtg')!.external).toBeDefined()
    expect(lastMew().body).toMatch(/overlaps/i) // named as a clash, not silently split-over
  })
})

/* ── duplicate: copy to another day/time, original stays ──────────── */

describe('duplicate copies a block; the original stays put (#335)', () => {
  it('keyless "duplicate the deck to friday" adds a twin, original unchanged', async () => {
    await fresh([block({ id: 'deck', startMin: 9 * 60, endMin: 10 * 60 })])
    await say('duplicate the deck to friday')
    await settle()
    // the original is exactly where it was
    expect(byId('deck')!.dayKey).toBe(TODAY)
    expect(byId('deck')!.startMin).toBe(9 * 60)
    // a NEW, distinct block landed on friday with the same shape
    const copy = blocks().find((b) => b.id !== 'deck' && b.title === 'Deck')!
    expect(copy).toBeDefined()
    expect(copy.dayKey).toBe(FRI)
    expect(copy.startMin).toBe(9 * 60) // kept the source clock time
    expect(copy.endMin).toBe(10 * 60)
    expect(copy.status).toBe('open')
  })

  it('a same-day copy lands in a free slot, never on top of the original', async () => {
    await fresh([block({ id: 'deck', startMin: 9 * 60, endMin: 10 * 60 })])
    await say('copy the deck')
    await settle()
    const copy = blocks().find((b) => b.id !== 'deck' && b.title === 'Deck')!
    expect(copy.dayKey).toBe(TODAY)
    expect(copy.startMin).not.toBe(9 * 60) // not stacked on the original
    expect(copy.endMin - copy.startMin).toBe(60) // same length
  })

  it('honors recurrence (#159): a copied series expands and links, original untouched', async () => {
    await fresh([block({ id: 'deck', startMin: 9 * 60, endMin: 10 * 60 })], [], 'local')
    // keyed turn: duplicate the deck starting tomorrow, DAILY for 3 days
    scriptedModel.midTurn = (exec) =>
      exec.duplicate('deck', {
        toDayOffset: 1,
        rrule: { freq: 'DAILY', interval: 1, count: 3 },
      })
    await say('duplicate the deck every day for the next three days')
    await settle()
    const series = blocks().filter((b) => b.id !== 'deck' && b.recurringBlockId)
    expect(series).toHaveLength(3) // 3 linked occurrences
    expect(new Set(series.map((b) => b.recurringBlockId)).size).toBe(1) // one series id
    expect(series.every((b) => b.title === 'Deck')).toBe(true)
    // DAILY count 3 from tomorrow (WED) → WED, THU, FRI
    expect(series.map((b) => b.dayKey).sort()).toEqual([WED, '2026-06-11', FRI].sort())
    // the original is neither moved nor swept into the series
    expect(byId('deck')!.recurringBlockId).toBeUndefined()
    expect(byId('deck')!.dayKey).toBe(TODAY)
  })

  it('duplicating a calendar event yields an OWNED copy; the original stays external', async () => {
    const ext = block({
      id: 'mtg',
      title: 'Standup',
      startMin: 9 * 60,
      endMin: 9 * 60 + 30,
      external: { calId: 'c', eventId: 'e' },
    } as Partial<Block>)
    await fresh([ext])
    await say('duplicate the standup to friday')
    await settle()
    // the calendar original is untouched
    expect(byId('mtg')!.external).toBeDefined()
    expect(byId('mtg')!.dayKey).toBe(TODAY)
    // the copy is a plain owned block (no external link) on friday
    const copy = blocks().find((b) => b.id !== 'mtg' && b.title === 'Standup')!
    expect(copy).toBeDefined()
    expect(copy.dayKey).toBe(FRI)
    expect(copy.external).toBeUndefined()
  })
})

/* ── relative-move: a nudge with no absolute time ─────────────────── */

describe('relative-move nudges without an absolute time (#335)', () => {
  it('keyless "push the deck later" shifts the start by the default 30 min', async () => {
    await fresh([block({ id: 'deck', startMin: 10 * 60, endMin: 11 * 60 })])
    await say('push the deck later')
    await settle()
    expect(byId('deck')!.startMin).toBe(10 * 60 + 30)
    expect(byId('deck')!.endMin).toBe(11 * 60 + 30) // length preserved
  })

  it('keyless "move the deck to the next free slot" lands clear of a calendar block', async () => {
    const deck = block({ id: 'deck', startMin: 14 * 60, endMin: 15 * 60 })
    const meeting = block({
      id: 'mtg',
      title: 'Standup',
      startMin: 9 * 60,
      endMin: 12 * 60,
      external: { calId: 'c', eventId: 'e' },
    } as Partial<Block>)
    await fresh([deck, meeting])
    await say('move the deck to the next free slot')
    await settle()
    // it relocated to the earliest clear slot AFTER the meeting — never onto it
    expect(byId('deck')!.startMin).toBeGreaterThanOrEqual(12 * 60)
    // the calendar event never moved
    expect(byId('mtg')!.startMin).toBe(9 * 60)
    expect(byId('mtg')!.external).toBeDefined()
  })

  it('keyless "push the deck to the next day" keeps the clock, one day on', async () => {
    await fresh([block({ id: 'deck', startMin: 9 * 60, endMin: 10 * 60 })])
    await say('push the deck to the next day')
    await settle()
    expect(byId('deck')!.dayKey).toBe(WED)
    expect(byId('deck')!.startMin).toBe(9 * 60) // same clock time
    expect(byId('deck')!.endMin).toBe(10 * 60)
  })
})
