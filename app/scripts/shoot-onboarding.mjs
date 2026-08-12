/* e2e + screenshots for first-run onboarding (#160 tour + #306 guided steps) —
   drives the BUILT app the way a new user meets it: fresh IndexedDB → the tour
   opens over the dial → step through Focus → Week → Talk → Start → the three
   guided steps (Keys, Calendar, Plan today) → send the canned braindump → pick
   a scenario → a planned day with tool-card receipts → reload → onboarding is
   gone for good. Captures a shot per panel. Uses the same playwright-core
   harness as the other shoot scripts (no extra test runner).
   Usage: node scripts/shoot-onboarding.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { findChromium } from './lib/chromium.mjs'
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

/* Start → the guided steps begin (#306) — the tour no longer closes here */
await page.click('.ob-nav .btn-primary')

const cardText = () => page.textContent('.ob-card')
const onStep = (n) =>
  page.waitForFunction(
    (re) => new RegExp(re).test(document.querySelector('.ob-card')?.textContent ?? ''),
    `Step ${n} of 3`,
    { timeout: 8000 }
  )

/* Step 1 · Keys — the #161 probe field is reused; "later" keeps the keyless floor */
await onStep(1)
if (!(await page.$('input[aria-label="Anthropic API key"]')))
  fail('keys step is missing the reused probe field')
if (!/later — stay keyless/.test((await cardText()) ?? '')) fail('keys step has no keyless "later"')
await page.screenshot({ path: `${outDir}/4-keys.png` })
await page.click('.ob-later')

/* Step 2 · Calendar — the three loopback redirect URIs (copyable) + client-id field */
await onStep(2)
const uris = await page.$$eval('.ob-uri code', (els) => els.map((e) => e.textContent ?? ''))
for (const port of [17893, 17894, 17895]) {
  if (!uris.some((u) => u.includes(`localhost:${port}`)))
    fail(`calendar step missing redirect URI for port ${port}`)
}
if (!(await page.$('input[aria-label="Google OAuth client ID"]')))
  fail('calendar step missing the client-id field')
await page.screenshot({ path: `${outDir}/5-calendar.png` })
await page.click('.ob-later')

/* Step 3 · Plan today — the canned braindump is prefilled + editable */
await onStep(3)
const dump = await page.$eval('textarea[aria-label="your first braindump"]', (el) => el.value)
if (!/block .*launch plan/i.test(dump)) fail('plan step braindump is not prefilled')
await page.screenshot({ path: `${outDir}/6-plan.png` })

/* plan my day → the modal closes for good and the keyless picker appears */
await page.click('.ob-foot .btn-primary')
await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 })
await page.waitForSelector('.scn-card', { timeout: 15000 })
if ((await page.$$eval('.scn-card', (els) => els.length)) < 2)
  fail('the keyless braindump did not offer the scenario picker')
await page.screenshot({ path: `${outDir}/7-picker.png` })

/* pick the first scenario → the first placed day, with tool-card receipts (#294) */
await page.click('.scn-card button')
await page.waitForSelector('.tool-card', { timeout: 10000 })
await page.screenshot({ path: `${outDir}/8-planned.png` })
if (!(await page.isVisible('.nx-stage'))) fail('the stage is not visible after onboarding')

/* reload — onboarding must NOT return (persisted flag) */
await page.reload()
await page.waitForSelector('.nx-stage', { timeout: 15000 })
await page.waitForTimeout(800)
if (await page.$('.ob-scrim')) fail('onboarding reappeared after reload')
else console.log('✓ onboarding gone after reload')

/* and Skip all on a fresh run jumps straight to the week (skips ALL of it) */
await page.evaluate(() => window.__mewReset?.())
await page.waitForSelector('.ob-scrim[role="dialog"]', { timeout: 8000 })
await page.click('.ob-skip')
await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 })
/* persistSettings is fire-and-forget (putSettings().catch()) — give the
   IndexedDB write a beat to commit before reloading, or a too-fast reload
   races the flush and the flag reads unset. A real user never reloads this
   fast; the settle just makes the harness deterministic. */
await page.waitForTimeout(400)
await page.reload()
await page.waitForSelector('.nx-stage', { timeout: 15000 })
await page.waitForTimeout(600)
if (await page.$('.ob-scrim')) fail('Skip all did not stick across reload')
else console.log('✓ Skip all sticks across reload')

await browser.close()

if (process.exitCode) console.log('\n✗ onboarding e2e: failures above')
else
  console.log(`\n✓ onboarding e2e: tour + 3 guided steps + pick + persistence verified → ${outDir}`)
