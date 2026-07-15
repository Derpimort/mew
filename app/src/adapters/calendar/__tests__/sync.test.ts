import { describe, expect, it } from 'vitest'
import {
  adoptOrphanedExternals,
  adoptRemoteLedger,
  mergePull,
  planPush,
  runSync,
  staleSyncEntries,
  syncWindow,
} from '../sync'
import type { CalendarAccount, PushEventBody, RemoteEvent, SyncEntry } from '../types'
import type { Block, ConnectedCalendar, RoutingMatrix } from '../../../domain/types'

const W = { startKey: '2026-06-08', endKey: '2026-06-29' } // Mon + 21d
const CAL: ConnectedCalendar = {
  id: 'work@acme',
  name: 'Google · Work',
  who: 'live · two-way',
  provider: 'google',
  kind: 'live',
  defaultTag: 'work',
}

function mk(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Q3 deck',
    tag: 'work',
    dayKey: '2026-06-09',
    startMin: 540,
    endMin: 690,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

function remote(over: Partial<RemoteEvent>): RemoteEvent {
  return {
    eventId: over.eventId ?? 'ev1',
    calId: 'work@acme',
    title: 'Design review',
    dayKey: '2026-06-10',
    startMin: 600,
    endMin: 660,
    ...over,
  }
}

describe('mergePull — inbound events', () => {
  it('new remote events become external blocks tagged by the calendar default', () => {
    const r = mergePull([], [remote({})], [CAL], W)
    expect(r.added).toBe(1)
    expect(r.blocks[0]).toMatchObject({
      title: 'Design review',
      tag: 'work',
      protected: false,
      external: { calId: 'work@acme', eventId: 'ev1' },
    })
  })

  it("never pulls MEW's own pushed events back in (loop prevention)", () => {
    const r = mergePull([], [remote({ mewBlockId: 'b1' })], [CAL], W)
    expect(r.added).toBe(0)
    expect(r.blocks).toHaveLength(0)
  })

  it('updates an existing external block when the remote event moved, keeping completion state', () => {
    const existing = mk({
      id: 'x1',
      title: 'Design review',
      dayKey: '2026-06-10',
      startMin: 600,
      endMin: 660,
      status: 'done',
      external: { calId: 'work@acme', eventId: 'ev1' },
    })
    const r = mergePull([existing], [remote({ startMin: 720, endMin: 780 })], [CAL], W)
    expect(r.updated).toBe(1)
    expect(r.blocks[0]).toMatchObject({ id: 'x1', startMin: 720, status: 'done' })
  })

  it('removes external blocks whose events vanished from the window', () => {
    const existing = mk({
      id: 'x1',
      dayKey: '2026-06-10',
      external: { calId: 'work@acme', eventId: 'gone' },
    })
    const r = mergePull([existing], [], [CAL], W)
    expect(r.removed).toBe(1)
    expect(r.blocks).toHaveLength(0)
  })

  it('a dismissed event is neither re-added nor kept — the user took it over', () => {
    const dismissed = new Set(['work@acme:ev1'])
    // a tombstoned incoming event is not re-added
    const r1 = mergePull([], [remote({})], [CAL], W, dismissed)
    expect(r1.added).toBe(0)
    expect(r1.blocks).toHaveLength(0)
    // and any lingering local copy of it is cleared
    const existing = mk({
      id: 'x1',
      dayKey: '2026-06-10',
      external: { calId: 'work@acme', eventId: 'ev1' },
    })
    const r2 = mergePull([existing], [remote({})], [CAL], W, dismissed)
    expect(r2.blocks.find((b) => b.id === 'x1')).toBeUndefined()
  })

  it('leaves MEW-native blocks completely alone', () => {
    const native = mk({ id: 'n1' })
    const r = mergePull([native], [], [CAL], W)
    expect(r.blocks).toEqual([native])
  })
})

/* The trap this heals (found live, 2026-07-15): imported blocks whose source
   calendar was removed without the disconnect cleanup kept a dangling
   `external` — the Settings preview projected them ("the calendar sees X with
   details") while planPush skipped them forever. Ownership follows the source:
   source gone ⇒ MEW adopts the block and the next sync pushes it. */
describe('adoptOrphanedExternals — dangling imports become MEW-native again', () => {
  it('strips external (and stale refs) when the source calendar is gone', () => {
    const orphan = mk({
      id: 'b1',
      title: 'dev work — PROD push',
      external: { calId: 'ics-import-gone', eventId: 'ev9' },
      calendarRefs: ['ics-import-gone'],
    })
    const { blocks, adopted } = adoptOrphanedExternals([orphan], [CAL])
    expect(adopted).toBe(1)
    expect(blocks[0].external).toBeUndefined()
    expect(blocks[0].calendarRefs).toEqual([])
    expect(blocks[0].title).toBe('dev work — PROD push') // everything else intact
  })

  it('leaves blocks from a still-connected calendar external — never re-pushed', () => {
    const pulled = mk({
      id: 'b2',
      external: { calId: CAL.id, eventId: 'ev1' },
      calendarRefs: [CAL.id],
    })
    const { blocks, adopted } = adoptOrphanedExternals([pulled], [CAL])
    expect(adopted).toBe(0)
    expect(blocks[0].external).toEqual({ calId: CAL.id, eventId: 'ev1' })
  })

  it('no orphans ⇒ the same array back (no phantom persistence churn)', () => {
    const native = [mk({ id: 'b3' })]
    const { blocks, adopted } = adoptOrphanedExternals(native, [CAL])
    expect(adopted).toBe(0)
    expect(blocks).toBe(native)
  })

  it('an adopted block reaches the push plan it was invisibly excluded from', () => {
    const matrix: RoutingMatrix = { [CAL.id]: { work: 'details', private: 'busy', health: 'busy' } }
    const orphan = mk({
      id: 'b4',
      title: 'team blockers',
      dayKey: '2026-06-09',
      external: { calId: 'gone', eventId: 'x' },
    })
    const before = planPush([orphan], matrix, [CAL], W, [])
    expect(before.ops).toHaveLength(0) // the live bug: projected in preview, never pushed
    const { blocks } = adoptOrphanedExternals([orphan], [CAL])
    const after = planPush(blocks, matrix, [CAL], W, [])
    expect(after.ops).toEqual([
      expect.objectContaining({ kind: 'create', blockId: 'b4', calId: CAL.id }),
    ])
    expect((after.ops[0] as { body: PushEventBody }).body.title).toBe('team blockers')
  })
})

describe('planPush — outbound diff per routing matrix (acceptance #6)', () => {
  const matrix: RoutingMatrix = {
    'work@acme': { work: 'details', private: 'busy', health: 'hidden' },
  }

  it('creates details for work, "Busy" for private, nothing for hidden health', () => {
    const blocks = [
      mk({ id: 'w1', tag: 'work', title: 'Q3 deck' }),
      mk({ id: 'p1', tag: 'private', title: 'Walk', startMin: 960, endMin: 1020 }),
      mk({ id: 'h1', tag: 'health', title: 'Dentist', startMin: 720, endMin: 780 }),
    ]
    const { ops } = planPush(blocks, matrix, [CAL], W, [])
    expect(ops).toHaveLength(2)
    const w = ops.find((o) => o.blockId === 'w1')
    const p = ops.find((o) => o.blockId === 'p1')
    expect(w).toMatchObject({ kind: 'create', body: { title: 'Q3 deck' } })
    expect(p).toMatchObject({ kind: 'create', body: { title: 'Busy' } }) // the walk is yours
    expect(ops.find((o) => o.blockId === 'h1')).toBeUndefined()
  })

  it('is idempotent: an up-to-date sync map plans nothing', () => {
    const blocks = [mk({ id: 'w1' })]
    const map: SyncEntry[] = [
      {
        id: 'w1:work@acme',
        blockId: 'w1',
        calId: 'work@acme',
        eventId: 'g1',
        hash: 'Q3 deck|2026-06-09|540|690',
      },
    ]
    expect(planPush(blocks, matrix, [CAL], W, map).ops).toHaveLength(0)
  })

  it('updates when the block moved, deletes when visibility flips to hidden', () => {
    const blocks = [mk({ id: 'w1', startMin: 600, endMin: 750 })]
    const map: SyncEntry[] = [
      {
        id: 'w1:work@acme',
        blockId: 'w1',
        calId: 'work@acme',
        eventId: 'g1',
        hash: 'Q3 deck|2026-06-09|540|690',
      },
    ]
    const moved = planPush(blocks, matrix, [CAL], W, map)
    expect(moved.ops[0]).toMatchObject({ kind: 'update', eventId: 'g1' })

    const hiddenMatrix: RoutingMatrix = {
      'work@acme': { work: 'hidden', private: 'hidden', health: 'hidden' },
    }
    const hidden = planPush(blocks, hiddenMatrix, [CAL], W, map)
    expect(hidden.ops[0]).toMatchObject({ kind: 'delete', eventId: 'g1' })
  })

  it('never pushes external blocks back out, and skips read-only calendars', () => {
    const ext = mk({ id: 'x1', external: { calId: 'other', eventId: 'e9' } })
    expect(planPush([ext], matrix, [CAL], W, []).ops).toHaveLength(0)
    const ro = { ...CAL, readOnly: true }
    expect(planPush([mk({ id: 'w1' })], matrix, [ro], W, []).ops).toHaveLength(0)
  })

  it('rolled originals project nowhere — their event is deleted, the new block created', () => {
    const rolled = mk({ id: 'old', status: 'rolled', rolledToId: 'new' })
    const fresh = mk({ id: 'new', dayKey: '2026-06-10' })
    const map: SyncEntry[] = [
      {
        id: 'old:work@acme',
        blockId: 'old',
        calId: 'work@acme',
        eventId: 'g1',
        hash: 'Q3 deck|2026-06-09|540|690',
      },
    ]
    const { ops } = planPush([rolled, fresh], matrix, [CAL], W, map)
    expect(ops.map((o) => o.kind).sort()).toEqual(['create', 'delete'])
  })
})

describe('runSync — end to end against a fake account', () => {
  it('pulls, merges, pushes, and maintains the ledger', async () => {
    const remoteEvents: RemoteEvent[] = [remote({ eventId: 'inbound1', title: 'Standup' })]
    const created: PushEventBody[] = []
    const deleted: string[] = []
    const account: CalendarAccount = {
      async authorize() {},
      async listCalendars() {
        return []
      },
      async listEvents() {
        return remoteEvents
      },
      async createEvent(_cal, body) {
        created.push(body)
        return `g-${body.mewBlockId}`
      },
      async updateEvent() {},
      async deleteEvent(_cal, id) {
        deleted.push(id)
      },
    }

    let blocks: Block[] = [mk({ id: 'w1', dayKey: '2026-06-09' })]
    let map: SyncEntry[] = [
      { id: 'gone:work@acme', blockId: 'gone', calId: 'work@acme', eventId: 'stale', hash: 'x' },
    ]
    const report = await runSync({
      account,
      calendars: [CAL],
      matrix: { 'work@acme': { work: 'details', private: 'busy', health: 'busy' } },
      now: new Date(2026, 5, 9, 12, 0),
      getBlocks: () => blocks,
      setBlocks: (b) => {
        blocks = b
      },
      loadSyncMap: async () => map,
      saveSyncMap: async (put, removeIds) => {
        // bulkPut is an UPSERT (same-id rows replaced), then the removals
        const putIds = new Set(put.map((x) => x.id))
        map = map.filter((e) => !putIds.has(e.id) && !removeIds.includes(e.id)).concat(put)
      },
    })

    expect(report.pulled.added).toBe(1) // Standup arrived
    expect(blocks.some((b) => b.external?.eventId === 'inbound1')).toBe(true)
    expect(created).toHaveLength(1) // w1 pushed as details
    expect(created[0].title).toBe('Q3 deck')
    expect(deleted).toEqual(['stale']) // orphaned ledger entry cleaned up remotely
    expect(map.find((e) => e.blockId === 'w1')?.eventId).toBe('g-w1')
    expect(map.find((e) => e.blockId === 'gone')).toBeUndefined()
  })

  it('syncWindow spans Monday through +21 days', () => {
    const w = syncWindow(new Date(2026, 5, 9)) // Tue Jun 9
    expect(w).toEqual({ startKey: '2026-06-08', endKey: '2026-06-29' })
  })

  /* the second silent killer found live (2026-07-15): the user deleted MEW's
     pushed event ON THE CALENDAR. The ledger still said "pushed, hash equal",
     so planPush planned nothing — the block never returned, no error ever. */
  it('re-creates a block whose pushed event the user deleted on the calendar', async () => {
    const b = mk({ id: 'w1', title: 'dev work', dayKey: '2026-06-09' })
    const body: PushEventBody = {
      title: 'dev work',
      dayKey: b.dayKey,
      startMin: b.startMin,
      endMin: b.endMin,
      mewBlockId: 'w1',
    }
    const created: PushEventBody[] = []
    const account: CalendarAccount = {
      async authorize() {},
      async listCalendars() {
        return []
      },
      async listEvents() {
        return [] // the pushed event is GONE remotely — user deleted it
      },
      async createEvent(_cal, bd) {
        created.push(bd)
        return 'g-fresh'
      },
      async updateEvent() {
        throw new Error('must not PATCH a dead event')
      },
      async deleteEvent() {},
    }
    let map: SyncEntry[] = [
      {
        id: 'w1:work@acme',
        blockId: 'w1',
        calId: 'work@acme',
        eventId: 'ev-dead',
        // the CURRENT hash — the exact state where the old plan trusted the ghost
        hash: `${body.title}|${body.dayKey}|${body.startMin}|${body.endMin}`,
      },
    ]
    const report = await runSync({
      account,
      calendars: [CAL],
      matrix: { 'work@acme': { work: 'details', private: 'busy', health: 'busy' } },
      now: new Date(2026, 5, 9, 12, 0),
      getBlocks: () => [b],
      setBlocks: () => {},
      loadSyncMap: async () => map,
      saveSyncMap: async (put, removeIds) => {
        // bulkPut is an UPSERT (same-id rows replaced), then the removals
        const putIds = new Set(put.map((x) => x.id))
        map = map.filter((e) => !putIds.has(e.id) && !removeIds.includes(e.id)).concat(put)
      },
    })
    expect(created.map((c) => c.title)).toEqual(['dev work']) // back on the calendar
    expect(report.pushed.created).toBe(1)
    // the ledger holds exactly the fresh entry — re-put id survives the removals
    expect(map).toEqual([expect.objectContaining({ blockId: 'w1', eventId: 'g-fresh' })])
  })

  it('an update racing a remote delete falls back to create instead of aborting the run', async () => {
    const b = mk({ id: 'w1', title: 'renamed since push', dayKey: '2026-06-09' })
    const account: CalendarAccount = {
      async authorize() {},
      async listCalendars() {
        return []
      },
      async listEvents() {
        // still listed (deleted between the listing and the PATCH below)
        return [
          {
            eventId: 'ev-racing',
            calId: 'work@acme',
            title: 'old title',
            dayKey: b.dayKey,
            startMin: b.startMin,
            endMin: b.endMin,
            mewBlockId: 'w1',
          },
        ]
      },
      async createEvent() {
        return 'g-recreated'
      },
      async updateEvent() {
        throw new Error('google 410: Resource has been deleted')
      },
      async deleteEvent() {},
    }
    let map: SyncEntry[] = [
      { id: 'w1:work@acme', blockId: 'w1', calId: 'work@acme', eventId: 'ev-racing', hash: 'old' },
    ]
    const report = await runSync({
      account,
      calendars: [CAL],
      matrix: { 'work@acme': { work: 'details', private: 'busy', health: 'busy' } },
      now: new Date(2026, 5, 9, 12, 0),
      getBlocks: () => [b],
      setBlocks: () => {},
      loadSyncMap: async () => map,
      saveSyncMap: async (put, removeIds) => {
        // bulkPut is an UPSERT (same-id rows replaced), then the removals
        const putIds = new Set(put.map((x) => x.id))
        map = map.filter((e) => !putIds.has(e.id) && !removeIds.includes(e.id)).concat(put)
      },
    })
    expect(report.pushed.created).toBe(1) // recovered, not aborted
    expect(map[0].eventId).toBe('g-recreated')
  })
})

describe('staleSyncEntries — the ledger vs the listing', () => {
  const W2 = { startKey: '2026-06-08', endKey: '2026-06-29' }
  const entry = (over: Partial<SyncEntry>): SyncEntry => ({
    id: 'b:work@acme',
    blockId: 'b',
    calId: 'work@acme',
    eventId: 'ev',
    hash: 'h',
    ...over,
  })

  it('flags an entry whose event vanished from the listing', () => {
    const b = mk({ id: 'b' })
    expect(staleSyncEntries([entry({})], [], [b], W2, [CAL])).toHaveLength(1)
  })

  it('trusts an entry whose event is still listed', () => {
    const b = mk({ id: 'b' })
    const listed = [remote({ eventId: 'ev', mewBlockId: 'b' })]
    expect(staleSyncEntries([entry({})], listed, [b], W2, [CAL])).toHaveLength(0)
  })

  it('gives no verdict for calendars that were not listed', () => {
    const b = mk({ id: 'b' })
    expect(staleSyncEntries([entry({ calId: 'other@cal' })], [], [b], W2, [CAL])).toHaveLength(0)
  })

  it('leaves gone/external/out-of-window blocks to the delete sweep', () => {
    const external = mk({ id: 'b', external: { calId: 'work@acme', eventId: 'z' } })
    const outOfWindow = mk({ id: 'b', dayKey: '2026-07-20' })
    expect(staleSyncEntries([entry({})], [], [], W2, [CAL])).toHaveLength(0) // block gone
    expect(staleSyncEntries([entry({})], [], [external], W2, [CAL])).toHaveLength(0)
    expect(staleSyncEntries([entry({})], [], [outOfWindow], W2, [CAL])).toHaveLength(0)
  })
})

/* The third healer, for the journey "same calendar, new device" (fresh
   install or restored backup): the ledger starts empty but MEW's events are
   already on the calendar, each carrying its block id. Without claiming them
   the plan would push every block AGAIN and the calendar doubles. */
describe('adoptRemoteLedger — a fresh ledger claims events that are already ours', () => {
  const mine = (over: Partial<RemoteEvent>): RemoteEvent =>
    remote({
      eventId: 'g-w1',
      title: 'Q3 deck',
      dayKey: '2026-06-09',
      startMin: 540,
      endMin: 690,
      mewBlockId: 'w1',
      ...over,
    })

  it('claims a listed event naming a native block; unchanged blocks then plan nothing', async () => {
    const b = mk({ id: 'w1' }) // exactly the remote shape — nothing to update
    const created: PushEventBody[] = []
    const account: CalendarAccount = {
      async authorize() {},
      async listCalendars() {
        return []
      },
      async listEvents() {
        return [mine({})]
      },
      async createEvent(_c, bd) {
        created.push(bd)
        return 'dup!'
      },
      async updateEvent() {},
      async deleteEvent() {},
    }
    let map: SyncEntry[] = []
    const report = await runSync({
      account,
      calendars: [CAL],
      matrix: { 'work@acme': { work: 'details', private: 'busy', health: 'busy' } },
      now: new Date(2026, 5, 9, 12, 0),
      getBlocks: () => [b],
      setBlocks: () => {},
      loadSyncMap: async () => map,
      saveSyncMap: async (put, removeIds) => {
        const putIds = new Set(put.map((x) => x.id))
        map = map.filter((e) => !putIds.has(e.id) && !removeIds.includes(e.id)).concat(put)
      },
    })
    expect(created).toHaveLength(0) // THE point: no duplicate push
    expect(report.pushed.created).toBe(0)
    expect(map).toEqual([
      expect.objectContaining({ blockId: 'w1', calId: 'work@acme', eventId: 'g-w1' }),
    ])
  })

  it('a block edited since the old device pushed converges by UPDATE, never create', () => {
    const edited = mk({ id: 'w1', title: 'Q3 deck v2' })
    const claimed = adoptRemoteLedger([], [mine({})], [edited])
    expect(claimed).toHaveLength(1)
    const { ops } = planPush(
      [edited],
      { 'work@acme': { work: 'details', private: 'busy', health: 'busy' } },
      [CAL],
      W,
      claimed
    )
    expect(ops).toEqual([
      expect.objectContaining({ kind: 'update', blockId: 'w1', eventId: 'g-w1' }),
    ])
  })

  it('never claims for external blocks, unknown block ids, or already-claimed slots', () => {
    const ext = mk({ id: 'w1', external: { calId: CAL.id, eventId: 'e' } })
    expect(adoptRemoteLedger([], [mine({})], [ext])).toHaveLength(0)
    expect(
      adoptRemoteLedger([], [mine({ mewBlockId: 'nobody' })], [mk({ id: 'w1' })])
    ).toHaveLength(0)
    const existing: SyncEntry = {
      id: 'w1:work@acme',
      blockId: 'w1',
      calId: CAL.id,
      eventId: 'old',
      hash: 'h',
    }
    expect(adoptRemoteLedger([existing], [mine({})], [mk({ id: 'w1' })])).toHaveLength(0)
  })

  it('a claim whose plan immediately deletes (tag went hidden) does not persist', async () => {
    const b = mk({ id: 'w1', tag: 'health' }) // health is hidden on this calendar
    const deleted: string[] = []
    const account: CalendarAccount = {
      async authorize() {},
      async listCalendars() {
        return []
      },
      async listEvents() {
        return [mine({})]
      },
      async createEvent() {
        return 'x'
      },
      async updateEvent() {},
      async deleteEvent(_c, id) {
        deleted.push(id)
      },
    }
    let map: SyncEntry[] = []
    await runSync({
      account,
      calendars: [CAL],
      matrix: { 'work@acme': { work: 'details', private: 'busy', health: 'hidden' } },
      now: new Date(2026, 5, 9, 12, 0),
      getBlocks: () => [b],
      setBlocks: () => {},
      loadSyncMap: async () => map,
      saveSyncMap: async (put, removeIds) => {
        const putIds = new Set(put.map((x) => x.id))
        map = map.filter((e) => !putIds.has(e.id) && !removeIds.includes(e.id)).concat(put)
      },
    })
    expect(deleted).toEqual(['g-w1']) // the hidden event left the calendar…
    expect(map).toEqual([]) // …and its claim left with it
  })
})
