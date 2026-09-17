/* Rolling carried work forward from the weekly review (#19, the #346 follow-up),
   through the REAL store. A roll MOVES the work: the copy lands on the same
   weekday next week and the original is marked rolled and linked to it, so the
   review never offers it again and one "undo that" takes the whole roll back.
   The probe that found the bug (and four more on the old plan-path roll) is
   pinned here: a series occurrence rides with its own series, a confirmed
   recurring rule never turns a roll into a year of blocks, a same-named block
   next week is never re-slotted, same-named picks each land, and a full day keeps
   the work carried and says so. Fakes at the storage/desktop/brain seams (the
   granular-ops harness); no jsdom, no network. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import { addDaysKey } from '../../domain/time'

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

/* a scripted local model — the undo pin needs a keyed turn that fires
   exec.undoLast() (the keyless floor has no undo route). Provider 'ollama'
   (modelLocation:'local') runs midTurn; nothing touches the network. */
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
const FRI = new Date(2026, 5, 12, 10, 0) // Friday June 12 2026, the review's day
const TODAY = '2026-06-12'
const NEXT = '2026-06-15' // next week's Monday: the roll's target week
const TUE = '2026-06-09'
const WED = '2026-06-10'
const THU = '2026-06-11'
const NEXT_TUE = '2026-06-16'
const NEXT_WED = '2026-06-17'
const NEXT_THU = '2026-06-18'
const BANNED = /\b(missed|failed|behind|overdue|streak|broke|broken)\b/i

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Roadmap draft',
    tag: 'work',
    dayKey: WED,
    startMin: 10 * 60,
    endMin: 11 * 60,
    protected: false,
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
  fakeDb.settings = { ...pristine.settings, modelLocation: location }
  vi.setSystemTime(FRI)
  useMew.setState(
    { ...pristine, lastTickDay: TODAY, nowMs: FRI.getTime(), lastActivityMs: FRI.getTime() },
    true
  )
  await useMew.getState().hydrate()
}

const chat = () => useMew.getState().chat
const blocks = () => useMew.getState().blocks
const byId = (id: string) => blocks().find((b) => b.id === id)
const lastMew = () => chat().findLast((m) => m.role === 'mew')!
const planCards = () => chat().filter((m) => m.role === 'tool' && m.tool?.name === 'plan').length
const titled = (title: string) => blocks().filter((b) => b.title === title)
const roll = (ids: string[]) => useMew.getState().rollForward(ids, NEXT)
/** the review's carried ids among `ids` (hydrate's day scaffold adds today's
    meals, which are carried too and not this suite's business) */
const carriedIds = (...ids: string[]) =>
  useMew
    .getState()
    .openWeeklyReview()
    .carried.map((b) => b.id)
    .filter((id) => ids.includes(id))
    .sort()
const say = (text: string) => useMew.getState().speak(text)

/** a confirmed learned rule (#327), as the confirm chip persists it */
const learnedRule = (rule: NonNullable<MemoryEvent['rule']>): MemoryEvent => ({
  id: `rule-${rule.match}`,
  ts: FRI.getTime() - 86_400_000,
  kind: 'learned_rule',
  dayKey: THU,
  rule,
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  scriptedModel.reset()
})

/* ── the roll moves the work ─────────────────────────────────────── */

