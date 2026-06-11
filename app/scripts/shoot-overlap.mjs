/* Overlap stress: creates a 3-deep pileup of events through the real prompt,
   then PROVES the focus dial's label declutter holds — every label <text>
   bbox is pairwise non-intersecting — and captures the frame.
   Usage: node scripts/shoot-overlap.mjs [baseUrl]   (exits 1 on overlap) */

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
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

await page.goto(`${base}/?t=9:40`)
await page.waitForSelector('.nx-count', { timeout: 10000 })
await page.evaluate(() => window.__mewReset?.())
await page.waitForSelector('.nx-count', { timeout: 10000 })
await page.waitForTimeout(800)

/* pile two timed blocks onto the seeded 9:00–11:30 deck block */
for (const cmd of [
  'block 1.5h for design sync today at 9:30',
  'block 1h for candidate interview today at 10',
]) {
  await page.fill('.prompt-row input', cmd)
  await page.press('.prompt-row input', 'Enter')
  await page.waitForTimeout(700)
}

/* reveal labels and measure them where they render */
await page.hover('.nx-stage')
await page.waitForTimeout(800)

const labels = await page.$$eval('.nx-stage svg .nx-fade text', (els) =>
  els
    .filter((el) => el.textContent && el.textContent.trim().length > 1)
    .map((el) => {
      const b = el.getBBox()
      return { text: el.textContent.trim(), x: b.x, y: b.y, w: b.width, h: b.height }
    }),
)
console.log(`labels on stage: ${labels.length}`)
for (const l of labels) console.log(`  [${l.x.toFixed(0)},${l.y.toFixed(0)} ${l.w.toFixed(0)}×${l.h.toFixed(0)}] ${l.text}`)

let collisions = 0
for (let i = 0; i < labels.length; i++)
  for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i]
    const b = labels[j]
    const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    if (hit) {
      collisions++
      console.log(`COLLISION: "${a.text}" ⟂ "${b.text}"`)
    }
  }

await page.screenshot({ path: `${outDir}/8-overlap-stress.png` })
await browser.close()

if (collisions > 0) {
  console.log(`✗ ${collisions} label collision(s) — declutter failed`)
  process.exit(1)
}
console.log('✓ zero label collisions under 3-deep event overlap →', `${outDir}/8-overlap-stress.png`)
