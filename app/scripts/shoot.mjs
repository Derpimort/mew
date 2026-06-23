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

/* 1 · Focus dial at the canonical 9:40 — minimal at rest, then hover reveal */
await page.goto(`${base}/?t=9:40`)
await page.waitForSelector('.nx-count', { timeout: 10000 })
await page.waitForTimeout(1500)
console.log('count:', await page.textContent('.nx-count'))
console.log('task:', await page.textContent('.nx-task'))
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
   <textarea> (auto-grow, multi-line) — match both so the selector survives the
   input→textarea change, mirroring scripts/shoot-overlap.mjs. */
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
