/* The day-load meter (#301), through the REAL store: a keyless plan turn that
   pushes a day past the demonstrated line posts exactly ONE chips message
   (the #296 shape), once per day per day-key (persisted via nudgeLastFired,
   #297); the trim chip re-plans through the rules floor; the keep chip is an
   inert acknowledgment; under the line — and under the data floor — silence.
   Adapters are faked at their seams (the rescue.test harness); no network,
   no keys, no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { addDaysKey, dayKey } from '../../domain/time'
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

import { useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m) // Tuesday, June 9
const TODAY = '2026-06-09'
const TOMORROW = addDaysKey(TODAY, 1)

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Spec draft — deep work',
    tag: 'work',
    dayKey: TOMORROW,
    startMin: 9 * 60,
    endMin: 13 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/** 15 lived days ending yesterday, 300 completed work minutes each (one deep
    240 + one shallow 60) → throughput median 300, the line at 345. */
function livedMemory(): MemoryEvent[] {
  const out: MemoryEvent[] = []
  let n = 0
  for (let i = 1; i <= 15; i++) {
    const k = addDaysKey(TODAY, -i)
    const ts = new Date(k + 'T17:00:00').getTime()
    out.push(
      { id: `m${n++}`, ts, kind: 'completed', dayKey: k, tag: 'work', plannedMin: 240, deep: true },
      { id: `m${n++}`, ts: ts + 1, kind: 'completed', dayKey: k, tag: 'work', plannedMin: 60 }
    )
  }
  return out
}

