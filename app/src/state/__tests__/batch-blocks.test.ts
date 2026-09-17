/* #75 — batch changes, through the REAL store (the granular-ops harness: a
   scripted local model for the keyed path, the rules floor for keyless). A wide
   batch is OFFERED first as a confirm naming every move and every block that
   stays put; nothing changes until the pick; the pick moves exactly the listed
   blocks, one undo reverses them all; calendar, fixed, done and repeating blocks
   never move; a narrow batch acts directly; a collision speaks the existing
   clash wording; a confirm picked after midnight re-checks (#94): one naming
   "today" changes nothing, one naming a weekday still acts. The review pins: a
   yes carries its list token, so taps between the offer and the yes, or a
   selector the other floor reads differently, offer again; every yes a keyed
   offer posts is one the keyless floor applies. */

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

const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)
/** the list token a batch yes carries after its "·" */
const tokenOf = (reply: string) => reply.match(/· ([a-z0-9]+)$/)![1]
const pick = async (label: string) => {
  const msg = chipMsgs().at(-1)!
  const choice = msg.choices!.find((c) => c.label === label)!
  await useMew.getState().pickChoice(msg.id, choice.id)
  await settle()
}
/** three flexible blocks after 15:00, a fixed call and a calendar event among them */
const afternoon = () => [
  deck('d1', 15 * 60, 16 * 60, { title: 'Deck' }),
  deck('d2', 17 * 60, 17 * 60 + 30, { title: 'Email' }),
  deck('d3', 18 * 60, 18 * 60 + 30, { title: 'Notes' }),
  block({ id: 'call', title: 'Client call', startMin: 15 * 60 + 30, endMin: 15 * 60 + 45 }),
  block({
    id: 'mtg',
    title: 'Quarterly planning',
    startMin: 20 * 60,
    endMin: 20 * 60 + 30,
    external: { calId: 'c', eventId: 'e' },
  }),
]
const at = (id: string) => {
  const b = byId(id)!
  return [b.dayKey, b.startMin, b.endMin]
}

