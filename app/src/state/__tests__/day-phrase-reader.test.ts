/* #160: one day-phrase reader, shared by move and remove.

   THIS FILE'S FIRST DESCRIBE IS THE ORDERING PIN, and it is deliberately written
   and landed BEFORE the reader changes (the manager's Rule One: in a reader, the
   order of passes IS the behaviour, so it gets a pin and never a comment). A
   weekday word at the front of a title — "Friday demo", "Wednesday review" — is
   part of the TITLE, and #72 excluded that shape from the day reader on purpose.
   These cases pass on the tree before the fix and must keep passing after it: if
   a day-phrase pass ever runs ahead of the title match, they are what fails. */

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
const THU = addDaysKey(TODAY, 2)
const TOMORROW = addDaysKey(TODAY, 1)

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
const blocks = () => useMew.getState().blocks
const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!
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

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/* ── the ordering pin: a weekday at the front of a title is the title's ── */

describe('#160 ordering: the title match runs before any day reading', () => {
  const say = (t: string) => useMew.getState().speak(t)
  /* the harness's lastMew() returns the MESSAGE, not its body — asserting a
     string against it fails loudly, but `not.toContain` on it would PASS while
     checking nothing, which is how this trap bit the other lane tonight */
  const lastBody = () => lastMew().body
  const titles = () => blocks().map((b) => `${b.title}@${b.dayKey}`)
  /* two blocks whose titles BEGIN with a weekday word, neither sitting on the
     day its own title names — so a day-phrase pass running first would look for
     "demo" on Friday and "review" on Wednesday and find neither */
  const weekdayTitles = () => [
    block({
      id: 'fd',
      title: 'Friday demo',
      dayKey: TODAY,
      startMin: 600,
      endMin: 660,
      protected: false,
    }),
    block({
      id: 'wr',
      title: 'Wednesday review',
      dayKey: THU,
      startMin: 660,
      endMin: 720,
      protected: false,
    }),
  ]

  it('remove finds a block whose title starts with a weekday, on whatever day it sits', async () => {
    await fresh(weekdayTitles())
    await say('remove the friday demo')
    await settle()
    expect(lastBody()).toBe('Removed — Friday demo (today 10:00).')
    expect(titles()).toEqual(['Wednesday review@2026-06-11'])
  })

  it('and so does move — the same title, the same rule, the other verb', async () => {
    await fresh(weekdayTitles())
    await say('move the friday demo to 15:00')
    await settle()
    expect(lastBody()).toBe('Moved — Friday demo now lives today at 15:00.')
    expect(titles()).toEqual(['Friday demo@2026-06-09', 'Wednesday review@2026-06-11'])
    expect(blocks().find((b) => b.id === 'fd')!.startMin).toBe(900)
  })

  it('a weekday title on a day that is not its own: remove still reads the title', async () => {
    await fresh(weekdayTitles())
    await say('remove the wednesday review')
    await settle()
    expect(lastBody()).toBe('Removed — Wednesday review (Thursday 11:00).')
    expect(titles()).toEqual(['Friday demo@2026-06-09'])
  })
})

/* ── one reader, both verbs ───────────────────────────────────────── */

describe('#160: move reads the day phrases remove already read', () => {
  const say = (t: string) => useMew.getState().speak(t)
  const lastBody = () => lastMew().body
  const at = (id: string) => {
    const b = blocks().find((x) => x.id === id)
    return b ? `${b.dayKey}@${b.startMin}` : 'GONE'
  }
  /* one title, two days — so only a day can say which */
  const gyms = () => [
    block({
      id: 'g-wed',
      title: 'Gym',
      tag: 'health',
      dayKey: TOMORROW,
      startMin: 510,
      endMin: 570,
      protected: false,
    }),
    block({
      id: 'g-thu',
      title: 'Gym',
      tag: 'health',
      dayKey: THU,
      startMin: 510,
      endMin: 570,
      protected: false,
    }),
  ]

  it('"on <weekday>" names which one moves — including the one that is NOT the soonest', async () => {
    await fresh(gyms())
    await say('move the gym on thursday to 15:00')
    await settle()
    expect(lastBody()).toBe('Moved — Gym now lives Thursday at 15:00.')
    expect([at('g-wed'), at('g-thu')]).toEqual([`${TOMORROW}@510`, `${THU}@900`])
  })

  it('the possessive names it too — the same phrase remove has read since #72', async () => {
    await fresh(gyms())
    await say("move wednesday's gym to 15:00")
    await settle()
    expect(lastBody()).toBe('Moved — Gym now lives Wednesday at 15:00.')
    expect([at('g-wed'), at('g-thu')]).toEqual([`${TOMORROW}@900`, `${THU}@510`])
  })

  it('a day with no such block: the miss NAMES the day, on both verbs (#160)', async () => {
    /* the reply must not be wrong about the one thing the parser got right —
       "I couldn't find \"gym\"" tells an owner looking at two gyms they have none */
    await fresh(gyms())
    await say('move the gym on friday to 15:00')
    await settle()
    expect(lastBody()).toBe(`I couldn't find "gym" on Friday to move — say it another way?`)
    expect([at('g-wed'), at('g-thu')]).toEqual([`${TOMORROW}@510`, `${THU}@510`])

    await fresh(gyms())
    await say('remove the gym on friday')
    await settle()
    expect(lastBody()).toBe(`I couldn't find "gym" on Friday to remove — say it another way?`)
    expect(blocks()).toHaveLength(2)
  })

  it('an ask naming no day keeps its old wording — no "on today" where nobody said today', async () => {
    /* the rescue split passes a DEFAULTED day, so the named-day sentence is fed
       by what the ask said rather than by what the resolver filters on */
    await fresh([block({ id: 'deck', title: 'Deck polish', startMin: 540, endMin: 660 })])
    await say('split the flurble around 13:00-13:45, keep 45m after')
    await settle()
    expect(lastBody()).toBe(`I couldn't find "flurble" to split — say it another way?`)
  })

  it("the adjective form is NOT a day phrase, on either verb — #72's decision, pinned", async () => {
    /* "the wednesday gym" keeps the weekday in the TITLE, because a weekday at
       the front of a title is ordinary ("Friday demo", "Sun salutation"). Read it
       as a day and those titles stop resolving — see the ordering pin above.
       Excluding it on BOTH verbs is what makes them consistent; teaching it to
       either one is a behaviour change that belongs to the owner, with #158's
       ask-or-guess question attached. */
    await fresh(gyms())
    await say('move the wednesday gym to 15:00')
    await settle()
    expect(lastBody()).toBe(`I couldn't find "wednesday gym" to move — say it another way?`)
    expect([at('g-wed'), at('g-thu')]).toEqual([`${TOMORROW}@510`, `${THU}@510`])

    await fresh(gyms())
    await say('remove the wednesday gym')
    await settle()
    /* remove finds the title "gym" and asks which — it does not filter by day */
    expect(lastBody()).toMatch(/^2 "gym" blocks ahead/)
    expect(blocks()).toHaveLength(2)
  })
})
