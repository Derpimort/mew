/* #75 slice 2, through the REAL store: a retag over a selection is offered
   first with the exact list, like every wide batch (#110), and acts in place:
   times never change, calendar/done/repeating blocks keep their tags and are
   named, one undo reverses it, and a keyed offer tapped on the keyless floor
   retags exactly what it listed. "between X and Y" picks the blocks that start
   inside it. Adapters faked at their seams (the batch-blocks harness); no jsdom. */

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
const rows = (day: string) =>
  blocks()
    .filter((b) => b.dayKey === day)
    .sort((a, b) => a.startMin - b.startMin)
    .map((b) => [b.id, b.tag, b.startMin, b.endMin])
/** tomorrow: three of the owner's calls (private), a calendar call, a walk */
const calls = () => [
  block({
    id: 'c1',
    title: 'Client call',
    tag: 'private',
    dayKey: WED,
    startMin: 540,
    endMin: 570,
    protected: false,
  }),
  block({
    id: 'c2',
    title: 'Vendor call',
    tag: 'private',
    dayKey: WED,
    startMin: 660,
    endMin: 690,
    protected: false,
  }),
  block({
    id: 'c3',
    title: 'Call the bank',
    tag: 'private',
    dayKey: WED,
    startMin: 780,
    endMin: 810,
    protected: false,
  }),
  block({
    id: 'cal',
    title: 'Board call',
    tag: 'private',
    dayKey: WED,
    startMin: 900,
    endMin: 960,
    external: { calId: 'c', eventId: 'e' },
  }),
  block({
    id: 'walk',
    title: 'Walk',
    tag: 'health',
    dayKey: WED,
    startMin: 1020,
    endMin: 1080,
    protected: false,
  }),
]

describe('#75 slice 2 — a retag, offered first and applied in place', () => {
  it('"tag all of tomorrow\'s calls as work": the exact list, the calendar call named, and the pick retags only those', async () => {
    await fresh(calls())
    const before = rows(WED)
    await say("tag all of tomorrow's calls as work")
    await settle()
    expect(rows(WED)).toEqual(before) // nothing before the pick
    const offer = chipMsgs().at(-1)!
    expect(offer.body).toBe(
      'tag 3 blocks as work tomorrow? Client call 9:00 · Vendor call 11:00 · Call the bank 13:00. Board call 15:00 (from your calendar) keeps its tag.'
    )
    expect(offer.choices![0].reply).toMatch(
      /^tag all tomorrow's "calls" as work — yes, all 3 · [a-z0-9]+$/
    )
    await pick('do it')
    expect(lastMew()).toBe(
      'Tagged 3 blocks as work tomorrow — Client call 9:00 · Vendor call 11:00 · Call the bank 13:00. Board call 15:00 (from your calendar) keeps its tag.'
    )
    expect(rows(WED)).toEqual([
      ['c1', 'work', 540, 570],
      ['c2', 'work', 660, 690],
      ['c3', 'work', 780, 810],
      ['cal', 'private', 900, 960],
      ['walk', 'health', 1020, 1080],
    ])
  })

  it('two blocks act directly, like the single ops', async () => {
    await fresh([
      block({
        id: 'g1',
        title: 'Gym',
        tag: 'private',
        startMin: 7 * 60,
        endMin: 8 * 60,
        protected: false,
      }),
      block({
        id: 'g2',
        title: 'Gym stretch',
        tag: 'private',
        startMin: 18 * 60,
        endMin: 18 * 60 + 30,
        protected: false,
      }),
    ])
    await say(`tag all today's "gym" as health`)
    await settle()
    expect(chipMsgs()).toHaveLength(0)
    expect(lastMew()).toBe('Tagged 2 blocks as health today — Gym 7:00 · Gym stretch 18:00.')
    expect(blocks().map((b) => b.tag)).toEqual(['health', 'health'])
  })

  it('when every picked block already has the tag, nothing changes and MEW says so', async () => {
    await fresh([
      block({
        id: 'w',
        title: 'Walk',
        tag: 'health',
        startMin: 17 * 60,
        endMin: 18 * 60,
        protected: false,
      }),
    ])
    await say(`tag all today's "walk" as health`)
    await settle()
    expect(lastMew()).toBe(
      'nothing there can be tagged as health today: Walk 17:00 (already health) keeps its tag. Everything stays as it is.'
    )
  })

  it('keyed: an offer tapped on the keyless floor retags exactly what it listed, and one undo in a keyed turn puts every tag back', async () => {
    await fresh(calls(), [], 'local')
    scriptedModel.midTurn = (exec) => {
      exec.batch({ dayOffset: 1, titleQuery: 'call' }, { kind: 'setTag', tag: 'work' })
    }
    await say('tag the calls tomorrow as work')
    await settle()
    scriptedModel.midTurn = null
    const offer = chipMsgs().at(-1)!
    expect(offer.choices![0].reply).toMatch(
      /^tag all tomorrow's "call" as work — yes, all 3 · [a-z0-9]+$/
    )
    useMew.setState((st) => ({ settings: { ...st.settings, modelLocation: 'remote' as const } }))
    const before = rows(WED)
    await pick('do it')
    expect(
      rows(WED)
        .filter((r) => r[1] === 'work')
        .map((r) => r[0])
    ).toEqual(['c1', 'c2', 'c3'])

    /* one undo, in one keyed turn with a retag, restores every tag */
    await fresh(calls(), [], 'local')
    let undone = ''
    scriptedModel.midTurn = (exec) => {
      exec.batch({ dayOffset: 1, titleQuery: 'call' }, { kind: 'setTag', tag: 'work' })
      const token = chipMsgs()
        .at(-1)!
        .choices![0].reply.match(/· ([a-z0-9]+)$/)![1]
      exec.batch({ dayOffset: 1, titleQuery: 'call' }, { kind: 'setTag', tag: 'work' }, 3, token)
      undone = exec.undoLast()
    }
    await say('tag the calls tomorrow as work — yes — no, undo that')
    await settle()
    expect(undone).toMatch(/^Undone — /)
    expect(rows(WED)).toEqual(before)
  })
})

describe('#75 slice 2 — "between X and Y"', () => {
  it('"push everything between 2 and 5pm back 30 min" picks the blocks that start from 14:00 to before 17:00', async () => {
    await fresh([
      block({ id: 'a', title: 'Deck', startMin: 13 * 60 + 30, endMin: 14 * 60, protected: false }),
      block({ id: 'b', title: 'Email', startMin: 14 * 60, endMin: 14 * 60 + 30, protected: false }),
      block({ id: 'c', title: 'Notes', startMin: 15 * 60, endMin: 15 * 60 + 30, protected: false }),
      block({
        id: 'd',
        title: 'Review',
        startMin: 16 * 60 + 30,
        endMin: 17 * 60,
        protected: false,
      }),
      block({ id: 'e', title: 'Wrap', startMin: 17 * 60, endMin: 17 * 60 + 30, protected: false }),
    ])
    await say('push everything between 2 and 5pm back 30 min')
    await settle()
    const offer = chipMsgs().at(-1)!
    expect(offer.body).toBe(
      'move 3 blocks 30 min later today? Email 14:00→14:30 · Notes 15:00→15:30 · Review 16:30→17:00. Review 17:00 would share time with Wrap 17:00–17:30.'
    )
    expect(offer.choices![0].reply).toMatch(
      /^push everything after 14:00 and before 17:00 today later by 30 min — yes, all 3 · [a-z0-9]+$/
    )
  })
})
