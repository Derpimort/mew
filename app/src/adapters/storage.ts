/* StoragePort + Dexie implementation. Local-first: everything lives in
   IndexedDB on this device. The Tauri vehicle swaps this file for SQLite. */

import Dexie, { type EntityTable } from 'dexie'
import type { Block, Capture, ChatMessage, MemoryEvent, Settings } from '../domain/types'
import type { SyncEntry } from './calendar/types'

/* The contract now lives in storage-port.ts (Dexie-free, so MEW Core can
   import it). Re-exported here so existing callers are unchanged. */
import { stripSecrets } from './storage-port'
import type { AuditEntry, PersistedState, StoragePort, ValidationError } from './storage-port'
export type { AuditEntry, PersistedState, StoragePort, ValidationError } from './storage-port'

/** The Dexie schema version this file ships. A bump here adds a `.version(n)`
    block below and is recorded in the audit log on the load that first sees it. */
export const SCHEMA_VERSION = 3

/* ── Schema validation ─────────────────────────────────────────────────────
   A pure check over already-loaded state. Industry migration tools (Flyway,
   Liquibase, Alembic) validate after a version bump rather than trusting that
   old rows match the new shape; we do the same. Returns a list (never throws),
   so the caller decides whether to repair, warn, or fall back. Each finding
   names the row and a positive next step — MEW's voice, even in a failure. */

const REPAIR_DROP = 'drop this record and re-derive it from the rest of the week'

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/** Validate one decoded `PersistedState` against the fields the engine relies on.
    Catches old data that loaded without a now-required field (the exact silent
    failure a schema bump can introduce) before it reaches the store. */
export function validateSchema(state: PersistedState): ValidationError[] {
  const errors: ValidationError[] = []

  /* Blocks: id/dayKey/status are load-bearing — the week is keyed by them. */
  for (const b of state.blocks ?? []) {
    const id = isNonEmptyString(b?.id) ? b.id : undefined
    if (!id) {
      errors.push({
        table: 'blocks',
        message: 'block is missing required `id`',
        repair: REPAIR_DROP,
      })
    }
    if (!isNonEmptyString(b?.dayKey)) {
      errors.push({
        table: 'blocks',
        id,
        message: 'block is missing required `dayKey` (which day it lives on)',
        repair: 'set `dayKey` to a YYYY-MM-DD day, or drop the block',
      })
    }
    if (!isNonEmptyString(b?.status)) {
      errors.push({
        table: 'blocks',
        id,
        message: 'block is missing required `status` (open · done · rolled)',
        repair: "set `status` to 'open' so it returns to the week",
      })
    }
  }

  /* Captures: an id is the minimum to place or complete one later. */
  for (const c of state.captures ?? []) {
    if (!isNonEmptyString(c?.id)) {
      errors.push({
        table: 'captures',
        message: 'capture is missing required `id`',
        repair: REPAIR_DROP,
      })
    }
  }

  /* Chat: ordered by `ts`; a row without it can't take its place in the thread. */
  for (const m of state.chat ?? []) {
    const id = isNonEmptyString(m?.id) ? m.id : undefined
    if (!id) {
      errors.push({
        table: 'chat',
        message: 'chat message is missing required `id`',
        repair: REPAIR_DROP,
      })
    }
    if (typeof m?.ts !== 'number') {
      errors.push({
        table: 'chat',
        id,
        message: 'chat message is missing required `ts` (its place in the thread)',
        repair: REPAIR_DROP,
      })
    }
  }

  /* Memory is the append-only pattern log — id/ts/kind are each load-bearing. */
  const blockIds = new Set((state.blocks ?? []).map((b) => b?.id).filter(isNonEmptyString))
  for (const e of state.memory ?? []) {
    const id = isNonEmptyString(e?.id) ? e.id : undefined
    if (!id) {
      errors.push({
        table: 'memory',
        message: 'memory event is missing required `id`',
        repair: REPAIR_DROP,
      })
    }
    if (typeof e?.ts !== 'number') {
      errors.push({
        table: 'memory',
        id,
        message: 'memory event is missing required `ts` (when it happened)',
        repair: REPAIR_DROP,
      })
    }
    if (!isNonEmptyString(e?.kind)) {
      errors.push({
        table: 'memory',
        id,
        message: 'memory event is missing required `kind`',
        repair: REPAIR_DROP,
      })
    }
    /* Orphaned reference: a memory event can name a block by id; a dangling one
       is a soft problem (history is allowed to outlive its block), so it's noted
       as a repair-in-place, never a reason to clear the table. */
    const ref = (e as { blockId?: unknown })?.blockId
    if (isNonEmptyString(ref) && !blockIds.has(ref)) {
      errors.push({
        table: 'memory',
        id,
        message: `memory event references a block (\`${ref}\`) that is no longer in the week`,
        repair: 'leave it (history may outlive its block) or clear its `blockId`',
      })
    }
  }

  return errors
}

