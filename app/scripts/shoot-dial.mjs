/* Tight, high-res capture of just the focus dial — to verify the 2-ring layout
   and the bottom readout. Usage: node scripts/shoot-dial.mjs [baseUrl] */
import { chromium } from 'playwright-core'
import { findChromium } from './lib/chromium.mjs'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5199'
const t = process.argv[3] ?? '9:55'
const tag = t.replace(':', '')
const exe = findChromium()
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

await page.goto(`${base}/?t=${t}`)
await page.waitForSelector('.nx-stage')
/* Past the first-run concept tour (#171). This proof predates the tour and
   nobody ran it afterwards, so it sat red: the tour's `.ob-scrim` is a
   role=dialog laid over the whole stage, and every `stage.hover()` below timed
   out on an intercepted pointer event. The failure looked like the dial, and
   the dial was fine.
   These are the same two lines `lib/harness.mjs` `boot()` runs, deliberately
   copied rather than imported: this script builds its own browser and page, and
   migrating it to the harness the night before a promotion is a bigger change
   than the one that was needed. The WAIT is half the fix — configuring the flag
   without waiting for the scrim to detach just races it. */
await page.evaluate(() => window.__mewConfigure?.({ hasSeenOnboarding: true }))
await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 }).catch(() => {})
await page.waitForTimeout(900)

const stage = page.locator('.nx-stage')
await stage.screenshot({ path: `${outDir}/dial-${tag}-rest.png` })

// hover the stage to reveal the readout + labels, then hover a specific arc so
// the readout shows a real time range (not just the idle affordance)
await stage.hover()
await page.waitForTimeout(500)
await stage.screenshot({ path: `${outDir}/dial-hover.png` })

// try to hover an actual arc (the fat invisible hit-target) for a range readout
const arc = page.locator('.nx-stage path[stroke="transparent"]').first()
if (await arc.count()) {
  await arc.hover({ force: true }).catch(() => {})
  await page.waitForTimeout(500)
  await stage.screenshot({ path: `${outDir}/dial-hover-arc.png` })
}

await browser.close()
console.log('done: dial-rest.png, dial-hover.png, dial-hover-arc.png')
