/* Orbit-lanes proof: builds a 6-deep pileup through the real prompt, then
   PROVES the design's two geometric guarantees from the live DOM — every
   label bbox pairwise non-intersecting, every arc on its own radius — and
   captures the acceptance states: at-rest, pileup, hover, promoted,
   background-running. Usage: node scripts/shoot-orbit.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5261'
const exe = path.join(os.homedir(), '.cache/ms-playwright/chromium-1223/chrome-linux64/chrome')
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 840 } })).newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

await page.goto(`${base}/?t=9:40`)
await page.waitForSelector('.nx-count', { timeout: 15000 })
await page.evaluate(() => window.__mewReset?.())
await page.waitForSelector('.nx-count', { timeout: 15000 })
await page.waitForTimeout(1200)

/* 1 · at rest (the seeded morning) */
await page.screenshot({ path: `${outDir}/orbit-1-rest.png` })

/* 2 · pile six+ overlapping items onto the morning */
for (const cmd of [
  'block 1.5h for design sync today at 9:30',
  'block 1h for candidate interview today at 10',
  'block 45m for code review today at 9:45',
  'swap iphone 3h in the background due 1pm',
]) {
  await page.fill('.prompt-row input, .prompt-row textarea', cmd)
  await page.press('.prompt-row input, .prompt-row textarea', 'Enter')
  await page.waitForTimeout(700)
}
await page.waitForTimeout(600)

const geom = await page.$$eval('.nx-stage svg', (svgs) => {
  const svg = svgs[0]
  const labels = [...svg.querySelectorAll('text.pri-lbl')].map((el) => {
    const b = el.getBBox()
    return { text: el.textContent.trim().slice(0, 30), x: b.x, y: b.y, w: b.width, h: b.height }
  })
  const radii = [...svg.querySelectorAll('path.pri-arc')].map((p) => {
    const m = /A (\d+(?:\.\d+)?)/.exec(p.getAttribute('d') ?? '')
    return m ? Number(m[1]) : null
  })
  return { labels, radii }
})
console.log(`orbit items: ${geom.radii.length} arcs, ${geom.labels.length} labels`)
let collisions = 0
for (let i = 0; i < geom.labels.length; i++)
  for (let j = i + 1; j < geom.labels.length; j++) {
    const a = geom.labels[i]
    const b = geom.labels[j]
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
      collisions++
      console.log(`LABEL COLLISION: "${a.text}" ⟂ "${b.text}"`)
    }
  }
const distinctRadii = new Set(geom.radii.filter(Boolean)).size
console.log(`labels: ${collisions === 0 ? '✓ zero collisions' : `✗ ${collisions}`} · arcs: ${distinctRadii === geom.radii.length ? '✓ every arc on its own radius' : '✗ shared radii'}`)
await page.screenshot({ path: `${outDir}/orbit-2-pileup.png` })

/* 3 · hover preview (85%) */
const someArc = page.locator('text.pri-lbl', { hasText: 'design sync' })
await someArc.hover()
await page.waitForTimeout(400)
await page.screenshot({ path: `${outDir}/orbit-3-hover.png` })

/* 4 · one-click promote: design sync takes the center */
await someArc.click()
await page.waitForTimeout(900)
const headline = await page.textContent('.nx-task')
console.log('promoted center:', headline?.trim().slice(0, 50))
await page.screenshot({ path: `${outDir}/orbit-4-promoted.png` })

/* 5 · demote chip → background-running center */
await page.click('.pri-demote')
await page.waitForTimeout(900)
const empty = await page.textContent('.nx-task')
console.log('demoted center:', empty?.trim().slice(0, 50))
await page.screenshot({ path: `${outDir}/orbit-5-background-running.png` })

await browser.close()
const promotedOk = /design sync/i.test(headline ?? '')
const demotedOk = /nothing holds you/i.test(empty ?? '')
if (collisions > 0 || distinctRadii !== geom.radii.length || geom.radii.length < 6 || !promotedOk || !demotedOk) {
  console.log('✗ orbit proof failed')
  process.exit(1)
}
console.log('✓ orbit-lanes verified: 6+ items, zero label/arc overlap, promote/demote round-trip →', outDir)
