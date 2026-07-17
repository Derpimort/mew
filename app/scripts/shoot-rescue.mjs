/* Rescue proof (#286): an inbound meeting lands on planned work → ONE rescue
   message with one-tap chips → a tap re-plans through the keyless floor.
   Drives the __mewSimulatePull dev seam against a served dist and fails loudly
   on any miss: build identity, exactly-one-offer delta, dedupe on a second
   pull, and the tapped split actually reshaping the day.
   Usage: node scripts/shoot-rescue.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { findChromium } from './lib/chromium.mjs'

const base = process.argv[2] ?? 'http://localhost:5199'
const exe = findChromium()
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 840 } })
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text())
})
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

const assert = (cond, msg) => {
  if (!cond) {
    console.log('RESCUE FAIL:', msg)
    process.exitCode = 1
    throw new Error(msg)
  }
}

/* fail with pixels, same pattern as shoot.mjs */
let phase = 'boot'
let failing = false
process.on('uncaughtException', (err) => {
  if (failing) return
  failing = true
  console.log(`SHOOT FAIL during ${phase}:`, err)
  setTimeout(() => process.exit(1), 8000)
  page
    .screenshot({ path: `${outDir}/fail-rescue-${phase}.png` })
    .then(() => console.log('fail shot →', `${outDir}/fail-rescue-${phase}.png`))
    .catch(() => {})
    .finally(() => process.exit(1))
})

/* 0 · build-identity guard: the served page must carry THIS checkout's bundle,
   or the proof would be shot against someone else's build */
phase = 'identity'
const distHtml = readFileSync(path.resolve('dist/index.html'), 'utf8')
const wantSrc = distHtml.match(/src="([^"]*assets\/index-[^"]+\.js)"/)?.[1]
assert(wantSrc, 'dist/index.html has no hashed index bundle — run pnpm build first')
await page.goto(`${base}/?t=9:40`)
const servedSrc = await page.evaluate(() =>
  [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).join(' ')
)
assert(
  servedSrc.includes(wantSrc),
  `served bundle (${servedSrc}) is not this build's (${wantSrc}) — wrong server?`
)
console.log('build identity:', wantSrc)

/* 1 · a deterministic stage: skip onboarding, clear today, plan one block */
phase = 'stage'
await page.waitForSelector('.nx-stage', { timeout: 15000 })
await page.evaluate(() => window.__mewConfigure?.({ hasSeenOnboarding: true }))
await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 }).catch(() => {})
const composer =
  '.prompt-row [aria-label="compose message to MEW"], .prompt-row input, .prompt-row textarea'
const sayIt = async (cmd) => {
  await page.fill(composer, cmd)
  await page.press(composer, 'Enter')
  await page.waitForTimeout(700)
}
await sayIt('clear my day so i can restart')
await sayIt('block 2h for rescue drill today at 15')

/* 2 · the landing: one simulated pull through the REAL merge + rescue path.
   Delta-count contract: exactly ONE new chips message appears. */
phase = 'landing'
const chipMsgCount = () => page.locator('.chip-choices').count()
const before = await chipMsgCount()
await page.evaluate(() =>
  window.__mewSimulatePull?.([
    { eventId: 'rc-1', title: 'Product sync', startMin: 15 * 60 + 30, endMin: 16 * 60 },
  ])
)
await page.waitForSelector('.chip-choices', { timeout: 5000 })
const afterOne = await chipMsgCount()
assert(afterOne === before + 1, `expected exactly one new rescue offer (${before} → ${afterOne})`)
const offerText = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.log')]
  return rows.map((r) => r.textContent).join('\n')
})
assert(
  /heads up — product sync at 15:30 landed on rescue drill\. want me to make room\?/i.test(
    offerText
  ),
  'the rescue line is missing or off-copy'
)
assert(!/conflict|problem|collision/i.test(offerText), 'copy broke the positive-only law')
const chips = page.locator('.chip-choices').last().locator('button')
const labels = await chips.allTextContents()
console.log('chips:', JSON.stringify(labels))
assert(labels.length >= 2, `expected ≥2 viable chips, got ${labels.length}`)
assert(
  labels.some((l) => /split around it/.test(l)),
  'split chip missing'
)
/* the shot must SHOW the offer — pin the log to its live edge first */
const stickToBottom = async () => {
  await page.evaluate(() => {
    const el = document.querySelector('.session-scroll')
    if (el) el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(400)
}
await stickToBottom()
await page.screenshot({ path: `${outDir}/rescue-chips.png` })

/* 3 · dedupe: the same listing re-pulled must not re-nudge */
phase = 'dedupe'
await page.evaluate(() =>
  window.__mewSimulatePull?.([
    { eventId: 'rc-1', title: 'Product sync', startMin: 15 * 60 + 30, endMin: 16 * 60 },
  ])
)
await page.waitForTimeout(600)
assert(
  (await chipMsgCount()) === afterOne,
  'the same landing re-pulled produced a second offer — dedupe broke'
)

/* 4 · one tap, keyless: split re-plans through the rules floor */
phase = 'tap'
await page.locator('.chip-choices button', { hasText: 'split around it' }).last().click()
await page.waitForTimeout(1200)
const logTail = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.log')]
  return rows
    .slice(-6)
    .map((r) => r.textContent)
    .join('\n')
})
console.log('log tail:', logTail.slice(-300).replace(/\s+/g, ' '))
assert(
  /rescue drill is now 15:00–15:30/i.test(logTail),
  'the split did not shrink the block to the meeting edge'
)
assert(
  /16:00–17:00 is held for rescue drill \(part 2\)/i.test(logTail),
  'the split did not place the kept tail after the meeting'
)
await stickToBottom()
await page.screenshot({ path: `${outDir}/rescue-picked.png` })

await browser.close()
console.log('done →', `${outDir}/rescue-chips.png`, `${outDir}/rescue-picked.png`)