describe('rolling forward moves the work (#19)', () => {
  it('the copy lands on the same weekday next week; the original is marked rolled and linked to it', async () => {
    const draft = block({
      id: 'rd',
      startMin: 10 * 60,
      endMin: 11 * 60 + 30,
      startedAt: FRI.getTime() - 2 * 86_400_000,
    })
    await fresh([draft])
    const cardsBefore = planCards()

    roll(['rd'])

    const original = byId('rd')!
    expect(original.status).toBe('rolled')
    const copy = byId(original.rolledToId!)!
    expect(copy).toMatchObject({
      title: 'Roadmap draft',
      tag: 'work',
      dayKey: NEXT_WED,
      status: 'open',
      protected: false,
    })
    expect(copy.endMin - copy.startMin).toBe(90) // the block as it was: same length
    expect(copy.startedAt).toBeUndefined() // a fresh session, not one already running
    expect(planCards()).toBe(cardsBefore + 1) // a tool card records the roll
    expect(lastMew().body).toBe(
      'Rolled forward — Roadmap draft now lives in next week. Nothing else moved.'
    )
  })

  it('a rolled original is never offered again: the reopened review leaves it out, and rolling it twice adds nothing', async () => {
    await fresh([
      block({ id: 'rd' }),
      block({
        id: 'gym',
        title: 'Gym',
        tag: 'health',
        dayKey: THU,
        startMin: 18 * 60,
        endMin: 19 * 60,
      }),
    ])
    expect(carriedIds('gym', 'rd')).toEqual(['gym', 'rd'])

    roll(['rd'])
    expect(carriedIds('gym', 'rd')).toEqual(['gym']) // the reopened review: no longer carried
    expect(useMew.getState().openWeeklyReview().byTag.work).toBeUndefined() // …nor in the carry tally

    const week = JSON.stringify(blocks())
    const said = chat().length
    roll(['rd']) // a stale pick of the same id
    expect(JSON.stringify(blocks())).toBe(week) // no second copy, nothing re-marked
    expect(chat()).toHaveLength(said)
    expect(titled('Roadmap draft')).toHaveLength(2) // the original + its one copy
  })

  it('one "undo that" takes the whole roll back: the copies go and the originals are open again', async () => {
    await fresh(
      [
        block({ id: 'rd' }),
        block({
          id: 'spec',
          title: 'Spec review',
          dayKey: THU,
          startMin: 14 * 60,
          endMin: 15 * 60,
        }),
      ],
      [],
      'local'
    )
    roll(['rd', 'spec'])
    expect(byId('rd')!.status).toBe('rolled')
    expect(byId('spec')!.status).toBe('rolled')
    expect(blocks().filter((b) => b.dayKey >= NEXT)).toHaveLength(2)

    /* the roll landed outside any turn — its snapshot must survive the next
       turn's fresh-exchange reset (#293), so a keyed "undo that" reaches it */
    scriptedModel.chunks = ['on it — ', 'putting that back.']
    scriptedModel.midTurn = (exec) => void exec.undoLast()
    await say('undo that')

    expect(byId('rd')).toMatchObject({ status: 'open', dayKey: WED })
    expect(byId('rd')!.rolledToId).toBeUndefined()
    expect(byId('spec')).toMatchObject({ status: 'open', dayKey: THU })
    expect(blocks().filter((b) => b.dayKey >= NEXT)).toHaveLength(0) // both copies gone
    expect(carriedIds('rd', 'spec')).toEqual(['rd', 'spec']) // offered again, as before the roll
  })

  it('nothing else moves: every block the owner did not pick is untouched', async () => {
    const others = [
      block({
        id: 'lunch',
        title: 'Lunch',
        tag: 'private',
        dayKey: NEXT_WED,
        startMin: 12 * 60,
        endMin: 12 * 60 + 45,
      }),
      block({
        id: 'focus',
        title: 'Deep focus',
        dayKey: NEXT_WED,
        startMin: 9 * 60,
        endMin: 11 * 60,
      }),
      block({
        id: 'sync',
        title: 'Product sync',
        dayKey: NEXT_WED,
        startMin: 11 * 60,
        endMin: 12 * 60,
        external: { calId: 'c', eventId: 'e1' },
        protected: true,
      }),
      block({
        id: 'stay',
        title: 'Stretch',
        tag: 'health',
        dayKey: THU,
        startMin: 7 * 60,
        endMin: 7 * 60 + 20,
      }),
    ]
    await fresh([block({ id: 'rd' }), ...others])
    const before = new Map(blocks().map((b) => [b.id, JSON.stringify(b)]))

    roll(['rd'])

    for (const id of before.keys()) {
      if (id === 'rd') continue
      expect(JSON.stringify(byId(id)), id).toBe(before.get(id))
    }
    /* and the copy is conflict-free on its day */
    const copy = byId(byId('rd')!.rolledToId!)!
    const clash = blocks().filter(
      (b) =>
        b.id !== copy.id &&
        b.dayKey === copy.dayKey &&
        b.status === 'open' &&
        b.startMin < copy.endMin &&
        copy.startMin < b.endMin
    )
    expect(clash).toEqual([])
  })
})