describe('#75 — a wide batch is offered first, and the pick moves exactly what it listed', () => {
  it('keyless "push everything after 3pm back an hour": one confirm naming the count; nothing moves before the pick', async () => {
    await fresh(afternoon())
    const before = snapshot()
    await say('push everything after 3pm back an hour')
    await settle()
    expect(snapshot()).toBe(before)
    const offer = chipMsgs().at(-1)!
    expect(offer.body).toBe(
      'move 3 blocks 60 min later today? Deck 15:00→16:00 · Email 17:00→18:00 · Notes 18:00→19:00. Client call 15:30 (fixed) and Quarterly planning 20:00 (from your calendar) stay where they are.'
    )
    expect(offer.choices!.map((c) => c.label)).toEqual(['do it', 'not now'])
    expect(offer.choices![0].reply).toMatch(
      /^push everything after 15:00 today later by 60 min — yes, all 3 · [a-z0-9]+$/
    )
    expect(offer.choices![1].reply).toBe('ok, leave them as they are')
  })

  it('the pick moves exactly the listed blocks; the fixed call and the calendar event stay put', async () => {
    await fresh(afternoon())
    await say('push everything after 3pm back an hour')
    await settle()
    await pick('do it')
    expect(at('d1')).toEqual([TODAY, 16 * 60, 17 * 60])
    expect(at('d2')).toEqual([TODAY, 18 * 60, 18 * 60 + 30])
    expect(at('d3')).toEqual([TODAY, 19 * 60, 19 * 60 + 30])
    expect(at('call')).toEqual([TODAY, 15 * 60 + 30, 15 * 60 + 45])
    expect(at('mtg')).toEqual([TODAY, 20 * 60, 20 * 60 + 30])
    expect(lastMew()).toBe(
      'Moved 3 blocks 60 min later today — Deck 15:00→16:00 · Email 17:00→18:00 · Notes 18:00→19:00. Client call 15:30 (fixed) and Quarterly planning 20:00 (from your calendar) stay where they are.'
    )
  })

  it('"not now" changes nothing', async () => {
    await fresh(afternoon())
    const before = snapshot()
    await say('push everything after 3pm back an hour')
    await settle()
    await pick('not now')
    expect(snapshot()).toBe(before)
  })

  it('keyed: the offer, then the yes with its count and token, then one undo brings every block back', async () => {
    await fresh(afternoon(), [], 'local')
    const before = snapshot()
    let offered = ''
    let countOnly = ''
    let moved = ''
    let undone = ''
    scriptedModel.chunks = ['on it — ', 'and back.']
    scriptedModel.midTurn = (exec) => {
      offered = exec.batch({ afterMin: 15 * 60 }, { kind: 'shift', deltaMin: 60 })
      const token = tokenOf(chipMsgs().at(-1)!.choices![0].reply)
      countOnly = exec.batch({ afterMin: 15 * 60 }, { kind: 'shift', deltaMin: 60 }, 3)
      moved = exec.batch({ afterMin: 15 * 60 }, { kind: 'shift', deltaMin: 60 }, 3, token)
      undone = exec.undoLast()
    }
    await say('push everything after 3pm back an hour — yes, do it — actually, undo that')
    await settle()
    expect(offered).toMatch(/^The options are on screen as clickable chips/)
    /* a yes without the list token names no list: offered again, nothing moves */
    expect(countOnly).toMatch(/^The options are on screen as clickable chips/)
    expect(moved).toMatch(/^Moved 3 blocks 60 min later today — /)
    expect(undone).toMatch(/^Undone — /)
    expect(snapshot()).toBe(before)
  })

  it('moving to another day is always offered first, even for two blocks', async () => {
    await fresh([deck('d1', 9 * 60, 10 * 60), deck('d2', 11 * 60, 12 * 60, { title: 'Email' })])
    const before = snapshot()
    await say("move all of today's work to tomorrow")
    await settle()
    expect(snapshot()).toBe(before)
    expect(chipMsgs().at(-1)!.choices![0].reply).toMatch(
      /^move all today's work to tomorrow — yes, all 2 · [a-z0-9]+$/
    )
    await pick('do it')
    expect(at('d1')).toEqual(['2026-06-10', 9 * 60, 10 * 60])
    expect(at('d2')).toEqual(['2026-06-10', 11 * 60, 12 * 60])
  })

  it('the week changed between the offer and the yes: offered again, nothing moves', async () => {
    await fresh(afternoon())
    await say('push everything after 3pm back an hour')
    await settle()
    useMew.setState((st) => ({ blocks: st.blocks.filter((b) => b.id !== 'd3') }))
    const before = snapshot()
    await pick('do it')
    expect(snapshot()).toBe(before)
    expect(chipMsgs().at(-1)!.body).toMatch(
      /^the week changed since then — move 2 blocks 60 min later today\?/
    )
  })
})

