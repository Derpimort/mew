/* The Focus dial's day picker (#23 slice 2) — driven through the REAL built app
   like the other specs (keyless floor, fixed clock ?t=09:40, fresh context per
   test), proving #23's WCAG items live:

   - the date is a real button: named by the date it shows (WCAG 2.5.3),
     aria-haspopup/aria-expanded, its glyph revealed by keyboard focus too
   - a modal dialog with a month grid; the picker opens on the dial's day with
     ONE roving tab stop; ←/→/↑/↓, Home/End and PageUp/PageDown move it
   - Enter picks: the dial shows that day and focus returns to the trigger
   - Escape closes AHEAD of the dial: nothing demotes, no page listener hears
     it, focus returns to the trigger — with a control proving the same key on
     the live arc does demote, so the harness would see one
   - Tab is trapped; the month buttons page without stealing focus; a press
     outside dismisses
   - the picked day survives Focus → Week → Focus (one focusedDayKey)

   Dates are computed from the machine clock (the seed is clock-anchored), so
   the spec holds on any weekday and across month edges. */

import { test, expect, type Page } from '@playwright/test'
import { boot } from './helpers'

declare global {
  interface Window {
    /** Escape keydowns that reached a window listener (the precedence probe). */
    __escHeard?: number
  }
}

