/* #74 — merge adjacent same-tag blocks into one, through the REAL store (the
   granular-ops harness: a scripted local model firing the executor for the keyed
   path; the rules floor for keyless). The earliest block keeps its id and grows
   to span the run, the others go, and one undo brings every part back. A fixed
   call or a [calendar] event between the parts, a calendar / done / repeating
   part, or mixed tags means nothing changes and the reply says which. */

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

import { runTool } from '../../adapters/model/tools'

const deck = (id: string, startMin: number, endMin: number, over: Partial<Block> = {}) =>
  block({ id, title: 'Deck', tag: 'work', startMin, endMin, protected: false, ...over })
const snapshot = () =>
  JSON.stringify(
    [...blocks()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((b) => [b.id, b.title, b.dayKey, b.startMin, b.endMin, b.status])
  )
const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body

describe('#74 — two same-tag blocks become one', () => {
  it('keyless: "merge my two deck blocks" joins them across free air — the first keeps its id and spans both, the second is gone from the store', async () => {
    await fresh([deck('d1', 9 * 60, 10 * 60), deck('d2', 11 * 60, 12 * 60)])
    await say('merge my two deck blocks')
    await settle()
    expect(byId('d1')).toMatchObject({ dayKey: TODAY, startMin: 9 * 60, endMin: 12 * 60 })
    expect(byId('d2')).toBeUndefined()
    expect(blocks().filter((b) => b.title === 'Deck')).toHaveLength(1)
    expect(fakeDb.blocks.has('d2')).toBe(false) // deleted in storage too, not just hidden
    expect(
      chat().some(
        (m) =>
          m.role === 'mew' &&
          m.body.startsWith('Merged — Deck now runs today 9:00–12:00 as one block (2 joined).')
      )
    ).toBe(true)
  })

  it('keyed: merge_blocks merges, and one undo in the same exchange brings both parts back exactly', async () => {
    await fresh([deck('d1', 9 * 60, 10 * 60), deck('d2', 10 * 60, 11 * 60)], [], 'local')
    const before = snapshot()
    let merged = ''
    let undone = ''
    let afterMerge = ''
    scriptedModel.chunks = ['on it — ', 'and put back.']
    scriptedModel.midTurn = (exec) => {
      merged = exec.merge('deck')
      afterMerge = snapshot()
      undone = exec.undoLast()
    }
    await say('merge the deck blocks — actually, undo that')
    await settle()
    expect(merged).toBe('Merged — Deck now runs today 9:00–11:00 as one block (2 joined).')
    expect((JSON.parse(afterMerge) as unknown[][]).filter((r) => r[1] === 'Deck')).toEqual([
      ['d1', 'Deck', TODAY, 9 * 60, 11 * 60, 'open'],
    ])
    expect(undone).toMatch(/^Undone — /)
    expect(snapshot()).toBe(before) // one snapshot took the whole merge back
    expect(fakeDb.blocks.has('d2')).toBe(true) // and re-persisted the removed part
  })

  it('three matches on the day merge as one run; overlapping parts are fine', async () => {
    await fresh([
      deck('d1', 9 * 60, 10 * 60),
      deck('d2', 9 * 60 + 30, 10 * 60 + 30),
      deck('d3', 11 * 60, 11 * 60 + 30),
    ])
    await say('merge the deck blocks')
    await settle()
    expect(blocks().filter((b) => b.title === 'Deck')).toEqual([
      expect.objectContaining({ id: 'd1', startMin: 9 * 60, endMin: 11 * 60 + 30 }),
    ])
  })

  it('a time pins the run: "merge the deck at 11:00 with the next one" leaves the 9:00 deck alone', async () => {
    await fresh([
      deck('d1', 9 * 60, 10 * 60),
      deck('d2', 11 * 60, 12 * 60),
      deck('d3', 12 * 60, 13 * 60),
    ])
    await say('merge the deck at 11:00 with the next one')
    await settle()
    expect(byId('d1')).toMatchObject({ startMin: 9 * 60, endMin: 10 * 60 })
    expect(byId('d2')).toMatchObject({ startMin: 11 * 60, endMin: 13 * 60 })
    expect(byId('d3')).toBeUndefined()
  })

  it('merge_blocks is registered for keyed models: query required, dayOffset and at optional, nothing else', async () => {
    const { MEW_TOOLS } = await import('../../adapters/model/tools')
    const tool = MEW_TOOLS.find((x) => x.name === 'merge_blocks')!
    expect(tool).toBeDefined()
    const params = tool.parameters as {
      required: string[]
      properties: Record<string, unknown>
      additionalProperties: boolean
    }
    expect(params.required).toEqual(['query'])
    expect(Object.keys(params.properties).sort()).toEqual(['at', 'dayOffset', 'query'])
    expect(params.additionalProperties).toBe(false)
    expect(tool.description).toMatch(/nothing changes/)
  })

  it('the tool dispatch passes query, dayOffset and at through to the executor', async () => {
    const calls: unknown[][] = []
    const exec = {
      merge: (...args: unknown[]) => {
        calls.push(args)
        return 'ok'
      },
    } as unknown as import('../../adapters/model').ToolExecutor
    await runTool('merge_blocks', { query: 'deck', dayOffset: 1, at: '9:00' }, exec)
    await runTool('merge_blocks', { query: 'deck' }, exec)
    await runTool('merge_blocks', { query: 'deck', dayOffset: 99 }, exec)
    expect(calls).toEqual([
      ['deck', 1, '9:00'],
      ['deck', undefined, undefined],
      ['deck', 13, undefined], // a day offset clamps to the two weeks the tools cover
    ])
  })
})

describe('#74 — the reply names the day the way it reads', () => {
  it('tomorrow\'s blocks: "now runs tomorrow …", and a blocker "sits between them tomorrow"', async () => {
    const TOMORROW = '2026-06-10'
    await fresh([
      deck('d1', 9 * 60, 10 * 60, { dayKey: TOMORROW }),
      deck('d2', 10 * 60, 11 * 60, { dayKey: TOMORROW }),
      deck('t1', 14 * 60, 15 * 60, { dayKey: TOMORROW, title: 'Notes' }),
      block({
        id: 'call',
        title: 'Client call',
        dayKey: TOMORROW,
        startMin: 15 * 60,
        endMin: 15 * 60 + 30,
      }),
      deck('t2', 15 * 60 + 30, 16 * 60 + 30, { dayKey: TOMORROW, title: 'Notes' }),
    ])
    await say('merge my two deck blocks tomorrow')
    await settle()
    expect(lastMew()).toBe('Merged — Deck now runs tomorrow 9:00–11:00 as one block (2 joined).')
    await say('merge my two notes blocks tomorrow')
    await settle()
    expect(lastMew()).toBe(
      'Client call 15:00–15:30 (fixed) sits between them tomorrow, so everything stays as it is.'
    )
  })

  it('a later day reads "on <weekday>"', async () => {
    const THURSDAY = '2026-06-11'
    await fresh([
      deck('d1', 9 * 60, 10 * 60, { dayKey: THURSDAY }),
      deck('d2', 10 * 60, 11 * 60, { dayKey: THURSDAY }),
    ])
    await say('merge my two deck blocks on thursday')
    await settle()
    expect(lastMew()).toBe('Merged — Deck now runs on Thursday 9:00–11:00 as one block (2 joined).')
  })
})

describe('#74 — nothing changes when a merge would cover something, and the reply says what', () => {
  it('a fixed call between the parts: nothing changes, and the call is named', async () => {
    await fresh([
      deck('d1', 9 * 60, 10 * 60),
      block({ id: 'call', title: 'Client call', startMin: 10 * 60, endMin: 10 * 60 + 30 }),
      deck('d2', 11 * 60, 12 * 60),
    ])
    const before = snapshot()
    await say('merge my two deck blocks')
    await settle()
    expect(snapshot()).toBe(before)
    expect(lastMew()).toBe(
      'Client call 10:00–10:30 (fixed) sits between them today, so everything stays as it is.'
    )
  })

  it('a calendar event between the parts: nothing changes, and it is named as from your calendar', async () => {
    await fresh([
      deck('d1', 9 * 60, 10 * 60),
      block({
        id: 'mtg',
        title: 'Quarterly planning',
        startMin: 10 * 60,
        endMin: 10 * 60 + 30,
        external: { calId: 'c', eventId: 'e' },
      }),
      deck('d2', 11 * 60, 12 * 60),
    ])
    const before = snapshot()
    await say('merge my two deck blocks')
    await settle()
    expect(snapshot()).toBe(before)
    expect(lastMew()).toBe(
      'Quarterly planning 10:00–10:30 (from your calendar) sits between them today, so everything stays as it is.'
    )
  })

  it('a calendar part never merges', async () => {
    await fresh([
      deck('d1', 9 * 60, 10 * 60),
      deck('d2', 10 * 60, 11 * 60, { external: { calId: 'c', eventId: 'e2' }, protected: true }),
    ])
    const before = snapshot()
    await say('merge my two deck blocks')
    await settle()
    expect(snapshot()).toBe(before)
    expect(lastMew()).toBe(
      'Deck at 10:00 came in from your calendar — I merge only blocks I placed, so everything stays as it is.'
    )
  })

  it('a done part never merges into an open one', async () => {
    await fresh([deck('d1', 9 * 60, 10 * 60, { status: 'done' }), deck('d2', 10 * 60, 11 * 60)])
    const before = snapshot()
    await say('merge my two deck blocks')
    await settle()
    expect(snapshot()).toBe(before)
    expect(lastMew()).toBe(
      'Deck at 9:00 is already done — a mew stays a mew, so everything stays as it is.'
    )
  })

  it('mixed tags never merge silently: nothing changes, and the tags are named', async () => {
    await fresh([deck('d1', 9 * 60, 10 * 60), deck('d2', 10 * 60, 11 * 60, { tag: 'private' })])
    const before = snapshot()
    await say('merge my two deck blocks')
    await settle()
    expect(snapshot()).toBe(before)
    expect(lastMew()).toBe(
      'those "Deck" blocks today are tagged work and private — give them one tag and I\'ll merge them. Everything stays as it is for now.'
    )
  })
})