describe('#75 — narrow batches, collisions, and a pick after midnight', () => {
  it('two blocks on the same day act directly, like the single ops', async () => {
    await fresh([
      deck('d1', 17 * 60, 17 * 60 + 30),
      deck('d2', 18 * 60, 18 * 60 + 30, { title: 'Email' }),
    ])
    await say('push everything after 5pm back 30 min')
    await settle()
    expect(chipMsgs()).toHaveLength(0)
    expect(at('d1')).toEqual([TODAY, 17 * 60 + 30, 18 * 60])
    expect(at('d2')).toEqual([TODAY, 18 * 60 + 30, 19 * 60])
  })

  it('three or more selected is offered even when fewer can move (the live-app case): the list says which stay put', async () => {
    await fresh([
      deck('pa', 19 * 60, 19 * 60 + 30, { title: 'Probe alpha' }),
      deck('pb', 20 * 60, 20 * 60 + 30, { title: 'Probe beta' }),
      block({ id: 'call', title: 'Client call', startMin: 20 * 60 + 30, endMin: 20 * 60 + 45 }),
      deck('pg', 21 * 60, 21 * 60 + 30, { title: 'Probe gamma' }),
    ])
    const before = snapshot()
    await say('push everything after 7pm back 30 min')
    await settle()
    expect(snapshot()).toBe(before)
    expect(chipMsgs().at(-1)!.body).toBe(
      'move 2 blocks 30 min later today? Probe alpha 19:00→19:30 · Probe gamma 21:00→21:30. Client call 20:30 (fixed) and Probe beta 20:00 (would sit over Client call 20:30–20:45) stay where they are.'
    )
    await pick('do it')
    expect(at('pa')).toEqual([TODAY, 19 * 60 + 30, 20 * 60])
    expect(at('pb')).toEqual([TODAY, 20 * 60, 20 * 60 + 30])
    expect(at('pg')).toEqual([TODAY, 21 * 60 + 30, 22 * 60])
  })

  it('the receipt card names the move, not the tool', async () => {
    const { toolCardLabel } = await import('../../domain/toolCard')
    expect(toolCardLabel('batch', { query: 'work' })).toEqual({
      verb: 'moving them',
      target: 'work',
    })
  })

  it('a collision the batch leaves speaks the existing clash wording', async () => {
    await fresh([
      deck('d1', 17 * 60, 18 * 60),
      deck('gym', 18 * 60, 19 * 60, { title: 'Gym', tag: 'health' }),
    ])
    await say('push all work after 5pm back an hour')
    await settle()
    expect(at('d1')).toEqual([TODAY, 18 * 60, 19 * 60])
    /* the keyless floor speaks the owner's view: the model-only drift note stays out (#119) */
    expect(lastMew()).toMatch(/ — note: it overlaps Gym 18:00–19:00 \(flexible\)$/)
  })

  it('a confirm picked after midnight re-checks (#94): nothing moves, and MEW says when it was offered', async () => {
    await fresh(afternoon())
    await say('push everything after 3pm back an hour')
    await settle()
    vi.setSystemTime(new Date(2026, 5, 10, 0, 5))
    useMew.getState().tick()
    const before = snapshot()
    await pick('do it')
    expect(snapshot()).toBe(before)
    expect(lastMew()).toMatch(/^That choice was offered on Tuesday/)
  })

  it('a confirm that names its day as a weekday still acts after midnight, moving exactly what it listed', async () => {
    const THU = '2026-06-11'
    await fresh(afternoon().map((b) => ({ ...b, dayKey: THU })))
    await say('push everything after 3pm on thursday back an hour')
    await settle()
    expect(chipMsgs().at(-1)!.choices![0].reply).toMatch(
      /^push everything after 15:00 on thursday later by 60 min — yes, all 3 · [a-z0-9]+$/
    )
    vi.setSystemTime(new Date(2026, 5, 10, 0, 5))
    useMew.getState().tick()
    await pick('do it')
    expect(at('d1')).toEqual([THU, 16 * 60, 17 * 60])
    expect(at('d2')).toEqual([THU, 18 * 60, 18 * 60 + 30])
    expect(at('d3')).toEqual([THU, 19 * 60, 19 * 60 + 30])
    expect(at('call')).toEqual([THU, 15 * 60 + 30, 15 * 60 + 45])
    expect(at('mtg')).toEqual([THU, 20 * 60, 20 * 60 + 30])
    expect(lastMew()).toMatch(/^Moved 3 blocks 60 min later/)
  })
})

