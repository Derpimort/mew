/* #301 — the week's day-load density tint, pinned in WeekColumns' real markup.
   The app's vitest is headless (no jsdom), and under server rendering zustand
   reads the store's INITIAL snapshot (the WeekColumns.a11y precedent) — so
   this suite pins the store-independent contract: a cold start renders NO
   tint class and NO hours label (the data floor claims nothing). The
   populated contract is split the #303 way — the level/label/line logic is
   pure and pinned in domain/__tests__/dayload.test.ts; the tinted real DOM
   (class present, header aria-label speaking the hours) is asserted by the
   shoot gate's day-load phase against the seeded week. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WeekColumns } from '../WeekColumns'

describe('#301 — below the data floor the grid claims nothing', () => {
  const html = renderToStaticMarkup(<WeekColumns />)

  it('cold start: no tint class lands on any day column', () => {
    expect(html).toContain('nxb-col') // the columns rendered…
    expect(html).not.toContain('wk-load') // …but none claims a density
  })

  it('cold start: no header carries an hours label — no numbers from noise', () => {
    expect(html).not.toContain('your usual is')
    expect(html).not.toContain('holds ')
  })

  it('and no inline background is smuggled past the tokens', () => {
    expect(html).not.toMatch(/style="[^"]*background/)
  })
})
