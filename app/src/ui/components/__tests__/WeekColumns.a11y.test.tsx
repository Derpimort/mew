/* #303 — the week grid's keyboard/screen-reader chrome. The app's vitest is
   headless (no jsdom), and under server rendering zustand reads the store's
   INITIAL snapshot (SessionLog.a11y precedent) — so this suite pins the
   store-independent contract in WeekColumns' real markup: the application
   role, the spoken grammar hint it points at, and the polite live region the
   keyboard announcements ride. The per-tile contract (exactly one roving
   tabindex=0, spoken names incl. "from your calendar") is pure logic pinned in
   weekKeys.test.ts and verified on the real DOM by the shoot a11y gate + e2e. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WeekColumns } from '../WeekColumns'

describe('#303 — the week grid is a keyboard application surface', () => {
  const html = renderToStaticMarkup(<WeekColumns />)

  it('the grid carries role=application with a descriptive name (APG, like the dial)', () => {
    expect(html).toMatch(/class="wk-grid"[^>]*role="application"/)
    expect(html).toMatch(/class="wk-grid"[^>]*aria-label="week grid[^"]*"/)
  })

  it('aria-describedby resolves to the sr-only grammar hint', () => {
    expect(html).toMatch(/class="wk-grid"[^>]*aria-describedby="wk-hint"/)
    expect(html).toMatch(/id="wk-hint" class="sr-only"/)
    // the hint teaches all three chords: move focus, nudge, resize
    expect(html).toContain('arrows move between blocks')
    expect(html).toContain('shift with an arrow nudges a block 15 minutes')
    expect(html).toContain('alt with up or down resizes')
  })

  it('ships the polite live region the nudge/resize announcements ride', () => {
    expect(html).toMatch(/role="status" aria-live="polite"/)
    expect(html).toMatch(/class="sr-only" role="status"/)
  })
})
