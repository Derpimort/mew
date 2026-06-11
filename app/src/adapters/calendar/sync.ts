/* Two-way sync engine. The planning functions are pure (and unit-tested);
   only runSync touches the network. Rules (PRD §4):
   — inbound events land tagged by the source calendar's default tag
   — MEW blocks flow out per the routing matrix (details / "Busy" / nothing)
   — MEW's own pushed events are never pulled back in (mewBlockId marker)
   — external blocks are never pushed back out. */

import type { Block, ConnectedCalendar, RoutingMatrix } from '../../domain/types'
import { project } from '../../domain/project'
import { addDaysKey, dayKey, mondayOf, uid } from '../../domain/time'
import type { CalendarAccount, PushEventBody, RemoteEvent, SyncEntry } from './types'

/* ── sync window: this week (Mon) through +14 days ───────────────────── */
export function syncWindow(now: Date): { startKey: string; endKey: string } {
  const startKey = dayKey(mondayOf(now))
  return { startKey, endKey: addDaysKey(startKey, 21) }
}

/* ── inbound: merge remote events into the week ──────────────────────── */
export interface PullResult {
  blocks: Block[]
  added: number
  updated: number
  removed: number
}

export function mergePull(
  blocks: Block[],
  events: RemoteEvent[],
  calendars: ConnectedCalendar[],
  window: { startKey: string; endKey: string },
): PullResult {
  const calIds = new Set(calendars.map((c) => c.id))
  const tagFor = new Map(calendars.map((c) => [c.id, c.defaultTag ?? 'work']))
  const remote = new Map<string, RemoteEvent>()
  for (const e of events) {
    if (e.mewBlockId) continue // ours — already in the week as the source block
    remote.set(`${e.calId}:${e.eventId}`, e)
  }

  let added = 0
  let updated = 0
  let removed = 0
  const out: Block[] = []

  for (const b of blocks) {
    if (!b.external || !calIds.has(b.external.calId)) {
      out.push(b)
      continue
    }
    const key = `${b.external.calId}:${b.external.eventId}`
    const e = remote.get(key)
    if (!e) {
      /* inside the window and absent remotely → the event was deleted */
      if (b.dayKey >= window.startKey && b.dayKey < window.endKey) {
        removed++
        continue
      }
      out.push(b)
      continue
    }
    remote.delete(key)
    if (
      b.title !== e.title ||
      b.dayKey !== e.dayKey ||
      b.startMin !== e.startMin ||
      b.endMin !== e.endMin ||
      (b.optional ?? false) !== (e.optional ?? false)
    ) {
      updated++
      out.push({ ...b, title: e.title, dayKey: e.dayKey, startMin: e.startMin, endMin: e.endMin, optional: e.optional })
    } else {
      out.push(b)
    }
  }

  for (const e of remote.values()) {
    added++
    out.push({
      id: uid(),
      title: e.title,
      tag: tagFor.get(e.calId) ?? 'work',
      dayKey: e.dayKey,
      startMin: e.startMin,
      endMin: e.endMin,
      protected: false,
      status: 'open',
      calendarRefs: [e.calId],
      estimateSource: 'user',
      external: { calId: e.calId, eventId: e.eventId },
      ...(e.optional ? { optional: true } : {}),
    })
  }

  return { blocks: out, added, updated, removed }
}

/* ── outbound: diff what each calendar should see vs what we pushed ──── */
export type PushOp =
  | { kind: 'create'; calId: string; blockId: string; body: PushEventBody }
  | { kind: 'update'; calId: string; blockId: string; eventId: string; body: PushEventBody }
  | { kind: 'delete'; calId: string; blockId: string; eventId: string }

function hashOf(b: PushEventBody): string {
  return `${b.title}|${b.dayKey}|${b.startMin}|${b.endMin}`
}

