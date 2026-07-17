/* Notification actions (#305, v0.5 item 10), through the REAL store: a mirrored
   block reminder grows the two universal quick-actions (done / +15) on BOTH the
   native toast and the in-app card, and each routes through a door the store
   already owns — done → toggleComplete (a mew, event logged), +15 → week.move,
   which the next sync run pushes out. The coherence gate is pinned too: the
   block you're in right now (drift's moment) grows no quick-actions. Adapters
   are faked at their seams (in-memory storage, a recording notifier, a
   scriptable Google account); no network, no keys, no jsdom. */

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

/* the recording notifier — every mirror() call is captured so the toast's
   action payload (and its absence) can be pinned */
type MirrorCall = {
  title: string
  body: string
  tag: string
  onClick: () => void
  actions?: { id: string; label: string }[]
  onAction?: (id: string) => void
}
const { mirrorCalls } = vi.hoisted(() => ({ mirrorCalls: [] as MirrorCall[] }))
vi.mock('../../adapters/notify', () => {
  const notifier = { mirror: (o: MirrorCall) => mirrorCalls.push(o) }
  return { createNotifier: () => notifier, createBrowserNotifier: () => notifier }
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

const CAL = 'work@acme'
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

/** A due-bearing background block near its latest start — the exact shape the
    start-by nudge fires on. Upcoming (10:00) and open, so it earns done/+15. */
function restore(over: Partial<Block> = {}): Block {
  return {
    id: 'restore',
    title: 'Phone restore',
    tag: 'work',
    attention: 'background',
    dayKey: TODAY,
    startMin: 600, // 10:00
    endMin: 780, // 13:00
    due: 780,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

async function boot(blocks: Block[], opts: { live?: boolean; start?: Date } = {}) {
  const start = opts.start ?? TUE(9, 51) // inside start-by's warning window (latest start 10:00)
  fakeDb.reset()
  account.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  fakeDb.settings = {
    ...pristine.settings,
    browserMirror: true,
    ...(opts.live
      ? {
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
      : {}),
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
  /* hydrate runs a tick of its own (store.ts) which fires + dedupes the day's
     nudges and can auto-sync; clear that so the test's explicit tick fires one
     clean instance, and reset mirrorCalls to capture only what the test drives */
  useMew.setState((s) => ({
    chat: [],
    queuedNudges: [],
    engine: { ...s.engine, lastFired: {} },
    lastSyncAt: start.getTime(),
  }))
  mirrorCalls.length = 0
}

const chat = () => useMew.getState().chat
const blocks = () => useMew.getState().blocks
const memory = () => useMew.getState().memory
const nudgeOf = (type: string) => chat().find((m) => m.nudgeType === type)

/** Boot the exact start-by fixture and tick once so the reminder fires and its
    card + toast grow the pair. Returns the posted nudge message. */
async function firedStartBy(): Promise<ChatMessage> {
  await boot([restore()])
  useMew.getState().tick()
  const msg = nudgeOf('start-by')
  expect(msg, 'start-by should fire in the warning window').toBeDefined()
  return msg!
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/* ── the mirrored reminder grows the pair (parity) ────────────────────── */

describe('a mirrored block reminder grows done / +15 (#305)', () => {
  it('the SAME two actions land on the toast and on the card', async () => {
    const msg = await firedStartBy()

    // parity: the card carries done + snooze15 (alongside start-by's own actions)
    expect(msg.actions?.map((a) => a.id)).toEqual(expect.arrayContaining(['done', 'snooze15']))

    // the toast mirrored exactly the two universal actions, with a router-bound
    // onAction (native tap) and a landing onClick (the click-to-land fallback)
    const call = mirrorCalls.find((c) => c.tag === msg.id)
    expect(call).toBeDefined()
    expect(call!.actions).toEqual([
      { id: 'done', label: 'Done' },
      { id: 'snooze15', label: '+15 min' },
    ])
    expect(typeof call!.onAction).toBe('function')
    expect(typeof call!.onClick).toBe('function')
  })

  it('the onClick lands on that nudge — the always-shipped fallback route', async () => {
    const msg = await firedStartBy()
    const call = mirrorCalls.find((c) => c.tag === msg.id)!
    call.onClick()
    expect(useMew.getState().page).toBe('week')
    expect(useMew.getState().scrollToMsgId).toBe(msg.id)
  })
})

/* ── the router: existing doors only ──────────────────────────────────── */

describe('the quick-action router (#305)', () => {
  it('done completes the block and logs the completed event, exactly like the checkbox', async () => {
    const msg = await firedStartBy()
    const before = memory().filter((e) => e.kind === 'completed').length

    useMew.getState().nudgeAction(msg.id, 'done')

    expect(blocks().find((b) => b.id === 'restore')!.status).toBe('done')
    const completed = memory().filter((e) => e.kind === 'completed')
    expect(completed).toHaveLength(before + 1)
    expect(completed.at(-1)).toMatchObject({ title: 'Phone restore', plannedMin: 180 })
    // the nudge settles positively (resolved), never an error
    expect(chat().find((m) => m.id === msg.id)!.resolved).toBeTruthy()
  })

  it('+15 shifts the block by 15 through week.move, duration preserved', async () => {
    const msg = await firedStartBy()

    useMew.getState().nudgeAction(msg.id, 'snooze15')

    const b = blocks().find((x) => x.id === 'restore')!
    expect(b).toMatchObject({ startMin: 615, endMin: 795, status: 'open' })
    expect(
      memory().some(
        (e) => e.kind === 'nudge_outcome' && e.nudgeType === 'start-by' && e.outcome === 'accepted'
      )
    ).toBe(true)
  })

  it('resolves quietly (no throw) when the block completed between mirror and tap', async () => {
    const msg = await firedStartBy()
    useMew.getState().toggleComplete('restore') // already done by another path
    expect(() => useMew.getState().nudgeAction(msg.id, 'snooze15')).not.toThrow()
    // still open? no — it was completed; +15 must not resurrect or move it
    expect(blocks().find((b) => b.id === 'restore')!.startMin).toBe(600)
    expect(chat().find((m) => m.id === msg.id)!.resolved).toBeTruthy()
  })
})

/* ── +15 re-syncs on the next run ─────────────────────────────────────── */

describe('the +15 move syncs out on the next run (#305)', () => {
  it('the calendar copy updates to the new start after the next sync', async () => {
    const upcoming: Block = {
      id: 'deck',
      title: 'Deck polish',
      tag: 'work',
      dayKey: TODAY,
      startMin: 600,
      endMin: 660,
      protected: true,
      status: 'open',
      calendarRefs: [],
      estimateSource: 'user',
    }
    await boot([upcoming], { live: true })
    await useMew.getState().syncNow() // first run pushes the block out
    const pushed = account.created.find((c) => c.body.title === 'Deck polish')
    expect(pushed).toBeDefined()

    // a mirrored reminder for the block would carry the pair — tap +15 on its card
    const nudge: ChatMessage = {
      id: 'n-deck',
      role: 'nudge',
      ts: Date.now(),
      nudgeType: 'start-by',
      body: 'start deck polish',
      actions: [
        { id: 'done', label: 'Done', kind: 'secondary' },
        { id: 'snooze15', label: '+15 min', kind: 'secondary' },
      ],
      payload: { blockId: 'deck' },
    }
    useMew.setState((s) => ({ chat: [...s.chat, nudge] }))
    useMew.getState().nudgeAction('n-deck', 'snooze15')
    expect(blocks().find((b) => b.id === 'deck')!.startMin).toBe(615)

    // next run: the ledger sees the new time and updates the calendar copy
    vi.setSystemTime(TUE(9, 57))
    useMew.setState({ nowMs: TUE(9, 57).getTime(), lastSyncAt: 0 })
    await useMew.getState().syncNow()
    expect(
      account.updated.some((u) => u.eventId === pushed!.eventId && u.body.startMin === 615)
    ).toBe(true)
  })
})

/* ── coherence: the block you're in grows nothing ─────────────────────── */

describe('coherence — the current block is drift’s moment, not a done/+15 moment (#305)', () => {
  it('a drift nudge about the live block grows no quick-actions, on the card or the toast', async () => {
    const current: Block = {
      id: 'focus',
      title: 'Deep work',
      tag: 'work',
      dayKey: TODAY,
      startMin: 540, // 9:00
      endMin: 660, // 11:00 — spans 9:30 "now"
      protected: true,
      status: 'open',
      calendarRefs: [],
      estimateSource: 'user',
    }
    await boot([current], { start: TUE(9, 30) })
    useMew.setState({ lastActivityMs: TUE(9, 30).getTime() - 11 * 60_000 }) // idle 11 min → drift
    useMew.getState().tick()

    const drift = nudgeOf('drift')
    expect(drift, 'drift should fire on an idle live block').toBeDefined()
    expect(drift!.actions?.some((a) => a.id === 'done' || a.id === 'snooze15')).toBe(false)
    const call = mirrorCalls.find((c) => c.tag === drift!.id)
    expect(call?.actions).toBeUndefined()
  })
})
