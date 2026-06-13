/* The recall scope contract, proven against the REAL adapter with fetch
   faked at the network seam: MEW scope never surfaces a foreign page;
   whole-brain scope surfaces it WITH its source. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGbrainHttp } from '../gbrainHttp'

/** A fake `gbrain serve`: answers initialize, then returns the given hits
    for every tools/call. Captures request bodies for assertions. With
    `honorLimit`, it ranks-then-truncates like a real brain — the only way to
    prove the MEW-scope over-fetch actually beats a foreign-heavy top-N. */
function fakeServe(hits: unknown[], opts?: { honorLimit?: boolean }) {
  const calls: { method: string; name?: string; args?: Record<string, unknown> }[] = []
  const fetchStub = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      method: string
      params?: { name?: string; arguments?: Record<string, unknown> }
    }
    calls.push({ method: body.method, name: body.params?.name, args: body.params?.arguments })
    const served = opts?.honorLimit
      ? hits.slice(0, Number(body.params?.arguments?.limit ?? 5))
      : hits
    const result =
      body.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fake', version: '0' } }
        : { content: [{ type: 'text', text: JSON.stringify(served) }] }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-1' },
    })
  })
  vi.stubGlobal('fetch', fetchStub)
  return { calls }
}

const port = () =>
  createGbrainHttp({ url: () => 'http://127.0.0.1:9', token: () => 't', enabled: () => true })

/* a brain shared with other agents: MEW's own pages + a coding agent's */
const SHARED = [
  { slug: 'task/spicanova-deploy', snippet: 'last: completed Thursday' },
  { slug: 'src/deploy.ts', snippet: 'spicanova deploy shipped Thursday, rollback tested' },
  { slug: 'concept/launch-checklist', snippet: 'launch checklist: comms, status page, rollback' },
]

afterEach(() => vi.unstubAllGlobals())

describe('recall scope', () => {
  it('default (MEW only): foreign pages never surface — only MEW namespaces', async () => {
    fakeServe(SHARED)
    const lines = await port().recall('spicanova deploy')
    expect(lines).toEqual(['task/spicanova-deploy — last: completed Thursday'])
  })

  it('whole brain: foreign pages arrive marked with their source', async () => {
    fakeServe(SHARED)
    const lines = await port().recall('spicanova deploy', { scope: 'all' })
    expect(lines).toEqual([
      'task/spicanova-deploy — last: completed Thursday',
      'spicanova deploy shipped Thursday, rollback tested · via src/deploy.ts',
      'launch checklist: comms, status page, rollback · via concept/launch-checklist',
    ])
  })

  it('every MEW namespace passes the scope filter', async () => {
    fakeServe([
      { slug: 'week/2026-06-09', snippet: 'debrief: 2 mews' },
      { slug: 'pref/time-default-gym', snippet: 'gym → 07:00' },
      { slug: 'person/dana', snippet: 'asked for the pre-read' },
      { slug: 'project/spicanova', snippet: 'ate 6h' },
      { slug: 'notes/random', snippet: 'foreign' },
    ])
    const lines = await port().recall('q')
    expect(lines).toHaveLength(4)
    expect(lines.join('\n')).not.toContain('foreign')
  })

  it('whole-brain asks only for what it shows; MEW scope over-fetches to outlast the filter', async () => {
    const { calls } = fakeServe(SHARED)
    await port().recall('q', { scope: 'all', limit: 3 })
    expect(calls.find((c) => c.name === 'query')!.args).toMatchObject({ query: 'q', limit: 3 })

    calls.length = 0
    await port().recall('q', { scope: 'mew', limit: 3 })
    // 'mew' drops foreign pages after the fetch, so it asks for limit×5 up front
    expect(calls.find((c) => c.name === 'query')!.args).toMatchObject({ query: 'q', limit: 15 })
  })

  it('a foreign-heavy brain still surfaces MEW pages — over-fetch beats the post-filter starve', async () => {
    /* a server that ranks-then-truncates: the top 3 by relevance are all
       foreign, so a naive limit-3 ask would filter to zero. Over-fetch reaches
       the MEW pages ranked just below. */
    fakeServe(
      [
        { slug: 'src/a.ts', snippet: 'foreign 1' },
        { slug: 'src/b.ts', snippet: 'foreign 2' },
        { slug: 'src/c.ts', snippet: 'foreign 3' },
        { slug: 'task/deck', snippet: 'last: completed' },
        { slug: 'person/dana', snippet: 'pre-read sent' },
      ],
      { honorLimit: true },
    )
    const lines = await port().recall('q', { scope: 'mew', limit: 3 })
    expect(lines).toEqual(['task/deck — last: completed', 'person/dana — pre-read sent'])
  })
})
