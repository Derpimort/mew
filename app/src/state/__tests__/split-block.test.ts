/* #73 — split a block around a time or a meeting (the #16 command surface),
   through the REAL store. One executor for every door: the typed ask ("split the
   deck around the 1pm call"), the keyed split_block tool, and the rescue chip's
   exact split (its golden lives in rescue-split-golden.test.ts). Pinned here:
   the call's span stays free between the pieces and the total length is kept;
   keyless and keyed land identically; a calendar block is never split; a series
   occurrence asks its scope first; an ambiguous name asks which; a gap outside
   the block or a too-short piece asks; part 2 never lands on a fixed or
   protected block, while a paced breather yields (#324); one undo takes the
   whole split back. The granular-ops harness (a scripted local model fires the
   executor); no jsdom. */

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

/* ── fixtures ─────────────────────────────────────────────────────── */

const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)
const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body
const snapshot = () =>
  JSON.stringify(
    [...blocks()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((b) => [b.id, b.title, b.dayKey, b.startMin, b.endMin, b.status, b.recurringBlockId])
  )
/** the week by content alone (fresh ids differ run to run) */
const shape = () =>
  JSON.stringify(
    [...blocks()]
      .map((b) => [b.title, b.dayKey, b.startMin, b.endMin, b.status, b.protected, b.tag])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  )
const part2 = (title = 'Deck (part 2)') => blocks().find((b) => b.title === title)

/** the deck 12:00–15:00 and a 1pm call from the connected calendar */
const DECK = () => block({ id: 'deck', title: 'Deck', startMin: 12 * 60, endMin: 15 * 60 })
const CALL = () =>
  block({
    id: 'call',
    title: 'Client call',
    startMin: 13 * 60,
    endMin: 13 * 60 + 45,
    protected: false,
    calendarRefs: ['c'],
    external: { calId: 'c', eventId: 'e1' },
  })
const occurrence = (id: string, day: string) =>
  block({
    id,
    title: 'Standup',
    dayKey: day,
    startMin: 9 * 60,
    endMin: 10 * 60,
    recurringBlockId: 'standup-series',
    rrule: { freq: 'DAILY', interval: 1 },
  })
const WED = '2026-06-10'
const THU = '2026-06-11'

/* ── the op ───────────────────────────────────────────────────────── */

describe('#73 — split the deck around the 1pm call', () => {
  it('keyless: the call stays free between the pieces and the deck keeps its 3 hours', async () => {
    await fresh([DECK(), CALL()])
    await say('split the deck around the 1pm call')
    await settle()

    expect(byId('deck')).toMatchObject({ title: 'Deck', startMin: 12 * 60, endMin: 13 * 60 })
    expect(byId('call')).toMatchObject({ startMin: 13 * 60, endMin: 13 * 60 + 45 }) // untouched
    expect(part2()).toMatchObject({
      tag: 'work',
      dayKey: TODAY,
      startMin: 13 * 60 + 45,
      endMin: 15 * 60 + 45,
      protected: true,
      status: 'open',
    })
    const total = [byId('deck')!, part2()!].reduce((n, b) => n + b.endMin - b.startMin, 0)
    expect(total).toBe(180)
    /* the paced breather that sat at 15:00 yields to part 2 (#324), named */
    expect(blocks().find((b) => b.title === 'Breather')).toMatchObject({
      startMin: 15 * 60 + 45,
      endMin: 16 * 60,
    })
    expect(lastMew()).toBe(
      'Split — Deck now runs 12:00–13:00, and Deck (part 2) picks up 13:45–15:45, around Client call 13:00–13:45 — moved Breather to 15:45 to clear Deck (part 2).'
    )
  })

  it('keyed: the split_block executor call lands exactly as the typed ask does', async () => {
    await fresh([DECK(), CALL()])
    await say('split the deck around the 1pm call')
    await settle()
    const keyless = shape()

    await fresh([DECK(), CALL()], [], 'local')
    let result = ''
    scriptedModel.midTurn = (exec) => {
      result = runToolResult(exec)
    }
    await say('split the deck around the 1pm call')
    await settle()
    expect(shape()).toBe(keyless)
    expect(result).toBe(
      'Split — Deck now runs 12:00–13:00, and Deck (part 2) picks up 13:45–15:45, around Client call 13:00–13:45 — moved Breather to 15:45 to clear Deck (part 2).'
    )
  })

  it('one undo takes the whole split back', async () => {
    await fresh([DECK(), CALL()], [], 'local')
    const before = snapshot()
    let undo = ''
    scriptedModel.midTurn = (exec) => {
      exec.split('deck', { startMin: 13 * 60, endMin: 13 * 60 + 45 })
      undo = exec.undoLast()
    }
    await say('split the deck around 13:00-13:45, then undo that')
    await settle()
    expect(snapshot()).toBe(before)
    expect(part2()).toBeUndefined()
    expect(undo.startsWith('Undone')).toBe(true)
  })
})

describe('#73 — the laws hold', () => {
  it('a calendar block is never split, and the reply says so plainly', async () => {
    await fresh([DECK(), CALL()])
    const before = snapshot()
    await say('split the client call around 13:15-13:30')
    await settle()
    expect(snapshot()).toBe(before)
    expect(lastMew()).toBe(
      "Client call came in from a connected calendar — it's not mine to split. I can split one of your own blocks around it instead."
    )
  })

  it('a series occurrence asks this / following / series first, and nothing changes until a pick', async () => {
    await fresh([occurrence('su-tue', TODAY), occurrence('su-wed', WED), occurrence('su-thu', THU)])
    const before = snapshot()
    await say('split the standup around 9:30-9:45')
    await settle()
    expect(snapshot()).toBe(before)
    const offer = chipMsgs().at(-1)!
    expect(offer.body).toBe('"Standup" repeats — which do you mean?')
    expect(offer.choices!.map((c) => [c.label, c.reply])).toEqual([
      ['just this one', 'split standup at 9:00 around 9:30-9:45 today just this one'],
      ['this & the ones after', 'split standup at 9:00 around 9:30-9:45 today this and following'],
      ['the whole series', 'split standup at 9:00 around 9:30-9:45 today across the whole series'],
    ])

    await useMew.getState().pickChoice(offer.id, offer.choices![0].id)
    await settle()
    expect(byId('su-tue')).toMatchObject({
      startMin: 9 * 60,
      endMin: 9 * 60 + 30,
      recurringBlockId: 'standup-series',
    })
    expect(part2('Standup (part 2)')).toMatchObject({ dayKey: TODAY, startMin: 585, endMin: 615 })
    expect(part2('Standup (part 2)')!.recurringBlockId).toBeUndefined()
    expect(byId('su-wed')).toMatchObject({ startMin: 9 * 60, endMin: 10 * 60 }) // the rest stay whole
    expect(byId('su-thu')).toMatchObject({ startMin: 9 * 60, endMin: 10 * 60 })
  })

  it('the whole series splits each occurrence that has room, and names the one kept whole', async () => {
    await fresh([
      occurrence('su-tue', TODAY),
      occurrence('su-wed', WED),
      occurrence('su-thu', THU),
      block({ id: 'dentist', title: 'Dentist', dayKey: THU, startMin: 585, endMin: 630 }),
    ])
    await say('split the standup around 9:30-9:45 across the whole series')
    await settle()
    expect([byId('su-tue')!.endMin, byId('su-wed')!.endMin, byId('su-thu')!.endMin]).toEqual([
      570, 570, 600,
    ])
    expect(
      blocks()
        .filter((b) => b.title === 'Standup (part 2)')
        .map((b) => b.dayKey)
    ).toEqual([TODAY, WED])
    expect(lastMew()).toBe(
      'Split — Standup across the whole series: 2 blocks now pause 9:30–9:45 and pick up again after. Thursday had no room for it, so that one stays whole.'
    )
  })

  it('part 2 never lands on a protected or fixed block: nothing changes and the reply names it', async () => {
    await fresh([
      DECK(),
      CALL(),
      block({ id: 'standup', title: 'Standup', startMin: 15 * 60, endMin: 15 * 60 + 30 }),
    ])
    const before = snapshot()
    await say('split the deck around the 1pm call')
    await settle()
    expect(snapshot()).toBe(before)
    expect(lastMew()).toBe(
      "the rest of Deck (120 min, 13:45–15:45) would run into Standup 15:00–15:30, and part 2 only goes where it fits — clear that or pick another gap, and I'll split it."
    )
  })

  it('a gap outside the block, or a piece under 15 min, asks instead of guessing', async () => {
    await fresh([DECK(), CALL()])
    const before = snapshot()
    await say('split the deck around 16:00-16:30')
    await settle()
    expect(lastMew()).toBe(
      "Deck runs 12:00–15:00, so 16:00–16:30 sits outside it — name a time inside it and I'll split it there."
    )
    await say('split the deck around 12:10-12:30')
    await settle()
    expect(lastMew()).toBe(
      'splitting Deck at 12:10 would leave just 10 min before the gap — pick a split with at least 15 min on each side?'
    )
    expect(snapshot()).toBe(before)
  })

  it('two blocks share the name: it asks which, and the pick splits exactly that one', async () => {
    await fresh([
      block({ id: 'deck-am', title: 'Deck', startMin: 8 * 60 + 30, endMin: 10 * 60 + 30 }),
      DECK(),
      CALL(),
    ])
    await say('split the deck around 13:00-13:45')
    await settle()
    const offer = chipMsgs().at(-1)!
    expect(offer.choices!.map((c) => [c.label, c.reply])).toEqual([
      ['the 8:30', 'split deck at 8:30 around 13:00-13:45 today'],
      ['the 12:00', 'split deck at 12:00 around 13:00-13:45 today'],
    ])
    await useMew.getState().pickChoice(offer.id, offer.choices![1].id)
    await settle()
    expect(byId('deck-am')).toMatchObject({ startMin: 510, endMin: 630 }) // untouched
    expect(byId('deck')).toMatchObject({ startMin: 720, endMin: 780 })
    expect(part2()).toMatchObject({ startMin: 825, endMin: 945 })
  })
})

describe('#73 — the split_block tool reads only a real gap or a real around', () => {
  it('passes a clock gap or an around block through; anything else answers without a call', async () => {
    const calls: unknown[][] = []
    const exec = {
      split: (...args: unknown[]) => {
        calls.push(args)
        return 'ok'
      },
    } as unknown as import('../../adapters/model').ToolExecutor
    await runTool(
      'split_block',
      { query: 'deck', aroundStartMin: 780, aroundEndMin: 825, at: '12:00' },
      exec
    )
    await runTool(
      'split_block',
      { query: 'deck', aroundQuery: 'call', aroundAt: '1pm', scope: 'this' },
      exec
    )
    expect(calls).toEqual([
      ['deck', { startMin: 780, endMin: 825 }, { at: '12:00', scope: undefined }],
      ['deck', { query: 'call', at: '1pm' }, { at: undefined, scope: 'this' }], // the executor reads the time
    ])
    expect(await runTool('split_block', { query: 'deck' }, exec)).toMatch(
      /^nothing to split around/
    )
    expect(
      await runTool('split_block', { query: 'deck', aroundStartMin: 825, aroundEndMin: 780 }, exec)
    ).toMatch(/^nothing to split around/)
    expect(calls).toHaveLength(2)
  })
})

import { runTool } from '../../adapters/model/tools'

/** the keyed turn's tool call for "split the deck around the 1pm call" */
function runToolResult(exec: import('../../adapters/model').ToolExecutor): string {
  return exec.split('deck', { query: 'call', at: '13:00' })
}
