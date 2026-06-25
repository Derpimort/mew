/* The loose-thread states and their glyph/label/color, in fixed display order
   (running → slipped → paused → unplaced). Kept in its own module so ThreadRail
   stays a components-only file for Fast Refresh
   (react-refresh/only-export-components). */

export type ThreadState = 'running' | 'slipped' | 'paused' | 'unplaced'

export const THREAD_STATES: Record<ThreadState, { glyph: string; label: string; color: string }> = {
  running: { glyph: '◐', label: 'running', color: 'var(--ice)' },
  slipped: { glyph: '↪', label: 'slipped', color: 'var(--gold)' },
  paused: { glyph: '‖', label: 'paused', color: 'var(--muted)' },
  unplaced: { glyph: '○', label: 'unplaced', color: 'var(--faint)' },
}
