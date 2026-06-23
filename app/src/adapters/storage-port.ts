/* StoragePort — the persistence contract, decoupled from any implementation.
   Dexie (browser) and SQLite (MEW Core) both satisfy it; neither leaks into
   this file, so Core can import the contract without pulling in Dexie. This
   is the seam ARCHITECTURE.md §2 names ("StoragePort ← Dexie/IndexedDB
   (Tauri: SQLite)"). */
import type { Block, Capture, ChatMessage, MemoryEvent, Settings } from '../domain/types'
import type { SyncEntry } from './calendar/types'

export interface PersistedState {
  blocks: Block[]
  captures: Capture[]
  chat: ChatMessage[]
  memory: MemoryEvent[]
  settings: Settings | null
}

/** One thing that's wrong with loaded state — emitted by `validateSchema`, never
    thrown. Each carries enough context to log honestly and to suggest a repair,
    so a version bump that lands old data missing a now-required field surfaces as
    a named problem (with a fix), not silent undefined behavior downstream. */
export interface ValidationError {
  /** Which table the bad row lives in — also the unit of clear-and-recover. */
  table: 'blocks' | 'captures' | 'chat' | 'memory'
  /** Stable row id when we have one, so the log points at a specific record. */
  id?: string
  /** What's wrong, in plain words (e.g. "block is missing required `dayKey`"). */
  message: string
  /** A positive next step — how to make this row valid again. */
  repair: string
}

/** Append-only migration/validation audit trail (the v3 `auditLog` table). Every
    schema upgrade, validation failure, and table fallback writes one row, so a
    user (or we) can read in the console exactly what happened on load — the
    Flyway/Liquibase audit-trail discipline, kept local-first. */
export interface AuditEntry {
  id: string
  /** Dexie schema version in effect when this happened. */
  version: number
  timestamp: number
  action: 'migrate' | 'validate' | 'fallback'
  details: string
}

export interface StoragePort {
  load(): Promise<PersistedState>
  putBlocks(blocks: Block[]): Promise<void>
  deleteBlocks(ids: string[]): Promise<void>
  putCaptures(captures: Capture[]): Promise<void>
  putChat(msgs: ChatMessage[]): Promise<void>
  putMemory(events: MemoryEvent[]): Promise<void>
  deleteMemory(ids: string[]): Promise<void>
  putSettings(s: Settings): Promise<void>
  loadSyncMap(): Promise<SyncEntry[]>
  saveSyncMap(put: SyncEntry[], removeIds: string[]): Promise<void>
  deleteSyncForCalendar(calId: string): Promise<void>
  exportJson(): Promise<string>
  importJson(json: string): Promise<void>
  /** Read the migration/validation audit trail, newest first. */
  getAuditLog(): Promise<AuditEntry[]>
  wipe(): Promise<void>
}
