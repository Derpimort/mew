/* e2e for the first-run concept tour (#160) — drives the BUILT app the way a
   new user meets it: fresh IndexedDB → the tour opens over the dial → step
   through Focus → Week → Talk → Start → reload → the tour is gone for good.
   Mirrors acceptance: "navigate 3 steps, dismiss, reload, assert modal gone."
   Uses the same playwright-core harness as the other shoot scripts (no extra
   test runner). Usage: node scripts/shoot-onboarding.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5199'
const outDir = path.resolve('shots/onboarding')
mkdirSync(outDir, { recursive: true })

function findChromium() {
  if (process.env.PW_CHROMIUM && existsSync(process.env.PW_CHROMIUM)) return process.env.PW_CHROMIUM
  const root = path.join(os.homedir(), '.cache/ms-playwright')
  try {
    const dir = readdirSync(root)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse()[0]
    for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = dir && path.join(root, dir, rel)
      if (p && existsSync(p)) return p
    }
  } catch {
    /* fall through */
  }
  return path.join(root, 'chromium-1223/chrome-linux64/chrome')
}

const browser = await chromium.launch({ executablePath: findChromium() })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 840 } })).newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

const fail = (msg) => {
  console.log(`✗ ${msg}`)
  process.exitCode = 1
}

/* fresh context = empty IndexedDB = first run. Start clean to be certain, then
   reload into the genuine first-run state. */
await page.goto(`${base}/?t=9:40`)
await page.waitForSelector('.nx-stage', { timeout: 15000 })
await page.evaluate(() => window.__mewReset?.())
await page.waitForSelector('.nx-stage', { timeout: 15000 })

/* the tour opens, on step one (Focus) */
await page.waitForSelector('.ob-scrim[role="dialog"]', { timeout: 8000 })
const stepOne = await page.textContent('.ob-card')
if (!/Focus dial/.test(stepOne ?? '')) fail('step 1 is not the Focus dial')
if (!/1 \/ 3/.test(stepOne ?? '')) fail('step counter not at 1 / 3')
await page.screenshot({ path: `${outDir}/1-focus.png` })

/* Next → step two (Week) */
await page.click('.ob-nav .btn-primary')
await page.waitForTimeout(400)
if (!/Week grid/.test((await page.textContent('.ob-card')) ?? ''))
  fail('step 2 is not the Week grid')
await page.screenshot({ path: `${outDir}/2-week.png` })

/* Next → step three (Talk) — the primary now reads "Start" */
await page.click('.ob-nav .btn-primary')
await page.waitForTimeout(400)
const stepThree = await page.textContent('.ob-card')
if (!/Talk to schedule/.test(stepThree ?? '')) fail('step 3 is not Talk to schedule')
if (!/3 \/ 3/.test(stepThree ?? '')) fail('step counter not at 3 / 3')
await page.screenshot({ path: `${outDir}/3-talk.png` })

/* Start → the tour closes and the week is usable */
await page.click('.ob-nav .btn-primary')
await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 })
const stageHittable = await page.isVisible('.nx-stage')
if (!stageHittable) fail('the stage is not visible after dismissing the tour')

/* reload — the tour must NOT return (persisted flag) */
await page.reload()
await page.waitForSelector('.nx-stage', { timeout: 15000 })
await page.waitForTimeout(800)
if (await page.$('.ob-scrim')) fail('the tour reappeared after reload')
else console.log('✓ tour gone after reload')

/* and Skip all on a fresh run jumps straight to the week */
await page.evaluate(() => window.__mewReset?.())
await page.waitForSelector('.ob-scrim[role="dialog"]', { timeout: 8000 })
await page.click('.ob-skip')
await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 })
await page.reload()
await page.waitForSelector('.nx-stage', { timeout: 15000 })
await page.waitForTimeout(600)
if (await page.$('.ob-scrim')) fail('Skip all did not stick across reload')
else console.log('✓ Skip all sticks across reload')

await browser.close()

if (process.exitCode) console.log('\n✗ onboarding e2e: failures above')
else console.log(`\n✓ onboarding e2e: all steps + dismiss + persistence verified → ${outDir}`)