describe('#75 review — a yes moves exactly the list it answered, on either floor', () => {
  const WED = '2026-06-10'
  const FRI = '2026-06-12'
  /** a keyed model offers the batch, then is unavailable when the owner taps */
  const offerKeyed = async (
    sel: Parameters<import('../../adapters/model').ToolExecutor['batch']>[0],
    op: Parameters<import('../../adapters/model').ToolExecutor['batch']>[1]
  ) => {
    scriptedModel.midTurn = (exec) => {
      exec.batch(sel, op)
    }
    await say('line those up for me')
    await settle()
    scriptedModel.midTurn = null
    useMew.setState((st) => ({ settings: { ...st.settings, modelLocation: 'remote' as const } }))
    return chipMsgs().at(-1)!
  }

  it('Y1: a drag and an inbox placement between the offer and the yes: offered again with the new list, nothing moves', async () => {
    await fresh(afternoon())
    const cap = useMew.getState().capture('file the taxes', { durationMin: 30 })
    await say('push everything after 3pm back an hour')
    await settle()
    const offer = chipMsgs().at(-1)!
    useMew.getState().dragMove('d3', TODAY, 14 * 60, 30)
    useMew
      .getState()
      .placeFromInbox(cap.item!.id, { dayKey: TODAY, startMin: 16 * 60 + 30, durationMin: 30 })
    const before = snapshot()
    await useMew.getState().pickChoice(offer.id, offer.choices![0].id)
    await settle()
    expect(snapshot()).toBe(before)
    expect(chipMsgs().at(-1)!.body).toMatch(
      /^the week changed since then — move 3 blocks 60 min later today\? Deck 15:00→16:00 · file the taxes 16:30→17:30 · Email 17:00→18:00\./
    )
  })

  it('Y1: a keyed offer for title words that are also a tag word, tapped on the keyless floor, moves the blocks it listed', async () => {
    await fresh(
      [
        deck('hw', 9 * 60, 10 * 60, { title: 'Homework help', tag: 'private' }),
        deck('wo', 11 * 60, 12 * 60, { title: 'Workout', tag: 'health' }),
        deck('dk', 13 * 60, 14 * 60),
        deck('em', 14 * 60, 15 * 60, { title: 'Email' }),
      ],
      [],
      'local'
    )
    const offer = await offerKeyed({ titleQuery: 'work' }, { kind: 'moveToDay', toDayOffset: 1 })
    expect(offer.body).toBe(
      'move 2 blocks from today to tomorrow? Homework help 9:00 · Workout 11:00.'
    )
    expect(offer.choices![0].reply).toMatch(
      /^move all today's "work" to tomorrow — yes, all 2 · [a-z0-9]+$/
    )
    await pick('do it')
    expect(at('hw')).toEqual([WED, 9 * 60, 10 * 60])
    expect(at('wo')).toEqual([WED, 11 * 60, 12 * 60])
    expect(at('dk')).toEqual([TODAY, 13 * 60, 14 * 60])
    expect(at('em')).toEqual([TODAY, 14 * 60, 15 * 60])
  })

  it.each([
    [
      'a window with a move to another day',
      { afterMin: 15 * 60 },
      { kind: 'moveToDay' as const, toDayOffset: 1 },
      /^move all today's blocks after 15:00 to tomorrow — yes, all 3 · [a-z0-9]+$/,
      [
        ['d1', WED, 15 * 60],
        ['d2', WED, 17 * 60],
        ['d3', WED, 18 * 60],
      ],
    ],
    [
      'both edges and title words in a shift',
      { afterMin: 15 * 60, beforeMin: 18 * 60 + 30, titleQuery: 'e' },
      { kind: 'shift' as const, deltaMin: -30 },
      /^push all "e" after 15:00 and before 18:30 today earlier by 30 min — yes, all 3 · [a-z0-9]+$/,
      [
        ['d1', TODAY, 14 * 60 + 30],
        ['d2', TODAY, 16 * 60 + 30],
        ['d3', TODAY, 17 * 60 + 30],
      ],
    ],
    [
      'a day past this week',
      { tag: 'work' as const, afterMin: 15 * 60 },
      { kind: 'moveToDay' as const, toDayOffset: 8 },
      /^move all today's work after 15:00 to 2026-06-17 — yes, all 3 · [a-z0-9]+$/,
      [
        ['d1', '2026-06-17', 15 * 60],
        ['d2', '2026-06-17', 17 * 60],
        ['d3', '2026-06-17', 18 * 60],
      ],
    ],
  ])(
    'Y3: every yes a keyed offer posts is one the keyless floor applies: %s',
    async (_, sel, op, reply, moved) => {
      await fresh(afternoon(), [], 'local')
      const offer = await offerKeyed(sel, op)
      expect(offer.choices![0].reply).toMatch(reply)
      await pick('do it')
      expect(moved.map(([id]) => [id, ...at(id as string).slice(0, 2)])).toEqual(moved)
      expect(useMew.getState().captures).toEqual([])
      expect(lastMew()).toMatch(/^Moved 3 blocks /)
    }
  )

  it('Z1: a trailing day is the day it acts on, and the offer names it before the yes', async () => {
    const both = [TODAY, WED].flatMap((d) => [
      deck(`deck-${d}`, 9 * 60, 10 * 60, { dayKey: d }),
      deck(`email-${d}`, 11 * 60, 12 * 60, { title: 'Email', dayKey: d }),
      deck(`notes-${d}`, 13 * 60, 14 * 60, { title: 'Notes', dayKey: d }),
    ])
    await fresh(both)
    await say('push everything back an hour tomorrow')
    await settle()
    expect(chipMsgs().at(-1)!.body).toBe(
      'move 3 blocks 60 min later tomorrow? Deck 9:00→10:00 · Email 11:00→12:00 · Notes 13:00→14:00.'
    )
    await pick('do it')
    expect(lastMew()).toMatch(/^Moved 3 blocks 60 min later tomorrow — /)
    expect(at(`deck-${WED}`)).toEqual([WED, 10 * 60, 11 * 60])
    expect(at(`deck-${TODAY}`)).toEqual([TODAY, 9 * 60, 10 * 60])
    expect(at(`notes-${TODAY}`)).toEqual([TODAY, 13 * 60, 14 * 60])
  })

  it('Z1: a shift MEW cannot place exactly asks, and nothing moves', async () => {
    await fresh(afternoon())
    const before = snapshot()
    await say('push everything after lunch back 30 min')
    await settle()
    expect(snapshot()).toBe(before)
    expect(chipMsgs()).toHaveLength(0)
    expect(lastMew()).toMatch(/^I can move them together with a start time and a day/)
  })

  it('Z2: a keyed offer for title words in quotes, tapped on the keyless floor, moves the blocks it listed', async () => {
    await fresh(
      [
        deck('dw1', 9 * 60, 10 * 60, { title: 'Read "Deep Work"', tag: 'private' }),
        deck('dw2', 20 * 60, 21 * 60, { title: 'Read "Deep Work"', tag: 'private' }),
        deck('news', 12 * 60, 13 * 60, { title: 'Read the news', tag: 'private' }),
      ],
      [],
      'local'
    )
    const offer = await offerKeyed(
      { titleQuery: 'Read "Deep Work"' },
      { kind: 'moveToDay', toDayOffset: 1 }
    )
    expect(offer.choices![0].reply).toMatch(
      /^move all today's "Read Deep Work" to tomorrow — yes, all 2 · [a-z0-9]+$/
    )
    await pick('do it')
    expect(at('dw1')).toEqual([WED, 9 * 60, 10 * 60])
    expect(at('dw2')).toEqual([WED, 20 * 60, 21 * 60])
    expect(at('news')).toEqual([TODAY, 12 * 60, 13 * 60])
  })

  it('Y2: a move names its day plainly, and past this week with its date', async () => {
    await fresh([deck('d1', 9 * 60, 10 * 60), deck('d2', 11 * 60, 12 * 60, { title: 'Email' })])
    await say("move all of today's work to friday")
    await settle()
    expect(chipMsgs().at(-1)!.body).toBe(
      'move 2 blocks from today to Friday? Deck 9:00 · Email 11:00.'
    )
    await pick('do it')
    expect(lastMew()).toBe('Moved 2 blocks from today to Friday — Deck 9:00 · Email 11:00.')
    expect(at('d1')).toEqual([FRI, 9 * 60, 10 * 60])

    await fresh(
      [deck('d1', 9 * 60, 10 * 60), deck('d2', 11 * 60, 12 * 60, { title: 'Email' })],
      [],
      'local'
    )
    const offer = await offerKeyed({ tag: 'work' }, { kind: 'moveToDay', toDayOffset: 8 })
    expect(offer.body).toBe(
      'move 2 blocks from today to Wednesday, Jun 17? Deck 9:00 · Email 11:00.'
    )
  })

  it('Y4: "move all hands to friday" moves the All hands block, as before', async () => {
    await fresh([block({ id: 'ah', title: 'All hands', startMin: 8 * 60, endMin: 9 * 60 })])
    await say('move all hands to friday')
    await settle()
    expect(lastMew()).toBe('Moved — All hands now lives Friday at 8:00.')
    expect(at('ah')).toEqual([FRI, 8 * 60, 9 * 60])
  })

  it('a yes whose plan became narrow is offered again, not acted on', async () => {
    await fresh(afternoon())
    await say('push everything after 3pm back an hour')
    await settle()
    useMew.setState((st) => ({
      blocks: st.blocks.filter((b) => !['d2', 'd3', 'mtg'].includes(b.id)),
    }))
    const before = snapshot()
    await pick('do it')
    expect(snapshot()).toBe(before)
    expect(chipMsgs().at(-1)!.body).toMatch(
      /^the week changed since then — move 1 block 60 min later today\? Deck 15:00→16:00\./
    )
  })

  it('G1: the offer names the blocks a move would share time with', async () => {
    await fresh([
      deck('d1', 9 * 60, 10 * 60),
      deck('d2', 11 * 60, 12 * 60, { title: 'Email' }),
      deck('gym', 9 * 60, 10 * 60, { title: 'Gym', tag: 'health', dayKey: WED }),
    ])
    await say("move all of today's work to tomorrow")
    await settle()
    expect(chipMsgs().at(-1)!.body).toBe(
      'move 2 blocks from today to tomorrow? Deck 9:00 · Email 11:00. Deck 9:00 would share time with Gym 9:00–10:00.'
    )
  })
})

