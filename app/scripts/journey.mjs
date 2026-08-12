/* Live conversational journey — drives the real app with a real model key
   (OPENAI_API_KEY env var; never logged) through the canonical user stories,
   and prints the transcript for quality review.
   Usage: OPENAI_API_KEY=… node scripts/journey.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { findChromium } from './lib/chromium.mjs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5199'
const key = process.env.OPENAI_API_KEY
if (!key) {
  console.error('OPENAI_API_KEY not set')
  process.exit(1)
}
const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
const exe = findChromium()

const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 840 } })).newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

await page.goto(`${base}/?t=9:40`)
await page.waitForSelector('.prompt-row input', { timeout: 10000 })
await page.waitForTimeout(800)

await page.evaluate(
  ([k, m]) => window.__mewConfigure({ remoteProvider: 'openai', openaiKey: k, openaiModel: m }),
  [key, model]
)

async function say(text) {
  await page.fill('.prompt-row input', text)
  await page.press('.prompt-row input', 'Enter')
  // wait for the thinking blink in the log to clear (model round trips)
  await page.waitForTimeout(400)
  await page
    .waitForFunction(() => !document.querySelector('.session-scroll .log .blink'), null, {
      timeout: 45000,
    })
    .catch(() => console.log('  (timed out waiting for reply)'))
  await page.waitForTimeout(400)
}

const journeys = [
  'good morning pixie',
  'block thursday morning for the deck and keep friday afternoon free, also i should call the bank sometime',
  'actually move the deck to friday morning instead',
  'how is my week looking?',
  'cleanup my calendar so i can restart and plan',
  'plan a focused tomorrow: 3h deep work on the spec in the morning and a walk at 4pm',
]

for (const j of journeys) {
  console.log(`\nyou ❯ ${j}`)
  await say(j)
  const tail = await page.$$eval('.session-scroll .log > div, .session-scroll .tui-nudge', (els) =>
    els.slice(-4).map((e) => e.textContent?.replace(/\s+/g, ' ').trim())
  )
  for (const line of tail) console.log(`  ${line}`)
}

/* verify state landed where the words said */
await page.click('.seg2 button:has-text("Week")')
await page.waitForTimeout(600)
const blocks = await page.$$eval('.nxb-blk', (els) => els.map((e) => e.getAttribute('title')))
console.log('\nweek blocks after journey:')
for (const b of blocks) console.log('  ·', b)
await page.screenshot({ path: 'shots/j1-journey-week.png' })
await page.click('.seg2 button:has-text("Focus")')
await page.waitForTimeout(600)
await page.screenshot({ path: 'shots/j2-journey-focus.png' })

await browser.close()
console.log('\njourney done')
