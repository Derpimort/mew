/* A harmless, on-device key probe for the guided setup flow (#161). It answers
   one question — "will this key be accepted?" — WITHOUT spending a chat turn:
   a single GET to the provider's `/v1/models` listing. No prompt, no tokens, no
   tool loop, no week mutation; it can't move a block or cost a generation. The
   key still leaves the device only to its own provider host (privacy law), and a
   zero-key session never calls this — it's reached solely by the Test button.

   Plain `fetch` (no SDK import) so it stays out of the lazy AI bundle and is
   stubbable in a unit test exactly like the openai adapter. The 401/403/404
   shapes are read back through the SAME classifyFailure the live turn uses, so
   the Test verdict and a real failure speak with one voice. */

import { PROVIDER_CONTRACT } from './contract'
import { classifyFailure } from './retry'
import type { RemoteProvider } from './aiAdapter'

/** The outcome of a key probe. `ok` is the only success; everything else carries
    a `reason` mirroring classifyFailure so the UI copy matches a live failure:
    - 'auth'    — the key was rejected (401/403): a typo or a revoked key.
    - 'model'   — reachable + authed, but the chosen model id 404s.
    - 'busy'    — a transient network/429/5xx blip; "try again" is honest here.
    - 'unknown' — anything else (offline, CORS, an odd status). */
export type KeyProbe =
  | { ok: true }
  | { ok: false; reason: 'auth' | 'model' | 'busy' | 'unknown'; status?: number }

const PROBE_TIMEOUT_MS = 8000

/** Just the slice of `fetch` the probe uses — a string URL + an init with the
    fields we set. Narrower than the global `fetch` overloads so a test stub
    (and the real `fetch`) both satisfy it without an `as` cast. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal: AbortSignal }
) => Promise<Response>

/** Where each provider lists its models, and the headers that authorize a
    browser-direct GET. Anthropic needs its version + the explicit
    direct-browser-access opt-in (the SDK sets these on the chat path; here we
    set them by hand since we bypass the SDK). OpenAI takes a bearer token. */
function probeRequest(
  provider: RemoteProvider,
  apiKey: string
): { url: string; headers: Record<string, string> } {
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/models',
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  }
  return {
    url: 'https://api.anthropic.com/v1/models',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  }
}

/** Probe one key (and, when given, confirm the model id exists). Never throws —
    every failure resolves to a classified `KeyProbe` so the caller can render a
    calm verdict instead of catching. */
export async function validateKey(
  provider: RemoteProvider,
  apiKey: string,
  model?: string,
  fetchImpl: FetchLike = fetch
): Promise<KeyProbe> {
  const key = apiKey.trim()
  if (!key) return { ok: false, reason: 'auth' }

  const { url, headers } = probeRequest(provider, key)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetchImpl(url, { method: 'GET', headers, signal: ctl.signal })
  } catch (err) {
    // network reject / abort / CORS — classifyFailure tags transient blips
    // 'busy'; anything else (offline, opaque) is 'unknown'. Either way: retryable
    // wording, not "your key is wrong".
    return { ok: false, reason: classifyFailure(err) === 'busy' ? 'busy' : 'unknown' }
  } finally {
    clearTimeout(timer)
  }

  if (res.ok) {
    // Authed. If the user picked a model, confirm the id is real so a 404 surfaces
    // here (in setup) rather than as a first-turn failure. A listing the shape of
    // which we can't read still counts as authed — we only DISqualify on a clear miss.
    if (model?.trim()) {
      const known = await modelIsKnown(res, model.trim())
      if (known === false) return { ok: false, reason: 'model' }
    }
    return { ok: true }
  }

  // classifyFailure reads `.status` off the error; the fetch path carries it on
  // the Response, so hand it the same shape the SDK errors have.
  return { ok: false, reason: classifyFailure({ status: res.status }), status: res.status }
}

/** Does the models listing contain `model`? Returns null (don't disqualify) when
    the body can't be parsed into the expected `{ data: [{ id }] }` shape — we
    never fail a valid key on an unexpected listing format. */
async function modelIsKnown(res: Response, model: string): Promise<boolean | null> {
  try {
    const body = (await res.clone().json()) as { data?: Array<{ id?: unknown }> }
    const ids = body?.data
    if (!Array.isArray(ids)) return null
    return ids.some((m) => typeof m?.id === 'string' && m.id === model)
  } catch {
    return null
  }
}

/** The "where do I get a key" target for each provider — the keys page, deep so
    the user lands one click from creating one (acceptance criterion: Step 2). */
export function consoleUrl(provider: RemoteProvider): string {
  return provider === 'openai'
    ? 'https://platform.openai.com/api-keys'
    : 'https://console.anthropic.com/keys'
}

/** A one-line, friendly verdict for a failed probe — MEW voice, positive-only,
    never blaming the user. Used by the setup flow's error state. */
export function probeMessage(
  reason: Exclude<KeyProbe, { ok: true }>['reason'],
  provider: RemoteProvider
): string {
  const host = provider === 'openai' ? 'OpenAI' : 'Anthropic'
  switch (reason) {
    case 'auth':
      return `That key didn't open the door — double-check you copied the whole thing from ${host}.`
    case 'model':
      return `The key works, but that model id wasn't found — pick another in the model list.`
    case 'busy':
      return `${host} was busy for a moment. Give it another go.`
    default:
      return `Couldn't reach ${host} just now — check your connection and try again.`
  }
}

/** Default model for a provider when the user hasn't chosen one — so the probe
    can confirm a real id even on first run. */
export function defaultModelFor(provider: RemoteProvider): string {
  return PROVIDER_CONTRACT[provider].defaultModel
}
