/* Visual + behavioral verification: drives the built app and captures the
   design-canonical moments (Carbon & Pet White system).
   Usage: node scripts/shoot.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5199'
const exe = path.join(os.homedir(), '.cache/ms-playwright/chromium-1223/chrome-linux64/chrome')
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 840 } })
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text())
})
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

/* fail loudly so a broken contract turns the `pnpm shoot` gate red */
const assert = (cond, msg) => {
  if (!cond) {
    console.log('A11Y FAIL:', msg)
    process.exitCode = 1
    throw new Error(msg)
  }
}

/* 1 · Focus dial at the canonical 9:40 — minimal at rest, then hover reveal */
await page.goto(`${base}/?t=9:40`)
await page.waitForSelector('.nx-count', { timeout: 10000 })
await page.waitForTimeout(1500)
console.log('count:', await page.textContent('.nx-count'))
console.log('task:', await page.textContent('.nx-task'))

/* 1a · Dial accessibility (issue #172 · WCAG 2.2 §2.1.1/§1.1.1/§4.1.2 · APG
   Application pattern). The pure nav/label logic is unit-tested; this proves the
   real DOM carries the roles, names, and roving tabindex, and that the keyboard
   actually moves + acts on focus. Any miss fails the shoot gate. */
{
  const a11y = await page.evaluate(() => {
    const stage = document.querySelector('.nx-stage')
    const arcs = [...document.querySelectorAll('.nx-stage svg [role="button"]')]
    return {
      role: stage?.getAttribute('role'),
      label: stage?.getAttribute('aria-label') ?? '',
      describedby: stage?.getAttribute('aria-describedby'),
      hintExists: !!(stage?.getAttribute('aria-describedby') && document.getElementById(stage.getAttribute('aria-describedby'))),
      heading: document.querySelector('.nx-stage h2#dial-title')?.textContent ?? '',
      arcCount: arcs.length,
      named: arcs.every((a) => (a.getAttribute('aria-label') ?? '').trim().length > 0),
      sampleName: arcs[0]?.getAttribute('aria-label') ?? '',
      tabZero: arcs.filter((a) => a.getAttribute('tabindex') === '0').length,
      tabMinus: arcs.filter((a) => a.getAttribute('tabindex') === '-1').length,
      ariaHidden: document.querySelectorAll('.nx-stage svg [aria-hidden="true"]').length,
    }
  })
  console.log('a11y:', JSON.stringify(a11y))
  assert(a11y.role === 'application', 'dial is not role=application')
  assert(/focus dial/i.test(a11y.label), 'dial application has no descriptive aria-label')
  assert(a11y.describedby && a11y.hintExists, 'aria-describedby does not resolve to a hint element')
  assert(/focus dial/i.test(a11y.heading), 'missing sr-only h2 dial heading')
  assert(a11y.arcCount >= 1, 'no arcs exposed as buttons')
  assert(a11y.named, 'an arc button has no accessible name')
  assert(a11y.tabZero === 1, `roving tabindex broken: ${a11y.tabZero} arcs have tabindex=0 (want exactly 1)`)
  assert(a11y.tabMinus >= a11y.arcCount - 1, 'non-focused arcs are not removed from the tab order')
  assert(a11y.ariaHidden >= 4, 'decorative geometry is not hidden from assistive tech')
  // the demote chip is a named button when something holds the centre
  const demoteName = await page.getAttribute('.pri-demote', 'aria-label')
  assert(demoteName && /run in background/i.test(demoteName), 'demote chip is not a named button')
  // keyboard actually moves focus and acts on it
  await page.focus('.nx-stage svg [tabindex="0"]')
  const before = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
  await page.keyboard.press('ArrowRight')
  const after = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
  assert(after && after !== before, `ArrowRight did not move focus (stayed on "${before}")`)
  // Escape demotes the centre item without throwing / losing the keyboard
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  console.log('a11y keyboard: moved focus', JSON.stringify({ before, after }))
}
await page.screenshot({ path: `${outDir}/1-focus-rest.png` })
await page.hover('.nx-stage')
await page.waitForTimeout(700)
await page.screenshot({ path: `${outDir}/2-focus-reveal.png` })

/* 2 · block detail card from an arc (fat invisible hit-targets) */
const hits = await page.$$('path[stroke="transparent"]')
if (hits[1]) {
  await hits[1].click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${outDir}/3-detail-card.png` })
  await page.mouse.click(40, 700) // dismiss
}

/* 3 · Week columns */
await page.click('.seg2 button:has-text("Week")')
await page.waitForTimeout(600)
console.log('summary:', (await page.textContent('.week-summary'))?.trim())
await page.screenshot({ path: `${outDir}/4-week.png` })

/* 4 · talk-to-schedule through the prompt (acceptance #1). The composer is a
   <textarea> (aria-label "talk to MEW", auto-grow, multi-line), not an <input>
   — match both so the selector survives the input→textarea change, mirroring
   scripts/shoot-overlap.mjs, and so this step doesn't time out. */
await page.fill('.prompt-row input, .prompt-row textarea', 'block thursday morning for the deck, keep friday afternoon free')
await page.press('.prompt-row input, .prompt-row textarea', 'Enter')
await page.waitForTimeout(900)
const log = await page.$$eval('.log', (els) => els.map((e) => e.textContent).join('\n'))
console.log('log tail:', log.slice(-220).replace(/\s+/g, ' '))
await page.screenshot({ path: `${outDir}/5-session.png` })

/* 5 · settings + retheme + light */
await page.click('text=settings')
await page.waitForSelector('.set-card h2')
await page.screenshot({ path: `${outDir}/6-settings.png` })
await page.click('.petopt:has-text("Fox")')
await page.click('.segc button:has-text("Pet white")')
await page.waitForTimeout(400)
await page.screenshot({ path: `${outDir}/7-fox-petwhite.png` })

await browser.close()
console.log('done →', outDir)
