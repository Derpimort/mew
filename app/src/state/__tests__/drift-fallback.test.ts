/* #12, the no-clean-drift fallback, through the REAL store. When new explicit
   work lands on the owner's own flexible block and that block has nowhere clean
   to drift, MEW offers a real choice instead of prose: ONE chips message (shift
   the work · drop the flexible block · keep both), posted after the reply.
   Pinned here: the chips appear with exact, keyless-parseable replies; nothing
   changes until a pick; each chip does exactly its action through the executor;
   no model-facing instruction text ever reaches the user; a chip whose reply
   could touch another block is never offered; and a keyed turn gets the very
   same chips. Adapters faked at their seams (the granular-ops harness). No jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import { choicesActive } from '../../domain/choices'
import type { ToolExecutor } from '../../adapters/model/types'

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

/* a scripted local model: hands the turn the real executor (the keyed path) */
const scriptedModel = {
  midTurn: null as null | ((exec: ToolExecutor) => void),
  reset() {
    this.midTurn = null
  },
}
vi.mock('../../adapters/model/aiAdapter', () => ({
  createAiAdapter: (spec: { provider: string }) => ({
    id: spec.provider,
    async *converse(_thread: unknown, _ctx: unknown, exec: ToolExecutor) {
      if (spec.provider !== 'ollama') throw Object.assign(new Error('offline'), { statusCode: 503 })
      yield 'on it.'
      scriptedModel.midTurn?.(exec)
    },
  }),
}))

import { useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m) // Tuesday, June 9
const TODAY = '2026-06-09'
const WED = '2026-06-10'
const THU = '2026-06-11'

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Offsite',
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

/** Groceries (90 min, flexible) at 14:00 today. Today is walled from 15:30 to the
    plannable end, and tomorrow leaves exactly one free hour, at 9:00. So a 60-min
    work block landing on 14:00 can shift to tomorrow 9:00, while Groceries (90)
    has nowhere clean to go. */
const week0 = (): Block[] => [
  block({
    id: 'groceries',
    title: 'Groceries',
    tag: 'private',
    startMin: 14 * 60,
    endMin: 15.5 * 60,
    protected: false,
  }),
  block({ id: 'wall-am', title: 'Offsite', startMin: 8 * 60, endMin: 14 * 60 }),
  block({ id: 'wall-pm', title: 'Offsite', startMin: 15.5 * 60, endMin: 22.5 * 60 }),
  block({ id: 'wed-wall', title: 'Workshop', dayKey: WED, startMin: 10 * 60, endMin: 22.5 * 60 }),
]

