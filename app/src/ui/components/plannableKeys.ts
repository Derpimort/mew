/* The plannable-hours field's keyboard grammar (#22 slice B) as pure logic —
   the weekKeys precedent: what a keypress MEANS, unit-tested without a DOM.
   Enter settles the draft IN PLACE (focus stays on the field, so a keyboard
   user never loses their place); ↑/↓ step 5 minutes, Shift steps an hour.
   Everything else returns null and keeps its default (typing, Tab, Escape). */

export type PlannableKeyIntent = { kind: 'settle' } | { kind: 'step'; deltaMin: number } | null

export function plannableKeyIntent(key: string, shift: boolean): PlannableKeyIntent {
  if (key === 'Enter') return { kind: 'settle' }
  if (key === 'ArrowUp' || key === 'ArrowDown')
    return { kind: 'step', deltaMin: (key === 'ArrowUp' ? 1 : -1) * (shift ? 60 : 5) }
  return null
}
