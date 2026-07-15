/* The guided-setup key probe (#161). It must (a) never throw — every failure is
   a classified verdict, (b) hit the listing endpoint, NOT a chat/generation path
   (the "harmless, not a real turn" law), (c) send the key only to the provider's
   own host with the right auth headers, and (d) map status codes through the
   SAME classifyFailure the live turn uses so setup and runtime agree. */

import { describe, expect, it, vi } from 'vitest'
import { validateKey, consoleUrl, probeMessage, defaultModelFor, type KeyProbe } from '../validate'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type ProbeInit = { method: string; headers: Record<string, string>; signal: AbortSignal }
type ProbeFetch = (url: string, init: ProbeInit) => Promise<Response>

/** A typed fetch stub: always resolves `res`, and records the (url, init) it was
    called with so we can assert the method/headers/host. Params are read off
    `.mock.calls`, so the stub body ignores them. */
function fetchReturning(res: Response | (() => Response)) {
  return vi.fn<ProbeFetch>(() => Promise.resolve(typeof res === 'function' ? res() : res))
}

/** Narrow a probe to its failure shape (throws if it was ok) so a test can read
    `.reason` without TS complaining about the success arm. */
function asFailure(p: KeyProbe): Extract<KeyProbe, { ok: false }> {
  if (p.ok) throw new Error('expected a failed probe, got ok')
  return p
}

const MODELS_OK = { data: [{ id: 'claude-sonnet-5' }, { id: 'gpt-5.4-mini' }] }

describe('validateKey — a harmless listing probe, never a chat turn', () => {
  it('an empty key is rejected as auth without any network call', async () => {
    const fetchMock = fetchReturning(jsonResponse(MODELS_OK))
    const out = await validateKey('anthropic', '   ', undefined, fetchMock)
    expect(out).toEqual({ ok: false, reason: 'auth' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('GETs the models listing — no prompt, no body, no generation', async () => {
    const fetchMock = fetchReturning(jsonResponse(MODELS_OK))
    await validateKey('anthropic', 'sk-ant-good', undefined, fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/models')
    expect(init.method).toBe('GET')
    expect('body' in init).toBe(false) // never sends a prompt to generate against
  })

  it('sends the key only to the provider host, with the right auth headers', async () => {
    const anthFetch = fetchReturning(jsonResponse(MODELS_OK))
    await validateKey('anthropic', 'sk-ant-xyz', undefined, anthFetch)
    const anthHeaders = anthFetch.mock.calls[0][1].headers
    expect(anthHeaders['x-api-key']).toBe('sk-ant-xyz')
    expect(anthHeaders['anthropic-version']).toBeTruthy()
    expect(anthHeaders['anthropic-dangerous-direct-browser-access']).toBe('true')

    const oaFetch = fetchReturning(jsonResponse(MODELS_OK))
    await validateKey('openai', 'sk-oa-xyz', undefined, oaFetch)
    const [oaUrl, oaInit] = oaFetch.mock.calls[0]
    expect(oaUrl).toBe('https://api.openai.com/v1/models')
    expect((oaInit?.headers as Record<string, string>).Authorization).toBe('Bearer sk-oa-xyz')
  })

  it('a 200 listing is ok', async () => {
    const fetchMock = fetchReturning(jsonResponse(MODELS_OK))
    expect(await validateKey('anthropic', 'sk-ant-good', undefined, fetchMock)).toEqual({
      ok: true,
    })
  })

  it('401/403 → auth (a rejected key), carrying the status', async () => {
    const f401 = fetchReturning(jsonResponse({ error: 'unauthorized' }, 401))
    expect(await validateKey('anthropic', 'sk-bad', undefined, f401)).toEqual({
      ok: false,
      reason: 'auth',
      status: 401,
    })
    const f403 = fetchReturning(jsonResponse({ error: 'forbidden' }, 403))
    expect(asFailure(await validateKey('openai', 'sk-bad', undefined, f403)).reason).toBe('auth')
  })

  it('a 5xx / 429 is transient → busy (retry is honest), not auth', async () => {
    const f429 = fetchReturning(jsonResponse({ error: 'rate' }, 429))
    expect(asFailure(await validateKey('anthropic', 'sk-ok', undefined, f429)).reason).toBe('busy')
    const f503 = fetchReturning(jsonResponse({ error: 'down' }, 503))
    expect(asFailure(await validateKey('openai', 'sk-ok', undefined, f503)).reason).toBe('busy')
  })

  it('a network reject resolves to a calm verdict — never throws', async () => {
    const boom = vi.fn<ProbeFetch>(() => {
      throw new TypeError('Failed to fetch')
    })
    const out = asFailure(await validateKey('anthropic', 'sk-ok', undefined, boom))
    expect(['busy', 'unknown']).toContain(out.reason)
  })

  it('when a model is named and present, the probe stays ok', async () => {
    const fetchMock = fetchReturning(jsonResponse(MODELS_OK))
    expect(await validateKey('anthropic', 'sk-ok', 'claude-sonnet-5', fetchMock)).toEqual({
      ok: true,
    })
  })

  it('an authed key but an unknown model id → model (surfaces the 404 in setup)', async () => {
    const fetchMock = fetchReturning(jsonResponse(MODELS_OK))
    expect(
      asFailure(await validateKey('anthropic', 'sk-ok', 'claude-does-not-exist', fetchMock)).reason
    ).toBe('model')
  })

  it('an unreadable listing never disqualifies a valid key (stays ok)', async () => {
    const fetchMock = fetchReturning(() => new Response('not json', { status: 200 }))
    expect(await validateKey('anthropic', 'sk-ok', 'whatever-model', fetchMock)).toEqual({
      ok: true,
    })
  })
})

describe('setup helpers', () => {
  it('consoleUrl points at the keys page per provider', () => {
    expect(consoleUrl('anthropic')).toBe('https://console.anthropic.com/keys')
    expect(consoleUrl('openai')).toBe('https://platform.openai.com/api-keys')
  })

  it('defaultModelFor matches the provider contract default', () => {
    expect(defaultModelFor('anthropic')).toBe('claude-sonnet-5')
    expect(defaultModelFor('openai')).toBe('gpt-5.4-mini')
  })

  it('probeMessage speaks MEW voice — never blames the user, always a next step', () => {
    const auth = probeMessage('auth', 'anthropic')
    expect(auth).toMatch(/double-check|copied/i)
    expect(probeMessage('model', 'anthropic')).toMatch(/model/i)
    expect(probeMessage('busy', 'openai')).toMatch(/again|another go/i)
    expect(probeMessage('unknown', 'anthropic')).toMatch(/connection|reach/i)
  })
})