/* ── the old plan-path roll's traps, pinned ─────────────────────────── */

describe('rolling forward never re-plans around the owner (#19)', () => {
  it('a series occurrence rides with its own series: linked to next week’s occurrence, which stays exactly where it was', async () => {
    const rrule = { freq: 'WEEKLY' as const, interval: 1 }
    const next = block({
      id: 'gym-17',
      title: 'Gym',
      tag: 'health',
      dayKey: NEXT_WED,
      startMin: 7 * 60,
      endMin: 8 * 60,
      recurringBlockId: 'gym-s',
      rrule,
    })
    await fresh([
      block({
        id: 'gym-10',
        title: 'Gym',
        tag: 'health',
        dayKey: WED,
        startMin: 7 * 60,
        endMin: 8 * 60,
        recurringBlockId: 'gym-s',
        rrule,
      }),
      next,
    ])
    const nextBefore = JSON.stringify(byId('gym-17'))
    const cardsBefore = planCards()

    roll(['gym-10'])

    expect(byId('gym-10')).toMatchObject({ status: 'rolled', rolledToId: 'gym-17' })
    expect(JSON.stringify(byId('gym-17'))).toBe(nextBefore) // never re-slotted
    expect(titled('Gym')).toHaveLength(2) // no twin beside it
    expect(planCards()).toBe(cardsBefore) // nothing was placed
    expect(lastMew().body).toBe(
      'Rolled forward — Gym already comes back with its series. Nothing else moved.'
    )
  })

  it('a series with nothing next week lands one plain copy — not a second member of the series', async () => {
    const rrule = { freq: 'WEEKLY' as const, interval: 1, until: TODAY }
    await fresh([
      block({
        id: 'gym-10',
        title: 'Gym',
        tag: 'health',
        dayKey: WED,
        startMin: 7 * 60,
        endMin: 8 * 60,
        recurringBlockId: 'gym-s',
        rrule,
      }),
    ])

    roll(['gym-10'])

    const copy = byId(byId('gym-10')!.rolledToId!)!
    expect(copy).toMatchObject({ title: 'Gym', dayKey: NEXT_WED, status: 'open' })
    expect(copy.recurringBlockId).toBeUndefined()
    expect(copy.rrule).toBeUndefined()
    expect(blocks().filter((b) => b.recurringBlockId === 'gym-s')).toHaveLength(1) // the series is as it was
  })

  it('a confirmed recurring rule never turns a roll into a series: exactly one copy lands', async () => {
    await fresh(
      [
        block({
          id: 'gym-tue',
          title: 'Gym',
          tag: 'health',
          dayKey: TUE,
          startMin: 18 * 60,
          endMin: 19 * 60,
        }),
      ],
      [learnedRule({ match: 'gym', rrule: { freq: 'WEEKLY', interval: 1, byday: ['TU'] } })]
    )

    roll(['gym-tue'])

    expect(titled('Gym')).toHaveLength(2) // the plan path made 54
    const copy = byId(byId('gym-tue')!.rolledToId!)!
    expect(copy).toMatchObject({ dayKey: NEXT_TUE, status: 'open' })
    expect(copy.recurringBlockId).toBeUndefined()
  })

  it('a same-named block already next week stays where it was, and the roll lands its own copy beside it', async () => {
    await fresh([
      block({ id: 'wr-10', title: 'Write report', dayKey: WED, startMin: 9 * 60, endMin: 10 * 60 }),
      block({
        id: 'wr-17',
        title: 'Write report',
        dayKey: NEXT_WED,
        startMin: 15 * 60,
        endMin: 16 * 60,
      }),
    ])
    const planned = JSON.stringify(byId('wr-17'))

    roll(['wr-10'])

    expect(JSON.stringify(byId('wr-17'))).toBe(planned) // never re-slotted (the plan path moved it to 8:00)
    const copy = byId(byId('wr-10')!.rolledToId!)!
    expect(copy.id).not.toBe('wr-17')
    expect(copy).toMatchObject({ dayKey: NEXT_WED, status: 'open' })
    expect(copy.startMin >= 16 * 60 || copy.endMin <= 15 * 60).toBe(true) // beside it, not on it
  })

  it('two same-named picks each land their own copy', async () => {
    await fresh([
      block({ id: 'fb-a', title: 'Focus block', dayKey: WED, startMin: 9 * 60, endMin: 10 * 60 }),
      block({ id: 'fb-b', title: 'Focus block', dayKey: WED, startMin: 14 * 60, endMin: 15 * 60 }),
    ])

    roll(['fb-a', 'fb-b'])

    const a = byId('fb-a')!
    const b = byId('fb-b')!
    expect([a.status, b.status]).toEqual(['rolled', 'rolled'])
    expect(a.rolledToId).not.toBe(b.rolledToId)
    const copies = [byId(a.rolledToId!)!, byId(b.rolledToId!)!]
    expect(copies.map((c) => c.dayKey)).toEqual([NEXT_WED, NEXT_WED])
    expect(copies[0].startMin >= copies[1].endMin || copies[1].startMin >= copies[0].endMin).toBe(
      true
    )
  })

  it('a day with no room next week keeps that work carried, and the reply says so kindly', async () => {
    await fresh([
      block({ id: 'spec', title: 'Spec review', dayKey: WED }),
      block({ id: 'deck', title: 'Deck', dayKey: THU, startMin: 14 * 60, endMin: 15 * 60 }),
      block({
        id: 'wall',
        title: 'Offsite interview day',
        dayKey: NEXT_WED,
        startMin: 0,
        endMin: 24 * 60 - 1,
        protected: true,
      }),
    ])

    roll(['spec', 'deck'])

    expect(byId('spec')).toMatchObject({ status: 'open', dayKey: WED })
    expect(byId('spec')!.rolledToId).toBeUndefined()
    expect(byId('deck')!.status).toBe('rolled')
    expect(byId(byId('deck')!.rolledToId!)!.dayKey).toBe(NEXT_THU)
    const reply = lastMew().body
    expect(reply).toBe(
      'Rolled forward — Deck now lives in next week. Nothing else moved. Wednesday next week is full, so Spec review stays carried for now.'
    )
    expect(reply).not.toMatch(BANNED)
    expect(carriedIds('spec', 'deck')).toEqual(['spec']) // still offered, exactly as it was
  })

  it('when nothing fits, nothing changes and nothing is claimed', async () => {
    await fresh([
      block({ id: 'spec', title: 'Spec review', dayKey: WED }),
      block({
        id: 'wall',
        title: 'Offsite interview day',
        dayKey: NEXT_WED,
        startMin: 0,
        endMin: 24 * 60 - 1,
        protected: true,
      }),
    ])
    const week = JSON.stringify(blocks())
    const cardsBefore = planCards()

    roll(['spec'])

    expect(JSON.stringify(blocks())).toBe(week)
    expect(planCards()).toBe(cardsBefore)
    expect(lastMew().body).toBe(
      'Wednesday next week is full, so Spec review stays carried for now.'
    )
  })
})

