/* #75 slice 3, through the REAL store: a sweep that reaches a repeating block
   asks which occurrences are meant BEFORE it touches anything, with the same
   three answers a single series edit offers (#343). Each chip re-issues the
   sweep in the keyless batch grammar with its scope word, so a pick means the
   same list on either floor and goes through the same midnight re-check every
   other chip does (#94/#96). A move onto ONE day never asks — two of the three
   answers cannot act on it — and says what does work instead. Adapters faked at
   their seams (the batch-blocks harness); no jsdom. */

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

/* ── fixtures ─────────────────────────────────────────────────────── */

const WED = '2026-06-10'
const THU = '2026-06-11'
const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body
const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)
const labels = () =>
  chipMsgs()
    .at(-1)!
    .choices!.map((c) => c.label)
const chipReply = (label: string) =>
  chipMsgs()
    .at(-1)!
    .choices!.find((c) => c.label === label)!.reply!
const pick = async (label: string) => {
  const msg = chipMsgs().at(-1)!
  await useMew.getState().pickChoice(msg.id, msg.choices!.find((c) => c.label === label)!.id)
  await settle()
}
const at = (id: string) => {
  const b = blocks().find((x) => x.id === id)!
  return [b.dayKey, b.startMin]
}
/** an evening Gym that repeats Tue/Wed/Thu, plus the owner's own two blocks */
const gymSeries = () => [
  block({
    id: 'g-tue',
    title: 'Gym',
    tag: 'health',
    startMin: 18 * 60,
    endMin: 19 * 60,
    recurringBlockId: 'r1',
  }),
  block({
    id: 'g-wed',
    title: 'Gym',
    tag: 'health',
    dayKey: WED,
    startMin: 18 * 60,
    endMin: 19 * 60,
    recurringBlockId: 'r1',
  }),
  block({
    id: 'g-thu',
    title: 'Gym',
    tag: 'health',
    dayKey: THU,
    startMin: 18 * 60,
    endMin: 19 * 60,
    recurringBlockId: 'r1',
  }),
]
const deck = () =>
  block({ id: 'deck', title: 'Deck', tag: 'health', startMin: 17 * 60, endMin: 18 * 60 })

describe('#75 slice 3 — a sweep over a repeating block asks first', () => {
  it('nothing moves until the answer: the chips carry the three scopes', async () => {
    await fresh([...gymSeries(), deck()])
    await say('push all health after 4pm today later by 30 min')
    await settle()
    expect(labels()).toEqual(['just this one', 'this & the ones after', 'the whole series'])
    expect(chipMsgs().at(-1)!.body).toBe('Gym repeats — which do you mean?')
    /* the sweep touched nothing — not even the one-off it could have moved */
    expect(at('deck')).toEqual([TODAY, 17 * 60])
    expect(at('g-tue')).toEqual([TODAY, 18 * 60])
  })

  it('each chip re-issues the sweep in the keyless grammar, with its scope word', async () => {
    await fresh([...gymSeries(), deck()])
    await say('push all health after 4pm today later by 30 min')
    await settle()
    expect(chipReply('just this one')).toBe(
      'push all health after 16:00 today later by 30 min just this one'
    )
    expect(chipReply('this & the ones after')).toBe(
      'push all health after 16:00 today later by 30 min this and following'
    )
    expect(chipReply('the whole series')).toBe(
      'push all health after 16:00 today later by 30 min across the whole series'
    )
  })

  it('the whole series, picked and confirmed: every occurrence moves, on its own day', async () => {
    await fresh([...gymSeries(), deck()])
    await say('push all health after 4pm today later by 30 min')
    await settle()
    await pick('the whole series')
    /* the answer widens the list, so the wide-change confirm still guards it */
    const offer = chipMsgs().at(-1)!.body
    expect(offer).toMatch(/^move 4 blocks 30 min later today\?/)
    expect(offer).toContain('Gym 18:00→18:30')
    await pick('do it')
    expect(lastMew()).toMatch(/^Moved 4 blocks 30 min later today — /)
    expect(at('g-tue')).toEqual([TODAY, 18 * 60 + 30])
    expect(at('g-wed')).toEqual([WED, 18 * 60 + 30])
    expect(at('g-thu')).toEqual([THU, 18 * 60 + 30])
    expect(at('deck')).toEqual([TODAY, 17 * 60 + 30])
  })

  it('just this one, picked: the other occurrences stay exactly where they were', async () => {
    await fresh([...gymSeries(), deck()])
    await say('push all health after 4pm today later by 30 min')
    await settle()
    await pick('just this one')
    /* two blocks is a narrow change, so the answer acts straight away */
    expect(lastMew()).toMatch(/^Moved 2 blocks 30 min later today — /)
    expect(at('g-tue')).toEqual([TODAY, 18 * 60 + 30])
    expect(at('g-wed')).toEqual([WED, 18 * 60])
    expect(at('g-thu')).toEqual([THU, 18 * 60])
  })

  it('a typed answer works the same as its chip', async () => {
    await fresh([...gymSeries(), deck()])
    await say('push all health after 4pm today later by 30 min just this one')
    await settle()
    expect(at('g-tue')).toEqual([TODAY, 18 * 60 + 30])
    expect(at('g-wed')).toEqual([WED, 18 * 60])
  })

  it('a series that holds one open occurrence asks nothing: the three answers would collapse', async () => {
    await fresh([gymSeries()[0], deck()])
    await say('push all health after 4pm today later by 30 min')
    await settle()
    expect(chipMsgs()).toEqual([])
    expect(lastMew()).toContain('Gym 18:00 (repeats)')
    expect(at('g-tue')).toEqual([TODAY, 18 * 60])
    expect(at('deck')).toEqual([TODAY, 17 * 60 + 30])
  })
})

describe('#75 slice 3 — a move onto one day says what does work', () => {
  it('no chips, and the reason names the answer that can act', async () => {
    await fresh([...gymSeries(), deck()])
    await say("move all today's health to tomorrow")
    await settle()
    /* the wide-change confirm is the only question here */
    expect(labels()).toEqual(['do it', 'not now'])
    expect(chipMsgs().at(-1)!.body).toContain(
      'Gym 18:00 (repeats — "just this one" moves this one)'
    )
    await pick('do it')
    expect(at('deck')).toEqual([WED, 17 * 60])
    expect(at('g-tue')).toEqual([TODAY, 18 * 60])
  })

  it("'just this one' moves the occurrence, and the run keeps its own days", async () => {
    await fresh([...gymSeries(), deck()])
    await say("move all today's health to tomorrow just this one")
    await settle()
    await pick('do it')
    expect(at('g-tue')).toEqual([WED, 18 * 60])
    expect(at('g-wed')).toEqual([WED, 18 * 60])
    expect(at('g-thu')).toEqual([THU, 18 * 60])
  })
})
