/* #73 — the rescue chip's split still splits byte-identically, now through the
   one split executor. The golden rows below were captured from the RC before
   #73 (9998742: the old edit + plan composition) by picking the same chip on the
   same week: the shortened block, the untouched meeting, part 2 and the paced
   breather match field for field. One deliberate, named change: part 2 now
   inherits the block's protection (the RC forced `protected: true`), so a
   flexible block's part 2 stays flexible (docs/v0.6-plan.md's open note). */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, Settings } from '../../domain/types'
import { dayKey } from '../../domain/time'
import { chatOrder } from '../../adapters/storage-port'
import type { PushEventBody, RemoteEvent, SyncEntry } from '../../adapters/calendar/types'

/* ── fakes ────────────────────────────────────────────────────────── */

const fakeDb = {
  blocks: new Map<string, unknown>(),
  captures: new Map<string, unknown>(),
  chat: new Map<string, unknown>(),
  memory: new Map<string, unknown>(),
  settings: null as Settings | null,
  sync: new Map<string, SyncEntry>(),
  chatAsc(): ChatMessage[] {
    return ([...this.chat.values()] as ChatMessage[]).sort(chatOrder)
  },
  reset() {
    this.blocks.clear()
    this.captures.clear()
    this.chat.clear()
    this.memory.clear()
    this.sync.clear()
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
    /* the push ledger keeps REAL round-trip semantics — the sync-out pin
       reads through it */
    loadSyncMap: async () => [...fakeDb.sync.values()],
    saveSyncMap: async (put: SyncEntry[], removeIds: string[]) => {
      put.forEach((e) => fakeDb.sync.set(e.id, e))
      removeIds.forEach((id) => fakeDb.sync.delete(id))
    },
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

/* the Google account, scripted per test — the same CalendarAccount seam
   runSync drives in production. What MEW pushes is listed back on the next
   pull (with its mewBlockId marker), exactly as the real calendar behaves —
   otherwise the stale-ledger sweep would read every pushed event as deleted
   and re-create instead of update. */
const account = {
  events: [] as RemoteEvent[],
  pushed: new Map<string, RemoteEvent>(),
  created: [] as { calId: string; body: PushEventBody; eventId: string }[],
  updated: [] as { calId: string; eventId: string; body: PushEventBody }[],
  deleted: [] as { calId: string; eventId: string }[],
  reset() {
    this.events = []
    this.pushed.clear()
    this.created = []
    this.updated = []
    this.deleted = []
  },
}
const asRemote = (calId: string, eventId: string, body: PushEventBody): RemoteEvent => ({
  eventId,
  calId,
  title: body.title,
  dayKey: body.dayKey,
  startMin: body.startMin,
  endMin: body.endMin,
  mewBlockId: body.mewBlockId,
})
vi.mock('../../adapters/calendar/google', () => ({
  googleAccount: () => ({
    authorize: async () => {},
    listCalendars: async () => [],
    listEvents: async () => [...account.events, ...account.pushed.values()],
    createEvent: async (calId: string, body: PushEventBody) => {
      const eventId = `g-${account.created.length + 1}`
      account.created.push({ calId, body, eventId })
      account.pushed.set(eventId, asRemote(calId, eventId, body))
      return eventId
    },
    updateEvent: async (calId: string, eventId: string, body: PushEventBody) => {
      account.updated.push({ calId, eventId, body })
      account.pushed.set(eventId, asRemote(calId, eventId, body))
    },
    deleteEvent: async (calId: string, eventId: string) => {
      account.deleted.push({ calId, eventId })
      account.pushed.delete(eventId)
    },
  }),
}))

import { useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m) // Tuesday, June 9
const TODAY = '2026-06-09'
const CAL = 'work@acme'

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Deck polish',
    tag: 'work',
    dayKey: TODAY,
    startMin: 540,
    endMin: 660,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

function remote(over: Partial<RemoteEvent>): RemoteEvent {
  return {
    eventId: 'ev1',
    calId: CAL,
    title: 'Design sync',
    dayKey: TODAY,
    startMin: 570,
    endMin: 615,
    ...over,
  }
}

/** Boot the real store on a fixture week with one live calendar. Keyless by
    default — the tap must re-plan on the rules floor. */
async function fresh(blocks: Block[], start = TUE(8, 0)) {
  fakeDb.reset()
  account.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  fakeDb.settings = {
    ...pristine.settings,
    googleClientId: 'cid-123',
    calendars: [
      {
        id: CAL,
        name: 'Google · Work',
        who: 'me',
        provider: 'google',
        kind: 'live',
        defaultTag: 'work',
      },
    ],
    matrix: { [CAL]: { work: 'details', private: 'hidden', health: 'hidden' } },
  }
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

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/* ── the golden ───────────────────────────────────────────────────── */

/** every field of every block but the fresh ids, in time order */
const rows = () =>
  [...blocks()]
    .map(({ id, ...rest }) => ({
      id: id === 'deck' ? 'deck' : rest.external ? 'meeting' : 'NEW',
      ...rest,
    }))
    .sort((a, b) => a.startMin - b.startMin)

const GOLDEN = [
  {
    id: 'deck',
    title: 'Deck polish',
    tag: 'work',
    dayKey: '2026-06-09',
    startMin: 540,
    endMin: 570,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
  },
  {
    id: 'meeting',
    title: 'Design sync',
    tag: 'work',
    dayKey: '2026-06-09',
    startMin: 570,
    endMin: 615,
    protected: false,
    status: 'open',
    calendarRefs: ['work@acme'],
    estimateSource: 'user',
    external: { calId: 'work@acme', eventId: 'ev1' },
  },
  {
    id: 'NEW',
    title: 'Deck polish (part 2)',
    tag: 'work',
    dayKey: '2026-06-09',
    startMin: 615,
    endMin: 660,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
  },
  {
    id: 'NEW',
    title: 'Breather',
    tag: 'rest',
    dayKey: '2026-06-09',
    startMin: 660,
    endMin: 675,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    /* #123: the pacing pass marks its breather as MEW's own (the only field
       added since the golden was captured) */
    placedBy: 'pacing',
  },
]

async function pickSplit(over: Partial<Block> = {}) {
  await fresh([block({ id: 'deck', ...over })])
  account.events = [remote({})]
  await useMew.getState().syncNow()
  const offer = chipMsgs()[0]
  expect(offer.choices!.find((c) => c.id === 'split')!.reply).toBe(
    'split the Deck polish around 9:30-10:15, keep 45m after'
  )
  await useMew.getState().pickChoice(offer.id, 'split')
}

describe('#73 — the rescue chip splits byte-identically through the one split executor', () => {
  it('a protected work block: every block matches the pre-#73 golden, field for field', async () => {
    await pickSplit()
    expect(rows()).toEqual(GOLDEN)
    expect(
      chat()
        .filter((m) => m.role === 'mew')
        .at(-1)!.body
    ).toBe(
      'Split — Deck polish now runs 9:00–9:30, and Deck polish (part 2) picks up 10:15–11:00, leaving 9:30–10:15 free. Tucked a 15-min breather into today at 11:00.'
    )
  })

  it('the named change: a flexible block keeps part 2 flexible; nothing else differs', async () => {
    await pickSplit({ protected: false })
    expect(rows()).toEqual(
      GOLDEN.map((r) =>
        r.id === 'deck' || r.title === 'Deck polish (part 2)' ? { ...r, protected: false } : r
      )
    )
  })
})
