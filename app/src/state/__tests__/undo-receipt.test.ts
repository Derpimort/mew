/* #149: the undo receipt names what actually came back. execUndo's summary said
   "put X back where it was" for every changed block, so a resize, a rename and a
   retag each described a move that never happened — the week was restored right,
   the sentence was not. Real store, keyless floor; the receipt is the artefact
   under test, so every pin asserts the WHOLE sentence. */

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

/* a scripted local model for the steps the keyless floor has no words for (an
   "undo that" fires exec.undoLast()). Provider 'ollama' (modelLocation:'local')
   runs midTurn; any other provider throws offline, so the floor answers. Nothing
   touches the network. */
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

const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** a fresh store on `at` (default Tuesday 8:30), hydrated from exactly `seed`:
    no seeded meals unless a journey asks for them, a connected calendar 'c' so
    [calendar] blocks survive hydrate, and the keyless floor unless `location`
    says 'local' (a scripted model then runs midTurn). */
async function fresh(
  seed: Block[],
  opts: {
    at?: Date
    location?: 'remote' | 'local'
    memory?: MemoryEvent[]
    settings?: Partial<Settings>
  } = {}
) {
  const at = opts.at ?? TUE(8, 30)
  fakeDb.reset()
  seed.forEach((b) => fakeDb.blocks.set(b.id, b))
  ;(opts.memory ?? []).forEach((e) => fakeDb.memory.set(e.id, e))
  fakeDb.settings = {
    ...pristine.settings,
    modelLocation: opts.location ?? 'remote',
    sustenance: 'off',
    calendars: [
      { id: 'c', name: 'Work', who: 'me', provider: 'google', kind: 'import', readOnly: true },
    ],
    ...opts.settings,
  }
  vi.setSystemTime(at)
  useMew.setState(
    {
      ...pristine,
      lastTickDay: keyOf(at),
      nowMs: at.getTime(),
      lastActivityMs: at.getTime(),
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

const TOMORROW = '2026-06-10'
const deck = () =>
  block({ id: 'deck', title: 'Deck', startMin: 9 * 60, endMin: 10 * 60, protected: false })
const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body
const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)
const pick = async (label: string) => {
  const msg = chipMsgs().at(-1)!
  await useMew.getState().pickChoice(msg.id, msg.choices!.find((c) => c.label === label)!.id)
  await settle()
}
const row = (id: string) => {
  const b = blocks().find((x) => x.id === id)!
  return [b.title, b.tag, b.dayKey, b.startMin, b.endMin]
}

/* ── the receipt names what came back ─────────────────────────────── */

describe('#149: undo says what actually changed, not always "back where it was"', () => {
  it('a move still reads exactly as it did — this is the wording the others were borrowing', async () => {
    await fresh([deck()])
    await say('move the deck to 14:00')
    await settle()
    expect(row('deck')).toEqual(['Deck', 'work', TODAY, 840, 900])
    await say('undo that')
    await settle()
    expect(lastMew()).toBe('Undone — put Deck back where it was.')
    expect(row('deck')).toEqual(['Deck', 'work', TODAY, 540, 600])
  })

  it('a resize says the length came back, because nothing moved', async () => {
    await fresh([deck()])
    await say('make the deck 30 min longer')
    await settle()
    expect(row('deck')).toEqual(['Deck', 'work', TODAY, 540, 630])
    await say('undo that')
    await settle()
    expect(lastMew()).toBe('Undone — put Deck back to its old length.')
    expect(row('deck')).toEqual(['Deck', 'work', TODAY, 540, 600])
  })

  it('a rename says the name came back, in the name itself', async () => {
    await fresh([deck()])
    await say('rename the deck to Deck polish')
    await settle()
    expect(blocks().find((b) => b.id === 'deck')!.title).toBe('deck polish')
    await say('undo that')
    await settle()
    expect(lastMew()).toBe('Undone — called it Deck again.')
    expect(row('deck')).toEqual(['Deck', 'work', TODAY, 540, 600])
  })

  it('a retag names the tag it came back to — the case #149 was filed for', async () => {
    await fresh([deck()])
    await say(`tag all of today's "deck" as private`)
    await settle()
    expect(row('deck')).toEqual(['Deck', 'private', TODAY, 540, 600])
    await say('undo that')
    await settle()
    expect(lastMew()).toBe('Undone — put Deck back to work.')
    expect(row('deck')).toEqual(['Deck', 'work', TODAY, 540, 600])
  })

  it('two blocks retagged: two tags come back, and no block is said to have moved', async () => {
    await fresh([
      deck(),
      block({
        id: 'notes',
        title: 'Deck notes',
        startMin: 11 * 60,
        endMin: 12 * 60,
        protected: false,
      }),
    ])
    await say(`tag all of today's "deck" as private`)
    await settle()
    expect(blocks().map((b) => b.tag)).toEqual(['private', 'private'])
    await say('undo that')
    await settle()
    expect(lastMew()).toBe('Undone — put two tags back.')
    expect(blocks().map((b) => b.tag)).toEqual(['work', 'work'])
  })

  it('a move to another day that keeps the clock still says WHERE it went back to', async () => {
    /* the day half of "moved", which needs a shape that changes the day WITHOUT
       the clock: a keyless "move the deck to tomorrow" re-times the block, so it
       would read as moved even if the day were ignored. A batch move-to-day keeps
       every block's own time by design, so here only the dayKey differs. */
    await fresh([
      deck(),
      block({
        id: 'notes',
        title: 'Deck notes',
        startMin: 11 * 60,
        endMin: 12 * 60,
        protected: false,
      }),
    ])
    await say("move all of today's work to tomorrow")
    await settle()
    await pick('do it')
    expect(blocks().map((b) => [b.dayKey, b.startMin])).toEqual([
      [TOMORROW, 540],
      [TOMORROW, 660],
    ])
    await say('undo that')
    await settle()
    expect(lastMew()).toBe('Undone — put two blocks back where they were.')
    expect(blocks().map((b) => [b.dayKey, b.startMin])).toEqual([
      [TODAY, 540],
      [TODAY, 660],
    ])
  })

  it('a block that both moved and was retagged takes the larger fact: where it sits', async () => {
    /* the precedence, pinned rather than left to reading order: time first,
       then length, then name, then tag */
    await fresh([deck()])
    await say('move the deck to 14:00')
    await settle()
    await say(`tag all of today's "deck" as private`)
    await settle()
    /* one snapshot per message (#130), so this undo holds only the retag */
    await say('undo that')
    await settle()
    expect(lastMew()).toBe('Undone — put Deck back to work.')
    expect(row('deck')).toEqual(['Deck', 'work', TODAY, 840, 900])
  })
})
