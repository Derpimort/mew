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
  wipe(): Promise<void>
}
