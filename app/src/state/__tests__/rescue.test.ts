/* Rescue my afternoon (#286), through the REAL store: a scripted calendar
   listing rides runSync's actual pull → merge → rescue-offer path, the chips
   land in chat, a tap re-plans through the keyless rules floor, and the next
   run pushes the change back out through the ledger. Adapters are faked at
   their seams (in-memory storage, a scriptable Google account); no network,
   no keys, no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, Settings } from '../../domain/types'
import { addDaysKey, dayKey } from '../../domain/time'
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
const deck = () => blocks().find((b) => b.title.startsWith('Deck polish') && !b.external)!
const meeting = () => blocks().find((b) => b.external)!

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/* ── scenarios ────────────────────────────────────────────────────── */

describe('an inbound meeting lands on planned work (#286)', () => {
  it('one pull → exactly ONE rescue message, with the copy and ≥2 viable chips', async () => {
    await fresh([block({ id: 'deck' })])
    account.events = [remote({})]
    await useMew.getState().syncNow()

    const offers = chipMsgs()
    expect(offers).toHaveLength(1)
    expect(offers[0].role).toBe('mew')
    expect(offers[0].body).toBe(
      'heads up — Design sync at 9:30 landed on Deck polish. want me to make room?'
    )
    const chips = offers[0].choices!
    expect(chips.length).toBeGreaterThanOrEqual(2)
    expect(chips.map((c) => c.id)).toEqual(['shift', 'split', 'roll'])
    expect(chips[0].label).toBe('shift to 10:15')
    expect(chips[2].label).toBe('roll to tomorrow')
    /* the arrival line still posts, ahead of the offer */
    expect(chat().some((m) => /1 event arrived/.test(m.body))).toBe(true)
    /* the meeting landed in the week as an external block */
    expect(meeting()).toMatchObject({ startMin: 570, endMin: 615 })
  })

  it('a pull landing two meetings produces two offers, each with its own chips', async () => {
    await fresh([
      block({ id: 'deck' }),
      block({ id: 'spec', title: 'Spec review', startMin: 780, endMin: 900 }),
    ])
    account.events = [
      remote({}),
      remote({ eventId: 'ev2', title: 'Standup', startMin: 800, endMin: 830 }),
    ]
    await useMew.getState().syncNow()
    const offers = chipMsgs()
    expect(offers).toHaveLength(2)
    expect(offers[0].body).toContain('landed on Deck polish')
    expect(offers[1].body).toContain('landed on Spec review')
  })

  it('the same conflict never re-nudges: an unchanged re-pull is silent, and a title-only update hits the lastFired key', async () => {
    await fresh([block({ id: 'deck' })])
    account.events = [remote({})]
    await useMew.getState().syncNow()
    expect(chipMsgs()).toHaveLength(1)

    /* the 5-minute cycle: same listing, nothing changed */
    vi.setSystemTime(TUE(8, 5))
    useMew.setState({ nowMs: TUE(8, 5).getTime(), lastSyncAt: 0 })
    await useMew.getState().syncNow()
    expect(chipMsgs()).toHaveLength(1)

    /* the event is touched but its span didn't move — same landing, same key */
    account.events = [remote({ title: 'Design sync — room B' })]
    vi.setSystemTime(TUE(8, 10))
    useMew.setState({ nowMs: TUE(8, 10).getTime(), lastSyncAt: 0 })
    await useMew.getState().syncNow()
    expect(chipMsgs()).toHaveLength(1)
  })

  it('the meeting moving again is a fresh key and correctly re-fires', async () => {
    await fresh([block({ id: 'deck' })])
    account.events = [remote({})]
    await useMew.getState().syncNow()
    expect(chipMsgs()).toHaveLength(1)

    account.events = [remote({ startMin: 600, endMin: 645 })]
    vi.setSystemTime(TUE(8, 5))
    useMew.setState({ nowMs: TUE(8, 5).getTime(), lastSyncAt: 0 })
    await useMew.getState().syncNow()
    const offers = chipMsgs()
    expect(offers).toHaveLength(2)
    expect(offers[1].body).toContain('at 10:00 landed on Deck polish')
  })

  it('keyless one-tap: the shift chip re-plans through the rules floor, the meeting never moves, and the next run syncs the change OUT', async () => {
    await fresh([block({ id: 'deck' })])
    account.events = [remote({})]
    await useMew.getState().syncNow()

    /* first run pushed MEW's own block out (create) — never the external */
    expect(account.created.map((c) => c.body.title)).toEqual(['Deck polish'])
    const pushedId = account.created[0].eventId

    const offer = chipMsgs()[0]
    await useMew.getState().pickChoice(offer.id, 'shift')

    /* the pick is an ordinary user turn; the executor moved OUR block */
    expect(
      chat().some((m) => m.role === 'user' && m.body === 'move the Deck polish to today at 10:15')
    ).toBe(true)
    expect(deck()).toMatchObject({ dayKey: TODAY, startMin: 615, endMin: 735 })
    expect(meeting()).toMatchObject({ startMin: 570, endMin: 615 }) // a fixed fact
    expect(
      chat().some(
        (m) => m.role === 'mew' && /^Moved — Deck polish now lives today at 10:15/.test(m.body)
      )
    ).toBe(true)
    /* the chip is spent — rehydrates inert */
    expect(chipMsgs()[0].choices!.find((c) => c.id === 'shift')!.picked).toBe(true)

    /* next run: the ledger sees the new hash and updates the calendar copy */
    vi.setSystemTime(TUE(8, 6))
    useMew.setState({ nowMs: TUE(8, 6).getTime(), lastSyncAt: 0 })
    await useMew.getState().syncNow()
    expect(account.updated).toHaveLength(1)
    expect(account.updated[0]).toMatchObject({
      eventId: pushedId,
      body: { startMin: 615, endMin: 735 },
    })
    /* and the settled week re-nudges nothing */
    expect(chipMsgs()).toHaveLength(1)
  })

  it('keyless one-tap: the split chip shrinks the block and places the kept tail — two existing tools, no new mutation path', async () => {
    await fresh([block({ id: 'deck' })])
    account.events = [remote({})]
    await useMew.getState().syncNow()

    const offer = chipMsgs()[0]
    expect(offer.choices!.find((c) => c.id === 'split')!.reply).toBe(
      'split the Deck polish around 9:30-10:15, keep 45m after'
    )
    await useMew.getState().pickChoice(offer.id, 'split')

    expect(deck()).toMatchObject({ startMin: 540, endMin: 570 }) // shrunk to the meeting's edge
    const tail = blocks().find((b) => b.title === 'Deck polish (part 2)')!
    expect(tail).toMatchObject({
      tag: 'work',
      dayKey: TODAY,
      startMin: 615,
      endMin: 660,
      status: 'open',
    })
    expect(meeting()).toMatchObject({ startMin: 570, endMin: 615 }) // untouched, always
  })

  it('keyless one-tap: the roll chip lands the block on tomorrow', async () => {
    await fresh([block({ id: 'deck' })])
    account.events = [remote({})]
    await useMew.getState().syncNow()

    await useMew.getState().pickChoice(chipMsgs()[0].id, 'roll')
    expect(deck().dayKey).toBe(addDaysKey(TODAY, 1))
    expect(meeting()).toMatchObject({ dayKey: TODAY, startMin: 570 })
  })

  it('a meeting landing on clear air (or another meeting) offers nothing', async () => {
    await fresh([block({ id: 'deck', startMin: 840, endMin: 900 })])
    account.events = [
      remote({}),
      remote({ eventId: 'ev2', title: 'Interview', startMin: 580, endMin: 610 }),
    ]
    await useMew.getState().syncNow()
    expect(chipMsgs()).toHaveLength(0)
  })

  it('a landing beyond the day words gets ONE prose heads-up — no chips faked, never repeated', async () => {
    const far = '2026-06-16' // 7 days out — past the floor's weekday words
    await fresh([block({ id: 'deck', dayKey: far })])
    account.events = [remote({ dayKey: far })]
    await useMew.getState().syncNow()

    const offers = chat().filter((m) => m.body.startsWith('heads up — '))
    expect(offers).toHaveLength(1)
    expect(offers[0].body).toBe(
      'heads up — Design sync at 9:30 on Jun 16 landed on Deck polish. want me to make room?'
    )
    expect(offers[0].choices).toBeUndefined() // nothing tappable is faked
    expect(chipMsgs()).toHaveLength(0)

    /* unchanged re-pull: silent (delta gate) */
    vi.setSystemTime(TUE(8, 5))
    useMew.setState({ nowMs: TUE(8, 5).getTime(), lastSyncAt: 0 })
    await useMew.getState().syncNow()
    /* a touched-but-unmoved event: the burned key holds — the user learned of
       this landing exactly once */
    account.events = [remote({ dayKey: far, title: 'Design sync — room B' })]
    vi.setSystemTime(TUE(8, 10))
    useMew.setState({ nowMs: TUE(8, 10).getTime(), lastSyncAt: 0 })
    await useMew.getState().syncNow()
    expect(chat().filter((m) => m.body.startsWith('heads up — '))).toHaveLength(1)
  })

  it("execEdit's miss copy is the contract runSplit's stray-tail guard reads — pinned at the producer", async () => {
    await fresh([block({ id: 'deck' })])
    /* the real floor, the real executor: a split ask naming no real block must
       stop at the shrink — runSplit's guard reads execEdit's miss prefix
       ("I couldn't find"), so this pins the copy where it is PRODUCED. If the
       wording ever changes, update rules.ts runSplit in the same commit. */
    await useMew.getState().speak('split the flurble around 13:00-13:45, keep 45m after')
    const reply = chat()
      .filter((m) => m.role === 'mew')
      .at(-1)!
    expect(reply.body.startsWith(`I couldn't find "flurble" to change`)).toBe(true)
    /* and no stray tail was placed — a failed shrink must never double time */
    expect(blocks().some((b) => b.title.includes('(part 2)'))).toBe(false)
  })

  it('the dev seam drives the same loop without a network — the RC verification paste', async () => {
    await fresh([block({ id: 'deck' })])
    useMew
      .getState()
      .simulatePull([{ eventId: 'sim1', title: 'Product sync', startMin: 570, endMin: 615 }])
    const offers = chipMsgs()
    expect(offers).toHaveLength(1)
    expect(offers[0].body).toContain('Product sync at 9:30 landed on Deck polish')
    /* same listing again — the seam dedupes exactly like the real pull */
    useMew
      .getState()
      .simulatePull([{ eventId: 'sim1', title: 'Product sync', startMin: 570, endMin: 615 }])
    expect(chipMsgs()).toHaveLength(1)
    /* one tap completes the loop keylessly */
    await useMew.getState().pickChoice(offers[0].id, 'shift')
    expect(deck().startMin).toBe(615)
  })
})