/** Which tables hold rows so broken the engine can't load them — only these are
    cleared on a failed load. A missing id/dayKey/status/ts/kind makes a row
    unusable; an orphaned reference does not, so memory-orphan-only stays intact.
    Returns the set of tables to clear, so recovery touches nothing it needn't. */
function corruptTables(errors: ValidationError[]): Set<ValidationError['table']> {
  const fatal = new Set<ValidationError['table']>()
  for (const e of errors) {
    if (e.message.includes('missing required')) fatal.add(e.table)
  }
  return fatal
}

class MewDb extends Dexie {
  blocks!: EntityTable<Block, 'id'>
  captures!: EntityTable<Capture, 'id'>
  chat!: EntityTable<ChatMessage, 'id'>
  memory!: EntityTable<MemoryEvent, 'id'>
  kv!: EntityTable<{ key: string; value: unknown }, 'key'>
  sync!: EntityTable<SyncEntry, 'id'>
  auditLog!: EntityTable<AuditEntry, 'id'>

  constructor() {
    super('mew')
    this.version(1).stores({
      blocks: 'id, dayKey, status',
      captures: 'id, status',
      chat: 'id, ts',
      memory: 'id, ts, kind, dayKey',
      kv: 'key',
    })
    this.version(2).stores({
      sync: 'id, calId, blockId', // outbound ledger: what MEW pushed where
    })
    /* v3: an append-only migration/validation audit trail. No existing table
       changes shape, so old rows carry forward untouched; this version only
       adds the ledger that records what each future load did to recover. */
    this.version(3).stores({
      auditLog: 'id, version, timestamp, action',
    })
  }
}

