/* One merge rule for the standing rulebook (#15, #8). Local memory is the
   always-on home and the brain mirrors it, and what applies is the MERGE:
   - Per rule (kind + match), the newest LOCAL event decides. A 'preference'
     makes it live with that value; a 'forgotten_pref' tombstones it, and the
     tombstone wins over the brain's copy (a forget sticks with the brain on).
   - A rule the local memory never touched comes from the brain as it stands.
   - Local first, then brain-only, deduped by rule and capped.
   Pure: the store hands in memory + the brain's list, and the same function
   decides what the brain is missing (the reconnect replay plan). */
import type { MemoryEvent, PrefPayload } from './types'

/** the rulebook the model context carries — the long-standing cap */
export const PREF_CAP = 15

/** one rule's identity: its kind + match, case- and edge-space-insensitive */
export const prefKey = (p: Pick<PrefPayload, 'kind' | 'match'>): string =>
  `${p.kind}:${p.match.trim().toLowerCase()}`

/** The local timeline, newest event per rule deciding: live prefs (newest
    first) and the rules a newer forget tombstoned. */
export function localPrefState(memory: readonly MemoryEvent[]): {
  live: PrefPayload[]
  tombstoned: Map<string, PrefPayload>
} {
  const decided = new Set<string>()
  const live: PrefPayload[] = []
  const tombstoned = new Map<string, PrefPayload>()
  for (let i = memory.length - 1; i >= 0; i--) {
    const e = memory[i]
    if ((e.kind !== 'preference' && e.kind !== 'forgotten_pref') || !e.pref) continue
    const k = prefKey(e.pref)
    if (decided.has(k)) continue
    decided.add(k)
    if (e.kind === 'forgotten_pref') tombstoned.set(k, e.pref)
    else live.push(e.pref)
  }
  return { live, tombstoned }
}

/** What applies: local live rules, then brain rules nothing local decided,
    deduped, tombstones excluded, capped. With no brain (null or []), exactly the
    local rulebook: byte-identical to the brain-off behavior before #15. */
export function mergeActivePrefs(
  memory: readonly MemoryEvent[],
  fromBrain: readonly PrefPayload[] | null
): PrefPayload[] {
  const { live, tombstoned } = localPrefState(memory)
  const seen = new Set<string>(tombstoned.keys())
  const out: PrefPayload[] = []
  for (const p of [...live, ...(fromBrain ?? [])]) {
    const k = prefKey(p)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
    if (out.length >= PREF_CAP) break
  }
  return out
}

/** #71: the applied rules nothing local decided — they come from the brain alone.
    Keyed by prefKey, over exactly the rules mergeActivePrefs keeps, so the
    console can mark a brain-only row and a forget can reach it. No brain (null
    or []) → empty. */
export function brainOnlyPrefKeys(
  memory: readonly MemoryEvent[],
  fromBrain: readonly PrefPayload[] | null
): Set<string> {
  if (!fromBrain?.length) return new Set()
  const { live } = localPrefState(memory)
  const local = new Set(live.map(prefKey))
  return new Set(
    mergeActivePrefs(memory, fromBrain)
      .map(prefKey)
      .filter((k) => !local.has(k))
  )
}

/** What the brain is missing, given its current list: local live rules it
    doesn't hold with the same value (told to MEW while the brain was away, or
    changed since), and forgotten rules it still lists (so its copy can be
    retired). */
export function prefReplayPlan(
  memory: readonly MemoryEvent[],
  fromBrain: readonly PrefPayload[]
): { remember: PrefPayload[]; forget: PrefPayload[] } {
  const { live, tombstoned } = localPrefState(memory)
  const brainValue = new Map(fromBrain.map((p) => [prefKey(p), p.value] as const))
  return {
    remember: live.filter((p) => brainValue.get(prefKey(p)) !== p.value),
    forget: [...tombstoned.entries()].filter(([k]) => brainValue.has(k)).map(([, p]) => p),
  }
}
