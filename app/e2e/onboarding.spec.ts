/* Onboarding v2 E2E (#306) — the first five minutes, keyless and deterministic
   (rules floor, fixed clock, fresh seed — the same construction as core-flows
   and plan-picker). THIS spec IS the ≤5-min proof: a brand-new profile walks the
   concept tour, skips keys (keyless floor stays) and calendar (local-only stays),
   sends the canned braindump as a REAL turn, and picks a scenario — landing a
   planned day with tool-card receipts. Every step below is one a first-time user
   takes, and there are only a handful — the journey, not a stopwatch, is the
   proof. The engine math + store laws are owned by vitest; this proves the
   onboarding → adapter → store glue holds end to end with zero keys. */

import { test, expect } from '@playwright/test'
import { boot } from './helpers'

test.describe('onboarding v2 — fresh profile → planned day, keyless', () => {
  test('tour → later on keys → later on calendar → braindump → pick → blocks + tool cards', async ({
    page,
  }) => {
    // boot does NOT auto-skip for this spec: the onboarding modal is up. Scope
    // every assertion to the card — the stage behind it carries its own hidden
    // headings (e.g. an sr-only "Focus dial"), which a page-wide text match
    // would collide with.
    await boot(page, { skipOnboarding: false })
    const card = page.locator('.ob-card')
    await expect(card).toBeVisible()

    // 1) the concept tour (#160): Focus → Week → Talk → Start
    const primary = card.locator('.ob-nav .btn-primary')
    await expect(card.getByText('Focus dial')).toBeVisible()
    await primary.click() // → Week
    await expect(card.getByText('Week grid')).toBeVisible()
    await primary.click() // → Talk
    await expect(card.getByText('Talk to schedule')).toBeVisible()
    await primary.click() // Start → guided step 1 (keys)

    // 2) Keys — the real #161 probe field is here; "later" keeps the keyless floor
    await expect(card.getByText(/Step 1 of 3/i)).toBeVisible()
    await expect(card.getByLabel('Anthropic API key')).toBeVisible()
    await card.getByRole('button', { name: /later — stay keyless/i }).click()

    // 3) Calendar — the three loopback redirect URIs are copyable; "later" is local-only
    await expect(card.getByText(/Step 2 of 3/i)).toBeVisible()
    await expect(card.locator('.ob-uri')).toHaveCount(3)
    await expect(card.getByText('http://localhost:17893')).toBeVisible()
    await card.getByRole('button', { name: /later — stay local-only/i }).click()

    // 4) Plan today — the canned braindump is editable; sending it is a REAL turn
    await expect(card.getByText(/Step 3 of 3/i)).toBeVisible()
    const dump = card.getByLabel('your first braindump')
    await expect(dump).toHaveValue(/block .*launch plan/i)
    await card.getByRole('button', { name: /plan my day/i }).click()

    // the modal closes for good; the turn runs on the keyless rules floor
    await expect(page.locator('.ob-scrim')).toHaveCount(0, { timeout: 5_000 })
    await expect(page.locator('.mew-thinking')).toHaveCount(0, { timeout: 15_000 })

    // 5) the plan-mode picker (#293) is on screen — the guided plan flowed through
    //    the REAL picker, not a wizard-side mutation
    const cards = page.locator('.scn-card')
    await expect(cards.first()).toBeVisible()
    expect(await cards.count()).toBeGreaterThanOrEqual(2)

    // 6) pick the first scenario → the first placed day, receipt + tool cards (#294)
    await page.locator('.scn-card button').first().click()
    const log = page.locator('.session-scroll .log')
    await expect(log.getByText(/^✓?\s*Done — /).first()).toBeVisible() // the plan-voice receipt
    expect(await page.locator('.tool-card').count()).toBeGreaterThanOrEqual(1) // the receipt IS the demo

    // 7) and the blocks are really on the week — the planned day landed. The 7-day
    //    horizon runs from TODAY, so late in a calendar week the places straddle
    //    this week and the next: count across both pages (plan-picker precedent).
    await page.locator('.seg2 button', { hasText: 'Week' }).click()
    const landed = page
      .locator('.nxb-blk')
      .filter({ hasText: /launch plan|quarterly goals|coffee chat|personal errands/i })
    let count = await landed.count()
    await page.getByRole('button', { name: 'next week' }).dispatchEvent('click')
    await page.waitForTimeout(400)
    count += await landed.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })
})
