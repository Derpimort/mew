/* #94, through the REAL store: a chip's reply is spoken when it's picked, so its
   day words mean the pick's day. A chip offered on Tuesday and picked after
   midnight acts only while its reply still reaches the same blocks on the same
   absolute day and time; otherwise the chip is spent, MEW says when it was
   offered, and nothing moves. Every day-relative chip family is pinned here: the
   drift shift (#12), the rescue shift / split / roll (#286), and the day-load
   trim (#301). A weekday-anchored reply ("to thursday") still acts after
   midnight, and a same-day pick is untouched. Keyless; adapters faked at their
   seams (the dayload/rescue harness); no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { addDaysKey, dayKey } from '../../domain/time'
import { chatOrder } from '../../adapters/storage-port'
import { choicesActive } from '../../domain/choices'

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
const WED = addDaysKey(TODAY, 1)
const THU = addDaysKey(TODAY, 2)
const WED_0005 = new Date(2026, 5, 10, 0, 5)

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Deck polish',
    tag: 'work',
    dayKey: TODAY,
    startMin: 9 * 60,
    endMin: 11 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

async function fresh(blocks: Block[], memory: MemoryEvent[] = [], start = TUE(8, 0)) {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  memory.forEach((e) => fakeDb.memory.set(e.id, e))
  fakeDb.settings = { ...pristine.settings, sustenance: 'off' }
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
const blocks = () => useMew.getState().blocks
const userTurns = () => chat().filter((m) => m.role === 'user').length
const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!
const snapshot = () =>
  JSON.stringify(
    [...blocks()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((b) => [b.id, b.title, b.dayKey, b.startMin, b.endMin, b.status])
  )
const settle = async () => {
  await Promise.resolve()
  vi.advanceTimersByTime(1)
  await Promise.resolve()
}
/** the clock rolls to `d` and the store ticks, as the shell does */
const rollTo = (d: Date) => {
  vi.setSystemTime(d)
  useMew.getState().tick()
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** Picks `choiceId` on `msg` after the clock rolled, and pins the stale shape:
    nothing moved, no reply spoken, the chip spent, MEW's line names the day. */
async function expectStalePick(msgId: string, choiceId: string, label: string) {
  const before = snapshot()
  const turns = userTurns()
  await useMew.getState().pickChoice(msgId, choiceId)
  await settle()
  expect(snapshot()).toBe(before)
  expect(userTurns()).toBe(turns)
  expect(lastMew().body).toBe(
    `That choice was offered on Tuesday ("${label}"), so everything stays as it is.`
  )
  const spent = chat().find((m) => m.id === msgId)!
  expect(spent.choices!.find((c) => c.id === choiceId)!.picked).toBe(true)
}

/* ── fixtures ─────────────────────────────────────────────────────── */

/** #12's drift week: Groceries (90, flexible) at 14:00 today, today walled from
    15:30, tomorrow one free hour at 9:00, so new work on 14:00 can shift to
    tomorrow 9:00 while Groceries has nowhere clean to go. */
const driftWeek = (): Block[] => [
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

/** #301's lived history: 15 days of 300 completed work minutes → the line at 345. */
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

/** #286: a meeting pulled onto today's Deck polish (9:00–11:00) at 9:30–10:15 */
async function rescueOffer() {
  await fresh([block({ id: 'deck' })])
  useMew
    .getState()
    .simulatePull([{ eventId: 'sim1', title: 'Product sync', startMin: 570, endMin: 615 }])
  await settle()
  return chipMsgs()[0]
}

const spec = (dayKey: string) =>
  block({ id: 'spec', title: 'Spec draft — deep work', dayKey, startMin: 9 * 60, endMin: 13 * 60 })
const loadOffer = () => chat().find((m) => /against your usual/.test(m.body))!

/* ── offered Tuesday, picked Wednesday 00:05: nothing moves ──────────── */

describe('#94 — a day-relative chip picked after midnight changes nothing, and says when it was offered', () => {
  it('drift shift: "to tomorrow at 9:00" would now mean Thursday', async () => {
    await fresh(driftWeek())
    await useMew.getState().speak('block 1h for the release review today at 14')
    await settle()
    const offer = chipMsgs()[0]
    expect(offer.choices!.find((c) => c.id === 'shift')!.reply).toBe(
      'move the release review at 14:00 to tomorrow at 9:00'
    )
    rollTo(WED_0005)
    expect(choicesActive(chat(), offer)).toBe(true) // still pickable after midnight
    await expectStalePick(offer.id, 'shift', 'move release review to tomorrow 9:00')
  })

  it.each([
    ['shift', 'move the Deck polish to today at 10:15', 'shift to 10:15'],
    ['split', 'split the Deck polish around 9:30-10:15, keep 45m after', 'split around it'],
    ['roll', 'move the Deck polish to tomorrow', 'roll to tomorrow'],
  ])('rescue %s: "%s" now speaks about Wednesday', async (id, reply, label) => {
    const offer = await rescueOffer()
    expect(offer.choices!.find((c) => c.id === id)!.reply).toBe(reply)
    rollTo(WED_0005)
    await expectStalePick(offer.id, id, label)
    expect(blocks().some((b) => b.title === 'Deck polish (part 2)')).toBe(false)
  })

  it('day-load trim: "to tomorrow" would now mean Thursday', async () => {
    await fresh([spec(TODAY)], livedMemory())
    await useMew.getState().speak('block 3h for the budget model today at 14')
    await settle()
    const offer = loadOffer()
    expect(offer.choices!.find((c) => c.id === 'trim')!.reply).toBe(
      'move the budget model to tomorrow'
    )
    rollTo(WED_0005)
    await expectStalePick(offer.id, 'trim', 'trim to my usual')
  })
})

/* ── what still acts ───────────────────────────────────────────────── */

describe('#94 — a chip that still means what it offered acts as before', () => {
  it('a weekday-anchored trim ("to thursday") picked after midnight still moves the block to Thursday', async () => {
    await fresh([spec(WED)], livedMemory())
    await useMew.getState().speak('block 3h for the budget model tomorrow at 14')
    await settle()
    const offer = loadOffer()
    expect(offer.choices!.find((c) => c.id === 'trim')!.reply).toBe(
      'move the budget model to thursday'
    )
    rollTo(WED_0005)
    await useMew.getState().pickChoice(offer.id, 'trim')
    await settle()
    expect(
      chat().some((m) => m.role === 'user' && m.body === 'move the budget model to thursday')
    ).toBe(true)
    expect(blocks().find((b) => b.title === 'budget model')!.dayKey).toBe(THU)
  })

  it('a same-day pick is untouched: the drift shift picked Tuesday evening lands on Wednesday 9:00', async () => {
    await fresh(driftWeek())
    await useMew.getState().speak('block 1h for the release review today at 14')
    await settle()
    const offer = chipMsgs()[0]
    rollTo(TUE(20, 0))
    await useMew.getState().pickChoice(offer.id, 'shift')
    await settle()
    expect(blocks().find((b) => b.title === 'release review')).toMatchObject({
      dayKey: WED,
      startMin: 9 * 60,
    })
  })

  it('an acknowledgment chip picked after midnight is still spoken (it changes nothing either way)', async () => {
    await fresh(driftWeek())
    await useMew.getState().speak('block 1h for the release review today at 14')
    await settle()
    const offer = chipMsgs()[0]
    rollTo(WED_0005)
    const before = snapshot()
    await useMew.getState().pickChoice(offer.id, 'keep')
    await settle()
    expect(chat().some((m) => m.role === 'user' && m.body === 'ok, keep both as they are')).toBe(
      true
    )
    expect(snapshot()).toBe(before)
    expect(chat().some((m) => /^That choice was offered on/.test(m.body))).toBe(false)
  })
})

/* ── peer review of #98 (coderpa): which-block and series-scope chips ── */

describe('#94 — which-block (#334) and series-scope (#343) chips re-check too: their target lookup counts from the pick day', () => {
  const gym = (id: string, dayKey: string, startMin = 18 * 60) =>
    block({ id, title: 'gym', tag: 'health', dayKey, startMin, endMin: startMin + 60 })
  /** two gyms today (so the name alone asks which) and one tomorrow at 18:00 */
  const gyms = () => [gym('gym-am', TODAY, 7 * 60), gym('gym-tue', TODAY), gym('gym-wed', WED)]

  it('"done with gym" offered Tuesday morning, "the 18:00" picked at Wed 00:05: Wednesday\'s gym is never marked done, and Tuesday\'s stays open', async () => {
    await fresh(gyms(), [], TUE(6, 0))
    await useMew.getState().speak('done with gym')
    await settle()
    const offer = chipMsgs().at(-1)!
    const evening = offer.choices!.find((c) => /18:00/.test(c.reply))!
    expect(evening.reply).toBe('done with gym at 18:00')
    rollTo(WED_0005)
    await expectStalePick(offer.id, evening.id, evening.label)
    expect(blocks().filter((b) => b.status === 'done')).toHaveLength(0)
  })

  it('"make gym 90 min" offered Tuesday, picked after midnight: Wednesday\'s gym keeps its hour', async () => {
    await fresh(gyms(), [], TUE(6, 0))
    await useMew.getState().speak('make gym 90 min')
    await settle()
    const offer = chipMsgs().at(-1)!
    const evening = offer.choices!.find((c) => /18:00/.test(c.reply))!
    rollTo(WED_0005)
    await expectStalePick(offer.id, evening.id, evening.label)
    expect(blocks().find((b) => b.id === 'gym-wed')).toMatchObject({
      startMin: 18 * 60,
      endMin: 19 * 60,
    })
  })

  it('"standup should be 10:00-10:30" → "just this one" offered Tuesday, picked after midnight: next Tuesday\'s standup keeps its time', async () => {
    const rrule = { freq: 'WEEKLY' as const, interval: 1 }
    const standups = ['2026-06-09', '2026-06-16', '2026-06-23'].map((dayKey, i) =>
      block({
        id: `s${i}`,
        title: 'Standup',
        dayKey,
        startMin: 9 * 60,
        endMin: 9 * 60 + 30,
        recurringBlockId: 's',
        rrule,
      })
    )
    await fresh(standups)
    await useMew.getState().speak('standup should be 10:00-10:30')
    await settle()
    const offer = chipMsgs().at(-1)!
    const justThis = offer.choices!.find((c) => c.label === 'just this one')!
    rollTo(WED_0005)
    await expectStalePick(offer.id, justThis.id, 'just this one')
    expect(
      blocks()
        .filter((b) => b.title === 'Standup')
        .every((b) => b.startMin === 9 * 60)
    ).toBe(true)
  })
})

/* ── #94 × #96: the pick-time check reads the turn clock ──────────────── */

describe('#94 with #96 — a chip picked in the seconds after midnight, before a tick lands', () => {
  it('the rescue roll offered Tuesday, picked at Wed 00:00:02 while the store clock still says Tuesday: stale, nothing moves', async () => {
    const offer = await rescueOffer()
    rollTo(new Date(2026, 5, 9, 23, 59, 58)) // Tuesday's last tick
    vi.setSystemTime(new Date(2026, 5, 10, 0, 0, 2)) // midnight passes; no tick yet
    expect(dayKey(new Date(useMew.getState().nowMs))).toBe(TODAY)
    await expectStalePick(offer.id, 'roll', 'roll to tomorrow')
  })
})
