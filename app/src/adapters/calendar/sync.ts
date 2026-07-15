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
  /** `calId:eventId` the user deleted or took ownership of — neither
      re-added nor matched, so any lingering local copy is also cleared. */
  dismissed?: ReadonlySet<string>
): PullResult {
  const calIds = new Set(calendars.map((c) => c.id))
  const tagFor = new Map(calendars.map((c) => [c.id, c.defaultTag ?? 'work']))
  const remote = new Map<string, RemoteEvent>()
  for (const e of events) {
    if (e.mewBlockId) continue // ours — already in the week as the source block
    const key = `${e.calId}:${e.eventId}`
    if (dismissed?.has(key)) continue // user deleted or took ownership — don't resurrect
    remote.set(key, e)
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
      out.push({
        ...b,
        title: e.title,
        dayKey: e.dayKey,
        startMin: e.startMin,
        endMin: e.endMin,
        optional: e.optional,
      })
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

/* ── repair: adopt blocks orphaned by a vanished source calendar ───────
   A block pulled in from a calendar carries `external` so the push NEVER
   exports it back — it already lives there. If that source calendar is later
   removed WITHOUT the full disconnect cleanup (a restored backup, a dev-hook
   settings wipe), the marker dangles: the block still projects in previews,
   but planPush skips it forever — present in MEW, invisible to sync, and
   nothing on screen says why. Ownership follows the source: source gone ⇒
   the block becomes MEW's own and flows out per the routing matrix again. */
export function adoptOrphanedExternals(
  blocks: Block[],
  calendars: ConnectedCalendar[]
): { blocks: Block[]; adopted: number } {
  const live = new Set(calendars.map((c) => c.id))
  let adopted = 0
  const out = blocks.map((b) => {
    if (!b.external || live.has(b.external.calId)) return b
    adopted++
    const { external: _dangling, ...rest } = b
    return { ...rest, calendarRefs: b.calendarRefs.filter((id) => live.has(id)) }
  })
  return adopted ? { blocks: out, adopted } : { blocks, adopted: 0 }
}

/* ── repair: forget ledger entries whose remote copy was deleted ───────
   The push ledger (syncMap) records "this block already lives on that
   calendar as event E". If the user deletes E on the calendar ITSELF, the
   ledger goes stale two ways, both silent:
     · hash still matches ⇒ planPush plans nothing — the block never returns;
     · hash differs ⇒ an update PATCHes a dead eventId, 404s, and aborts the
       whole run before later ops.
   The pull's listing is ground truth inside the window, so any entry whose
   event is absent there (for a block we'd still push) is forgotten — and
   planPush regenerates a clean CREATE in the same run. User intent isn't
   guessed: deleting MEW's copy on the calendar while the block still stands
   in MEW means the calendar drifted, and MEW's week is the source of truth. */
export function staleSyncEntries(
  syncMap: SyncEntry[],
  listed: RemoteEvent[],
  blocks: Block[],
  window: { startKey: string; endKey: string },
  calendars: ConnectedCalendar[]
): SyncEntry[] {
  const seen = new Set(listed.map((e) => `${e.calId}:${e.eventId}`))
  const listedCals = new Set(calendars.map((c) => c.id))
  const byId = new Map(blocks.map((b) => [b.id, b]))
  return syncMap.filter((s) => {
    if (!listedCals.has(s.calId)) return false // that calendar wasn't listed — no verdict
    const b = byId.get(s.blockId)
    /* a gone/external/out-of-window block is planPush's delete sweep to
       settle (delete-on-gone is already 404-tolerant); only entries the plan
       would otherwise trust as "still pushed" need the existence check */
    if (!b || b.external) return false
    if (b.dayKey < window.startKey || b.dayKey >= window.endKey) return false
    return !seen.has(`${s.calId}:${s.eventId}`)
  })
}

/* ── repair: claim remote events that are already OURS into the ledger ─
   Every event MEW pushes carries its block id (extendedProperties.private
   .mewBlockId). A fresh ledger — new device, restored backup, cleared site
   data — doesn't know about them, so planPush would push the same blocks
   AGAIN and the calendar doubles. The marker is the proof of ownership: a
   listed event naming a native local block joins the ledger with the
   REMOTE state's hash, so an unchanged block plans nothing and an edited
   one plans an update — never a duplicate create. */
export function adoptRemoteLedger(
  syncMap: SyncEntry[],
  listed: RemoteEvent[],
  blocks: Block[]
): SyncEntry[] {
  const have = new Set(syncMap.map((s) => s.id))
  const native = new Map(blocks.filter((b) => !b.external).map((b) => [b.id, b]))
  const claimed: SyncEntry[] = []
  for (const e of listed) {
    if (!e.mewBlockId || !native.has(e.mewBlockId)) continue
    const id = `${e.mewBlockId}:${e.calId}`
    if (have.has(id)) continue
    have.add(id) // first sighting claims the slot; ledger ids stay unique
    claimed.push({
      id,
      blockId: e.mewBlockId,
      calId: e.calId,
      eventId: e.eventId,
      hash: `${e.title}|${e.dayKey}|${e.startMin}|${e.endMin}`,
    })
  }
  return claimed
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
  syncMap: SyncEntry[]
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
      ops.push({
        kind: 'update',
        calId: want.calId,
        blockId: want.blockId,
        eventId: have.eventId,
        body: want,
      })
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
  /** `calId:eventId` of imported events the user dismissed/took over */
  dismissed?: ReadonlySet<string>
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
      deps.account.listEvents(c.id, timeMin.toISOString(), timeMax.toISOString())
    )
  )
  const allRemote = eventLists.flat()
  const before = deps.getBlocks()
  const pulled = mergePull(before, allRemote, deps.calendars, window, deps.dismissed)
  if (pulled.added || pulled.updated || pulled.removed) {
    const kept = new Set(pulled.blocks.map((b) => b.id))
    const removedIds = before.filter((b) => !kept.has(b.id)).map((b) => b.id)
    deps.setBlocks(pulled.blocks, removedIds)
  }

  /* push — reconcile the ledger against the listing first, both ways:
     · claim remote events that carry our own mewBlockId but are missing from
       the ledger (fresh device / restored backup) — never duplicate a push;
     · drop entries whose remote copy the user deleted on the calendar itself,
       so the plan re-CREATES those blocks instead of trusting a ghost. */
  const rawMap = await deps.loadSyncMap()
  const claimed = adoptRemoteLedger(rawMap, allRemote, deps.getBlocks())
  const fullMap = claimed.length ? [...rawMap, ...claimed] : rawMap
  const stale = staleSyncEntries(fullMap, allRemote, deps.getBlocks(), window, deps.calendars)
  const staleIds = new Set(stale.map((s) => s.id))
  const syncMap = staleIds.size ? fullMap.filter((s) => !staleIds.has(s.id)) : fullMap
  const { ops, nextMap } = planPush(deps.getBlocks(), deps.matrix, deps.calendars, window, syncMap)
  const put: SyncEntry[] = [...claimed] // claims persist even when they plan no op
  const removeIds: string[] = [...staleIds]
  const pushed = { created: 0, updated: 0, deleted: 0 }
  /* a PATCH/DELETE hitting an event that vanished mid-flight (deleted between
     our listing and this op) must not kill the whole run — recreate instead */
  const gone = (e: unknown) => e instanceof Error && /^google (404|410)/.test(e.message)
  for (const op of ops) {
    if (op.kind === 'create') {
      const eventId = await deps.account.createEvent(op.calId, op.body)
      put.push(nextMap(op, eventId)!)
      pushed.created++
    } else if (op.kind === 'update') {
      try {
        await deps.account.updateEvent(op.calId, op.eventId, op.body)
        put.push(nextMap(op)!)
        pushed.updated++
      } catch (e) {
        if (!gone(e)) throw e
        const eventId = await deps.account.createEvent(op.calId, op.body)
        put.push({ ...nextMap(op)!, eventId })
        pushed.created++
      }
    } else {
      await deps.account.deleteEvent(op.calId, op.eventId)
      const id = `${op.blockId}:${op.calId}`
      /* a claim adopted THIS run that the plan then deleted (visibility went
         hidden) must not persist — drop it from the puts, not just add a removal */
      const claimIdx = put.findIndex((p) => p.id === id)
      if (claimIdx >= 0) put.splice(claimIdx, 1)
      removeIds.push(id)
      pushed.deleted++
    }
  }
  /* a re-created block reuses its ledger id — storage puts THEN deletes, so a
     stale id that was just re-put must not ride along in the removals */
  const putIds = new Set(put.map((p) => p.id))
  await deps.saveSyncMap(
    put,
    removeIds.filter((id) => !putIds.has(id))
  )

  return {
    pulled: { added: pulled.added, updated: pulled.updated, removed: pulled.removed },
    pushed,
  }
}
