/** The assertive-region copy for a turn, as a pure edge function: a rising edge
    of `thinking` announces the start, a falling edge announces completion, and a
    same-value tick stays quiet (returns the prior message so nothing re-fires).
    Kept pure + in its own module so the announce contract is unit-tested without
    a DOM, and so SessionLog stays a components-only file for Fast Refresh
    (react-refresh/only-export-components). */
export function streamAnnouncement(prev: string, was: boolean, now: boolean): string {
  if (now && !was) return 'mew is responding…'
  if (!now && was) return 'response complete'
  return prev
}
