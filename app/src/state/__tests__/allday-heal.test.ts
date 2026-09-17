/* All-day entries through the REAL store (#27): an install that already holds
   the owner's broken Civic Holiday (an external 0:00–23:59 block) heals on
   load with no re-sync; the healed label never takes the countdown, never
   fires "civic holiday is set to run over your lunch", never lands a rescue,
   and never reaches a calendar — not even orphaned and adopted as MEW's own.
   New all-day entries ride the same pull path (runSync, simulatePull, ICS
   import) as labels. Adapters are faked at their seams (in-memory storage, a
   scriptable Google account); no network, no keys, no jsdom. Each scenario
   that proves an absence carries its control: the unhealed shape, same
   harness, speaking up. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, Settings } from '../../domain/types'
import { dayKey } from '../../domain/time'
import { liveNow } from '../../domain/liveNow'
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

/* the Google account, scripted per test — what MEW pushes is listed back on
   the next pull with its mewBlockId marker, as the real calendar behaves */
const account = {
  events: [] as RemoteEvent[],
  pushed: new Map<string, RemoteEvent>(),
  created: [] as { calId: string; body: PushEventBody; eventId: string }[],
  reset() {
    this.events = []
    this.pushed.clear()
    this.created = []
  },
}
vi.mock('../../adapters/calendar/google', () => ({
  googleAccount: () => ({
    authorize: async () => {},
    listCalendars: async () => [],
    listEvents: async () => [...account.events, ...account.pushed.values()],
    createEvent: async (calId: string, body: PushEventBody) => {
      const eventId = `g-${account.created.length + 1}`
      account.created.push({ calId, body, eventId })
      account.pushed.set(eventId, { eventId, calId, ...body })
      return eventId
    },
    updateEvent: async () => {},
    deleteEvent: async () => {},
  }),
}))

import { useMew } from '../store'

/* ── harness: the owner's Monday ─────────────────────────────────── */

const pristine = useMew.getState()
const MON = '2026-09-21'
const WED = '2026-09-23'
const AT = (h: number, m = 0) => new Date(2026, 8, 21, h, m) // Monday, Sep 21
const CAL = 'work@acme'
const FULL_DAY = 23 * 60 + 59

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'RC work',
    tag: 'work',
    dayKey: MON,
    startMin: 13 * 60,
    endMin: 16 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/** The Civic Holiday exactly as a pre-#27 pull stored it. */
const storedHoliday = (over: Partial<Block> = {}): Block =>
  block({
    id: 'civic',
    title: 'Civic Holiday',
    startMin: 0,
    endMin: FULL_DAY,
    protected: false,
    calendarRefs: [CAL],
    external: { calId: CAL, eventId: 'civic-ev' },
    ...over,
  })

const lunch = () =>
  block({ id: 'lunch', title: 'Lunch', tag: 'rest', startMin: 12 * 60, endMin: 13 * 60 })
const rc = () => block({ id: 'rc' })

