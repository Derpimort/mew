/* Deferred-nudge coalescing. A nudge is reflection, not an interrupt (PRD):
   it appears once the assistant turn finishes, never spliced into a live
   stream. While a turn is in flight the store parks fired nudges here; when
   the turn completes it flushes them in order through this helper, so a
   multi-action plan that re-triggers the same nudge speaks it once. */

import type { NudgeInstance } from './library'

/** Identity for coalescing: the nudge type plus its contextual dedupe key
    (a dayKey, blockId, …). Falls back to the payload when a nudge carries no
    explicit key, so same-type nudges with identical payloads collapse while
    genuinely distinct ones (different block, different day) each survive. */
function dedupeKey(n: NudgeInstance): string {
  const k = n.key ?? JSON.stringify(n.payload)
  return `${n.type}::${k}`
}

/** Collapse exact-duplicate nudges, preserving first-seen order. Two nudges
    coalesce when they share a type and dedupe key; the first instance wins so
    the earliest context is the one the user sees. Pure — no store, no clock. */
export function coalesceNudges(queue: NudgeInstance[]): NudgeInstance[] {
  const seen = new Set<string>()
  const out: NudgeInstance[] = []
  for (const n of queue) {
    const key = dedupeKey(n)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(n)
  }
  return out
}
