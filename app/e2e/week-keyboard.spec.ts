/* Keyboard-first week E2E (#303) — the seeded week re-planned mouse-free,
   driven through the REAL built app exactly like core-flows (#164): keyless
   rules floor, fixed clock (?t=09:40), fresh context per test.

   The journey the issue names: focus (one roving tab stop, arrows traverse)
   → move ±15 min (Shift+↑/↓) → day hop (Shift+←/→) → resize (Alt+↑/↓) — every
   commit through the store's dragMove door (pinned store-side in
   scenarios.test.ts; here we assert the UI seams: the focused tile's spoken
   label, the polite live region, and the tile really rendering in its new
   column). The seed is clock-anchored, so today's blocks are the same every
   run; the day hop targets tomorrow (or yesterday on Sundays, when the visible
   week ends at today) at 18:00 — free in every seeded neighbour day. */

import { test, expect, type Page } from '@playwright/test'
import { boot } from './helpers'

const activeLabel = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')

/** Wait for the roving rAF refocus to settle on a label matching `re`. */
async function expectFocus(page: Page, re: RegExp) {
  await expect.poll(() => activeLabel(page), { message: `focus should read ${re}` }).toMatch(re)
}

/** Arrow-walk the roving focus (mouse-free) until the label matches `re`. */
async function arrowTo(page: Page, re: RegExp, max = 20) {
  for (let i = 0; i < max; i++) {
    if (re.test(await activeLabel(page))) return
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(60) // the roving refocus rides a rAF
  }
  expect(re.test(await activeLabel(page)), `never arrowed to ${re}`).toBe(true)
}

/** Local YYYY-MM-DD for today+delta — matches domain dayKey (local, not UTC). */
function localDayKey(delta: number): string {
  const d = new Date()
  d.setDate(d.getDate() + delta)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function openWeek(page: Page) {
  await page.locator('.seg2 button', { hasText: 'Week' }).click()
  await expect(page.locator('.nxb-blk').first()).toBeVisible()
}

test.describe('keyboard-first week (#303)', () => {
  test('the grid has exactly one tab stop and every tile a spoken name', async ({ page }) => {
    await boot(page)
    await openWeek(page)
    const tiles = page.locator('.nxb-blk')
    const count = await tiles.count()
    expect(count).toBeGreaterThan(5) // the seeded week is lived-in
    await expect(page.locator('.nxb-blk[tabindex="0"]')).toHaveCount(1) // roving
    await expect(page.locator('.nxb-blk[tabindex="-1"]')).toHaveCount(count - 1)
    const unnamed = await page
      .locator('.nxb-blk')
      .evaluateAll((els) => els.filter((el) => !el.getAttribute('aria-label')?.trim()).length)
    expect(unnamed).toBe(0)
  })

  test('a seeded week is re-planned mouse-free: focus → move → resize → day hop', async ({
    page,
  }) => {
    await boot(page)
    await openWeek(page)

    // ── focus: Tab's single landing spot is the live block; arrows traverse
    await page.focus('.nxb-blk[tabindex="0"]')
    await expectFocus(page, /^Q3 deck/) // 9:40's now-block holds the roving stop
    await arrowTo(page, /^Reply to Sam/)
    await expectFocus(page, /^Reply to Sam, 14:30 to 15:00$/)

    // ── move ±15 min: Shift+↓ commits through the drag door and announces
    await page.keyboard.press('Shift+ArrowDown')
    await expectFocus(page, /^Reply to Sam, 14:45 to 15:15$/)
    await expect(page.locator('[data-wk-live]')).toHaveText(
      'Reply to Sam, 14:30 to 15:00, moved to 14:45'
    )
    await page.keyboard.press('Shift+ArrowUp') // and it reverses cleanly
    await expectFocus(page, /^Reply to Sam, 14:30 to 15:00$/)

    // ── resize: Alt+↓ grows the end a step, Alt+↑ takes it back
    await page.keyboard.press('Alt+ArrowDown')
    await expectFocus(page, /^Reply to Sam, 14:30 to 15:15$/)
    await expect(page.locator('[data-wk-live]')).toHaveText('Reply to Sam, now 14:30 to 15:15')
    await page.keyboard.press('Alt+ArrowUp')
    await expectFocus(page, /^Reply to Sam, 14:30 to 15:00$/)

    // ── day hop: Shift+←/→ carries the block to the neighbour column, focus follows
    await arrowTo(page, /^Rest — earned, 18:00 to 19:00/)
    const sunday = new Date().getDay() === 0 // the visible week ends at today
    const hopKey = localDayKey(sunday ? -1 : 1)
    await page.keyboard.press(sunday ? 'Shift+ArrowLeft' : 'Shift+ArrowRight')
    await expectFocus(page, /^Rest — earned, 18:00 to 19:00/) // focus rode along
    await expect(
      page.locator(`[data-daykey="${hopKey}"] .nxb-blk`).filter({ hasText: /Rest — earned/ })
    ).toHaveCount(1)
    await expect(page.locator('[data-wk-live]')).toContainText('Rest, 18:00 to 19:00, moved to')

    // ── the store seam: the door's own chat line confirms the same commit
    await expect(
      page
        .locator('.session-scroll .log')
        .getByText(/^Moved — Rest/)
        .first()
    ).toBeVisible()
  })
})
