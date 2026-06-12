/* StoragePort + Dexie implementation. Local-first: everything lives in
   IndexedDB on this device. The Tauri vehicle swaps this file for SQLite. */

import Dexie, { type EntityTable } from 'dexie'
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

class MewDb extends Dexie {
  blocks!: EntityTable<Block, 'id'>
  captures!: EntityTable<Capture, 'id'>
  chat!: EntityTable<ChatMessage, 'id'>
  memory!: EntityTable<MemoryEvent, 'id'>
  kv!: EntityTable<{ key: string; value: unknown }, 'key'>
  sync!: EntityTable<SyncEntry, 'id'>

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
  }
}

export function createDexieStorage(): StoragePort {
  const db = new MewDb()

  /* Ask the browser not to evict the user's week under storage pressure. */
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {})
  }

  return {
    async load() {
      const [blocks, captures, chat, memory, settingsRow] = await Promise.all([
        db.blocks.toArray(),
        db.captures.toArray(),
        db.chat.orderBy('ts').toArray(),
        db.memory.orderBy('ts').toArray(),
        db.kv.get('settings'),
      ])
      return {
        blocks,
        captures,
        chat,
        memory,
        settings: (settingsRow?.value as Settings) ?? null,
      }
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
         Each device keeps its own keys; restore re-enters them in Settings. */
      const settings = state.settings
        ? { ...state.settings, anthropicKey: '', openaiKey: '', brainToken: '' }
        : state.settings
      return JSON.stringify({ ...state, settings }, null, 2)
    },
    async importJson(json) {
      const state = JSON.parse(json) as PersistedState
      await db.transaction('rw', [db.blocks, db.captures, db.chat, db.memory, db.kv], async () => {
        const current = (await db.kv.get('settings'))?.value as
          | { anthropicKey?: string; openaiKey?: string; brainToken?: string }
          | undefined
        await Promise.all([db.blocks.clear(), db.captures.clear(), db.chat.clear(), db.memory.clear()])
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
    async wipe() {
      await db.delete()
      await db.open()
    },
  }
}
