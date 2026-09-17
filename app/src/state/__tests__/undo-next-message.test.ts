/* #120 + #118: "undo that" reaches MEW's last change in the owner's very next
   message, whatever made it: a typed or keyed change, a picked chip, or a tap
   (#293). The keyless floor has the same undo, never a capture. One message
   only, and an undo always takes back the newest change. Through the REAL
   store (a scripted local model for the keyed steps); no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import { parseCommand } from '../../domain/parse'

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
const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body
const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)
const pick = async (label: string, msg = chipMsgs().at(-1)!) => {
  await useMew.getState().pickChoice(msg.id, msg.choices!.find((c) => c.label === label)!.id)
  await settle()
}
/** the week as sorted [title, day, start, end] rows */
const week = () =>
  blocks()
    .map((b) => [b.title, b.dayKey, b.startMin, b.endMin])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
/** a keyed "undo that": the scripted model calls the undo tool and returns its result */
async function keyedUndo(): Promise<string> {
  await useMew.getState().updateSettings({ modelLocation: 'local' })
  let out = ''
  scriptedModel.midTurn = (exec) => {
    out = exec.undoLast()
  }
  await say('undo that')
  await settle()
  return out
}
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

describe('#118 — keyless "undo" words are an undo, never a thought', () => {
  it('reads the whole-message undo phrases, and nothing that only starts like one', () => {
    const now = TUE(9)
    for (const t of [
      'undo',
      'undo that',
      'Undo it.',
      'undo the last change',
      'no, put it back',
      'oops put that back please',
      'take that back',
      'revert it!',
    ])
      expect(parseCommand(t, now), t).toEqual({ kind: 'undo' })
    for (const t of [
      'put it back at 3pm',
      'undo the laundry',
      'take it back to the store',
      'revert the deck to 9',
    ])
      expect(parseCommand(t, now).kind, t).not.toBe('undo')
  })
})

describe('#120 — the very next message reaches the last change', () => {
  it('a keyed typed move, undone the message after', async () => {
    await fresh([block({ id: 'deck', title: 'Deck' })], { location: 'local' })
    scriptedModel.midTurn = (exec) => {
      exec.move('deck', 1)
    }
    await say('move the deck to tomorrow')
    await settle()
    expect(week()).toEqual([['Deck', WED, 480, 540]]) // tomorrow's first open slot

    expect(await keyedUndo()).toBe('Undone — put Deck back where it was.')
    expect(week()).toEqual([['Deck', TODAY, 540, 600]])
  })

  it('a split picked from a rescue chip, undone the message after', async () => {
    await fresh([block({ id: 'deck', title: 'Deck polish', startMin: 540, endMin: 660 })], {
      at: TUE(8, 0),
    })
    useMew
      .getState()
      .simulatePull([{ eventId: 'sync', title: 'Design sync', startMin: 570, endMin: 615 }])
    await settle()
    const before = week()
    await pick('split around it')
    expect(week()).not.toEqual(before)

    expect(await keyedUndo()).toBe(
      "Undone — took back the two blocks I'd just placed, put Deck polish back where it was."
    )
    expect(week()).toEqual(before)
  })

  it('a removal picked from a day chip, undone keyless the message after — nothing captured', async () => {
    await fresh([lunch('l-tue', TODAY), lunch('l-wed', WED)])
    await say('remove the lunch at 12:00')
    await settle()
    await pick('tomorrow 12:00')
    expect(week()).toEqual([['Lunch', TODAY, 720, 765]])

    await say('undo that')
    await settle()
    expect(lastMew()).toBe('Undone — brought back Lunch.')
    expect(week()).toEqual([
      ['Lunch', TODAY, 720, 765],
      ['Lunch', WED, 720, 765],
    ])
    expect(useMew.getState().captures).toEqual([])
  })

  it('a keyless split, undone keyless; a second undo finds nothing', async () => {
    await fresh([block({ id: 'deck', title: 'Deck polish', startMin: 540, endMin: 660 })], {
      at: TUE(8, 0),
    })
    await say('split the deck polish around 9:30-10:15')
    await settle()
    await say('undo that')
    await settle()
    expect(lastMew()).toBe(
      "Undone — took back the Deck polish (part 2) block I'd just placed, put Deck polish back where it was."
    )
    expect(week()).toEqual([['Deck polish', TODAY, 540, 660]])

    await say('undo that')
    await settle()
    expect(lastMew()).toBe(
      'nothing to undo right now — I can take back my last change in your very next message.'
    )
    expect(useMew.getState().captures).toEqual([])
  })
})

