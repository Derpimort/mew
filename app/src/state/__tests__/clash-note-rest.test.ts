/* The clash note never calls a protected rest "flexible" (found in #137's
   review): a change that runs over a protected rest names it the way #122 does
   ("it runs over your evening walk 18:00–18:45"), with no offer to drift it
   (protect-rest owns sacred rest), while a truly flexible block keeps its
   "(flexible)" note, and for the keyed model its drift guidance. Real store
   (keyless floor, plus a scripted local model for the keyed results); no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import { DRIFT_OFFER_NOTE } from '../../adapters/model/modelNotes'

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

const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body
const deck = () =>
  block({ id: 'deck', title: 'Deck', startMin: 17 * 60, endMin: 18 * 60, protected: false })
const walk = (startMin = 18 * 60, endMin = 18 * 60 + 45) =>
  block({ id: 'walk', title: 'Evening walk', tag: 'rest', startMin, endMin })
const gym = (startMin = 18 * 60, endMin = 19 * 60) =>
  block({ id: 'gym', title: 'Gym', tag: 'health', startMin, endMin, protected: false })

describe('a clash with a protected rest is named as rest, never "flexible"', () => {
  it('the batch repro: work pushed onto the evening walk names the walk', async () => {
    await fresh([deck(), walk()])
    await say('push all work after 5pm back 30 min')
    await settle()
    expect(lastMew()).toBe(
      'Moved 1 block 30 min later today — Deck 17:00→17:30. — it runs over your evening walk 18:00–18:45'
    )
    expect(blocks().find((b) => b.id === 'walk')).toMatchObject({ startMin: 1080, endMin: 1125 })
  })

  it('a truly flexible block keeps its note', async () => {
    await fresh([deck(), gym()])
    await say('push all work after 5pm back an hour')
    await settle()
    expect(lastMew()).toMatch(/ — note: it overlaps Gym 18:00–19:00 \(flexible\)$/)
  })

  it('both at once: the flexible note, then the rest', async () => {
    await fresh([deck(), gym(18 * 60, 18 * 60 + 30), walk(18 * 60 + 30, 19 * 60 + 15)])
    await say('push all work after 5pm back an hour')
    await settle()
    expect(lastMew()).toMatch(
      / — note: it overlaps Gym 18:00–18:30 \(flexible\) — it runs over your evening walk 18:30–19:15$/
    )
  })

  it('keyed results: the rest carries no drift offer; a flexible block keeps it', async () => {
    let result = ''
    await fresh([deck(), walk()], { location: 'local' })
    scriptedModel.midTurn = (exec) => {
      result = exec.batch({ afterMin: 17 * 60, tag: 'work' }, { kind: 'shift', deltaMin: 30 })
    }
    await say('push my work after 5 back half an hour')
    await settle()
    expect(result).toContain(' — it runs over your evening walk 18:00–18:45')
    expect(result).not.toContain('offer to drift')

    await fresh([deck(), gym()], { location: 'local' })
    scriptedModel.midTurn = (exec) => {
      result = exec.batch({ afterMin: 17 * 60, tag: 'work' }, { kind: 'shift', deltaMin: 60 })
    }
    await say('push my work after 5 back an hour')
    await settle()
    expect(result).toContain(`— note: it overlaps Gym 18:00–19:00 (flexible${DRIFT_OFFER_NOTE})`)
  })

  it('another path, a keyed edit onto the walk, names it the same way', async () => {
    let result = ''
    await fresh([deck(), walk()], { location: 'local' })
    scriptedModel.midTurn = (exec) => {
      result = exec.edit('deck', { startMin: 18 * 60, endMin: 19 * 60 })
    }
    await say('make the deck 6 to 7')
    await settle()
    expect(result).toMatch(/ — it runs over your evening walk 18:00–18:45$/)
    expect(result).not.toContain('(flexible')
  })
})