/* ── the owner's rules still steer where a roll lands ─────────────────── */

describe('rolling forward keeps to the owner’s rules (#19)', () => {
  it('a confirmed rule’s window still steers the copy', async () => {
    // work leans to the morning by default; the owner's confirmed rule says afternoons
    await fresh(
      [block({ id: 'deck', title: 'Deck', dayKey: WED, startMin: 9 * 60, endMin: 10 * 60 })],
      [learnedRule({ match: 'deck', window: 'afternoon' })]
    )

    roll(['deck'])

    const copy = byId(byId('deck')!.rolledToId!)!
    expect(copy.dayKey).toBe(NEXT_WED)
    expect(copy.startMin).toBeGreaterThanOrEqual(12 * 60)
  })

  it('a block with a due time still ends by it, even against a preferred window', async () => {
    await fresh(
      [
        block({
          id: 'inv',
          title: 'Invoice run',
          tag: 'private',
          dayKey: WED,
          startMin: 9 * 60,
          endMin: 10 * 60,
          due: 12 * 60,
        }),
      ],
      [learnedRule({ match: 'invoice run', window: 'afternoon' })]
    )

    roll(['inv'])

    const copy = byId(byId('inv')!.rolledToId!)!
    expect(copy).toMatchObject({ dayKey: NEXT_WED, due: 12 * 60 })
    expect(copy.endMin).toBeLessThanOrEqual(12 * 60)
  })

  it('a weekend pick more than a week ahead still lands on its day', async () => {
    // Sunday June 14 → Sunday June 21: nine days out from Friday, past a 7-day search
    await fresh([block({ id: 'hike', title: 'Hike', tag: 'health', dayKey: '2026-06-14' })])

    roll(['hike'])

    expect(byId('hike')!.status).toBe('rolled')
    expect(byId(byId('hike')!.rolledToId!)!.dayKey).toBe('2026-06-21')
    expect(lastMew().body).toBe('Rolled forward — Hike now lives in next week. Nothing else moved.')
  })

  it('a background hold keeps its time of day', async () => {
    await fresh([
      block({
        id: 'restore',
        title: 'Phone restore',
        tag: 'private',
        dayKey: WED,
        startMin: 14 * 60,
        endMin: 17 * 60,
        attention: 'background',
      }),
    ])

    roll(['restore'])

    const copy = byId(byId('restore')!.rolledToId!)!
    expect(copy).toMatchObject({
      dayKey: NEXT_WED,
      startMin: 14 * 60,
      endMin: 17 * 60,
      attention: 'background',
    })
  })

  it('the day-load meter still speaks when a roll fills a day past your usual (#301)', async () => {
    /* 15 lived days of 300 completed work minutes → the line sits at 345 */
    const lived: MemoryEvent[] = []
    for (let i = 1; i <= 15; i++) {
      const k = addDaysKey(TODAY, -i)
      const ts = new Date(k + 'T17:00:00').getTime()
      lived.push(
        {
          id: `c${i}a`,
          ts,
          kind: 'completed',
          dayKey: k,
          tag: 'work',
          plannedMin: 240,
          deep: true,
        },
        { id: `c${i}b`, ts: ts + 1, kind: 'completed', dayKey: k, tag: 'work', plannedMin: 60 }
      )
    }
    await fresh(
      [
        block({
          id: 'q3',
          title: 'Q3 deck — deep work',
          dayKey: WED,
          startMin: 8 * 60,
          endMin: 12 * 60,
        }),
        block({
          id: 'sp',
          title: 'Spec — deep work',
          dayKey: WED,
          startMin: 13 * 60,
          endMin: 17 * 60,
        }),
      ],
      lived
    )
    const meter = () => chat().filter((m) => /against your usual/.test(m.body))
    expect(meter()).toHaveLength(0)

    roll(['q3', 'sp'])
    await Promise.resolve()
    await Promise.resolve()

    expect(byId('q3')!.status).toBe('rolled')
    expect(byId('sp')!.status).toBe('rolled')
    expect(meter()).toHaveLength(1)
  })
})
