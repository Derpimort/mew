/* RC journeys, round 3 (tsk_01m2rfszh5t6414hgfx4j0cdg7): the two newest things
   in the RC meeting everything else — #150's scope ask over a repeating block
   whose list crosses days, and #149's undo receipt naming what actually came
   back. Round 1 (#125) and round 2 (#152) hold the earlier features; this file
   deliberately leaves those alone and picks up where they stopped: a sweep that
   spans days and is READ BACK against the week, and undo telling the truth about
   a length, a name and a move in one session.
   Real store, keyless floor unless a journey says otherwise, asserting the WEEK
   and the CHAT at every step. Test-only: a journey that finds a bug pins it as a
   filed issue, never a fix here. */
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

/* ── journey helpers ──────────────────────────────────────────────── */

const WED = '2026-06-10'
const THU = '2026-06-11'

/* ── journey helpers ──────────────────────────────────────────────── */

const seen = (from: number) =>
  chat()
    .slice(from)
    .filter((m) => m.role !== 'tool')
    .map((m) => `${m.role}: ${m.body}`)
const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)
const chips = (msg = chipMsgs().at(-1)!) => msg.choices!.map((c) => [c.label, c.reply])
const pick = async (label: string) => {
  const msg = chipMsgs().at(-1)!
  await useMew.getState().pickChoice(msg.id, msg.choices!.find((c) => c.label === label)!.id)
  await settle()
}
/** every block as [title, day, start, end], in week order — what the owner sees */
const weekRows = () =>
  blocks()
    .slice()
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.startMin - b.startMin)
    .map((b) => [b.title, b.dayKey, b.startMin, b.endMin])
const gym = (id: string, dayKey: string) =>
  block({
    id,
    title: 'Gym',
    tag: 'health',
    dayKey,
    startMin: 18 * 60,
    endMin: 19 * 60,
    protected: false,
    recurringBlockId: 'r1',
  })

/* ── 10 · a sweep over a repeating run, read back against the week ───── */

describe('RC journey 10: the scope ask, a list that crosses days, and taking it back', () => {
  it('asks before it moves anything, names every row with its day, and one undo returns all three', async () => {
    await fresh([
      gym('g-tue', TODAY),
      gym('g-wed', WED),
      gym('g-thu', THU),
      block({ id: 'deck', title: 'Deck', startMin: 17 * 60, endMin: 18 * 60, protected: false }),
    ])
    const before = weekRows()

    /* 1 · the sweep reaches a repeating block, so MEW asks which occurrences it
       means (#150) — and moves NOTHING yet, not even the one-off it could have */
    let from = chat().length
    await say('push all health after 4pm today later by 30 min')
    await settle()
    expect(seen(from)).toEqual([
      'user: push all health after 4pm today later by 30 min',
      'mew: Gym repeats — which do you mean?',
    ])
    expect(chips().map(([label]) => label)).toEqual([
      'just this one',
      'this & the ones after',
      'the whole series',
    ])
    expect(weekRows()).toEqual(before)

    /* 2 · the answer widens the list across three days, so the confirm names a
       day on every row and drops the "today" it can no longer claim (#150's
       copy fix). The owner can check the list they are approving. */
    await pick('the whole series')
    expect(chipMsgs().at(-1)!.body).toBe(
      'move 3 blocks 30 min later? Gym today 18:00→18:30 · Gym tomorrow 18:00→18:30 · Gym Thursday 18:00→18:30.'
    )
    expect(weekRows()).toEqual(before) // still nothing moved

    /* 3 · the receipt reads back exactly as the offer did, and the week matches
       it row for row — which is the whole point of naming the days */
    from = chat().length
    await pick('do it')
    expect(seen(from).at(-1)).toBe(
      'mew: Moved 3 blocks 30 min later — Gym today 18:00→18:30 · Gym tomorrow 18:00→18:30 · Gym Thursday 18:00→18:30.'
    )
    expect(weekRows()).toEqual([
      ['Deck', TODAY, 1020, 1080],
      ['Gym', TODAY, 1110, 1170],
      ['Gym', WED, 1110, 1170],
      ['Gym', THU, 1110, 1170],
    ])

    /* 4 · they DID move, so undo says so in the move's own words (#149), and the
       whole run comes back — the one-off that never moved is untouched throughout */
    from = chat().length
    await say('undo that')
    await settle()
    expect(seen(from)).toEqual([
      'user: undo that',
      'mew: Undone — put three blocks back where they were.',
    ])
    expect(weekRows()).toEqual(before)
  })
})

/* ── 11 · one session, three kinds of change, three honest receipts ──── */

describe('RC journey 11: MEW takes back a length, a name and a move, and says which', () => {
  it('each undo names what actually came back, and the week matches the sentence each time', async () => {
    await fresh([
      block({ id: 'deck', title: 'Deck', startMin: 9 * 60, endMin: 10 * 60, protected: false }),
      block({
        id: 'gym',
        title: 'Gym',
        tag: 'health',
        startMin: 18 * 60,
        endMin: 19 * 60,
        protected: false,
      }),
    ])

    /* 1 · a resize, taken back: the block never moved, so the sentence doesn't
       say it did — it names the length that came back (#149) */
    let from = chat().length
    await say('make the deck 30 min longer')
    await settle()
    expect(weekRows()[0]).toEqual(['Deck', TODAY, 540, 630])
    await say('undo that')
    await settle()
    expect(seen(from).at(-1)).toBe('mew: Undone — put Deck back to its old length.')
    expect(weekRows()[0]).toEqual(['Deck', TODAY, 540, 600])

    /* 2 · a rename, taken back, in the same session: the name that came back is
       the one the owner sees */
    from = chat().length
    await say('rename the gym to Evening gym')
    await settle()
    expect(blocks().find((b) => b.id === 'gym')!.title).toBe('evening gym')
    await say('undo that')
    await settle()
    expect(seen(from).at(-1)).toBe('mew: Undone — called it Gym again.')
    expect(blocks().find((b) => b.id === 'gym')!.title).toBe('Gym')

    /* 3 · and a real move still reads the way it always did — the wording the
       other two were borrowing before #149 */
    from = chat().length
    await say('move the deck to 14:00')
    await settle()
    expect(weekRows().find((r) => r[0] === 'Deck')).toEqual(['Deck', TODAY, 840, 900])
    await say('undo that')
    await settle()
    expect(seen(from).at(-1)).toBe('mew: Undone — put Deck back where it was.')
    expect(weekRows().find((r) => r[0] === 'Deck')).toEqual(['Deck', TODAY, 540, 600])

    /* nothing the owner didn't ask for moved at any point */
    expect(weekRows()).toEqual([
      ['Deck', TODAY, 540, 600],
      ['Gym', TODAY, 1080, 1140],
    ])
    expect(useMew.getState().captures).toEqual([])
  })
})
