/* Weekly review + roll-forward proof (#346). A Friday 17:35 boot (via the ?d=
   day shift) against the REAL seeded week. The engine posts ONE review offer
   (once per ISO week — re-ticks add nothing), "show me" opens the read-only
   review surface, the carried blocks are an owner multi-select, and rolling a
   pick runs THROUGH the executor (a plan tool card + a positive confirmation).
   Fails loudly on any miss: build identity, exactly one offer, the surface
   contract, the roll. Usage: node scripts/shoot-review.mjs [baseUrl]
   NEVER point this at :5199 (the owner's live server) — serve this worktree's
   own dist on a free port (e.g. 4346). */

import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { findChromium } from './lib/chromium.mjs'

const base = process.argv[2] ?? 'http://localhost:4346'
const exe = findChromium()
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

/* the next Friday from the host clock (today if Friday) — ?d= shifts the app's
   day there so the review window (Friday evening) is real, not simulated */
const friday = new Date()
friday.setDate(friday.getDate() + ((5 - friday.getDay() + 7) % 7))
const pad = (n) => String(n).padStart(2, '0')
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/* build-identity guard (shoot.mjs): test THIS worktree's dist, never a stale
   server that happens to answer on the port */
const entryOf = (html) =>
  html.match(/\/assets\/index-[^"']+\.js/)?.[0] ?? '(no recognizable bundle)'
let servedHtml = ''
try {
  servedHtml = await (await fetch(base)).text()
} catch {
  console.log(`BUILD CHECK FAIL: nothing answered at ${base} — serve this worktree's dist first`)
  process.exit(1)
}
if (entryOf(servedHtml) !== entryOf(readFileSync(path.resolve('dist/index.html'), 'utf8'))) {
  console.log(`BUILD MISMATCH: ${base} serves a different build than this worktree's dist`)
  process.exit(1)
}
console.log('build identity:', entryOf(servedHtml))

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 840 } })
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text())
})
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

const assert = (cond, msg) => {
  if (!cond) {
    console.log('REVIEW FAIL:', msg)
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
  setTimeout(() => process.exit(1), 8000)
  page
    .screenshot({ path: `${outDir}/fail-review-${phase}.png` })
    .then(() => console.log('fail shot →', `${outDir}/fail-review-${phase}.png`))
    .catch(() => {})
    .finally(() => process.exit(1))
})

const skipOnboarding = async () => {
  await page.waitForSelector('.nx-stage', { timeout: 10000 })
  await page.evaluate(() => window.__mewConfigure?.({ hasSeenOnboarding: true }))
  await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 }).catch(() => {})
}

/* 1 · the once-a-week offer — Friday evening, exactly one, deduped on re-tick */
phase = 'offer'
await page.goto(`${base}/?d=${dkey(friday)}&t=17:35`)
await skipOnboarding()
/* one real store tick guarantees the ritual pass has run past the wrap time */
await page.evaluate(() => window.__mewSetIdle?.(0))
const offerSel = () =>
  page.$$eval(
    '.tui-nudge .h',
    (els) => els.filter((e) => e.textContent?.includes('nudge/weekly-review')).length
  )
