/* The HTTP-client StoragePort's wire behavior, mocked at fetch — the real
   client↔server↔sqlite round-trip is proven by the contract suite in
   core/test/server.test.ts; this guards the request shape and error handling
   from the app side (where tsc/vitest run). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCoreStorage } from '../storage.core'
import type { Block } from '../../domain/types'

type FetchInit = { method: string; headers: Record<string, string>; body: string }

afterEach(() => vi.unstubAllGlobals())

describe('createCoreStorage — the HTTP StoragePort client', () => {
  it('posts {method,args} to /rpc with the bearer token and returns the result', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: FetchInit) => ({
      ok: true,
      json: async () => ({ ok: true, result: { blocks: [], captures: [], chat: [], memory: [], settings: null } }),
    }))
    vi.stubGlobal('fetch', fetchSpy)

    const store = createCoreStorage('http://127.0.0.1:9000', 'tok')
    const out = await store.load()

    expect(out.blocks).toEqual([])
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:9000/rpc')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ method: 'load', args: [] })
  })

  it('forwards args for void commands and trims a trailing slash on the base url', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: FetchInit) => ({ ok: true, json: async () => ({ ok: true, result: null }) }))
    vi.stubGlobal('fetch', fetchSpy)

    const store = createCoreStorage('http://127.0.0.1:9000/', 'tok')
    await store.putBlocks([{ id: 'a' } as Block])

    expect(fetchSpy.mock.calls[0][0]).toBe('http://127.0.0.1:9000/rpc')
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ method: 'putBlocks', args: [[{ id: 'a' }]] })
  })

  it('throws on a non-ok HTTP status', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: FetchInit) => ({ ok: false, status: 500, text: async () => 'boom' }))
    vi.stubGlobal('fetch', fetchSpy)

    const store = createCoreStorage('http://127.0.0.1:9000', 'tok')
    await expect(store.load()).rejects.toThrow(/mew-core load 500/)
  })

  it('throws when the server envelope reports ok:false', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: FetchInit) => ({ ok: true, json: async () => ({ ok: false, error: 'nope' }) }))
    vi.stubGlobal('fetch', fetchSpy)

    const store = createCoreStorage('http://127.0.0.1:9000', 'tok')
    await expect(store.wipe()).rejects.toThrow(/mew-core wipe: nope/)
  })
})