/* ── #302 back-to-back observation ───────────────────────────────────
   When the buffer is on and a pull lands external meetings ≤ bufferMin apart,
   ONE positive line per day rides the arrival message's observation slot —
   never a separate message, deduped per day so a re-pull can't repeat it. The
   meetings sit on a clear afternoon (no planned work), so no rescue fires and
   the arrival + observation stand alone. */
describe('a pull landing back-to-back meetings observes it once (#302)', () => {
  const withBuffer = (min: number) =>
    useMew.setState({ settings: { ...useMew.getState().settings, meetingBufferMin: min } })
  const arrival = () => chat().find((m) => /arrived from your calendar/.test(m.body))
  const observed = () => chat().filter((m) => m.observation && /back-to-back/.test(m.observation))
  const backToBackPair = () => {
    account.events = [
      remote({ eventId: 'm1', title: 'Sync A', startMin: 13 * 60, endMin: 14 * 60 }),
      remote({ eventId: 'm2', title: 'Sync B', startMin: 14 * 60, endMin: 15 * 60 }),
    ]
  }

  it('appends exactly ONE observation line to the arrival message', async () => {
    await fresh([block({ id: 'deck' })]) // morning work only; the afternoon is clear
    withBuffer(10)
    backToBackPair()
    await useMew.getState().syncNow()

    expect(chipMsgs()).toHaveLength(0) // free afternoon → no rescue, just the arrival
    expect(arrival()?.observation).toBe(
      'two meetings back-to-back at 14:00 — i kept your 10 min after free'
    )
  })

  it('buffer off (0) never observes, even when meetings land back-to-back', async () => {
    await fresh([block({ id: 'deck' })])
    withBuffer(0)
    backToBackPair()
    await useMew.getState().syncNow()
    expect(arrival()?.observation).toBeUndefined()
  })

  it('a later pull adding another tight meeting the same day does NOT re-observe', async () => {
    await fresh([block({ id: 'deck' })])
    withBuffer(10)
    backToBackPair()
    await useMew.getState().syncNow()
    expect(observed()).toHaveLength(1)

    /* a THIRD meeting lands the same day, also back-to-back — the day's key is
       already burned, so the second arrival carries no observation */
    account.events = [
      ...account.events,
      remote({ eventId: 'm3', title: 'Sync C', startMin: 15 * 60, endMin: 16 * 60 }),
    ]
    vi.setSystemTime(TUE(8, 5))
    useMew.setState({ nowMs: TUE(8, 5).getTime(), lastSyncAt: 0 })
    await useMew.getState().syncNow()
    expect(observed()).toHaveLength(1) // still exactly one, per-day dedup held
  })
})

