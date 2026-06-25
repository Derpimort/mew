import { describe, expect, it } from 'vitest'
import { mergePull, planPush, runSync, syncWindow } from '../sync'
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
        map = map.filter((e) => !removeIds.includes(e.id)).concat(put)
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
})
