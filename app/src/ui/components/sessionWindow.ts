/* The session log's window — pure logic (#250, phase 1).

   A long-lived profile carries thousands of chat messages; rendering them all
   made every keystroke pay for the whole history. The render layer now shows
   only the newest page of pre-mount history (older pages arrive on demand via
   the "· earlier ·" sentinel), while everything appended after mount always
   renders. One boundary — the session log's mount instant — drives three
   behaviors at once:

     ts ≤ mountedAt  →  history: windowed, static (no entrance animation),
                        silent to screen readers when paged in
     ts > mountedAt  →  fresh: always rendered, animated entrance, announced
                        by the polite live region

   Everything here is a pure function of (chat, mountedAt, pages) so the rules
   are unit-testable without a DOM; SessionLog.tsx owns the React wiring. */

import type { ChatMessage } from '../../domain/types'

/** How many history messages one page of the window reveals. */
export const PAGE = 50

/** A message appended after the session log mounted — the only rows that play
    the terminal blur-up entrance, and the only ones a screen reader hears. */
export function isFreshMessage(ts: number, mountedAt: number): boolean {
  return ts > mountedAt
}

/** How many leading messages predate the mount (chat is (ts, id)-ordered —
    hydration loads the newest page in that order, earlier pages PREPEND
    strictly older rows, live turns APPEND with a monotonic `nowFn()` — so
    history is always a prefix). */
export function historyCount(chat: readonly ChatMessage[], mountedAt: number): number {
  const firstFresh = chat.findIndex((m) => isFreshMessage(m.ts, mountedAt))
  return firstFresh === -1 ? chat.length : firstFresh
}

/** Index of the oldest history row the window shows. 0 = fully paged in. */
export function windowStart(history: number, pages: number): number {
  return Math.max(0, history - Math.max(1, pages) * PAGE)
}

/** True when two chat snapshots differ at most in the FINAL message's content
    (same id, replaced object) — the shape of a per-chunk stream update, where
    `flush()` rewrites the newest message's body once per token batch. The
    window treats such snapshots as identical: the streaming row reads itself
    through its own narrow selector (`liveTail`), so nothing else needs to
    re-render. Any append, removal, or non-tail replacement compares unequal.

    Sound because chat messages are append-only and never mutated in place —
    the store always REPLACES a message object, so reference equality on each
    element is a complete change detector. */
export function chatEqualExceptLiveTail(
  a: readonly ChatMessage[],
  b: readonly ChatMessage[]
): boolean {
  if (a === b) return true
  const n = a.length
  if (n !== b.length) return false
  if (n === 0) return true
  for (let i = 0; i < n - 1; i++) if (a[i] !== b[i]) return false
  return a[n - 1] === b[n - 1] || a[n - 1].id === b[n - 1].id
}

/** The window's chat source, as a zustand-v5 selector. v5 dropped the
    equality-fn argument, so the selector memoizes instead: as long as the only
    difference is the live tail's rewritten body, it keeps returning the
    PREVIOUS array — same reference, so the list subscriber never re-renders
    mid-stream. One instance per subscriber (create it inside `useMemo`). */
export function makeWindowSourceSelector(): (s: { chat: ChatMessage[] }) => ChatMessage[] {
  let prev: ChatMessage[] | null = null
  return (s) => {
    prev = prev !== null && chatEqualExceptLiveTail(prev, s.chat) ? prev : s.chat
    return prev
  }
}

/** The fresh copy of a message while it is the newest in the store — the row a
    live turn streams into. Every other row gets `null` forever, so a row
    subscribed through this re-renders per chunk ONLY while it is the tail:
    chunk updates cost O(1) rows, independent of history length. */
export function liveTail(chat: readonly ChatMessage[], id: string): ChatMessage | null {
  const last = chat[chat.length - 1]
  return last && last.id === id ? last : null
}