/* ── #302 execMove honors the buffer on the auto-slot branch only ─────
   The reviewer's 🟡: an auto-slotted move (no time given) must land shy of a
   meeting like plan/findSlot/suggestSlots, while an explicit time still lands
   exactly where asked (explicit intent wins). The day leaves exactly a 70-min
   gap after an external meeting, sized so a 60-min task fits at 10:00 (abutting)
   with no buffer and only at 10:10 with a 10-min one. */
describe('execMove: auto-slots shy of a buffered meeting, explicit time lands exact (#302)', () => {
  const TOMORROW = addDaysKey(TODAY, 1)
  const dayFixture = (): Block[] => [
    block({ id: 'am', title: 'Morning hold', startMin: 8 * 60, endMin: 9 * 60 }),
    block({
      id: 'mtg',
      title: 'Client sync',
      startMin: 9 * 60,
      endMin: 10 * 60,
      external: { calId: CAL, eventId: 'seed-mtg' },
    }),
    block({ id: 'pm', title: 'Afternoon hold', startMin: 11 * 60 + 10, endMin: 18 * 60 + 30 }),
    block({ id: 'rep', title: 'Report', dayKey: TOMORROW, startMin: 9 * 60, endMin: 10 * 60 }),
  ]
  const withBuffer = (min: number) =>
    useMew.setState({ settings: { ...useMew.getState().settings, meetingBufferMin: min } })
  const report = () => blocks().find((b) => b.title === 'Report')!

  it('buffer 10: an auto-slotted move (no time) lands shy of the meeting edge — 10:10', async () => {
    await fresh(dayFixture())
    withBuffer(10)
    await useMew.getState().speak('move report to today')
    expect(report().dayKey).toBe(TODAY)
    expect(report().startMin).toBe(10 * 60 + 10) // 10 min past the meeting's 10:00 end
  })

  it('buffer 0 (off): the same move abuts the meeting edge — 10:00, byte-identical to before', async () => {
    await fresh(dayFixture())
    withBuffer(0)
    await useMew.getState().speak('move report to today')
    expect(report().startMin).toBe(10 * 60) // the day's only fit, exactly at the meeting's end
  })

  it('an explicit-time move ignores the buffer — lands exactly at 10:00 with the buffer on', async () => {
    await fresh(dayFixture())
    withBuffer(10)
    await useMew.getState().speak('move report to today at 10:00')
    expect(report().dayKey).toBe(TODAY)
    expect(report().startMin).toBe(10 * 60) // explicit intent wins; the buffer never touches it
  })
})
