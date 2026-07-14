/* StoragePort over the wire — the client half of MEW Core. Every call forwards
   to the Core service's token-gated /rpc (core/src/server.ts); the SQLite store
   lives in the sidecar, not the browser. Same contract as the Dexie and SQLite
   vehicles (storage-port.ts), so the engine above the seam is unchanged — this
   is just a third vehicle. Dexie-free by construction: nothing here imports a
   storage engine. Wiring the live store to this (+ the Tauri spawn that starts
   the sidecar, + retiring Dexie) is slice 3; this slice ships the adapter and
   proves it against the contract. */
import type { Block, Capture, ChatMessage, MemoryEvent, Settings } from '../domain/types'
import type { SyncEntry } from './calendar/types'
import type { AuditEntry, PersistedState, StoragePort } from './storage-port'

interface RpcEnvelope<T> {
  ok: boolean
  result?: T
  error?: string
}

/** Point the client at a running Core service (url + per-launch token). */
export function createCoreStorage(baseUrl: string, token: string): StoragePort {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/rpc`

  async function rpc<T>(method: string, args: unknown[]): Promise<T> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ method, args }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(
        `mew-core ${method} ${res.status}${detail ? `: ${detail.slice(0, 140)}` : ''}`
      )
    }
    const env = (await res.json()) as RpcEnvelope<T>
    if (!env.ok) throw new Error(`mew-core ${method}: ${env.error ?? 'failed'}`)
    return env.result as T
  }

  return {
    load: () => rpc<PersistedState>('load', []),
    putBlocks: (blocks: Block[]) => rpc<void>('putBlocks', [blocks]),
    deleteBlocks: (ids: string[]) => rpc<void>('deleteBlocks', [ids]),
    putCaptures: (captures: Capture[]) => rpc<void>('putCaptures', [captures]),
    deleteCaptures: (ids: string[]) => rpc<void>('deleteCaptures', [ids]),
    putChat: (msgs: ChatMessage[]) => rpc<void>('putChat', [msgs]),
    countChat: () => rpc<number>('countChat', []),
    loadChatBefore: (ts: number, id: string, limit: number) =>
      rpc<ChatMessage[]>('loadChatBefore', [ts, id, limit]),
    loadChatOlderThan: (ts: number) => rpc<ChatMessage[]>('loadChatOlderThan', [ts]),
    deleteChat: (ids: string[]) => rpc<void>('deleteChat', [ids]),
    putMemory: (events: MemoryEvent[]) => rpc<void>('putMemory', [events]),
    deleteMemory: (ids: string[]) => rpc<void>('deleteMemory', [ids]),
    putSettings: (s: Settings) => rpc<void>('putSettings', [s]),
    loadSyncMap: () => rpc<SyncEntry[]>('loadSyncMap', []),
    saveSyncMap: (put: SyncEntry[], removeIds: string[]) =>
      rpc<void>('saveSyncMap', [put, removeIds]),
    deleteSyncForCalendar: (calId: string) => rpc<void>('deleteSyncForCalendar', [calId]),
    exportJson: () => rpc<string>('exportJson', []),
    importJson: (json: string) => rpc<void>('importJson', [json]),
    getAuditLog: () => rpc<AuditEntry[]>('getAuditLog', []),
    wipe: () => rpc<void>('wipe', []),
  }
}
