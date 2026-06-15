#!/usr/bin/env bun
/* MEW Core entry — spawned as a Tauri sidecar (slice 3, mirroring gbrain).
   Opens the SQLite profile, serves the StoragePort on a loopback port behind a
   per-launch token, and prints {url, token} on stdout for the parent to read
   (two stable lines, the same handshake shape gbrain serve uses).
     bun src/main.ts --db <path> --port <n>
   --db   default ':memory:' (slice 3 passes app_data_dir()/profile.sqlite)
   --port default 0 → OS-assigned free loopback port */
import { createSqliteStorage } from './storage/sqlite'
import { serveCore } from './server'

const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback
}

const db = flag('--db', ':memory:')
const port = Number(flag('--port', '0'))
/* a fresh token each launch unless the parent injects one — no secret on disk */
const token = process.env.MEW_CORE_TOKEN || crypto.randomUUID()

const server = serveCore({ store: createSqliteStorage(db), token, port })
console.log(`mew-core url=http://127.0.0.1:${server.port}`)
console.log(`mew-core token=${token}`)