await page.waitForFunction(
  () =>
    [...document.querySelectorAll('.tui-nudge .h')].some((e) =>
      e.textContent?.includes('nudge/weekly-review')
    ),
  null,
  { timeout: 8000 }
)
let offers = await offerSel()
assert(offers === 1, `expected exactly one weekly-review offer, found ${offers}`)
/* once per ISO week: three more ticks add nothing */
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.__mewSetIdle?.(0))
  await page.waitForTimeout(80)
}
offers = await offerSel()
assert(offers === 1, `once-per-week broken: became ${offers} offers after re-ticks`)
const offerText = await page.$$eval('.tui-nudge', (els) => {
  const el = els.find((e) => e.querySelector('.h')?.textContent?.includes('nudge/weekly-review'))
  return el?.textContent?.replace(/\s+/g, ' ') ?? ''
})
assert(/want your week in review/.test(offerText), 'the offer lost its invite copy')
assert(
  !/\b(missed|failed|behind|overdue|streak|broke|broken)\b/i.test(offerText),
  'voice law violated: a banned word reached the offer'
)
console.log('offer:', JSON.stringify({ count: offers, text: offerText.slice(0, 80) }))
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.tui-nudge')].find((e) =>
    e.querySelector('.h')?.textContent?.includes('nudge/weekly-review')
  )
  el?.scrollIntoView({ block: 'center' })
})
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/13-review-offer.png` }) // gitignored — proof, not canon

/* 2 · "show me" opens the read-only review surface */
phase = 'surface'
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.tui-nudge')].find((e) =>
    e.querySelector('.h')?.textContent?.includes('nudge/weekly-review')
  )
  el?.querySelector('.tui-btn.pri')?.click() // "show me"
})
await page.waitForSelector('.wkr', { timeout: 5000 })
const surface = await page.evaluate(() => {
  const dlg = document.querySelector('.wkr')
  return {
    role: dlg?.getAttribute('role'),
    modal: dlg?.getAttribute('aria-modal'),
    title: document.querySelector('.wkr-h')?.textContent ?? '',
    mews: document.querySelectorAll('.wkr-mew').length,
    carried: document.querySelectorAll('.wkr-carry input[type="checkbox"]').length,
    tally: document.querySelectorAll('.wkr-chip').length,
    roll: !!document.querySelector('.wkr-roll'),
    rollDisabled: document.querySelector('.wkr-roll')?.disabled ?? true,
    text: document.querySelector('.wkr')?.textContent ?? '',
  }
})
console.log('surface:', JSON.stringify({ ...surface, text: undefined }))
assert(surface.role === 'dialog' && surface.modal === 'true', 'review is not an accessible dialog')
assert(/your week in review/i.test(surface.title), 'review title missing')
assert(surface.carried >= 1, 'the carried multi-select rendered no candidates to roll')
assert(surface.roll && surface.rollDisabled, 'roll must be present and disabled before a pick')
assert(
  !/\b(missed|failed|behind|overdue|streak|broke|broken)\b/i.test(surface.text),
  'voice law violated: a banned word reached the review surface'
)
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/14-weekly-review.png` }) // canonical surface shot

/* 3 · the owner picks and rolls — through the executor (a plan card lands, a
   positive confirmation posts). Nothing rolls until the pick, by law. */
phase = 'roll'
await page.click('.wkr-carry input[type="checkbox"]') // owner selects the first carried block
const rollLive = await page.evaluate(() => {
  const b = document.querySelector('.wkr-roll')
  return { disabled: b?.disabled ?? true, label: b?.textContent ?? '' }
})
assert(!rollLive.disabled, 'roll must become live once a block is picked')
await page.screenshot({ path: `${outDir}/15-review-selected.png` }) // gitignored — proof
const planCardsBefore = (await page.$$('.tool-card')).length
await page.click('.wkr-roll')
await page.waitForSelector('.wkr', { state: 'detached', timeout: 5000 }) // surface closes on roll
await page.waitForFunction(
  () => /rolled forward/i.test(document.querySelector('.session-scroll')?.textContent ?? ''),
  null,
  { timeout: 5000 }
)
const session = await page.evaluate(
  () => document.querySelector('.session-scroll')?.textContent ?? ''
)
const planCardsAfter = (await page.$$('.tool-card')).length
assert(planCardsAfter > planCardsBefore, 'the roll did not go through the executor (no plan card)')
assert(
  !/\b(missed|failed|behind|overdue|streak|broke|broken)\b/i.test(session),
  'voice law violated: a banned word reached the roll confirmation'
)
console.log(
  'roll:',
  JSON.stringify({
    planCards: `${planCardsBefore}→${planCardsAfter}`,
    confirmed: /rolled forward/i.test(session),
  })
)

await browser.close()
console.log('done →', outDir)
