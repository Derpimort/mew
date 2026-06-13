/* gbrain HTTP adapter — speaks MCP JSON-RPC against `gbrain serve` (v0.42:
   POST /mcp behind a bearer API key, GET /health open). One lazy initialize
   handshake per session (the streamable transport hands back an
   Mcp-Session-Id); every data call is `tools/call` on the core operations:
   put_page, add_timeline_entry, add_link, query. All of it optional-path:
   3s timeouts, every failure swallowed to one console.warn + a health flip —
   the brain must never block the week. */

import type { BrainPage, BrainPort, PrefPayload, RecallOpts } from './types'
import { parsePrefBody } from './senses'

const TIMEOUT_MS = 3000

interface GbrainConfig {
  /** read per call so settings changes apply without rebuilding the port */
  url(): string
  token(): string
  enabled(): boolean
}

export function createGbrainHttp(cfg: GbrainConfig): BrainPort {
  let sessionId: string | null = null
  let rpcId = 0
  let warned = false

  const warnOnce = (err: unknown) => {
    sessionId = null // a fresh session next time the brain comes back
    if (!warned) {
      warned = true
      console.warn('mew: brain unreachable — running without it', err)
    }
  }

  const post = async (body: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> => {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      return await fetch(`${cfg.url().replace(/\/$/, '')}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${cfg.token()}`,
          ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      })
    } finally {
      clearTimeout(t)
    }
  }

  /** The streamable transport answers JSON or a one-event SSE stream. */
  const parseRpc = async (res: Response): Promise<{ result?: unknown; error?: unknown }> => {
    const text = await res.text()
    if (text.startsWith('event:') || text.includes('\ndata:')) {
      const data = text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('')
      return JSON.parse(data || '{}')
    }
    return text ? JSON.parse(text) : {}
  }

  const ensureSession = async (): Promise<void> => {
    if (sessionId) return
    const res = await post({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'mew', version: '1.0' },
      },
    })
    if (!res.ok) throw new Error(`initialize ${res.status}`)
    sessionId = res.headers.get('mcp-session-id')
    await parseRpc(res)
    /* the spec wants the notification before tool calls; best-effort */
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {})
  }

  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    await ensureSession()
    const res = await post({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'tools/call',
      params: { name, arguments: args },
    })
    if (res.status === 404 || res.status === 400) {
      sessionId = null // expired session: one retry with a fresh handshake
      await ensureSession()
      const retry = await post({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'tools/call',
        params: { name, arguments: args },
      })
      if (!retry.ok) throw new Error(`${name} ${retry.status}`)
      return parseRpc(retry)
    }
    if (!res.ok) throw new Error(`${name} ${res.status}`)
    const rpc = await parseRpc(res)
    /* MCP tool failures arrive in-band: HTTP 200, isError in the result */
    const r = rpc.result as { isError?: boolean; content?: { type: string; text?: string }[] } | undefined
    if (rpc.error) throw new Error(`${name}: ${JSON.stringify(rpc.error).slice(0, 200)}`)
    if (r?.isError) throw new Error(`${name}: ${r.content?.[0]?.text?.slice(0, 200) ?? 'tool error'}`)
    warned = false
    return rpc
  }

  const frontmatter = (page: BrainPage): string => {
    const lines = ['---']
    if (page.type) lines.push(`type: ${page.type}`)
    if (page.tags?.length) lines.push(`tags: [${page.tags.join(', ')}]`)
    lines.push('---', '')
    return lines.join('\n')
  }

  return {
    async ingest(page: BrainPage) {
      if (!cfg.enabled()) return
      /* a graph write that needs a page the brain hasn't met yet stubs it
         once and retries; and no single failure takes down its siblings */
      const stubAnd = async (slug: string, retry: () => Promise<unknown>) => {
        const type = slug.split('/')[0]
        await call('put_page', { slug, content: `---\ntype: ${type}\n---\n# ${slug.split('/').slice(1).join('/')}\n` })
        await retry()
      }
      try {
        if (page.body != null) {
          await call('put_page', { slug: page.slug, content: frontmatter(page) + page.body })
        }
        for (const t of page.timeline ?? []) {
          try {
            await call('add_timeline_entry', { slug: t.slug, date: t.date, summary: t.summary })
          } catch {
            await stubAnd(t.slug, () =>
              call('add_timeline_entry', { slug: t.slug, date: t.date, summary: t.summary }),
            ).catch(() => {})
          }
        }
        for (const to of page.links ?? []) {
          try {
            await call('add_link', { from: page.slug, to })
          } catch {
            await stubAnd(to, () => call('add_link', { from: page.slug, to })).catch(() => {})
          }
        }
      } catch (err) {
        warnOnce(err)
      }
    },

    async recall(question: string, opts?: RecallOpts): Promise<string[]> {
      if (!cfg.enabled()) return []
      const limit = opts?.limit ?? 5
      const textOf = (rpc: unknown): string =>
        (rpc as { result?: { content?: { type: string; text?: string }[] } }).result?.content?.find(
          (c) => c.type === 'text',
        )?.text ?? ''
      /* results arrive as a JSON array or plain lines; both become short
         citable "slug — snippet" lines for the context block */
      const toLines = (text: string): string[] => {
        try {
          const arr = JSON.parse(text) as unknown
          if (Array.isArray(arr)) {
            return arr
              .map((hit) => {
                if (typeof hit === 'string') return hit
                const h = hit as { slug?: string; title?: string; snippet?: string; content?: string; summary?: string }
                const snippet = (h.snippet ?? h.summary ?? h.title ?? h.content ?? '').replace(/\s+/g, ' ').slice(0, 120)
                return h.slug ? `${h.slug} — ${snippet}` : snippet
              })
              .filter(Boolean)
          }
        } catch {
          /* not JSON — fall through to line splitting */
        }
        return text
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
      }
      try {
        let lines = toLines(textOf(await call('query', { query: question, limit })))
        if (!lines.length) {
          /* embeddings may be absent (keyless brains) — keyword search still serves */
          lines = toLines(textOf(await call('search', { query: question, limit })))
        }
        return lines.slice(0, limit)
      } catch (err) {
        warnOnce(err)
        return []
      }
    },

    async listPrefs(): Promise<PrefPayload[]> {
      if (!cfg.enabled()) return []
      try {
        const textOf = (rpc: unknown): string =>
          (rpc as { result?: { content?: { type: string; text?: string }[] } }).result?.content?.find(
            (c) => c.type === 'text',
          )?.text ?? ''
        const listed = textOf(await call('list_pages', { tag: 'preference', limit: 30 }))
        let slugs: string[] = []
        try {
          const arr = JSON.parse(listed) as unknown
          if (Array.isArray(arr)) {
            slugs = arr
              .map((e) => (typeof e === 'string' ? e : ((e as { slug?: string }).slug ?? '')))
              .filter((sl) => sl.startsWith('pref/'))
          }
        } catch {
          slugs = listed
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.startsWith('pref/'))
        }
        const out: PrefPayload[] = []
        for (const slug of slugs.slice(0, 30)) {
          const raw = textOf(await call('get_page', { slug }))
          /* get_page wraps the page in a JSON envelope; the markdown body
             lives in .content (fall back to the raw text for older shapes) */
          let body = raw
          try {
            const env = JSON.parse(raw) as { compiled_truth?: string; content?: string; body?: string }
            body = env.compiled_truth ?? env.content ?? env.body ?? raw
          } catch {
            /* raw markdown already */
          }
          const pref = parsePrefBody(body)
          if (pref) out.push(pref)
          else console.warn('mew: skipping malformed pref page', slug)
        }
        return out.reverse() // list is oldest-first; newest belongs on top
      } catch (err) {
        warnOnce(err)
        return []
      }
    },

    async health(): Promise<boolean> {
      if (!cfg.enabled()) return false
      try {
        const ctl = new AbortController()
        const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
        const res = await fetch(`${cfg.url().replace(/\/$/, '')}/health`, { signal: ctl.signal })
        clearTimeout(t)
        if (res.ok) warned = false
        return res.ok
      } catch {
        return false
      }
    },
  }
}