/** Boot the real store keyless on a fixture week — the floor must do it all. */
async function fresh(blocks: Block[], memory: MemoryEvent[], start = TUE(8, 0)) {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  memory.forEach((e) => fakeDb.memory.set(e.id, e))
  fakeDb.settings = { ...pristine.settings }
  vi.setSystemTime(start)
  useMew.setState(
    {
      ...pristine,
      lastTickDay: dayKey(start),
      nowMs: start.getTime(),
      lastActivityMs: start.getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

const chat = () => useMew.getState().chat
const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)
const meterMsgs = () => chat().filter((m) => /against your usual/.test(m.body))
const blocks = () => useMew.getState().blocks

/* in-turn chips flush synchronously in speak's finally; the out-of-turn path
   posts on a microtask — two hops settle both without touching the clock */
const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/* ── scenarios ────────────────────────────────────────────────────── */

describe('placing past the throughput line (#301)', () => {
  it('one over-line plan turn → exactly ONE gentle line + two chips, in the #296 shape', async () => {
    await fresh([block({ id: 'spec' })], livedMemory())
    await useMew.getState().speak('block 3h for the budget model tomorrow at 14')
    await settle()

    const offers = meterMsgs()
    expect(offers).toHaveLength(1)
    expect(offers[0].role).toBe('mew')
    expect(offers[0].body).toBe(`that's 7h of work against your usual 5 — want me to keep it kind?`)
    const chips = offers[0].choices!
    expect(chips.map((c) => ({ id: c.id, label: c.label }))).toEqual([
      { id: 'keep', label: 'keep it as planned' },
      { id: 'trim', label: 'trim to my usual' },
    ])
    /* the trim reply is a plain ask the rules floor executes (parse.ts move) */
    expect(chips[1].reply).toBe('move the budget model to thursday')
    /* the meter line lands AFTER the plan's own reply — reflection, not interrupt */
    const bodies = chat().map((m) => m.body)
    expect(bodies.findIndex((b) => /against your usual/.test(b))).toBeGreaterThan(
      bodies.findIndex((b) => /^Done — /.test(b))
    )
    /* the same-turn right-size aside stays quiet — the chips carry the offer
       (the aside rides the plan reply's body when it speaks) */
    expect(chat().some((m) => /right-size it if you want/.test(m.body))).toBe(false)
  })

  it('once per day per day-key: a second over-line placement on the same day re-nudges nothing', async () => {
    await fresh([block({ id: 'spec' })], livedMemory())
    await useMew.getState().speak('block 3h for the budget model tomorrow at 14')
    await settle()
    expect(meterMsgs()).toHaveLength(1)

    await useMew.getState().speak('block 30m for follow-ups tomorrow at 18')
    await settle()
    expect(meterMsgs()).toHaveLength(1)

    /* the burned key is machine state, persisted (#297): it survives a restart */
    expect(useMew.getState().settings.nudgeLastFired?.[`dayload:${TOMORROW}`]?.key).toBe(TODAY)
    expect(fakeDb.settings?.nudgeLastFired?.[`dayload:${TOMORROW}`]?.key).toBe(TODAY)
  })

  it('one run over-loading two days speaks once per day-key', async () => {
    await fresh(
      [
        block({ id: 'spec' }),
        block({
          id: 'fri-base',
          title: 'Roadmap base — deep work',
          dayKey: addDaysKey(TODAY, 3), // Friday
        }),
      ],
      livedMemory()
    )
    await useMew
      .getState()
      .speak(
        'block 3h for the budget model tomorrow at 14, block 2h for the roadmap push on friday at 14'
      )
    await settle()
    const offers = meterMsgs()
    expect(offers).toHaveLength(2)
    expect(offers[0].body).toContain(`that's 7h of work`)
    expect(offers[1].body).toContain(`that's 6h of work`)
  })

  it('under the line → silence, pinned', async () => {
    await fresh([block({ id: 'spec' })], livedMemory())
    await useMew.getState().speak('block 1h for notes tomorrow at 14')
    await settle()
    expect(meterMsgs()).toHaveLength(0)
    expect(chipMsgs()).toHaveLength(0)
  })

  it('data floor: cold history → no meter, however heavy the ask', async () => {
    await fresh([block({ id: 'spec' })], [])
    await useMew.getState().speak('block 5h for the budget model tomorrow at 13')
    await settle()
    expect(meterMsgs()).toHaveLength(0)
    expect(chipMsgs()).toHaveLength(0)
  })

  it('voice pin: the whole flow never says overloaded / behind / too much', async () => {
    await fresh([block({ id: 'spec' })], livedMemory())
    await useMew.getState().speak('block 3h for the budget model tomorrow at 14')
    await settle()
    const everything = chat()
      .map((m) => `${m.body} ${m.observation ?? ''}`)
      .join(' ')
    expect(everything).not.toMatch(/\b(overloaded|behind|too much)\b/i)
  })
})

describe('the chips (#296 shape — a pick is a user turn)', () => {
  it('trim executes keylessly through the rules floor: one move, the day back under', async () => {
    await fresh([block({ id: 'spec' })], livedMemory())
    await useMew.getState().speak('block 3h for the budget model tomorrow at 14')
    await settle()

    const offer = meterMsgs()[0]
    await useMew.getState().pickChoice(offer.id, 'trim')
    await settle()

    /* the pick posted the reply as an ordinary user turn */
    expect(
      chat().some((m) => m.role === 'user' && m.body === 'move the budget model to thursday')
    ).toBe(true)
    /* the executor moved the block — tools stay the only mutation path */
    const moved = blocks().find((b) => b.title === 'budget model')!
    expect(moved.dayKey).toBe(addDaysKey(TODAY, 2))
    expect(
      chat().some(
        (m) => m.role === 'mew' && /^Moved — budget model now lives Thursday/.test(m.body)
      )
    ).toBe(true)
    /* tomorrow is back at the usual — and the guard stays quiet about the
       trim's own landing day (240 + 180 on thursday is still under) */
    expect(meterMsgs()).toHaveLength(1)
    const spent = meterMsgs()[0].choices!.find((c) => c.id === 'trim')!
    expect(spent.picked).toBe(true)
  })

  it('keep is an inert acknowledgment: no mutation, a plain floor reply', async () => {
    await fresh([block({ id: 'spec' })], livedMemory())
    await useMew.getState().speak('block 3h for the budget model tomorrow at 14')
    await settle()

    const before = blocks()
    const offer = meterMsgs()[0]
    await useMew.getState().pickChoice(offer.id, 'keep')
    await settle()

    expect(chat().some((m) => m.role === 'user' && m.body === 'ok, keep it as planned')).toBe(true)
    expect(blocks()).toEqual(before) // the week did not move
    expect(chat().at(-1)!.body).toBe('Good. Mewing away.')
    expect(meterMsgs()).toHaveLength(1) // and nothing re-nudged
  })
})