const p2 = (n: number) => String(n).padStart(2, '0')
const keyOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`

/** Local YYYY-MM-DD for today+delta — matches domain dayKey (local, not UTC). */
function localDayKey(delta: number): string {
  const d = new Date()
  d.setDate(d.getDate() + delta)
  return keyOf(d)
}

/** Monday-based weekday of today: Mon 0 … Sun 6 (MEW's weeks). */
const mon0 = () => (new Date().getDay() + 6) % 7

/** The same day-of-month `n` months on, clamped to that month's length. */
function addMonths(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const last = new Date(y, m - 1 + n + 1, 0).getDate()
  return keyOf(new Date(y, m - 1 + n, Math.min(d, last)))
}

const trigger = (page: Page) => page.locator('.nx-day-pick')
const dialog = (page: Page) => page.getByRole('dialog', { name: 'pick a day for the focus dial' })
const activeDay = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('data-daykey') ?? null)
const focusOnTrigger = (page: Page) =>
  page.evaluate(() => document.activeElement?.classList.contains('nx-day-pick') ?? false)
const focusInside = (page: Page) =>
  page.evaluate(() => !!document.activeElement?.closest('[role="dialog"].dp'))

async function openByKeyboard(page: Page) {
  await trigger(page).focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
}

async function press(page: Page, key: string, expected: string) {
  await page.keyboard.press(key)
  await expect.poll(() => activeDay(page), { message: `${key} → ${expected}` }).toBe(expected)
}

test.describe('the Focus dial day picker (#23 slice 2)', () => {
  test('the date is a real button that names its day and opens a modal grid on it', async ({
    page,
  }) => {
    await boot(page)
    const t = trigger(page)
    await expect(t).toHaveAttribute('aria-haspopup', 'dialog')
    await expect(t).toHaveAttribute('aria-expanded', 'false')
    const shown = ((await page.locator('.nx-day-pick .dt').textContent()) ?? '').trim()
    expect(shown).not.toBe('')
    await expect(t).toHaveAccessibleName(`${shown} — change day`) // the visible date leads the name

    // the glyph hides at rest and shows for keyboard focus exactly as for hover
    const glyph = () => page.locator('.nx-day-glyph').evaluate((el) => getComputedStyle(el).opacity)
    await page.mouse.move(1, 1)
    await expect.poll(glyph).toBe('0')
    await t.focus()
    await expect.poll(glyph).toBe('1')

    await page.keyboard.press('Enter')
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page)).toHaveAttribute('aria-modal', 'true')
    await expect(t).toHaveAttribute('aria-expanded', 'true')
    await expect(dialog(page).getByRole('grid')).toBeVisible()

    const today = localDayKey(0)
    await expect.poll(() => activeDay(page)).toBe(today)
    const cell = page.locator(`.dp td[data-daykey="${today}"]`)
    await expect(cell).toHaveAttribute('aria-selected', 'true')
    await expect(cell).toHaveAttribute('aria-current', 'date')
    await expect(page.locator('.dp td[tabindex="0"]')).toHaveCount(1)
  })

  test('arrows, week edges and pages move the day; Enter picks it and focus comes home', async ({
    page,
  }) => {
    await boot(page)
    await openByKeyboard(page)
    await press(page, 'ArrowRight', localDayKey(1))
    await press(page, 'ArrowDown', localDayKey(8))
    await press(page, 'ArrowUp', localDayKey(1))
    await press(page, 'ArrowLeft', localDayKey(0))
    await press(page, 'Home', localDayKey(-mon0()))
    await press(page, 'End', localDayKey(6 - mon0()))
    const sunday = localDayKey(6 - mon0())
    await press(page, 'PageDown', addMonths(sunday, 1))
    await press(page, 'PageUp', addMonths(addMonths(sunday, 1), -1))
    await press(page, 'Shift+PageDown', addMonths(addMonths(addMonths(sunday, 1), -1), 12))
    await expect(page.locator('.dp td[tabindex="0"]')).toHaveCount(1) // still one stop

    // pick the day before today with Enter
    await page.keyboard.press('Escape')
    await openByKeyboard(page)
    const yesterday = localDayKey(-1)
    await press(page, 'ArrowLeft', yesterday)
    await page.keyboard.press('Enter')
    await expect(dialog(page)).toHaveCount(0)
    await expect.poll(() => focusOnTrigger(page)).toBe(true)
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.nx-stage')).toHaveAttribute(
      'aria-label',
      /^focus dial: 12-hour clock showing the tasks for /
    )
    await expect(page.locator('.nx-count')).toHaveCount(0) // no now off today
    await expect(page.getByRole('button', { name: 'back to today' })).toBeVisible()

    // it reopens on the picked day; "today" brings the live dial back
    await openByKeyboard(page)
    await expect.poll(() => activeDay(page)).toBe(yesterday)
    await expect(page.locator(`.dp td[data-daykey="${yesterday}"]`)).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await dialog(page).getByRole('button', { name: 'today', exact: true }).click()
    await expect(dialog(page)).toHaveCount(0)
    await expect.poll(() => focusOnTrigger(page)).toBe(true)
    await expect(page.locator('.nx-count')).toBeVisible()
  })

  test('Escape closes the picker ahead of the dial: no demote, no page listener, focus home', async ({
    page,
  }) => {
    await boot(page)
    const centre = page.locator('.clk-center .nx-task')
    const live = ((await centre.textContent()) ?? '').trim()
    expect(live).not.toBe('')
    await page.evaluate(() => {
      window.__escHeard = 0
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.__escHeard = (window.__escHeard ?? 0) + 1
      })
    })

    await openByKeyboard(page)
    await press(page, 'ArrowRight', localDayKey(1)) // moved, not picked
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect.poll(() => focusOnTrigger(page)).toBe(true)
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
    expect(await page.evaluate(() => window.__escHeard)).toBe(0)
    await expect(centre).toHaveText(live) // the live item still holds the centre
    await expect(page.locator('.nx-count')).toBeVisible()
    await expect(page.locator('.nx-stage')).toHaveAttribute(
      'aria-label',
      "focus dial: 12-hour clock showing today's tasks"
    )

    // control: the same key on the live arc DOES demote, and a window listener hears it
    await page.focus('.nx-stage svg [role="button"][tabindex="0"]')
    await page.keyboard.press('Escape')
    await expect(centre).not.toHaveText(live)
    expect(await page.evaluate(() => window.__escHeard)).toBe(1)
  })

  test('Tab stays inside; the month buttons page in place; a press outside dismisses', async ({
    page,
  }) => {
    await boot(page)
    await openByKeyboard(page)
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      expect(await focusInside(page), `Tab ${i + 1} stays in the picker`).toBe(true)
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await focusInside(page), `Shift+Tab ${i + 1} stays in the picker`).toBe(true)
    }

    const heading = dialog(page).locator('.dp-month')
    const month = ((await heading.textContent()) ?? '').trim()
    await dialog(page)
      .getByRole('button', { name: /^next month — / })
      .click()
    await expect(heading).not.toHaveText(month)
    expect(await page.evaluate(() => document.activeElement?.className)).toBe('dp-nav')
    await dialog(page)
      .getByRole('button', { name: /^previous month — / })
      .click()
    await expect(heading).toHaveText(month)

    await page.locator('.nx-stage').click({ position: { x: 12, y: 600 } }) // clear stage corner
    await expect(dialog(page)).toHaveCount(0)
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('the picked day survives Focus → Week → Focus', async ({ page }) => {
    await boot(page)
    // a neighbour inside this Mon–Sun week: tomorrow on Mondays, else yesterday
    const target = localDayKey(mon0() === 0 ? 1 : -1)
    await openByKeyboard(page)
    await press(page, mon0() === 0 ? 'ArrowRight' : 'ArrowLeft', target)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'back to today' })).toBeVisible()
    const label = await page.locator('.nx-stage').getAttribute('aria-label')

    await page.locator('.seg2 button', { hasText: 'Week' }).click()
    await expect(page.locator(`.nxb-col.today[data-daykey="${target}"]`)).toBeVisible()

    await page.locator('.seg2 button', { hasText: 'Focus' }).click()
    await expect(page.locator('.nx-stage')).toHaveAttribute('aria-label', label ?? '')
    await openByKeyboard(page)
    await expect(page.locator(`.dp td[data-daykey="${target}"]`)).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })
})
