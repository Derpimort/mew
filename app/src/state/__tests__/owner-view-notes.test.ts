/* #119: a tool result can carry a note written for the keyed model ("don't
   propose another time yourself", "offer to drift it, don't move it unasked").
   The keyed model still reads every note; the keyless floor, which speaks the
   tool result to the owner, drops them and keeps only the owner's line. Pure
   ownerView pins plus the real store on both paths (a scripted local model for
   the keyed side); no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import { CAPTURE_NUDGE_NOTE, DRIFT_OFFER_NOTE, ownerView } from '../../adapters/model/modelNotes'

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

const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body
/** Deck 17:00–18:00 (work) beside a flexible Gym 18:00–19:00: a one-hour batch
    shift of the work lands Deck on Gym, and the receipt names the overlap */
const deckAndGym = () => [
  block({ id: 'deck', title: 'Deck', startMin: 17 * 60, endMin: 18 * 60, protected: false }),
  block({
    id: 'gym',
    title: 'Gym',
    tag: 'health',
    startMin: 18 * 60,
    endMin: 19 * 60,
    protected: false,
  }),
]
const MODEL_WORDS = /\(The |don't propose|offer to drift|unasked/

describe('#119 — ownerView keeps model-only notes out of what the owner hears', () => {
  it('drops each note and leaves every other character as it was', () => {
    expect(ownerView(`Captured "call the bank".${CAPTURE_NUDGE_NOTE}`)).toBe(
      'Captured "call the bank".'
    )
    expect(
      ownerView(
        `Moved 1 block 60 min later today — Deck 17:00→18:00. — note: it overlaps Gym 18:00–19:00 (flexible${DRIFT_OFFER_NOTE}) and Yoga 18:30–19:00 (flexible${DRIFT_OFFER_NOTE})`
      )
    ).toBe(
      'Moved 1 block 60 min later today — Deck 17:00→18:00. — note: it overlaps Gym 18:00–19:00 (flexible) and Yoga 18:30–19:00 (flexible)'
    )
    const plain = 'Split — Deck now runs 12:00–13:00 (fixed — it can’t move), and nothing else.'
    expect(ownerView(plain)).toBe(plain)
    expect(ownerView(ownerView(`x${CAPTURE_NUDGE_NOTE}`))).toBe('x')
  })
})

describe("#119 — the keyless floor speaks only the owner's line; the keyed model still reads the note", () => {
  it('a keyless capture: "Captured …" and nothing written for the model', async () => {
    await fresh([block({ id: 'anchor', title: 'Standup', dayKey: '2026-06-10' })])
    await say('call the bank')
    await settle()
    expect(lastMew()).toBe('Captured "call the bank".')
    expect(useMew.getState().captures.map((c) => c.title)).toEqual(['call the bank'])
  })

  it('a keyed capture: the tool result the model reads keeps the note', async () => {
    await fresh([block({ id: 'anchor', title: 'Standup', dayKey: '2026-06-10' })], {
      location: 'local',
    })
    let result = ''
    scriptedModel.midTurn = (exec) => {
      result = exec.capture('call the bank')
    }
    await say('remind me to call the bank')
    await settle()
    expect(result).toBe(`Captured "call the bank".${CAPTURE_NUDGE_NOTE}`)
    expect(chat().some((m) => m.role === 'mew' && MODEL_WORDS.test(m.body))).toBe(false)
  })

  it('a keyless receipt that names a flexible overlap says "(flexible)" and no more', async () => {
    await fresh(deckAndGym())
    await say('push all work after 5pm back an hour')
    await settle()
    expect(lastMew()).toMatch(/ — note: it overlaps Gym 18:00–19:00 \(flexible\)$/)
    expect(lastMew()).not.toMatch(MODEL_WORDS)
  })

  it('the keyed batch result keeps the drift note for the model', async () => {
    await fresh(deckAndGym(), { location: 'local' })
    let result = ''
    scriptedModel.midTurn = (exec) => {
      result = exec.batch({ afterMin: 17 * 60, tag: 'work' }, { kind: 'shift', deltaMin: 60 })
    }
    await say('push my work after 5 back an hour')
    await settle()
    expect(result).toContain(`— note: it overlaps Gym 18:00–19:00 (flexible${DRIFT_OFFER_NOTE})`)
  })
})
