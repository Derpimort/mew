import { afterAll, expect, test } from 'bun:test'
import { createSqliteStorage } from '../src/storage/sqlite'
import { serveCore, type CoreServer } from '../src/server'
import { storageContract } from '../src/storage/contract'
import { createCoreStorage } from '../../app/src/adapters/storage.core'

/* The whole point of slice 2: the HTTP client + Core server satisfy the SAME
   StoragePort contract the SQLite vehicle does — one spec, now three vehicles.
   A fresh server+sqlite+client per test gives each case its own clean store. */
const servers: CoreServer[] = []
afterAll(() => servers.forEach((s) => s.stop()))

storageContract(
  () => {
    const server = serveCore({ store: createSqliteStorage(':memory:'), token: 'test-token' })
    servers.push(server)
    return createCoreStorage(`http://localhost:${server.port}`, 'test-token')
  },
  { test, expect },
)

/* server-specific guarantees the storage contract doesn't cover */
test('the token gate rejects a bad bearer with 401', async () => {
  const server = serveCore({ store: createSqliteStorage(':memory:'), token: 'good' })
  servers.push(server)
  const res = await fetch(`http://localhost:${server.port}/rpc`, {
    method: 'POST',
    headers: { Authorization: 'Bearer wrong', 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'load', args: [] }),
  })
  expect(res.status).toBe(401)
})

test('only StoragePort methods are reachable — a non-method name is 400, not a call', async () => {
  const server = serveCore({ store: createSqliteStorage(':memory:'), token: 't' })
  servers.push(server)
  const res = await fetch(`http://localhost:${server.port}/rpc`, {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'constructor', args: [] }),
  })
  expect(res.status).toBe(400)
})

test('health needs no token', async () => {
  const server = serveCore({ store: createSqliteStorage(':memory:'), token: 't' })
  servers.push(server)
  const res = await fetch(`http://localhost:${server.port}/health`)
  expect(res.status).toBe(200)
})
