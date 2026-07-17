/* Shared E2E boot for the built app (used by every spec in this directory).
   Determinism, by construction (#164): keyless rules floor (DEFAULT_SETTINGS
   ships no model key), a fixed clock via `?t=`, and Playwright's fresh browser
   context per test so the first-run seed re-creates the same lived-in week. */

import { expect, type Page } from '@playwright/test'

/** Pin the clock so the seeded "now" block is identical every run. */
export const AT = '?t=09:40'

/** Boot the app at the fixed clock and wait until it is actually interactive:
    the live dial has rendered (the countdown only paints once hydrate() +
    liveNow have a current block) AND the boot preloader's slide-wipe overlay
    has fully left the DOM — until then its fixed, inset-0 panel swallows the
    first click. */
export async function boot(page: Page, opts: { skipOnboarding?: boolean } = {}) {
  const { skipOnboarding = true } = opts
  await page.goto(`/${AT}`)
  await expect(page.locator('.nx-count')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[aria-label="MEW loading"]')).toHaveCount(0, { timeout: 15_000 })
  // First-run onboarding (#160 tour + #306 guided steps) renders over the app on
  // a fresh context (Settings.hasSeenOnboarding defaults to false) and its modal
  // scrim intercepts pointer events. Most specs dismiss it the way a first-time
  // user does — "Skip all" — so the week underneath is interactive; dismiss()
  // persists hasSeenOnboarding for the context, so it never returns mid-test.
  // The onboarding spec (#306) is the exception: it passes skipOnboarding:false
  // to drive the full first-five-minutes journey itself.
  await expect(page.locator('.ob-scrim')).toBeVisible({ timeout: 15_000 })
  if (skipOnboarding) {
    await page.getByRole('button', { name: 'Skip all' }).click()
    await expect(page.locator('.ob-scrim')).toHaveCount(0, { timeout: 5_000 })
  }
}
