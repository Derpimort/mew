/* #131: the remove ask tells the owner to say "both" or "all of them", so a
   typed answer does what the chip would. While a remove ask is live, its label,
   the all-chip's words, a day ("the thursday one") or a time resolves to that
   chip through the same pick path, #94's re-check included; the same words with
   no live ask are an ordinary message, as before. Real store (keyless floor)
   plus the pure resolver; no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import { typedRemoveAnswer } from '../../domain/choices'

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

const WED = '2026-06-10'
const THU = '2026-06-11'
const lunch = (id: string, dayKey: string) =>
  block({
    id,
    title: 'Lunch',
    tag: 'private',
    dayKey,
    startMin: 720,
    endMin: 765,
    protected: false,
  })
const threeLunches = () => [lunch('l-tue', TODAY), lunch('l-wed', WED), lunch('l-thu', THU)]
const lunchIds = () =>
  blocks()
    .filter((b) => b.title === 'Lunch')
    .map((b) => b.id)
    .sort()
const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body
const lastUser = () =>
  chat()
    .filter((m) => m.role === 'user')
    .at(-1)!.body
async function askAboutLunch() {
  await say('remove the lunch at 12:00')
  await settle()
  expect(lastMew()).toMatch(/^3 "lunch" blocks ahead/)
}

describe('#131 — a typed answer to a live remove ask does what its chip does', () => {
  it('the all-chip in words: "all of them", "both", "all", "remove all of them", "Remove both."', async () => {
    for (const said of ['all of them', 'both', 'all', 'remove all of them', 'Remove both.']) {
      await fresh(threeLunches())
      await askAboutLunch()
      await say(said)
      await settle()
      expect(lunchIds(), said).toEqual([])
      expect(lastUser(), said).toBe('remove all lunch')
      expect(useMew.getState().captures, said).toEqual([])
    }
  })

  it('one lunch in words: a label, "the thursday one", "thursday\'s", "tomorrow"', async () => {
    for (const [said, gone] of [
      ['thursday 12:00', 'l-thu'],
      ['the thursday one', 'l-thu'],
      ["thursday's", 'l-thu'],
      ['tomorrow', 'l-wed'],
      ['remove the today one', 'l-tue'],
    ] as const) {
      await fresh(threeLunches())
      await askAboutLunch()
      await say(said)
      await settle()
      expect(lunchIds(), said).toEqual(['l-thu', 'l-tue', 'l-wed'].filter((id) => id !== gone))
      expect(useMew.getState().captures, said).toEqual([])
    }
  })

  it('with no live ask, the same words are an ordinary message, as before', async () => {
    await fresh(threeLunches())
    await say('both')
    await settle()
    expect(lunchIds()).toEqual(['l-thu', 'l-tue', 'l-wed'])
    expect(useMew.getState().captures.map((c) => c.title)).toEqual(['both'])

    /* an ask left behind by a newer message is no longer live */
    await fresh(threeLunches())
    await askAboutLunch()
    await say("what's on today")
    await settle()
    await say('all of them')
    await settle()
    expect(lunchIds()).toEqual(['l-thu', 'l-tue', 'l-wed'])
  })

  it('#94 still applies: a typed "tomorrow 12:00" after midnight is refused like the tap', async () => {
    await fresh(threeLunches(), { at: TUE(23, 50) })
    await askAboutLunch()
    vi.setSystemTime(new Date(2026, 5, 10, 0, 5))
    useMew.getState().tick()
    await say('tomorrow 12:00')
    await settle()
    expect(lastMew()).toBe(
      'That choice was offered on Tuesday ("tomorrow 12:00"), so everything stays as it is.'
    )
    expect(lunchIds()).toEqual(['l-thu', 'l-tue', 'l-wed'])
  })
})

describe('#131 — typedRemoveAnswer (pure)', () => {
  const ask = (id: string, choices: [string, string][], picked = false) => ({
    id,
    role: 'mew' as const,
    body: 'which?',
    ts: 1,
    choices: choices.map(([label, reply], i) => ({ id: `c${i + 1}`, label, reply, picked })),
  })
  const user = (id: string) => ({ id, role: 'user' as const, body: 'x', ts: 0 })

  it('only the newest live chips, only a remove ask, only a word that points at one chip', () => {
    const removeAsk = ask('a', [
      ['the 12:00', 'remove lunch 12:00'],
      ['the 12:30', 'remove lunch 12:30'],
      ['both', 'remove all lunch'],
    ])
    expect(typedRemoveAnswer([user('u'), removeAsk], 'the 12:30')).toEqual({
      msgId: 'a',
      choiceId: 'c2',
    })
    expect(typedRemoveAnswer([user('u'), removeAsk], 'both')).toEqual({
      msgId: 'a',
      choiceId: 'c3',
    })
    expect(typedRemoveAnswer([user('u'), removeAsk], '12:00')).toEqual({
      msgId: 'a',
      choiceId: 'c1',
    })
    /* not a remove ask: a drift offer's "keep both" is its own family */
    const drift = ask('d', [
      ['drop Groceries', 'remove the Groceries today at 14:00'],
      ['keep both', 'ok, keep both as they are'],
    ])
    expect(typedRemoveAnswer([user('u'), drift], 'both')).toBeNull()
    /* a repeating block's scope ask removes, but has no all-chip: "all" never
       means "the whole series"; its own label, typed, still picks it */
    const scope = ask('s', [
      ['just this one', 'remove standup today at 9:00 just this one'],
      ['this & the ones after', 'remove standup today at 9:00 this and following'],
      ['the whole series', 'remove standup today at 9:00 across the whole series'],
    ])
    expect(typedRemoveAnswer([user('u'), scope], 'all')).toBeNull()
    expect(typedRemoveAnswer([user('u'), scope], 'just this one')).toEqual({
      msgId: 's',
      choiceId: 'c1',
    })
    /* another family's chip label, typed exactly, is still not a remove answer */
    const rescue = ask('r', [
      ['shift to 10:15', 'move the Deck polish to today at 10:15'],
      ['roll to tomorrow', 'move the Deck polish to tomorrow'],
    ])
    expect(typedRemoveAnswer([user('u'), rescue], 'roll to tomorrow')).toBeNull()
    /* picked, or left behind by a newer user message: not live */
    expect(
      typedRemoveAnswer([user('u'), ask('p', [['both', 'remove all lunch']], true)], 'both')
    ).toBeNull()
    expect(typedRemoveAnswer([removeAsk, user('u')], 'both')).toBeNull()
    /* a day word two chips share is no answer */
    const twoToday = ask('t', [
      ['today 9:00', 'remove deck today at 9:00'],
      ['today 14:00', 'remove deck today at 14:00'],
    ])
    expect(typedRemoveAnswer([user('u'), twoToday], 'the today one')).toBeNull()
    expect(typedRemoveAnswer([user('u'), removeAsk], 'lunch at noon')).toBeNull()
  })
})