async function fresh(blocks: Block[], location: 'remote' | 'local' = 'remote') {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  fakeDb.settings = { ...pristine.settings, modelLocation: location, sustenance: 'off' }
  vi.setSystemTime(TUE(9, 0))
  useMew.setState(
    {
      ...pristine,
      lastTickDay: TODAY,
      nowMs: TUE(9, 0).getTime(),
      lastActivityMs: TUE(9, 0).getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

const chat = () => useMew.getState().chat
const blocks = () => useMew.getState().blocks
const byId = (id: string) => blocks().find((b) => b.id === id)
const byTitle = (t: string) => blocks().filter((b) => b.title === t)
const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)
const say = (text: string) => useMew.getState().speak(text)
const settle = async () => {
  await Promise.resolve()
  vi.advanceTimersByTime(1)
  await Promise.resolve()
}
/** everything the owner can read: every message body and every chip label */
const visibleText = () =>
  chat()
    .flatMap((m: ChatMessage) => [m.body, ...(m.choices ?? []).map((c) => c.label)])
    .join('\n')
const snapshot = () =>
  JSON.stringify(
    [...blocks()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((b) => [b.id, b.title, b.dayKey, b.startMin, b.endMin, b.status])
  )

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  scriptedModel.reset()
})

const PLACE = 'block 1h for the release review today at 14'

/* ── the offer ────────────────────────────────────────────────────── */

describe('#12 — no clean drift: a real choice, not prose', () => {
  it('a no-clean-drift collision shows the three chips, after the reply', async () => {
    await fresh(week0())
    await say(PLACE)
    await settle()

    const offers = chipMsgs()
    expect(offers).toHaveLength(1)
    const offer = offers[0]
    expect(offer.body).toBe(
      'Groceries and release review share 14:00–15:00, with no clean slot to drift to. How should it go?'
    )
    expect(offer.choices!.map((c) => ({ id: c.id, label: c.label, reply: c.reply }))).toEqual([
      {
        id: 'shift',
        label: 'move release review to tomorrow 9:00',
        reply: 'move the release review at 14:00 to tomorrow at 9:00',
      },
      {
        id: 'drop-groceries',
        label: 'drop Groceries',
        reply: 'remove the Groceries today at 14:00', // names its day (#62's pin)
      },
      { id: 'keep', label: 'keep both', reply: 'ok, keep both as they are' },
    ])

    /* the reply states the fact and says the options are on screen */
    const bodies = chat().map((m) => m.body)
    const replyIdx = bodies.findIndex((b) => /is held for release review/.test(b))
    expect(replyIdx).toBeGreaterThanOrEqual(0)
    expect(bodies[replyIdx]).toContain('Groceries still shares that time')
    expect(bodies[replyIdx]).toContain('The options for that overlap are on screen.')
    expect(chat().indexOf(offer)).toBeGreaterThan(replyIdx) // the ask follows the reply
  })

  it('nothing changes before a pick: the overlap waits on the owner', async () => {
    await fresh(week0())
    await say(PLACE)
    await settle()
    const placed = byTitle('release review')[0]
    expect(placed).toMatchObject({ dayKey: TODAY, startMin: 14 * 60, endMin: 15 * 60 })
    expect(byId('groceries')).toMatchObject({ dayKey: TODAY, startMin: 14 * 60, endMin: 15.5 * 60 })
    const before = snapshot()
    vi.advanceTimersByTime(10 * 60 * 1000)
    await settle()
    expect(snapshot()).toBe(before)
  })

  it('no model-facing instruction text ever reaches the owner', async () => {
    await fresh(week0())
    await say(PLACE)
    await settle()
    const text = visibleText()
    expect(text).not.toMatch(
      /offer to|don't leave it unasked|note:|END your turn|say nothing more/i
    )
  })
})

/* ── each chip does exactly its action ────────────────────────────── */

describe('#12 — each chip does exactly what it says, through the executor', () => {
  it('shift: the work moves to its clean slot; Groceries and the walls stay put', async () => {
    await fresh(week0())
    await say(PLACE)
    await settle()
    const before = JSON.parse(snapshot()) as unknown[][]
    const placedId = byTitle('release review')[0].id

    await useMew.getState().pickChoice(chipMsgs()[0].id, 'shift')
    await settle()

    expect(byId(placedId)).toMatchObject({ dayKey: WED, startMin: 9 * 60, endMin: 10 * 60 })
    const after = JSON.parse(snapshot()) as unknown[][]
    expect(after.filter((r) => r[0] !== placedId)).toEqual(before.filter((r) => r[0] !== placedId))
    expect(after).toHaveLength(before.length)
  })

  it('drop: Groceries is removed; the work and everything else stay put', async () => {
    await fresh(week0())
    await say(PLACE)
    await settle()
    const before = JSON.parse(snapshot()) as unknown[][]

    await useMew.getState().pickChoice(chipMsgs()[0].id, 'drop-groceries')
    await settle()

    expect(byId('groceries')).toBeUndefined()
    const after = JSON.parse(snapshot()) as unknown[][]
    expect(after).toEqual(before.filter((r) => r[0] !== 'groceries'))
  })

  it('keep: nothing changes at all', async () => {
    await fresh(week0())
    await say(PLACE)
    await settle()
    const before = snapshot()

    await useMew.getState().pickChoice(chipMsgs()[0].id, 'keep')
    await settle()

    expect(snapshot()).toBe(before)
    expect(chat()[chat().length - 1].body).toBe('Good. Mewing away.')
  })
})

/* ── exactness + the other paths ──────────────────────────────────── */

describe('#12 — never a chip that could touch a block it did not name', () => {
  /* #12 follow-up: the drop reply names its day ("today"), so #62's day pin
     singles out exactly this Groceries. A same-titled one at the same time on
     another day used to hide the chip; now it shows, and still touches only
     the block it names. */
  it('a same-titled Groceries at 14:00 later in the week no longer hides the drop chip — it names its day and removes only that one', async () => {
    await fresh([
      ...week0(),
      block({
        id: 'groceries-thu',
        title: 'Groceries',
        tag: 'private',
        dayKey: THU,
        startMin: 14 * 60,
        endMin: 15.5 * 60,
        protected: false,
      }),
    ])
    await say(PLACE)
    await settle()
    const offer = chipMsgs()[0]
    expect(offer.choices!.map((c) => c.id)).toEqual(['shift', 'drop-groceries', 'keep'])
    expect(offer.choices!.find((c) => c.id === 'drop-groceries')!.reply).toBe(
      'remove the Groceries today at 14:00'
    )
    const before = JSON.parse(snapshot()) as unknown[][]

    await useMew.getState().pickChoice(offer.id, 'drop-groceries')
    await settle()

    expect(byId('groceries')).toBeUndefined() // today's went
    expect(byId('groceries-thu')).toBeDefined() // Thursday's never did
    const after = JSON.parse(snapshot()) as unknown[][]
    expect(after).toEqual(before.filter((r) => r[0] !== 'groceries'))
  })

  it('keyed: the same day-named drop chip, even with the same-titled block later in the week', async () => {
    await fresh(
      [
        ...week0(),
        block({
          id: 'groceries-thu',
          title: 'Groceries',
          tag: 'private',
          dayKey: THU,
          startMin: 14 * 60,
          endMin: 15.5 * 60,
          protected: false,
        }),
      ],
      'local'
    )
    scriptedModel.midTurn = (exec) => {
      exec.plan(
        [
          {
            title: 'release review',
            tag: 'work',
            dayOffset: 0,
            startMin: 14 * 60,
            durationMin: 60,
          },
        ],
        []
      )
    }
    await say('put the release review at 2pm today')
    await settle()
    const drop = chipMsgs()[0].choices!.find((c) => c.id === 'drop-groceries')
    expect(drop?.reply).toBe('remove the Groceries today at 14:00')
  })

  /* peer review of #63 (coderpa): the shift chip's exactness guard, pinned. A
     same-titled block at the same minute on an EARLIER day means the shift
     reply ("move the release review at 14:00 to …") resolves to THAT block —
     picking it would move today's review and leave the new one on Groceries. */
  it('a same-titled block at the same minute earlier in the week keeps the shift chip off (its reply would move that one)', async () => {
    const wall = (id: string, dayKey: string, startMin: number, endMin: number) =>
      block({ id, title: 'Offsite', dayKey, startMin, endMin })
    await fresh([
      block({ id: 'rr-today', title: 'release review', startMin: 14 * 60, endMin: 15 * 60 }),
      wall('tue-am', TODAY, 8 * 60, 14 * 60),
      wall('tue-pm', TODAY, 15 * 60, 22.5 * 60),
      block({
        id: 'groceries-wed',
        title: 'Groceries',
        tag: 'private',
        dayKey: WED,
        startMin: 14 * 60,
        endMin: 15.5 * 60,
        protected: false,
      }),
      wall('wed-am', WED, 8 * 60, 14 * 60),
      wall('wed-pm', WED, 15.5 * 60, 22.5 * 60),
      wall('thu-wall', THU, 10 * 60, 22.5 * 60), // Thursday keeps one free hour, at 9:00
    ])
    await say('block 1h for the release review tomorrow at 14')
    await settle()
    const offer = chipMsgs()[0]
    expect(offer.choices!.map((c) => c.id)).toEqual(['drop-groceries-wed', 'keep'])
    expect(visibleText()).not.toMatch(/move release review/)
    expect(byId('rr-today')).toMatchObject({ dayKey: TODAY, startMin: 14 * 60 }) // never a candidate
  })

  it('several stuck blocks are named as a list: "a, b and c share …"', async () => {
    /* two 90-min flexible blocks around 14:00, today walled either side; tomorrow's
       one free hour fits neither, so both are stuck */
    const flexible = (id: string, title: string, startMin: number) =>
      block({ id, title, tag: 'private', startMin, endMin: startMin + 90, protected: false })
    await fresh([
      block({ id: 'wall-am', title: 'Offsite', startMin: 8 * 60, endMin: 13 * 60 }),
      flexible('laundry', 'Laundry', 13 * 60),
      flexible('groceries', 'Groceries', 14.5 * 60),
      block({ id: 'wall-pm', title: 'Offsite', startMin: 16 * 60, endMin: 22.5 * 60 }),
      ...week0().filter((b) => b.id === 'wed-wall'),
    ])
    await say(PLACE)
    await settle()
    const offer = chipMsgs()[0]
    expect(offer.body).toMatch(/^Laundry, Groceries and release review share 14:00–15:00/)
  })

  it('with neither an exact shift nor an exact drop, no chips: the plain fact stands', async () => {
    /* Wednesday is full (no shift), and Groceries is one occurrence of a series,
       which never gets a drop chip (a series asks this / following / series first) */
    await fresh([
      ...week0()
        .filter((b) => b.id !== 'wed-wall')
        .map((b) => (b.id === 'groceries' ? { ...b, recurringBlockId: 'groceries-weekly' } : b)),
      block({
        id: 'wed-full',
        title: 'Workshop',
        dayKey: WED,
        startMin: 8 * 60,
        endMin: 22.5 * 60,
      }),
    ])
    await say(PLACE)
    await settle()
    expect(chipMsgs()).toHaveLength(0)
    const reply = chat().find((m) => /is held for release review/.test(m.body))!
    expect(reply.body).toContain('Groceries still shares that time')
    expect(reply.body).not.toContain('on screen')
  })

  it('a move that lands work on Groceries offers the same choice', async () => {
    await fresh([
      ...week0(),
      block({
        id: 'review',
        title: 'release review',
        dayKey: THU,
        startMin: 9 * 60,
        endMin: 10 * 60,
      }),
    ])
    await say('move the release review to today at 14')
    await settle()
    expect(byId('review')).toMatchObject({ dayKey: TODAY, startMin: 14 * 60 })
    const offer = chipMsgs()[0]
    expect(offer.choices!.map((c) => c.id)).toEqual(['shift', 'drop-groceries', 'keep'])
    expect(chat().find((m) => /^Moved — release review/.test(m.body))!.body).toContain(
      'The options for that overlap are on screen.'
    )
  })

  it('a keyed turn gets the very same chips, and the tool result says they are on screen', async () => {
    await fresh(week0(), 'local')
    let result = ''
    scriptedModel.midTurn = (exec) => {
      result = exec.plan(
        [
          {
            title: 'release review',
            tag: 'work',
            dayOffset: 0,
            startMin: 14 * 60,
            durationMin: 60,
          },
        ],
        []
      )
    }
    await say('put the release review at 2pm today')
    await settle()
    expect(result).toContain('The options for that overlap are on screen.')
    expect(result).not.toMatch(/offer to|don't leave it unasked/)
    expect(chipMsgs()).toHaveLength(1)
    expect(chipMsgs()[0].choices!.map((c) => c.id)).toEqual(['shift', 'drop-groceries', 'keep'])
  })
})

/* ── a drop chip picked after midnight (peer review of #89, coderpa) ── */

describe('#12 — a drop chip re-checks at pick time: its day words mean the day it is picked', () => {
  const groceriesOn = (id: string, dayKey: string) =>
    block({
      id,
      title: 'Groceries',
      tag: 'private',
      dayKey,
      startMin: 14 * 60,
      endMin: 15.5 * 60,
      protected: false,
    })
  /** the clock rolls past midnight into Wednesday, and the store ticks */
  const rollTo = (d: Date) => {
    vi.setSystemTime(d)
    useMew.getState().tick()
  }
  const WED_0005 = new Date(2026, 5, 10, 0, 5)
  const lastMew = () =>
    chat()
      .filter((m) => m.role === 'mew')
      .at(-1)!

  it('offered Tuesday for Tuesday’s Groceries, picked Wednesday 00:05 with a same-titled Groceries on Wednesday: nothing is removed, and MEW names the block the choice was for', async () => {
    await fresh([...week0(), groceriesOn('groceries-wed', WED)])
    await say(PLACE)
    await settle()
    const offer = chipMsgs()[0]
    expect(offer.choices!.find((c) => c.id === 'drop-groceries')!.reply).toBe(
      'remove the Groceries today at 14:00'
    )

    rollTo(WED_0005)
    expect(choicesActive(chat(), chipMsgs()[0])).toBe(true) // still pickable after midnight
    const before = snapshot()
    const userTurns = chat().filter((m) => m.role === 'user').length

    await useMew.getState().pickChoice(offer.id, 'drop-groceries')
    await settle()

    expect(snapshot()).toBe(before) // both Groceries stay, Wednesday's included
    expect(byId('groceries')).toBeDefined()
    expect(byId('groceries-wed')).toBeDefined()
    expect(lastMew().body).toBe(
      "That choice was for Tuesday's Groceries at 14:00, so everything stays as it is."
    )
    expect(chat().filter((m) => m.role === 'user')).toHaveLength(userTurns) // no reply was spoken
    const spent = chat().find((m) => m.id === offer.id)!
    expect(spent.choices!.find((c) => c.id === 'drop-groceries')!.picked).toBe(true)
    expect(choicesActive(chat(), spent)).toBe(false) // the offer is spent
  })

  it('a chip for tomorrow’s block, picked after midnight: "tomorrow" is Thursday now, so nothing is removed and the block is named as today’s', async () => {
    await fresh([...week0(), groceriesOn('groceries-wed', WED)])
    await say(PLACE)
    await settle()
    const offer = chipMsgs()[0]
    /* the same offer, re-pointed at Wednesday's Groceries the way a Tuesday
       offer for it reads */
    useMew.setState((st) => ({
      chat: st.chat.map((m) =>
        m.id === offer.id
          ? {
              ...m,
              choices: m.choices!.map((c) =>
                c.id === 'drop-groceries'
                  ? {
                      id: 'drop-groceries-wed',
                      label: 'drop Groceries',
                      reply: 'remove the Groceries tomorrow at 14:00',
                    }
                  : c
              ),
            }
          : m
      ),
    }))
    rollTo(WED_0005)
    const before = snapshot()

    await useMew.getState().pickChoice(offer.id, 'drop-groceries-wed')
    await settle()

    expect(snapshot()).toBe(before)
    expect(lastMew().body).toBe(
      "That choice was for today's Groceries at 14:00, so everything stays as it is."
    )
  })

  it('a weekday-named chip still singles out its block after midnight, so the pick removes exactly that block', async () => {
    await fresh([...week0(), groceriesOn('groceries-thu', THU)])
    await say(PLACE)
    await settle()
    const offer = chipMsgs()[0]
    useMew.setState((st) => ({
      chat: st.chat.map((m) =>
        m.id === offer.id
          ? {
              ...m,
              choices: m.choices!.map((c) =>
                c.id === 'drop-groceries'
                  ? {
                      id: 'drop-groceries-thu',
                      label: 'drop Groceries',
                      reply: 'remove the Groceries on thursday at 14:00',
                    }
                  : c
              ),
            }
          : m
      ),
    }))
    rollTo(WED_0005)
    const before = JSON.parse(snapshot()) as unknown[][]

    await useMew.getState().pickChoice(offer.id, 'drop-groceries-thu')
    await settle()

    expect(byId('groceries-thu')).toBeUndefined() // Thursday is still Thursday
    expect(JSON.parse(snapshot())).toEqual(before.filter((r) => r[0] !== 'groceries-thu'))
    expect(
      chat().some(
        (m) => m.role === 'user' && m.body === 'remove the Groceries on thursday at 14:00'
      )
    ).toBe(true)
  })

  it('a block that is gone by the pick: nothing else is touched, and MEW names it by the chip', async () => {
    await fresh([...week0(), groceriesOn('groceries-wed', WED)])
    await say(PLACE)
    await settle()
    const offer = chipMsgs()[0]
    useMew.setState((st) => ({ blocks: st.blocks.filter((b) => b.id !== 'groceries') }))
    rollTo(WED_0005)
    const before = snapshot()

    await useMew.getState().pickChoice(offer.id, 'drop-groceries')
    await settle()

    expect(snapshot()).toBe(before) // Wednesday's Groceries stays
    expect(lastMew().body).toBe('That choice was for Groceries, so everything stays as it is.')
  })
})

/* ── #96: the drop chip's pick-time check reads the turn clock ─────────── */

describe('#96 — a drop chip picked in the seconds after midnight, before a tick lands', () => {
  it('store ticked at Tue 23:59:58, wall at Wed 00:00:02: the check reads Wednesday like the executor, so nothing is removed', async () => {
    await fresh([
      ...week0(),
      block({
        id: 'groceries-wed',
        title: 'Groceries',
        tag: 'private',
        dayKey: WED,
        startMin: 14 * 60,
        endMin: 15.5 * 60,
        protected: false,
      }),
    ])
    await say(PLACE)
    await settle()
    const offer = chipMsgs()[0]
    vi.setSystemTime(new Date(2026, 5, 9, 23, 59, 58))
    useMew.getState().tick() // Tuesday's last tick
    vi.setSystemTime(new Date(2026, 5, 10, 0, 0, 2)) // midnight passes; no tick yet
    const before = snapshot()

    await useMew.getState().pickChoice(offer.id, 'drop-groceries')
    await settle()

    expect(snapshot()).toBe(before) // neither Groceries is removed
    expect(
      chat()
        .filter((m) => m.role === 'mew')
        .at(-1)!.body
    ).toBe("That choice was for Tuesday's Groceries at 14:00, so everything stays as it is.")
  })
})
