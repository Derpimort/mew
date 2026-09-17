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