async function fresh(blocks: Block[], start = AT(10, 26)) {
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
    /* every tag routes out in detail — so only the all-day rule can keep a label home */
    matrix: { [CAL]: { work: 'details', private: 'details', health: 'details' } },
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

const blocks = () => useMew.getState().blocks
const chat = () => useMew.getState().chat
const byId = (id: string) => blocks().find((b) => b.id === id)
const mentionsHoliday = () => chat().filter((m) => /civic holiday/i.test(m.body))
const pushedTitles = () => account.created.map((c) => c.body.title)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/* ── scenarios ────────────────────────────────────────────────────── */

describe('the load heal — an existing install stops minting a 24-hour Monday', () => {
  it('a stored external 0:00–23:59 block heals to an all-day label on load, persisted, no sync', async () => {
    await fresh([storedHoliday(), lunch(), rc()])
    expect(byId('civic')).toMatchObject({
      allDay: true,
      startMin: 0,
      endMin: 0,
      tag: 'private',
      external: { calId: CAL, eventId: 'civic-ev' },
    })
    expect(fakeDb.blocks.get('civic')).toMatchObject({ allDay: true, endMin: 0 })
    expect(account.created).toEqual([]) // nothing ran against the calendar
  })

  it('the healed label is never the countdown: at 14:26 the centre is RC work', async () => {
    await fresh([storedHoliday(), lunch(), rc()], AT(14, 26))
    const live = liveNow(blocks(), MON, 14 * 60 + 26)
    expect(live.current?.id).toBe('rc')
    expect(live.headline).toBe('Finish RC work.')
  })

  it('the boot tick never asks to keep the civic holiday over lunch', async () => {
    await fresh([storedHoliday(), lunch(), rc()])
    expect(mentionsHoliday()).toEqual([])
  })

  it('control: a block the calendar itself called timed is not healed — and the old nudge speaks', async () => {
    await fresh([storedHoliday({ allDay: false }), lunch(), rc()])
    expect(byId('civic')).toMatchObject({ allDay: false, endMin: FULL_DAY })
    expect(mentionsHoliday().map((m) => m.body)).toEqual([
      'Civic Holiday is set to run over your lunch — keep it?',
    ])
  })
})

describe('sync after the heal — no rescue, nothing pushed', () => {
  it('re-pulling the holiday as all-day changes nothing and offers nothing', async () => {
    await fresh([storedHoliday(), lunch(), rc()])
    account.events = [
      {
        eventId: 'civic-ev',
        calId: CAL,
        title: 'Civic Holiday',
        dayKey: MON,
        startMin: 0,
        endMin: 0,
        allDay: true,
      },
    ]
    await useMew.getState().syncNow()
    expect(byId('civic')).toMatchObject({ allDay: true, endMin: 0 })
    expect(chat().filter((m) => (m.choices?.length ?? 0) > 0)).toEqual([])
    expect(pushedTitles()).toContain('RC work') // the week does flow out…
    expect(pushedTitles()).not.toContain('Civic Holiday') // …the label never does
  })

  it('a first-time date-only holiday and a Mon–Wed OOO land as labels with no rescue line', async () => {
    await fresh([lunch(), rc()])
    account.events = [
      {
        eventId: 'h',
        calId: CAL,
        title: 'Civic Holiday',
        dayKey: MON,
        startMin: 0,
        endMin: 0,
        allDay: true,
      },
      {
        eventId: 'o',
        calId: CAL,
        title: 'OOO',
        dayKey: MON,
        startMin: 0,
        endMin: 0,
        allDay: true,
        endDayKey: WED,
      },
    ]
    await useMew.getState().syncNow()
    const labels = blocks().filter((b) => b.allDay)
    expect(labels.map((b) => [b.title, b.endDayKey])).toEqual([
      ['Civic Holiday', undefined],
      ['OOO', WED],
    ])
    expect(chat().some((m) => /landed on/.test(m.body))).toBe(false)
    expect(pushedTitles()).toContain('RC work')
    expect(pushedTitles()).not.toContain('Civic Holiday')
    expect(pushedTitles()).not.toContain('OOO')
  })

  it('control: the same event in the old clamped shape lands on RC work', async () => {
    await fresh([lunch(), rc()])
    account.events = [
      {
        eventId: 'h',
        calId: CAL,
        title: 'Civic Holiday',
        dayKey: MON,
        startMin: 0,
        endMin: FULL_DAY,
      },
    ]
    await useMew.getState().syncNow()
    expect(chat().some((m) => /Civic Holiday at 0:00 landed on RC work/.test(m.body))).toBe(true)
  })
})

describe('never pushed — not even orphaned', () => {
  it('a legacy holiday whose calendar is gone heals BEFORE adoption and stays off every calendar', async () => {
    const orphan = storedHoliday({ external: { calId: 'gone@acme', eventId: 'civic-ev' } })
    await fresh([orphan, rc()])
    expect(byId('civic')).toMatchObject({ allDay: true })
    expect(byId('civic')?.external).toBeUndefined() // adopted as MEW's own…
    await useMew.getState().syncNow()
    expect(pushedTitles()).toContain('RC work')
    expect(pushedTitles()).not.toContain('Civic Holiday') // …and still never pushed
  })
})

describe('the other doors: the dev seam and ICS import', () => {
  it('simulatePull lands all-day entries as labels and posts no rescue', async () => {
    await fresh([rc()])
    useMew.getState().simulatePull([
      { eventId: 'h', title: 'Civic Holiday', startMin: 0, endMin: FULL_DAY, allDay: true },
      { eventId: 'o', title: 'OOO', startMin: 0, endMin: 0, allDay: true, endDayKey: WED },
    ])
    expect(
      blocks()
        .filter((b) => b.allDay)
        .map((b) => [b.title, b.startMin, b.endMin, b.endDayKey])
    ).toEqual([
      ['Civic Holiday', 0, 0, undefined],
      ['OOO', 0, 0, WED],
    ])
    expect(chat().some((m) => /landed on/.test(m.body))).toBe(false)
  })

  it('ICS import counts all-day entries as labels, never as skipped', async () => {
    await fresh([])
    const ics = [
      'BEGIN:VCALENDAR',
      'X-WR-CALNAME:Holidays',
      'BEGIN:VEVENT',
      'UID:civic@x',
      'DTSTART;VALUE=DATE:20260921',
      'DTEND;VALUE=DATE:20260922',
      'SUMMARY:Civic Holiday',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:yearly@x',
      'DTSTART:20260922T140000Z',
      'DTEND:20260922T150000Z',
      'RRULE:FREQ=YEARLY',
      'SUMMARY:Anniversary',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    useMew.getState().importIcs('holidays.ics', ics)
    expect(blocks().find((b) => b.title === 'Civic Holiday')).toMatchObject({
      allDay: true,
      dayKey: MON,
    })
    const line = chat().at(-1)!.body
    expect(line).toContain('1 event in this window landed in the week')
    expect(line).toContain('1 all-day (a label on the day — no time held)')
    expect(line).toContain('(skipped 1 monthly/yearly-recurring')
    expect(line).not.toMatch(/skipped \d+ all-day/)
  })
})
