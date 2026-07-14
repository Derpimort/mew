/* MEW Core's localhost API: the StoragePort, dispatched over token-gated HTTP.
   One generic /rpc endpoint forwards {method, args} to the store — the seam is
   the same StoragePort the SQLite and Dexie vehicles already satisfy, so the
   client adapter (app/src/adapters/storage.core.ts) needs no per-method wire
   code, and the parity contract proves both ends at once. Least privilege: only
   the StoragePort surface is reachable, never arbitrary store properties. The
   per-launch bearer token mirrors gbrain's loopback auth (ARCHITECTURE.md §2). */
import type { StoragePort } from '../../app/src/adapters/storage-port'

/* the exact StoragePort surface — the allow-list /rpc dispatch honors. A name
   off this list (constructor, __proto__, …) is a 400, never a call. */
const METHODS: ReadonlySet<string> = new Set([
  'load',
  'putBlocks',
  'deleteBlocks',
  'putCaptures',
  'deleteCaptures',
  'putChat',
  'countChat',
  'loadChatBefore',
  'loadChatOlderThan',
  'deleteChat',
  'putMemory',
  'deleteMemory',
  'putSettings',
  'loadSyncMap',
  'saveSyncMap',
  'deleteSyncForCalendar',
  'exportJson',
  'importJson',
  'getAuditLog',
  'wipe',
])

/** The request handler — pure (no socket), so it tests without binding a port. */
export function coreFetchHandler(store: StoragePort, token: string): (req: Request) => Promise<Response> {
  const dispatch = store as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
  return async (req) => {
    const { pathname } = new URL(req.url)
    if (pathname === '/health') return Response.json({ ok: true })
    if (pathname !== '/rpc' || req.method !== 'POST') return new Response('not found', { status: 404 })
    if (req.headers.get('authorization') !== `Bearer ${token}`) return new Response('unauthorized', { status: 401 })

    let body: { method?: string; args?: unknown[] }
    try {
      body = (await req.json()) as { method?: string; args?: unknown[] }
    } catch {
      return Response.json({ ok: false, error: 'invalid json' }, { status: 400 })
    }
    const method = body.method ?? ''
    if (!METHODS.has(method)) return Response.json({ ok: false, error: `unknown method: ${method}` }, { status: 400 })

    try {
      const result = await dispatch[method]!(...(body.args ?? []))
      /* void commands carry no payload — null keeps the envelope uniform */
      return Response.json({ ok: true, result: result ?? null })
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : 'core error' }, { status: 500 })
    }
  }
}

export interface CoreServer {
  /** the bound loopback port (OS-assigned when 0 was requested) */
  port: number
  stop(): void
}

/** Bind the handler to a loopback port. port 0 → the OS assigns a free one. */
export function serveCore(opts: { store: StoragePort; token: string; port?: number }): CoreServer {
  const server = Bun.serve({ port: opts.port ?? 0, hostname: '127.0.0.1', fetch: coreFetchHandler(opts.store, opts.token) })
  /* TCP serve always binds a numeric port; ?? 0 only satisfies the union type */
  return { port: server.port ?? 0, stop: () => void server.stop(true) }
}
