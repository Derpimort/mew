/* Sustenance scaffold proof (#299): the canonical 9:40 morning against the
   REAL seeded week — the standing scaffold fed the day on the boot tick
   (dinner + a breather around the seeded lunch), said its one line, and the
   morning brief composed AFTER it on the same tick, so its shape already
   counts the meals. Fails loudly on any miss: build identity, the exact
   line exactly once, the executor's receipt card, once-per-day over
   re-ticks, and the meal blocks standing on the week view.
   Usage: node scripts/shoot-sustenance.mjs [baseUrl] */

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
    console.log('SUSTENANCE FAIL:', msg)
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
    .screenshot({ path: `${outDir}/fail-sustenance-${phase}.png` })
    .then(() => console.log('fail shot →', `${outDir}/fail-sustenance-${phase}.png`))
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

/* 1 · the 9:40 boot tick already ran the pass: one line, exact voice */
phase = 'scaffold-line'
await page.waitForSelector('.nx-stage', { timeout: 15000 })
await page.evaluate(() => window.__mewConfigure?.({ hasSeenOnboarding: true }))
await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 }).catch(() => {})
const LINE = 'fed and paced: dinner 19:00, a breather at 12:00 — say the word to reshape'
const lineCount = () =>
  page.$$eval(
    '.log',
    (els, want) => els.filter((e) => (e.textContent ?? '').includes(want)).length,
    LINE
  )
assert(
  (await lineCount()) === 1,
  `expected the exact scaffold line once, found ${await lineCount()}`
)
/* the apply's receipt: the executor plan card is on the log (#282/#294) */
const cards = await page.$$eval('.tool-card', (els) =>
  els.map((e) => e.getAttribute('aria-label') ?? '')
)
assert(
  cards.some((l) => /placing blocks/.test(l) && /done/.test(l)),
  `no settled "placing blocks" receipt among ${JSON.stringify(cards)}`
)
/* the shared tick, ordered: the brief's shape line counts the fed day */
const briefText = await page.$$eval(
  '.tui-nudge',
  (els) =>
    els
      .find((e) => e.querySelector('.h')?.textContent?.includes('nudge/morning-brief'))
      ?.textContent?.replace(/\s+/g, ' ') ?? ''
)
assert(
  /today: 8 blocks, 9:00–20:00/.test(briefText),
  `brief does not count the meals: ${briefText}`
)

/* 2 · once per day: three more real engine ticks add nothing */
phase = 'once-per-day'
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.__mewSetIdle?.(0))
  await page.waitForTimeout(120)
}
assert((await lineCount()) === 1, 'once-per-day broken: the line multiplied under re-ticks')

/* 3 · the meals stand on the week — Dinner and the Breather as real tiles */
phase = 'week'
await page.click('.seg2 button:has-text("Week")')
await page.waitForTimeout(600)
const tiles = await page.$$eval('.nxb-blk', (els) =>
  els.map((e) => e.getAttribute('aria-label') ?? '')
)
assert(
  tiles.some((l) => /dinner/i.test(l)),
  'no Dinner tile on the week'
)
assert(
  tiles.some((l) => /breather/i.test(l)),
  'no Breather tile on the week'
)
console.log('week tiles:', JSON.stringify(tiles.filter((l) => /dinner|breather|lunch/i.test(l))))

/* 4 · the canonical morning shot: the scaffold line centered in the log
   beside the week that holds its meals (later nudges outrank the live edge) */
phase = 'shot'
await page.evaluate((want) => {
  const row = [...document.querySelectorAll('.log')].find((e) =>
    (e.textContent ?? '').includes(want)
  )
  const scroll = document.querySelector('.session-scroll')
  if (row && scroll) {
    /* place the line ~a card below the log's header, receipt card above it */
    scroll.scrollTop =
      row.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 160
  }
}, LINE)
await page.waitForTimeout(400)
await page.screenshot({ path: `${outDir}/9-sustenance-morning.png` })

await browser.close()
console.log(
  'scaffold proof: line ×1 · receipt card · brief counts 8 blocks · dinner+breather on week'
)
console.log('done →', `${outDir}/9-sustenance-morning.png`)