export function planPush(
  blocks: Block[],
  matrix: RoutingMatrix,
  calendars: ConnectedCalendar[],
  window: { startKey: string; endKey: string },
  syncMap: SyncEntry[],
): { ops: PushOp[]; nextMap: (op: PushOp, eventId?: string) => SyncEntry | null } {
  const ops: PushOp[] = []
  const byId = new Map(blocks.map((b) => [b.id, b]))
  const mapByKey = new Map(syncMap.map((s) => [s.id, s]))
  const desired = new Map<string, PushEventBody & { calId: string; blockId: string }>()

  for (const cal of calendars) {
    if (cal.readOnly) continue
    for (const ev of project(blocks, matrix, cal.id)) {
      const block = byId.get(ev.blockId)
      if (!block || block.external) continue // never push external events back
      if (ev.dayKey < window.startKey || ev.dayKey >= window.endKey) continue
      desired.set(`${ev.blockId}:${cal.id}`, {
        calId: cal.id,
        blockId: ev.blockId,
        title: ev.title,
        dayKey: ev.dayKey,
        startMin: ev.startMin,
        endMin: ev.endMin,
        mewBlockId: ev.blockId,
      })
    }
  }

  for (const [key, want] of desired) {
    const have = mapByKey.get(key)
    if (!have) {
      ops.push({ kind: 'create', calId: want.calId, blockId: want.blockId, body: want })
    } else if (have.hash !== hashOf(want)) {
      ops.push({ kind: 'update', calId: want.calId, blockId: want.blockId, eventId: have.eventId, body: want })
    }
  }
  for (const have of syncMap) {
    if (!desired.has(have.id)) {
      ops.push({ kind: 'delete', calId: have.calId, blockId: have.blockId, eventId: have.eventId })
    }
  }

  const nextMap = (op: PushOp, eventId?: string): SyncEntry | null => {
    if (op.kind === 'delete') return null
    return {
      id: `${op.blockId}:${op.calId}`,
      blockId: op.blockId,
      calId: op.calId,
      eventId: op.kind === 'create' ? eventId! : op.eventId,
      hash: hashOf(op.body),
    }
  }

  return { ops, nextMap }
}

/* ── orchestration ───────────────────────────────────────────────────── */
export interface SyncDeps {
  account: CalendarAccount
  calendars: ConnectedCalendar[] // live ones only
  matrix: RoutingMatrix
  now: Date
  getBlocks(): Block[]
  setBlocks(blocks: Block[], removedIds: string[]): void
  loadSyncMap(): Promise<SyncEntry[]>
  saveSyncMap(put: SyncEntry[], removeIds: string[]): Promise<void>
}

export interface SyncReport {
  pulled: { added: number; updated: number; removed: number }
  pushed: { created: number; updated: number; deleted: number }
}

export async function runSync(deps: SyncDeps): Promise<SyncReport> {
  await deps.account.authorize(false)
  const window = syncWindow(deps.now)
  const timeMin = new Date(deps.now)
  timeMin.setDate(timeMin.getDate() - ((timeMin.getDay() + 6) % 7))
  timeMin.setHours(0, 0, 0, 0)
  const timeMax = new Date(timeMin)
  timeMax.setDate(timeMax.getDate() + 21)

  /* pull */
  const eventLists = await Promise.all(
    deps.calendars.map((c) =>
      deps.account.listEvents(c.id, timeMin.toISOString(), timeMax.toISOString()),
    ),
  )
  const before = deps.getBlocks()
  const pulled = mergePull(before, eventLists.flat(), deps.calendars, window)
  if (pulled.added || pulled.updated || pulled.removed) {
    const kept = new Set(pulled.blocks.map((b) => b.id))
    const removedIds = before.filter((b) => !kept.has(b.id)).map((b) => b.id)
    deps.setBlocks(pulled.blocks, removedIds)
  }

  /* push */
  const syncMap = await deps.loadSyncMap()
  const { ops, nextMap } = planPush(deps.getBlocks(), deps.matrix, deps.calendars, window, syncMap)
  const put: SyncEntry[] = []
  const removeIds: string[] = []
  const pushed = { created: 0, updated: 0, deleted: 0 }
  for (const op of ops) {
    if (op.kind === 'create') {
      const eventId = await deps.account.createEvent(op.calId, op.body)
      put.push(nextMap(op, eventId)!)
      pushed.created++
    } else if (op.kind === 'update') {
      await deps.account.updateEvent(op.calId, op.eventId, op.body)
      put.push(nextMap(op)!)
      pushed.updated++
    } else {
      await deps.account.deleteEvent(op.calId, op.eventId)
      removeIds.push(`${op.blockId}:${op.calId}`)
      pushed.deleted++
    }
  }
  await deps.saveSyncMap(put, removeIds)

  return { pulled: { added: pulled.added, updated: pulled.updated, removed: pulled.removed }, pushed }
}