describe('#75 — the batch_blocks tool', () => {
  it('is registered for keyed models with op required, and the dispatch passes selector, op and confirmCount', async () => {
    const { MEW_TOOLS } = await import('../../adapters/model/tools')
    const tool = MEW_TOOLS.find((x) => x.name === 'batch_blocks')!
    expect((tool.parameters as { required: string[] }).required).toEqual(['op'])
    expect(tool.description).toMatch(/nothing changes until the user says yes/)
    const calls: unknown[][] = []
    const exec = {
      batch: (...args: unknown[]) => {
        calls.push(args)
        return 'ok'
      },
    } as unknown as import('../../adapters/model').ToolExecutor
    await runTool(
      'batch_blocks',
      { afterMin: 900, op: 'shift', deltaMin: 60, confirmCount: 3, confirmToken: ' k7f2 ' },
      exec
    )
    await runTool('batch_blocks', { tag: 'work', op: 'move_to_day', toDayOffset: 1 }, exec)
    expect(calls).toEqual([
      [
        {
          dayOffset: undefined,
          afterMin: 900,
          beforeMin: undefined,
          tag: undefined,
          titleQuery: undefined,
        },
        { kind: 'shift', deltaMin: 60 },
        3,
        'k7f2',
        undefined, // #75 slice 3: no scope word in this ask
      ],
      [
        {
          dayOffset: undefined,
          afterMin: undefined,
          beforeMin: undefined,
          tag: 'work',
          titleQuery: undefined,
        },
        { kind: 'moveToDay', toDayOffset: 1 },
        undefined,
        undefined,
        undefined,
      ],
    ])
    expect(await runTool('batch_blocks', { op: 'shift' }, exec)).toMatch(/^nothing to shift/)
    const { sanitizeIntent } = await import('../../adapters/model/rules')
    expect(
      sanitizeIntent({
        kind: 'batch',
        batch: { op: 'shift', deltaMin: 60, confirmCount: 3, confirmToken: 'k7f2' },
      })
    ).toMatchObject({ kind: 'batch', batch: { confirmCount: 3, confirmToken: 'k7f2' } })
  })
})
