/* Ambient types for the in-page scenario hooks the E2E suite drives. These are
   defined for real in src/state/store.ts (the __mew* dev/scenario family); the
   E2E project is compiled standalone by Playwright, so it declares the slice it
   uses here rather than importing the whole app. Keep in sync with store.ts. */

export {}

declare global {
  interface Window {
    /** Stream a scripted mew reply chunk-by-chunk through speak()'s real
        per-chunk flush path (#281) — resolves when the last chunk painted. */
    __mewSayStream?: (chunks: string[], gapMs: number) => Promise<void>
    /** Rewind last-activity by `minutes` and run one tick (drift, deterministically). */
    __mewSetIdle?: (minutes: number) => void
    /** Append-only memory events, kind + day only — for asserting a flow logged what it should. */
    __mewMemoryKinds?: () => { kind: string; dayKey: string }[]
    /** Captured Notification mirrors, installed by the drift test's init script. */
    __mewNotifications?: { title: string; body?: string }[]
  }
}
