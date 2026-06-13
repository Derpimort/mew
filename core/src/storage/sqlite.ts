/* SQLite StoragePort for MEW Core (Bun's built-in bun:sqlite — no native dep).
   Entities are stored as JSON blobs keyed by id: load returns whole objects,
   exactly as the Dexie vehicle does, so the engine above the seam is unchanged.
   ARCHITECTURE.md §2: "the core never changes; B/C just swap the adapter." */
import { Database } from 'bun:sqlite'
import type { PersistedState, StoragePort } from '../../../app/src/adapters/storage-port'
import type { Block, Capture, ChatMessage, MemoryEvent, Settings } from '../../../app/src/domain/types'
import type { SyncEntry } from '../../../app/src/adapters/calendar/types'

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS blocks   (id TEXT PRIMARY KEY, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS captures (id TEXT PRIMARY KEY, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS chat     (id TEXT PRIMARY KEY, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS memory   (id TEXT PRIMARY KEY, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS kv       (key TEXT PRIMARY KEY, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS sync     (id TEXT PRIMARY KEY, calId TEXT NOT NULL, json TEXT NOT NULL)',
]

export function createSqliteStorage(path = ':memory:'): StoragePort {
  const db = new Database(path)
  for (const stmt of SCHEMA) db.run(stmt)

  const allOf = <T>(table: string): T[] =>
    (db.query(`SELECT json FROM ${table}`).all() as { json: string }[]).map((r) => JSON.parse(r.json) as T)

  /* raw insert (no transaction) so it composes inside importJson's own tx */
  const putRows = <T extends { id: string }>(table: string, rows: T[]) => {
    const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (id, json) VALUES (?, ?)`)
    for (const it of rows) stmt.run(it.id, JSON.stringify(it))
  }
  const upsert = <T extends { id: string }>(table: string, rows: T[]) => db.transaction(() => putRows(table, rows))()

  const delByIds = (table: string, ids: string[]) => {
    if (!ids.length) return
    const stmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`)
    db.transaction(() => {
      for (const id of ids) stmt.run(id)
    })()
  }

  const getSettings = (): Settings | null => {
    const row = db.query("SELECT json FROM kv WHERE key = 'settings'").get() as { json: string } | null
    return row ? (JSON.parse(row.json) as Settings) : null
  }
  const putSettingsRow = (s: Settings) =>
    db.prepare("INSERT OR REPLACE INTO kv (key, json) VALUES ('settings', ?)").run(JSON.stringify(s))

  return {
    async load(): Promise<PersistedState> {
      return {
        blocks: allOf<Block>('blocks'),
        captures: allOf<Capture>('captures'),
        chat: allOf<ChatMessage>('chat'),
        memory: allOf<MemoryEvent>('memory'),
        settings: getSettings(),
      }
    },
    async putBlocks(blocks) {
      upsert('blocks', blocks)
    },
    async deleteBlocks(ids) {
      delByIds('blocks', ids)
    },
    async putCaptures(captures) {
      upsert('captures', captures)
    },
    async putChat(msgs) {
      upsert('chat', msgs)
    },
    async putMemory(events) {
      upsert('memory', events)
    },
    async deleteMemory(ids) {
      delByIds('memory', ids)
    },
    async putSettings(s) {
      putSettingsRow(s)
    },
    async loadSyncMap(): Promise<SyncEntry[]> {
      return (db.query('SELECT json FROM sync').all() as { json: string }[]).map((r) => JSON.parse(r.json) as SyncEntry)
    },
    async saveSyncMap(put, removeIds) {
      const ins = db.prepare('INSERT OR REPLACE INTO sync (id, calId, json) VALUES (?, ?, ?)')
      const del = db.prepare('DELETE FROM sync WHERE id = ?')
      db.transaction(() => {
        for (const e of put) ins.run(e.id, e.calId, JSON.stringify(e))
        for (const id of removeIds) del.run(id)
      })()
    },
    async deleteSyncForCalendar(calId) {
      db.prepare('DELETE FROM sync WHERE calId = ?').run(calId)
    },
    async exportJson(): Promise<string> {
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
      const current = getSettings()
      db.transaction(() => {
        for (const t of ['blocks', 'captures', 'chat', 'memory']) db.run(`DELETE FROM ${t}`)
        putRows('blocks', state.blocks ?? [])
        putRows('captures', state.captures ?? [])
        putRows('chat', state.chat ?? [])
        putRows('memory', state.memory ?? [])
        if (state.settings) {
          /* this device's keys survive a restore — backups carry none */
          putSettingsRow({
            ...state.settings,
            anthropicKey: state.settings.anthropicKey || current?.anthropicKey || '',
            openaiKey: state.settings.openaiKey || current?.openaiKey || '',
            brainToken: state.settings.brainToken || current?.brainToken || '',
          })
        }
      })()
    },
    async wipe() {
      db.transaction(() => {
        for (const t of ['blocks', 'captures', 'chat', 'memory', 'kv', 'sync']) db.run(`DELETE FROM ${t}`)
      })()
    },
  }
}
