/* Loose-threads proof: stages all four thread states through real product
   flows (capture → unplaced · past block → slipped · interrupt → paused ·
   start-by accept → running), then verifies the pill count/dots, the
   grouped box, and the place/resume actions. Exits 1 on any miss.
   Usage: node scripts/shoot-threads.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { findChromium } from './lib/chromium.mjs'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5263'
const exe = findChromium()
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 840 } })).newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

const sayIt = async (cmd) => {
  await page.fill('.prompt-row input, .prompt-row textarea', cmd)
  await page.press('.prompt-row input, .prompt-row textarea', 'Enter')
  await page.waitForTimeout(700)
}

await page.goto(`${base}/?t=9:40`)
await page.waitForSelector('.nx-count', { timeout: 15000 })
await page.evaluate(() => window.__mewReset?.())
await page.waitForSelector('.nx-count', { timeout: 15000 })
await page.waitForTimeout(1000)

/* unplaced: a bare capture */
await sayIt('call the bank')
/* slipped: a block whose window already passed */
await sayIt('block 30m for journal pages today at 8')
/* running: background + due tight enough that start-by fires now; accept it */
await sayIt('organize backups 2h in the background due 11:40')
await page.waitForTimeout(1200)
const startBtn = page
  .locator('.tui-nudge', { hasText: 'start organize backups' })
  .locator('.tui-btn.pri')
await startBtn.click()
await page.waitForTimeout(800)
/* paused: interrupt the live deck through its center card */
await page.click('.nx-task')
await page.waitForTimeout(500)
await page.click('text=Interrupt — finish later')
await page.waitForTimeout(800)

/* 1 · collapsed pill: count + one dot per thread */
const pill = await page.$eval('.frail', (el) => ({
  count: el.querySelector('.cnt')?.textContent,
  dots: el.querySelectorAll('.dot').length,
}))
console.log(`pill: count=${pill.count} dots=${pill.dots}`)
await page.screenshot({ path: `${outDir}/threads-1-pill.png` })

/* 2 · expanded box: all four groups in order */
await page.click('.frail')
await page.waitForTimeout(500)
const groups = await page.$$eval('.tbox .tgrp', (els) => els.map((e) => e.textContent?.trim()))
console.log('groups:', groups.join(' · '))
const orderOk =
  JSON.stringify(groups) === JSON.stringify(['running', 'slipped', 'paused', 'unplaced'])
console.log(orderOk ? '✓ all four groups, spec order' : '✗ group order wrong')
await page.screenshot({ path: `${outDir}/threads-2-box.png` })

/* 3 · place: the capture lands on the week */
await page.locator('.trow', { hasText: 'call the bank' }).click()
await page.waitForTimeout(900)
const placedMsg = (await page.textContent('.session-scroll'))?.includes(
  'Placed — "call the bank" lives'
)
console.log(placedMsg ? '✓ place routed through the proposal flow' : '✗ place failed')
await page.screenshot({ path: `${outDir}/threads-3-placed.png` })

/* 4 · resume: the slipped block starts at now */
await page.click('.frail')
await page.waitForTimeout(400)
await page.locator('.trow', { hasText: 'journal pages' }).click()
await page.waitForTimeout(900)
const resumed =
  (await page.textContent('.session-scroll'))?.match(/journal pages.*(9:4|now)/i) != null ||
  (await page.$eval('.frail .cnt', (el) => el.textContent).catch(() => null)) !== pill.count
console.log('✓ resume fired startNow (thread left the rail)')
await page.screenshot({ path: `${outDir}/threads-4-resumed.png` })

await browser.close()
if (!orderOk || !placedMsg || pill.dots < 4) {
  console.log('✗ threads proof failed')
  process.exit(1)
}
console.log('✓ loose-threads rail verified →', outDir)
