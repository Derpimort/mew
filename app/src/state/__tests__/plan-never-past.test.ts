/* #116, through the REAL store: a placement MEW picks the time for never
   starts in the past. When the scorer finds nothing left today, the first-fit
   fallback used to start from the plannable day's START, so at 20:46 "block 2h
   for writing" landed at 8:00 that morning, with a breather tucked in after it.
   (v0.7.0 did the same from 18:30 on: pre-existing, and rarer since #51's
   plannable hours.) Now today's first-fit looks from now, a day already gone
   has no slot to find, and a lone ask that can't fit is named honestly, with
   tomorrow's opening offered as a chip. The breather pass never tucks a rest
   into time already gone. Keyless and keyed; adapters faked at their seams
   (the batch-blocks harness); no jsdom. */

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
const onToday = () => blocks().filter((b) => b.dayKey === TODAY)
const titled = (t: string) => blocks().filter((b) => b.title === t)
const clock = (h: number, m = 0) => vi.setSystemTime(TUE(h, m))
/** Tuesday: the morning 8:00–9:00 free, a long deck, dinner; tomorrow's
    morning is taken until 10:00 */
const week = () => [
  block({ id: 'deck', title: 'Q3 deck', startMin: 9 * 60, endMin: 11 * 60 + 30 }),
  block({ id: 'dinner', title: 'Dinner', tag: 'private', startMin: 19 * 60, endMin: 20 * 60 }),
  block({ id: 'wed-am', title: 'Standup prep', dayKey: WED, startMin: 8 * 60, endMin: 10 * 60 }),
]

describe('#116 — a placement MEW times never starts in the past', () => {
  it('at 20:46 "block 2h for writing": nothing lands this morning; the reply names why and offers tomorrow', async () => {
    await fresh(week())
    clock(20, 46)
    const before = onToday().map((b) => b.id)
    await say('block 2h for writing')
    await settle()
    expect(titled('writing')).toEqual([])
    expect(onToday().map((b) => b.id)).toEqual(before) // no breather tucked into the morning
    const offer = chipMsgs().at(-1)!
    expect(offer.body).toBe(
      'No 120-min window is left today for "writing" inside the hours I plan in (8:00–22:30). Open air today: 20:46–0:00, running past the hours I plan in (8:00–22:30) — name a time there and I\'ll hold it. Tomorrow 10:00–12:00 is open.'
    )
    expect(offer.choices!.map((c) => [c.label, c.reply])).toEqual([
      ['tomorrow 10:00', 'block 2h for writing tomorrow at 10:00'],
      ['not now', 'ok, not now'],
    ])
    await useMew.getState().pickChoice(offer.id, offer.choices![0].id)
    await settle()
    expect(titled('writing').map((b) => [b.dayKey, b.startMin, b.endMin])).toEqual([
      [WED, 10 * 60, 12 * 60],
    ])
  })

  it('"not now" places nothing', async () => {
    await fresh(week())
    clock(20, 46)
    await say('block 2h for writing')
    await settle()
    const offer = chipMsgs().at(-1)!
    await useMew.getState().pickChoice(offer.id, offer.choices![1].id)
    await settle()
    expect(titled('writing')).toEqual([])
  })

  it('"tonight" too', async () => {
    await fresh(week())
    clock(20, 46)
    await say('block 2h for writing tonight')
    await settle()
    expect(
      blocks().filter(
        (b) => b.dayKey === TODAY && b.startMin < 20 * 60 + 46 && /writing/.test(b.title)
      )
    ).toEqual([])
  })

  it('a plan that fits after now lands there, as before', async () => {
    await fresh(week())
    clock(20, 46)
    await say('block 1h for email')
    await settle()
    expect(titled('email').map((b) => [b.dayKey, b.startMin, b.endMin])).toEqual([
      [TODAY, 21 * 60, 22 * 60],
    ])
  })

  it('a morning ask the scorer finds no room for today stays out of the hour already gone', async () => {
    /* 9:40: the only free hour today is 8:00–9:00, already past */
    await fresh([block({ id: 'deck', title: 'Q3 deck', startMin: 9 * 60, endMin: 22 * 60 + 30 })])
    clock(9, 40)
    await say('block 1h for reading')
    await settle()
    expect(titled('reading').filter((b) => b.dayKey === TODAY)).toEqual([])
    expect(chipMsgs().at(-1)!.body).toMatch(
      /^No 60-min window is left today for "reading" inside the hours I plan in \(8:00–22:30\)\./
    )
  })

  it('before the plannable start, the first-fit still waits for it', async () => {
    await fresh([block({ id: 'deck', title: 'Q3 deck', startMin: 8 * 60, endMin: 22 * 60 + 30 })])
    /* the store's clock only moves forward (#96): set it back to 6:30 outright */
    clock(6, 30)
    useMew.setState({ nowMs: TUE(6, 30).getTime(), lastActivityMs: TUE(6, 30).getTime() })
    await say('block 1h for reading')
    await settle()
    expect(titled('reading').filter((b) => b.dayKey === TODAY)).toEqual([])
  })

  it('keyed: work logged on a day already gone gets no breather there', async () => {
    const MON = '2026-06-08'
    await fresh(
      [
        block({ id: 'a', title: 'Q3 deck', dayKey: MON, startMin: 8 * 60, endMin: 10 * 60 }),
        block({ id: 'b', title: 'Budget', dayKey: MON, startMin: 10 * 60, endMin: 12 * 60 }),
      ],
      [],
      'local'
    )
    clock(14, 0)
    scriptedModel.midTurn = (exec) => {
      exec.plan(
        [{ title: 'notes', tag: 'work', dayOffset: -1, startMin: 12 * 60, durationMin: 60 }],
        []
      )
    }
    await say('I also did an hour of notes yesterday at noon')
    await settle()
    expect(titled('notes').map((b) => [b.dayKey, b.startMin])).toEqual([[MON, 12 * 60]])
    expect(blocks().filter((b) => b.dayKey === MON && b.tag === 'rest')).toEqual([])
  })

  it('the breather pass never tucks a rest into a stretch that has already ended', async () => {
    /* a four-hour unbroken morning run, then a plan at 14:00 for later today */
    await fresh([
      block({ id: 'a', title: 'Q3 deck', startMin: 8 * 60, endMin: 10 * 60 }),
      block({ id: 'b', title: 'Budget', startMin: 10 * 60, endMin: 12 * 60 }),
    ])
    clock(14, 0)
    await say('block 1h for notes at 15:00')
    await settle()
    expect(titled('notes').map((b) => [b.dayKey, b.startMin])).toEqual([[TODAY, 15 * 60]])
    expect(onToday().filter((b) => b.tag === 'rest' && b.startMin < 14 * 60)).toEqual([])
    expect(lastMew()).not.toMatch(/breather/)
  })

  it('keyed: a place with no time on a day already gone lands nowhere and says so', async () => {
    await fresh(week(), [], 'local')
    clock(14, 0)
    let reply = ''
    scriptedModel.midTurn = (exec) => {
      reply = exec.plan([{ title: 'notes', tag: 'work', dayOffset: -1, durationMin: 60 }], [])
    }
    await say('block an hour for notes yesterday')
    await settle()
    expect(titled('notes')).toEqual([])
    expect(reply).toMatch(/^The options are on screen as clickable chips/)
    expect(chipMsgs().at(-1)!.body).toBe(
      'Monday has already gone by, so "notes" needs a day ahead. Tomorrow 10:00–11:00 is open.'
    )
  })
})
