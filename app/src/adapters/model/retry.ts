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
       truth about WHY is its `lastError`, so classification unwraps it. */

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
    same endpoint: network errors, 429 (rate limit), and 500/502/503/529
    (overloaded / gateway / unavailable). Everything else — 400/401/403/404/422,
    an abort, a non-Error — is permanent: it will fail again until the user
    changes something. */
export function isTransient(err: unknown): boolean {
  if (isAbort(err)) return false
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
    typically one that can't run tools (#153); `busy` is transient; `unknown`
    is anything else. Distinct from isTransient so the copy can stop calling a
    rejected key "busy". */
export type FailureKind = 'auth' | 'model' | 'rejected' | 'busy' | 'unknown'
export function classifyFailure(err: unknown): FailureKind {
  if (isAbort(err)) return 'unknown' // an abort isn't a model failure
  const status = statusOf(err)
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'model'
  if (status === 400 || status === 422) return 'rejected'
  if (isTransient(err)) return 'busy'
  return 'unknown'
}