describe('#120 — one message, and always the newest change', () => {
  it('a change in between: "undo that" takes back that newer change only', async () => {
    await fresh(
      [
        block({ id: 'deck', title: 'Deck' }),
        block({
          id: 'gym',
          title: 'Gym',
          tag: 'health',
          startMin: 1080,
          endMin: 1140,
          protected: false,
        }),
      ],
      { location: 'local' }
    )
    scriptedModel.midTurn = (exec) => {
      exec.move('deck', 1)
    }
    await say('move the deck to tomorrow')
    await settle()
    scriptedModel.midTurn = (exec) => {
      exec.move('gym', 0, 19 * 60)
    }
    await say('and the gym to 7pm')
    await settle()

    expect(await keyedUndo()).toBe('Undone — put Gym back where it was.')
    expect(week()).toEqual([
      ['Deck', WED, 480, 540],
      ['Gym', TODAY, 1080, 1140],
    ])
  })

  it('a message in between that changes nothing: the change is no longer undone', async () => {
    await fresh([block({ id: 'deck', title: 'Deck polish', startMin: 540, endMin: 660 })], {
      at: TUE(8, 0),
    })
    await say('split the deck polish around 9:30-10:15')
    await settle()
    const split = week()
    await say("what's on today")
    await settle()

    await say('undo that')
    await settle()
    expect(lastMew()).toBe(
      'nothing to undo right now — I can take back my last change in your very next message.'
    )
    expect(week()).toEqual(split)
  })
})

describe('#130 — a held undo acts only while the week is what the change left', () => {
  const standup = () =>
    block({ id: 'anchor', title: 'Standup', dayKey: WED, startMin: 540, endMin: 555 })
  const stored = () => [...fakeDb.blocks.values()].map((b) => (b as { title: string }).title).sort()

  it('a calendar sync in between: the meeting stays, nothing is undone, and MEW says why', async () => {
    await fresh([standup()])
    await say('block 1h for deck at 15:00')
    await settle()
    useMew
      .getState()
      .simulatePull([{ eventId: 'e1', title: 'Board call', startMin: 17 * 60, endMin: 18 * 60 }])
    await settle()
    const before = week()

    await say('undo that')
    await settle()
    expect(lastMew()).toBe(
      "something else changed since, so I can't take that back cleanly: Board call came in from your calendar."
    )
    expect(week()).toEqual(before)
    expect(stored()).toEqual(['Board call', 'Standup', 'deck'])
  })

  it('a checkbox in between: the block stays done and its mew stays', async () => {
    await fresh([block({ id: 'email', title: 'Email', startMin: 510, endMin: 540 })])
    await say('block 1h for deck at 15:00')
    await settle()
    useMew.getState().toggleComplete('email')
    await settle()
    const mews = () => useMew.getState().memory.filter((e) => e.kind === 'completed').length
    expect(mews()).toBe(1)

    await say('undo that')
    await settle()
    expect(lastMew()).toBe(
      "something else changed since, so I can't take that back cleanly: Email was checked off."
    )
    expect(blocks().find((b) => b.id === 'email')!.status).toBe('done')
    expect(mews()).toBe(1)
    expect(blocks().map((b) => b.title)).toContain('deck')
  })

  it('a capture in between: the inbox keeps it', async () => {
    await fresh([standup()])
    await say('block 1h for deck at 15:00')
    await settle()
    useMew.getState().capture('call the bank')
    await settle()

    await say('undo that')
    await settle()
    expect(lastMew()).toBe(
      'something else changed since, so I can\'t take that back cleanly: "call the bank" went into your inbox.'
    )
    expect(useMew.getState().captures.map((c) => [c.title, c.status])).toEqual([
      ['call the bank', 'open'],
    ])
  })

  it('a tap holds its undo the same way: a drag, then a checkbox, then "undo that" declines', async () => {
    await fresh([
      block({ id: 'deck', title: 'Deck', startMin: 600, endMin: 660, protected: false }),
      block({ id: 'email', title: 'Email', startMin: 510, endMin: 540 }),
    ])
    expect(useMew.getState().dragMove('deck', TODAY, 14 * 60, 60)).toBe('moved')
    useMew.getState().toggleComplete('email')
    await settle()

    await say('undo that')
    await settle()
    expect(lastMew()).toBe(
      "something else changed since, so I can't take that back cleanly: Email was checked off."
    )
    expect(blocks().find((b) => b.id === 'deck')!.startMin).toBe(14 * 60)
    expect(blocks().find((b) => b.id === 'email')!.status).toBe('done')
  })

  it('only a tick in between: the undo still takes the change back', async () => {
    await fresh([standup()])
    await say('block 1h for deck at 15:00')
    await settle()
    vi.setSystemTime(TUE(8, 35))
    useMew.getState().tick()
    await settle()

    await say('undo that')
    await settle()
    expect(lastMew()).toBe("Undone — took back the deck block I'd just placed.")
    expect(week()).toEqual([['Standup', WED, 540, 555]])
  })

  it('an undo in the same turn as its change is unchanged', async () => {
    await fresh([standup()], { location: 'local' })
    let undone = ''
    scriptedModel.midTurn = (exec) => {
      exec.plan(
        [{ title: 'deck', tag: 'work', dayOffset: 0, startMin: 15 * 60, durationMin: 60 }],
        []
      )
      undone = exec.undoLast()
    }
    await say('block an hour for the deck at 3 — no, put it back')
    await settle()
    expect(undone).toBe("Undone — took back the deck block I'd just placed.")
    expect(week()).toEqual([['Standup', WED, 540, 555]])
  })
})
