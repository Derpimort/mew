/* Core-flow E2E (issue #164) — the three journeys that fail silently if the
   UI→adapter→store glue breaks, driven through the REAL built app:

     1. talk-to-schedule  — a prompt places a real block in the week
     2. a mew             — completing the now-block celebrates + logs memory
     3. drift             — idling on a focused block raises the check-in + mirror

   Determinism, by construction (acceptance #4):
     · keyless rules floor — DEFAULT_SETTINGS ships no model key, so speak()
       resolves through domain/parse + the deterministic executor. No network,
       no model, same answer every run. (selectAdapters → [rules].)
     · fixed clock — `?t=09:40` pins "now" to 09:40 today, so the seed's
       "Q3 deck — deep work" (09:00–11:30) is the live block in every run.
     · fresh storage — each test gets its own browser context (Playwright
       default), so IndexedDB is empty and the first-run seed re-creates the
       same lived-in week from the fixed clock.

   These SUPPLEMENT the unit suites (acceptance #5): they assert the seams —
   rendered UI, the store mutation, the memory event, the notification mirror —
   never the domain math the vitest suites already own. The deterministic
   `window.__mew*` scenario hooks (defined in state/store.ts, the same family as
   __mewConfigure / __mewSetTurn) read memory and rewind idle without a wall
   clock. */

import { test, expect, type Page } from '@playwright/test'

/** Pin the clock so the seeded "now" block is identical every run. */
const AT = '?t=09:40'

/** Boot the app at the fixed clock and wait until it is actually interactive:
    the live dial has rendered (the countdown only paints once hydrate() +
    liveNow have a current block) AND the boot preloader's slide-wipe overlay
    has fully left the DOM — until then its fixed, inset-0 panel swallows the
    first click. */
async function boot(page: Page) {
  await page.goto(`/${AT}`)
  await expect(page.locator('.nx-count')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[aria-label="MEW loading"]')).toHaveCount(0, { timeout: 15_000 })
  // First-run concept tour (#160) renders over the app on a fresh context
  // (Settings.hasSeenOnboarding defaults to false) and its modal scrim
  // intercepts pointer events. Dismiss it the way a first-time user does —
  // "Skip all" — so the week underneath is interactive. dismiss() persists
  // hasSeenOnboarding for the context, so it never returns mid-test.
  await expect(page.locator('.ob-scrim')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Skip all' }).click()
  await expect(page.locator('.ob-scrim')).toHaveCount(0, { timeout: 5_000 })
}

/** The composer is a <textarea aria-label="compose message to MEW"> (its
    placeholder reads "talk to MEW…"). One send = type + Enter; we then wait for
    MEW's reply line to settle (thinking row gone). */
async function say(page: Page, text: string) {
  const box = page.getByLabel('compose message to MEW')
  await box.click()
  await box.fill(text)
  await box.press('Enter')
  // the keyless floor answers within a beat; wait for the typing row to clear
  await expect(page.locator('.mew-thinking')).toHaveCount(0, { timeout: 15_000 })
}

test.describe('MEW core flows', () => {
  test('talk-to-schedule places a real block from a plain prompt', async ({ page }) => {
    await boot(page)

    // a title that does NOT collide with anything in the seed, so finding it in
    // the week proves THIS placement (not a pre-seeded "deck") landed.
    await say(page, 'block 1h for the investor memo today')

    // UI seam #1 — the user line and MEW's factual confirmation are in the log
    const log = page.locator('.session-scroll .log')
    await expect(log.getByText('block 1h for the investor memo today')).toBeVisible()
    // execPlan's success line is "Done — … is held for investor memo …"
    await expect(log.getByText(/held for .*investor memo/i)).toBeVisible()

    // UI seam #2 — the block is really in the week grid. Today (offset 0) always
    // sits in the visible week, so no week-paging is needed; the block renders
    // as a .nxb-blk whose label carries the title.
    await page.locator('.seg2 button', { hasText: 'Week' }).click()
    await expect(page.locator('.nxb-blk').filter({ hasText: /investor memo/i })).toHaveCount(1)
  })

  test('completing the now-block is a mew — celebrates and logs memory', async ({ page }) => {
    await boot(page)

    // open the live block's detail card from the Week grid's dock (a plain
    // panel, clear of the dial's SVG), then complete it. At 09:40 the now-block
    // is the seeded "Q3 deck — deep work" (.nxb-blk.now), so its dock card
    // offers the primary "Done — a mew" action (BlockCard, isNow path).
    await page.locator('.seg2 button', { hasText: 'Week' }).click()
    await page.locator('.nxb-blk.now').first().click()
    const card = page.locator('.wk-dock .nx-card')
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: /done — a mew/i }).click()

    // store seam — a 'completed' event is appended to the (append-only) memory
    const kinds = await page.evaluate(() => window.__mewMemoryKinds?.() ?? [])
    expect(kinds.some((e) => e.kind === 'completed')).toBe(true)

    // UI seam — the celebration lands in the log (positive-only voice; a mew is
    // a completion only — there is no failure branch to assert against)
    await expect(page.locator('.session-scroll .log').getByText(/that's a mew/i)).toBeVisible()
  })

  test('idling on a focused block raises the drift check-in and mirrors it', async ({
    browser,
  }) => {
    // A fresh context so we can (a) stub the Notification API to capture the
    // mirror and (b) report the tab as hidden — the mirror fires only for what
    // the user would otherwise miss (NotifierPort: visible tabs are skipped).
    const context = await browser.newContext()
    await context.addInitScript(() => {
      // captured mirror calls — asserted after drift fires
      window.__mewNotifications = []
      class FakeNotification {
        static permission = 'granted'
        static requestPermission() {
          return Promise.resolve('granted' as NotificationPermission)
        }
        onclick: (() => void) | null = null
        constructor(title: string, opts?: { body?: string }) {
          window.__mewNotifications!.push({ title, body: opts?.body })
        }
        close() {}
      }
      ;(window as unknown as { Notification: unknown }).Notification = FakeNotification
      // a hidden tab — so notifier.mirror() does not early-return on "visible"
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    })
    const page = await context.newPage()
    try {
      await boot(page)

      // rewind last-activity past the 10-minute drift threshold and run one tick
      // — exactly how the live minute-ticker evaluates drift, minus the wait.
      await page.evaluate(() => window.__mewSetIdle?.(15))

      // UI seam — the drift check-in card is in the log, offering its actions
      const drift = page.locator('.tui-nudge', { hasText: 'nudge/drift' })
      await expect(drift).toHaveCount(1)
      await expect(drift.getByRole('button', { name: /move it/i })).toBeVisible()

      // store seam — the check-in is recorded as a 'drift' memory event
      const kinds = await page.evaluate(() => window.__mewMemoryKinds?.() ?? [])
      expect(kinds.some((e) => e.kind === 'drift')).toBe(true)

      // adapter seam — the unfocused tab got a Notification mirror of the drift
      // nudge (the seed's heavy Saturday also raises a right-size nudge at boot,
      // so we match the drift mirror by its body, not by position).
      const notes = await page.evaluate(() => window.__mewNotifications ?? [])
      const driftNote = notes.find((n) => /still on/i.test(n.body ?? ''))
      expect(driftNote, `notifications: ${JSON.stringify(notes)}`).toBeTruthy()
      expect(driftNote!.title).toMatch(/MEW/)
    } finally {
      await context.close()
    }
  })
})
