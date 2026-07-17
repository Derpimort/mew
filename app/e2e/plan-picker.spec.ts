/* Plan mode E2E (#293) — the propose → pick → exact-apply loop through the
   REAL built app, keyless and deterministic (rules floor, fixed clock, fresh
   seed — the same construction as core-flows). This asserts the seams: the
   braindump posts the picker cards, a pick lands real blocks on the week
   grid, and the picked card settles inert. The engine math and the store
   laws are owned by the vitest suites; this proves the UI→adapter→store
   glue holds end to end with zero keys. */

import { test, expect, type Page } from '@playwright/test'
import { boot } from './helpers'

/** Six separate, un-pinned items — each clause carries its own verb so the
    keyless grammar parses one place per clause; ≥3 un-pinned items routes the
    ask to the scenario picker (planMode default 'auto'). Titles avoid the
    seed so every landing provably comes from THIS pick. */
const BRAINDUMP = 'block the investor memo, block budget review, block a gym session, block errands'

async function say(page: Page, text: string) {
  const box = page.getByLabel('compose message to MEW')
  await box.click()
  await box.fill(text)
  await box.press('Enter')
  await expect(page.locator('.mew-thinking')).toHaveCount(0, { timeout: 15_000 })
}

test.describe('plan mode — braindump → picker → pick → blocks on the week', () => {
  test('a keyless multi-task braindump proposes scenarios and the pick applies them', async ({
    page,
  }) => {
    await boot(page)

    await say(page, BRAINDUMP)

    // the picker is on screen: ≥2 scenario cards, each an article with a
    // 7-column strip and a real pick button — and the week is still untouched
    const cards = page.locator('.scn-card')
    await expect(cards.first()).toBeVisible()
    expect(await cards.count()).toBeGreaterThanOrEqual(2)
    await expect(page.locator('.scn-card .scn-strip').first()).toBeVisible()
    expect(await page.locator('.scn-card .scn-day').count()).toBeGreaterThanOrEqual(14)
    await page.locator('.seg2 button', { hasText: 'Week' }).click()
    await expect(page.locator('.nxb-blk').filter({ hasText: /investor memo/i })).toHaveCount(0)
    await page.locator('.seg2 button', { hasText: 'Focus' }).click()

    // pick the first scenario — the stored quote applies through the plan
    // executor: a receipt card + the plan-voice confirmation land in the log
    await page.locator('.scn-card button').first().click()
    const log = page.locator('.session-scroll .log')
    await expect(log.getByText(/^✓?\s*Done — /).first()).toBeVisible()

    // the picked card settles inert with its ✓; every sibling goes inert too
    await expect(page.locator('.scn-card button', { hasText: /picked/ }).first()).toBeVisible()
    for (const btn of await page.locator('.scn-card button').all()) {
      await expect(btn).toBeDisabled()
    }

    // and the blocks are really on the week grid — the preview landed. The
    // 7-day horizon runs from TODAY, so late in a calendar week the places
    // straddle this week and the next: count across both pages.
    await page.locator('.seg2 button', { hasText: 'Week' }).click()
    const landed = page
      .locator('.nxb-blk')
      .filter({ hasText: /investor memo|budget review|gym session|errands/i })
    let count = await landed.count()
    /* dispatch, not click: the pager lives in a clipped header this viewport
       can't scroll into the hit-test box; the handler is what pages the week */
    await page.getByRole('button', { name: 'next week' }).dispatchEvent('click')
    await page.waitForTimeout(400)
    count += await landed.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })
})
