/* The needsReconnect pause (#25), through the REAL store: an expired desktop
   sign-in pauses sync honestly — one kind chat line per episode (ticks keep
   retrying but never re-post), Settings gets an actionable state, and the ONLY
   exit is the deliberate reconnect click (interactive auth + catch-up sync).
   Adapters are faked at their seams like notify-actions.test.ts: in-memory
   storage, a scriptable Google account; no network, no keys, no jsdom. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import type { SyncEntry } from '../../adapters/calendar/types'
import { ReauthRequiredError } from '../../adapters/calendar/types'

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

vi.mock('../../adapters/notify', () => {
  const notifier = { mirror: () => {} }
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

/* the scriptable account — `expired` mirrors the desktop shell with a dead
   in-memory token: silent authorize pauses, interactive succeeds */
const account = {
  expired: false,
  authCalls: [] as boolean[],
  reset() {
    this.expired = false
    this.authCalls = []
  },
}
vi.mock('../../adapters/calendar/google', () => ({
  googleAccount: () => ({
    authorize: async (interactive: boolean) => {
      account.authCalls.push(interactive)
      if (account.expired && !interactive) throw new ReauthRequiredError()
      if (interactive) account.expired = false
    },
    listCalendars: async () => [],
    listEvents: async () => [],
    createEvent: async () => 'g-1',
    updateEvent: async () => {},
    deleteEvent: async () => {},
  }),
}))

import { useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const CAL = 'work@acme'

async function boot() {
  fakeDb.reset()
  account.reset()
  /* one stored block keeps hydrate on the loaded path — an empty db would
     take the fresh-seed branch and replace these settings with seed defaults */
  fakeDb.blocks.set('anchor', {
    id: 'anchor',
    title: 'Deep work',
    tag: 'work',
    dayKey: '2026-06-09',
    startMin: 540,
    endMin: 600,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
  })
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
  useMew.setState({ ...pristine }, true)
  await useMew.getState().hydrate()
  /* hydrate can auto-sync; settle to a clean, healthy baseline */
  useMew.setState({ chat: [], needsReconnect: false, syncError: null, lastSyncAt: 0 })
  account.authCalls = []
}

const st = () => useMew.getState()
const pauseLines = () => st().chat.filter((m) => /calendar sync is paused/i.test(m.body))
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('the reconnect pause (#25)', () => {
  beforeEach(boot)

  it('an expired sign-in pauses once: flag up, ONE chat line across repeated ticks', async () => {
    account.expired = true
    await st().syncNow()
    expect(st().needsReconnect).toBe(true)
    expect(st().syncError).toBeNull() // paused is its own honest state, not a hiccup
    expect(pauseLines()).toHaveLength(1)

    await st().syncNow() // the 5-min tick retrying must not re-post
    expect(pauseLines()).toHaveLength(1)
    expect(account.authCalls.every((i) => i === false)).toBe(true) // nothing interactive happened
  })

  it('reconnect is the deliberate exit: interactive auth, flag cleared, catch-up sync', async () => {
    account.expired = true
    await st().syncNow()
    expect(st().needsReconnect).toBe(true)

    account.authCalls = []
    await st().reconnectGoogle()
    await settle() // the kicked catch-up sync is fire-and-forget

    expect(account.authCalls[0]).toBe(true) // the click IS the consent
    expect(st().needsReconnect).toBe(false)
    expect(st().lastSyncAt).toBeGreaterThan(0) // the week caught up
    expect(pauseLines()).toHaveLength(1) // no new episode line
  })

  it('disconnecting the last live google calendar ends the pause with it', async () => {
    account.expired = true
    await st().syncNow()
    expect(st().needsReconnect).toBe(true)

    st().disconnectCalendar(CAL)
    expect(st().needsReconnect).toBe(false)
  })
})
