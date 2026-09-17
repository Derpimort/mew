/* #121, through the REAL store: a split's pieces merge back. Split names its
   second piece "X (part 2)", and merge used to read that as a different block,
   so every natural ask answered "the only one there". Now a split's "(part N)"
   is the same block's piece: the pair merges back into one "X" (the first keeps
   its id), one undo restores both, and while a meeting still sits between them
   the refusal names it. #108's rule holds: different blocks sharing a word
   never merge. Keyless, plus a keyed undo; adapters faked at their seams (the
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

import { mergeName } from '../../domain/week'

/* ── fixtures ─────────────────────────────────────────────────────── */

const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body
const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)
const rows = () =>
  blocks()
    .filter((b) => b.dayKey === TODAY)
    .sort((a, b) => a.startMin - b.startMin)
    .map((b) => [b.id, b.title, b.startMin, b.endMin])
const deckPolish = () =>
  block({ id: 'deck', title: 'Deck polish', startMin: 9 * 60, endMin: 11 * 60, protected: false })
async function splitIt() {
  await fresh([deckPolish()])
  await say('split the deck polish around 9:30-10:15')
  await settle()
  expect(lastMew()).toMatch(
    /^Split — Deck polish now runs 9:00–9:30, and Deck polish \(part 2\) picks up 10:15–/
  )
}

describe('#121 — a split pair merges back into one block', () => {
  it.each([
    'merge my two deck polish blocks',
    'merge the deck polish blocks',
    'merge the deck polish at 9:00 with the next one',
    'join the deck polish blocks together',
  ])('"%s" joins "Deck polish" and "Deck polish (part 2)"; the first keeps its id', async (ask) => {
    await splitIt()
    const end = blocks().find((b) => b.title === 'Deck polish (part 2)')!.endMin
    await say(ask)
    await settle()
    expect(lastMew()).toMatch(
      /^Merged — Deck polish now runs today 9:00–\d+:\d\d as one block \(2 joined\)\.$/
    )
    expect(rows().filter((r) => String(r[1]).startsWith('Deck polish'))).toEqual([
      ['deck', 'Deck polish', 9 * 60, end],
    ])
  })

  it('keyed: a merge and its undo in one turn put both pieces back exactly', async () => {
    /* one turn: "undo that" across messages is #120's, not this fix's */
    await splitIt()
    const pieces = rows()
    useMew.getState().updateSettings({ modelLocation: 'local' })
    let merged = ''
    let undone = ''
    scriptedModel.midTurn = (exec) => {
      merged = exec.merge('deck polish')
      undone = exec.undoLast()
    }
    await say('merge the deck polish pieces — no, leave them')
    await settle()
    expect(merged).toMatch(/^Merged — Deck polish now runs today 9:00–/)
    expect(undone).toMatch(/^Undone — /)
    expect(rows()).toEqual(pieces)
  })

  it('while the meeting still sits between the pieces, the refusal names it; once it is gone, they merge', async () => {
    await fresh([deckPolish()])
    useMew
      .getState()
      .simulatePull([
        { eventId: 'sync', title: 'Design sync', startMin: 9 * 60 + 30, endMin: 10 * 60 + 15 },
      ])
    await settle()
    const offer = chipMsgs().at(-1)!
    await useMew
      .getState()
      .pickChoice(offer.id, offer.choices!.find((c) => c.label === 'split around it')!.id)
    await settle()
    const before = rows()

    await say('merge my two deck polish blocks')
    await settle()
    expect(lastMew()).toBe(
      'Design sync 9:30–10:15 (from your calendar) sits between them today, so everything stays as it is.'
    )
    expect(rows()).toEqual(before)

    useMew.getState().simulatePull([])
    await settle()
    await say('merge my two deck polish blocks')
    await settle()
    expect(lastMew()).toMatch(/^Merged — Deck polish now runs today 9:00–/)
    expect(
      blocks()
        .filter((b) => b.title.startsWith('Deck polish'))
        .map((b) => b.id)
    ).toEqual(['deck'])
  })

  it('a piece already rolled forward is not part of the merge', async () => {
    await splitIt()
    const part2 = blocks().find((b) => b.title === 'Deck polish (part 2)')!
    useMew.getState().rollForward([part2.id], '2026-06-15')
    await settle()
    await say('merge my two deck polish blocks')
    await settle()
    expect(lastMew()).toBe(
      'Deck polish at 9:00 today is the only "deck polish" there, so there\'s nothing to merge it with.'
    )
  })

  it('a split pair beside a different block sharing a word: the refusal names two blocks, not three', async () => {
    await fresh([
      block({
        id: 'p1',
        title: 'Deck polish',
        startMin: 9 * 60,
        endMin: 10 * 60,
        protected: false,
      }),
      block({
        id: 'p2',
        title: 'Deck polish (part 2)',
        startMin: 10 * 60 + 30,
        endMin: 11 * 60,
        protected: false,
      }),
      block({
        id: 'r',
        title: 'Deck review',
        startMin: 11 * 60,
        endMin: 12 * 60,
        protected: false,
      }),
    ])
    await say('merge my two deck blocks')
    await settle()
    expect(lastMew()).toBe(
      "Deck polish and Deck review are different blocks — name the one whose parts you want joined, and I'll merge them. Everything stays as it is for now."
    )
    expect(
      blocks()
        .map((b) => b.id)
        .sort()
    ).toEqual(['p1', 'p2', 'r'])
  })

  it('#108 holds: different blocks that share a word still never merge', async () => {
    await fresh([
      block({ id: 'p', title: 'Deck polish', startMin: 9 * 60, endMin: 10 * 60, protected: false }),
      block({
        id: 'r',
        title: 'Deck review',
        startMin: 10 * 60,
        endMin: 11 * 60,
        protected: false,
      }),
    ])
    await say('merge my two deck blocks')
    await settle()
    expect(lastMew()).toBe(
      "Deck polish and Deck review are different blocks — name the one whose parts you want joined, and I'll merge them. Everything stays as it is for now."
    )
    expect(
      blocks()
        .map((b) => b.id)
        .sort()
    ).toEqual(['p', 'r'])
  })
})

describe('mergeName — a split piece is the same block, nothing else is', () => {
  it.each([
    ['Deck polish (part 2)', 'deck polish'],
    ['Deck polish (Part 3)', 'deck polish'],
    ['Deck polish — v2 (part 2)', 'deck polish'],
    ['Part 2 planning', 'part 2 planning'],
    ['Deck polish (part 2) notes', 'deck polish (part 2) notes'],
    ['Deck (part two)', 'deck (part two)'],
  ])('%s → %s', (title, name) => {
    expect(mergeName({ title })).toBe(name)
  })
})
