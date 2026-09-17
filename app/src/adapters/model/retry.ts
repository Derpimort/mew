/* Honest failure classification for the model adapters. Transport resilience
   lives in the Vercel AI SDK now (#152) — streamText's maxRetries owns the
   backoff schedule the old hand-rolled withRetry ran — so what remains here is
   the part the SDK can't own: telling the USER the truth about why a turn fell
   through. A rejected key is not "busy", and copy that sends someone to
   Settings must only fire when Settings can fix it.

   Error shapes accepted, in one place so the classifier can't drift:
     · `{ status }` — MEW's own plain-fetch paths (the validate.ts key probe)
       tag their errors with the raw HTTP status;
     · `{ statusCode }` — the AI SDK's APICallError (name 'AI_APICallError');
     · AI_RetryError — the SDK's wrapper once its own retries are spent; the
       truth about WHY is its `lastError`, so classification unwraps it;
     · a DROPPED reply — the server answered 2xx, then the connection broke
       while the body streamed. The SDK (7.x) wraps that as APICallError
       'Failed to process successful response' carrying the 2xx `statusCode`
       and the real transport error as its `cause` (TypeError 'network error'
       in a browser; undici's 'terminated' → UND_ERR_SOCKET in Node, which the
       SDK also flags `isRetryable`). The status alone reads as success, so the
       classifier looks down the cause chain for the network error.

   No retry for a dropped reply — the call, on purpose: streamText's backoff
   wraps only the request, never a stream it has started reading (proven in
   dropped-reply.test.ts: one fetch, even when the SDK flags the drop
   retryable), and MEW adds none of its own. Tokens and tool calls that already
   streamed can't be un-sent, so a replay could say or do things twice; the
   store keeps whatever went through ("hiccuped mid-thought"), and when nothing
   did, the rules floor answers the turn at once instead of re-waiting on a
   model that just dropped. So a dropped reply is its own kind, and its copy
   never claims a retry. */

/** A user-initiated cancel must never be classified as a model failure: an
    abort is the user's decision, not a blip. */
function isAbort(err: unknown): boolean {
  return (err as { name?: unknown })?.name === 'AbortError'
}

/** The SDK's retries exhausted: the honest cause is the last underlying error,
    not the wrapper. Narrowed on the SDK's error name so an unrelated object
    carrying a `lastError` field is never unwrapped. */
function unwrap(err: unknown): unknown {
  if ((err as { name?: unknown })?.name === 'AI_RetryError') {
    return (err as { lastError?: unknown }).lastError ?? err
  }
  return err
}

/** The HTTP status of a failed request, if the error carries one — `.status`
    from MEW's own fetch paths, `.statusCode` from the AI SDK's APICallError. */
function statusOf(raw: unknown): number | undefined {
  const err = unwrap(raw)
  const s = (err as { status?: unknown })?.status
  if (typeof s === 'number') return s
  const sc = (err as { statusCode?: unknown })?.statusCode
  return typeof sc === 'number' ? sc : undefined
}

/** How far down `.cause` the classifier looks: the SDK wraps a transport
    failure once, undici once more — four links covers both with room, and the
    bound means a cyclic chain can never hang the classifier. */
const MAX_CAUSE_DEPTH = 4

/** A transport failure somewhere down the `.cause` chain — a TypeError, which
    is what fetch and its body reader reject with when the socket goes. */
function causedByNetwork(err: unknown): boolean {
  let cause = (err as { cause?: unknown })?.cause
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && cause != null; depth++) {
    if ((cause as { name?: unknown }).name === 'TypeError') return true
    cause = (cause as { cause?: unknown }).cause
  }
  return false
}

/** The reply had begun (2xx) and then the connection broke mid-body: the SDK's
    APICallError with a success status, flagged retryable by the SDK or carrying
    a network error in its cause chain. A 2xx wrap caused by anything else (a
    parse failure, a malformed chunk) is not a drop and stays unclassified. */
function isDropped(raw: unknown): boolean {
  const err = unwrap(raw)
  if ((err as { name?: unknown })?.name !== 'AI_APICallError') return false
  const status = statusOf(err)
  if (status === undefined || status < 200 || status > 299) return false
  return (err as { isRetryable?: unknown }).isRetryable === true || causedByNetwork(err)
}

/** Network-level failures surface with no HTTP status: a browser fetch
    rejecting (`TypeError: Failed to fetch`), or the SDK's APICallError for a
    request that never got a response — the SDK marks those `isRetryable`.
    Narrow on purpose — a status-less Error from elsewhere (a JSON parse, a
    malformed-intent guard) is a logic failure, not a blip. */
function isNetworkError(raw: unknown): boolean {
  const err = unwrap(raw)
  if (statusOf(err) !== undefined) return false
  const name = (err as { name?: unknown })?.name
  if (name === 'TypeError') return true
  return name === 'AI_APICallError' && (err as { isRetryable?: unknown }).isRetryable === true
}

/** Transient = the request could have succeeded moments later on the same key,
    same endpoint: network errors (a dropped reply included), 429 (rate limit),
    and 500/502/503/529 (overloaded / gateway / unavailable). Everything else —
    400/401/403/404/422, an abort, a non-Error — is permanent: it will fail
    again until the user changes something. */
export function isTransient(err: unknown): boolean {
  if (isAbort(err)) return false
  if (isDropped(err)) return true
  const status = statusOf(err)
  if (status !== undefined) {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 529
  }
  return isNetworkError(err)
}

/** Why a model turn failed, for an honest, actionable fallback message. `auth`
    (401/403 — key rejected) and `model` (404 — model name not found) are
    PERMANENT and the user must fix them in Settings; `rejected` (400/422) is
    the endpoint understanding and refusing the request — for a local model,
    typically one that can't run tools (#153); `busy` is transient; `dropped`
    is transient too, but the reply had already begun — never retried (see the
    header), so its copy claims no retry; `unknown` is anything else. Distinct
    from isTransient so the copy can stop calling a rejected key "busy". */
export type FailureKind = 'auth' | 'model' | 'rejected' | 'busy' | 'dropped' | 'unknown'
export function classifyFailure(err: unknown): FailureKind {
  if (isAbort(err)) return 'unknown' // an abort isn't a model failure
  if (isDropped(err)) return 'dropped'
  const status = statusOf(err)
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'model'
  if (status === 400 || status === 422) return 'rejected'
  if (isTransient(err)) return 'busy'
  return 'unknown'
}