export function createDexieStorage(): StoragePort {
  const db = new MewDb()

  /* Ask the browser not to evict the user's week under storage pressure. */
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {})
  }

  /* Best-effort audit write: the trail must never be the thing that breaks a
     load, so a failure to record is swallowed (and surfaced to the console). */
  async function audit(action: AuditEntry['action'], details: string): Promise<void> {
    try {
      await db.auditLog.put({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        version: SCHEMA_VERSION,
        timestamp: Date.now(),
        action,
        details,
      })
    } catch (err) {
      console.warn('[mew/storage] could not write audit entry', err)
    }
  }

  return {
    async load() {
      /* A bump can leave the DB at a higher version than this build last saw.
         Note it once per load so the trail shows which schema served the data. */
      const seen = (await db.kv.get('schemaVersion'))?.value
      if (seen !== SCHEMA_VERSION) {
        await db.kv.put({ key: 'schemaVersion', value: SCHEMA_VERSION })
        await audit(
          'migrate',
          `schema now at v${SCHEMA_VERSION}${typeof seen === 'number' ? ` (was v${seen})` : ' (first run on this version)'}`
        )
      }

      const [blocks, captures, chat, memory, settingsRow] = await Promise.all([
        db.blocks.toArray(),
        db.captures.toArray(),
        db.chat.orderBy('ts').toArray(),
        db.memory.orderBy('ts').toArray(),
        db.kv.get('settings'),
      ])
      const state: PersistedState = {
        blocks,
        captures,
        chat,
        memory,
        settings: (settingsRow?.value as Settings) ?? null,
      }

      /* Validate the loaded state. Old data that survived a version bump without
         a now-required field is caught here — logged with context, never left to
         cause undefined behavior downstream. */
      const errors = validateSchema(state)
      if (errors.length) {
        console.warn(
          `[mew/storage] schema validation found ${errors.length} issue(s) after loading at v${SCHEMA_VERSION}:`
        )
        for (const e of errors) {
          console.warn(`  · ${e.table}${e.id ? ` (${e.id})` : ''}: ${e.message} — try: ${e.repair}`)
        }
        await audit(
          'validate',
          `${errors.length} issue(s): ${errors.map((e) => `${e.table}${e.id ? `#${e.id}` : ''} — ${e.message}`).join('; ')}`
        )

        /* No data loss across the board: clear ONLY the tables that hold
           unusable rows, keep every other table intact, and return the
           remaining state. The corrupt table comes back empty, not undefined. */
        const fatal = corruptTables(errors)
        for (const table of fatal) {
          await db[table].clear()
          state[table] = []
          await audit('fallback', `cleared corrupted \`${table}\` table; other tables left intact`)
          console.warn(
            `[mew/storage] cleared corrupted \`${table}\` table to recover; other tables kept`
          )
        }
      }

      return state
    },
    async putBlocks(blocks) {
      await db.blocks.bulkPut(blocks)
    },
    async deleteBlocks(ids) {
      await db.blocks.bulkDelete(ids)
    },
    async putCaptures(captures) {
      await db.captures.bulkPut(captures)
    },
    async deleteCaptures(ids) {
      await db.captures.bulkDelete(ids)
    },
    async putChat(msgs) {
      await db.chat.bulkPut(msgs)
    },
    async putMemory(events) {
      await db.memory.bulkPut(events)
    },
    async deleteMemory(ids) {
      await db.memory.bulkDelete(ids)
    },
    async putSettings(s) {
      await db.kv.put({ key: 'settings', value: s })
    },
    async loadSyncMap() {
      return db.sync.toArray()
    },
    async saveSyncMap(put, removeIds) {
      await db.transaction('rw', db.sync, async () => {
        if (put.length) await db.sync.bulkPut(put)
        if (removeIds.length) await db.sync.bulkDelete(removeIds)
      })
    },
    async deleteSyncForCalendar(calId) {
      await db.sync.where('calId').equals(calId).delete()
    },
    async exportJson() {
      const state = await this.load()
      /* a backup travels (downloads folder, cloud drives) — API keys don't.
         stripSecrets owns the redaction (storage-port.ts) so the SQLite vehicle
         and the key-audit suite share one source of truth; restore re-enters
         this device's keys in Settings. */
      return JSON.stringify({ ...state, settings: stripSecrets(state.settings) }, null, 2)
    },
    async importJson(json) {
      const state = JSON.parse(json) as PersistedState
      await db.transaction('rw', [db.blocks, db.captures, db.chat, db.memory, db.kv], async () => {
        const current = (await db.kv.get('settings'))?.value as
          | { anthropicKey?: string; openaiKey?: string; brainToken?: string }
          | undefined
        await Promise.all([
          db.blocks.clear(),
          db.captures.clear(),
          db.chat.clear(),
          db.memory.clear(),
        ])
        await db.blocks.bulkPut(state.blocks ?? [])
        await db.captures.bulkPut(state.captures ?? [])
        await db.chat.bulkPut(state.chat ?? [])
        await db.memory.bulkPut(state.memory ?? [])
        if (state.settings) {
          /* this device's keys survive a restore — backups carry none */
          await db.kv.put({
            key: 'settings',
            value: {
              ...state.settings,
              anthropicKey: state.settings.anthropicKey || current?.anthropicKey || '',
              openaiKey: state.settings.openaiKey || current?.openaiKey || '',
              brainToken: state.settings.brainToken || current?.brainToken || '',
            },
          })
        }
      })
    },
    async getAuditLog() {
      /* newest first — the most recent load's story reads at the top */
      return db.auditLog.orderBy('timestamp').reverse().toArray()
    },
    async wipe() {
      await db.delete()
      await db.open()
    },
  }
}
