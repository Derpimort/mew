/* Week-scaffold proof (#349): the gbrain marquee at week scale. A weekday boot
   against the REAL seeded week (this week only — the coming week is a blank
   canvas), a couple of confirmed rhythms seeded through the local memory floor,
   then one real engine tick. The store offers ONCE to rough out the coming week;
   the "rough it out" chip opens the #293 preview (nothing placed yet); the
   "pick" accept places the stored quote through the SAME plan executor. Three
   frames — offer → preview → accept — plus loud assertions on each. Keyless
   throughout. Usage: node scripts/shoot-scaffold.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { findChromium } from './lib/chromium.mjs'

const base = process.argv[2] ?? 'http://localhost:4349'
const exe = findChromium()
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

/* a fixed Sunday 10:00 — the marquee's canonical "offered once on Sunday"
   moment: the coming Mon–Sun is empty in the seed (the scaffold trigger) and
   sits at day-offsets 1–7, so the picker's 7-day strip shows the whole draft.
   10:00 is before the 17:00 weekly-ritual window, so nothing else competes. */
const DAY = '2026-07-19'

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text())
})
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

const assert = (cond, msg) => {
  if (!cond) {
    console.log('SCAFFOLD FAIL:', msg)
    process.exitCode = 1
    throw new Error(msg)
  }
}

let phase = 'boot'
let failing = false
process.on('uncaughtException', (err) => {
  if (failing) return
  failing = true
  console.log(`SHOOT FAIL during ${phase}:`, err)
  page
    .screenshot({ path: `${outDir}/fail-scaffold-${phase}.png` })
    .then(() => console.log('fail shot →', `${outDir}/fail-scaffold-${phase}.png`))
    .catch(() => {})
    .finally(() => process.exit(1))
})

/* 0 · build-identity guard: the served page must carry THIS checkout's bundle */
phase = 'identity'
const distHtml = readFileSync(path.resolve('dist/index.html'), 'utf8')
const wantSrc = distHtml.match(/src="([^"]*assets\/index-[^"]+\.js)"/)?.[1]
assert(wantSrc, 'dist/index.html has no hashed index bundle — run pnpm build first')
await page.goto(`${base}/?d=${DAY}&t=10:00`)
const servedSrc = await page.evaluate(() =>
  [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).join(' ')
)
assert(
  servedSrc.includes(wantSrc),
  `served bundle (${servedSrc}) is not this build's (${wantSrc}) — wrong server?`
)
console.log('build identity:', wantSrc, '· app day:', DAY, '(sun) 10:00')

/* 1 · boot the real seeded week, dismiss the first-run tour */
phase = 'seed'
await page.waitForSelector('.nx-stage', { timeout: 15000 })
await page.evaluate(() => window.__mewConfigure?.({ hasSeenOnboarding: true }))
await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 }).catch(() => {})

/* 2 · teach MEW a few rhythms (confirmed rules → the local memory floor) */
phase = 'rules'
await page.evaluate(() => {
  window.__mewConfirmRule?.({ match: 'deep work', tag: 'work', durationMin: 90, window: 'morning' })
  window.__mewConfirmRule?.({ match: 'inbox & admin', tag: 'private', durationMin: 45 })
  window.__mewConfirmRule?.({
    match: 'weekly review',
    tag: 'work',
    durationMin: 60,
    window: 'afternoon',
  })
  window.__mewConfirmRule?.({ match: 'gym', tag: 'health', durationMin: 45, window: 'morning' })
})

/* 3 · one real engine tick → the offer, once (a re-tick adds nothing) */
phase = 'offer'
const offerCards = () =>
  page.$$eval('.tui-nudge', (els) =>
    els.filter((e) => e.querySelector('.h')?.textContent?.includes('nudge/scaffold-week'))
  )
for (let i = 0; i < 4 && (await offerCards()).length === 0; i++) {
  await page.evaluate(() => window.__mewSetIdle?.(0))
  await page.waitForTimeout(150)
}
assert((await offerCards()).length === 1, 'no week-scaffold offer after 4 ticks')
await page.evaluate(() => window.__mewSetIdle?.(0)) // re-tick: dedupe holds
await page.waitForTimeout(150)
assert((await offerCards()).length === 1, 'once-per-coming-week broken: the offer multiplied')
await page.evaluate(() => {
  const offer = [...document.querySelectorAll('.tui-nudge')].find((e) =>
    e.querySelector('.h')?.textContent?.includes('nudge/scaffold-week')
  )
  const scroll = document.querySelector('.session-scroll')
  if (offer && scroll)
    scroll.scrollTop =
      offer.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 8
})
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/20-scaffold-offer.png` })

/* 4 · the chip opens the preview — chat-only, the week untouched */
phase = 'preview'
await page.click('.tui-nudge button:has-text("rough it out")')
await page.waitForSelector('.scn-cards', { timeout: 15000 })
const cardName = await page.$eval('.scn-name', (e) => e.textContent)
assert(/your usual week/.test(cardName ?? ''), `preview name off: ${cardName}`)
const sliverCount = await page.$$eval('.scn-slv', (els) => els.length)
assert(sliverCount > 0, 'the preview strip shows no proposed blocks')
console.log('preview:', cardName, '·', sliverCount, 'proposed slivers')
await page.evaluate(() => {
  const scroll = document.querySelector('.session-scroll')
  if (scroll) scroll.scrollTop = scroll.scrollHeight
})
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/21-scaffold-preview.png` })

/* 5 · accept → the stored quote places through the executor (the receipt +
   the plan-voice line), and the picked card keeps its ✓ */
phase = 'accept'
await page.click('.scn-card .scn-head button')
await page.waitForSelector('.scn-card button:has-text("picked")', { timeout: 15000 })
const logText = await page.$eval('.session-scroll', (e) => e.textContent ?? '')
assert(/done —/i.test(logText), 'no plan-voice confirmation after accept')
await page.evaluate(() => {
  const scroll = document.querySelector('.session-scroll')
  if (scroll) scroll.scrollTop = scroll.scrollHeight
})
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/22-scaffold-accepted.png` })

await browser.close()
console.log(
  'scaffold proof: offer ×1 (dedupe held) · chip → preview (week untouched) · accept → executor place'
)
console.log(
  'done →',
  `${outDir}/20-scaffold-offer.png`,
  `${outDir}/21-scaffold-preview.png`,
  `${outDir}/22-scaffold-accepted.png`
)
