/* Visual + behavioral verification: drives the built app and captures the
   design-canonical moments (Carbon & Pet White system).
   Usage: node scripts/shoot.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { findChromium } from './lib/chromium.mjs'

const base = process.argv[2] ?? 'http://localhost:5199'
/* unpinned chromium (shared resolver, PW_CHROMIUM seam) — this script gates
   CI (ui-overlap.yml), so a hard build-number path is the first thing to break */
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

/* a fresh playwright context has an empty IndexedDB, so the seed runs and the
   first-run concept tour (#160) opens over the dial — dismiss it the way a
   returning user already has, so these canonical shots capture the app itself */
const skipOnboarding = async () => {
  await page.waitForSelector('.nx-stage', { timeout: 10000 })
  await page.evaluate(() => window.__mewConfigure?.({ hasSeenOnboarding: true }))
  await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 }).catch(() => {})
}

/* fail loudly so a broken contract turns the `pnpm shoot` gate red */
const assert = (cond, msg) => {
  if (!cond) {
    console.log('A11Y FAIL:', msg)
    process.exitCode = 1
    throw new Error(msg)
  }
}

/* …and fail with pixels. A throw anywhere below (an a11y assert, a missing
   selector, a dead preview) rejects the script's top-level await; before
   exiting red, this handler captures what the browser was actually showing as
   fail-<phase>.png — in the same shots/ dir the CI artifact (ui-shots)
   uploads. Without it an a11y-red run on a headless runner is one console line
   and zero pixels: every assert throws before the first canonical screenshot.
   Node's ESM loader observes the top-level-await rejection itself and re-raises
   it as an uncaughtException (origin 'unhandledRejection'), so THIS is the hook
   that sees it — an 'unhandledRejection' listener never fires for it. Kept out
   of `assert` so its synchronous call sites stay untouched. */
let phase = 'boot'
let failing = false
process.on('uncaughtException', (err) => {
  if (failing) return // one capture; a failure inside the handler must not loop
  failing = true
  console.log(`SHOOT FAIL during ${phase}:`, err)
  setTimeout(() => process.exit(1), 8000) // hard stop if the capture itself hangs
  page
    .screenshot({ path: `${outDir}/fail-${phase}.png` })
    .then(() => console.log('fail shot →', `${outDir}/fail-${phase}.png`))
    .catch(() => {})
    .finally(() => process.exit(1))
})

/* 1 · Focus dial at the canonical 9:40 — minimal at rest, then hover reveal */
phase = 'dial-load'
await page.goto(`${base}/?t=9:40`)
await skipOnboarding()
await page.waitForSelector('.nx-count', { timeout: 10000 })
await page.waitForTimeout(1500)
console.log('count:', await page.textContent('.nx-count'))
console.log('task:', await page.textContent('.nx-task'))

/* 1a · Dial accessibility (issue #172 · WCAG 2.2 §2.1.1/§1.1.1/§4.1.2 · APG
   Application pattern). The pure nav/label logic is unit-tested; this proves the
   real DOM carries the roles, names, and roving tabindex, and that the keyboard
   actually moves + acts on focus. Any miss fails the shoot gate. */
{
  phase = 'dial-a11y'
  const a11y = await page.evaluate(() => {
    const stage = document.querySelector('.nx-stage')
    const arcs = [...document.querySelectorAll('.nx-stage svg [role="button"]')]
    return {
      role: stage?.getAttribute('role'),
      label: stage?.getAttribute('aria-label') ?? '',
      describedby: stage?.getAttribute('aria-describedby'),
      hintExists: !!(
        stage?.getAttribute('aria-describedby') &&
        document.getElementById(stage.getAttribute('aria-describedby'))
      ),
      heading: document.querySelector('.nx-stage h2#dial-title')?.textContent ?? '',
      arcCount: arcs.length,
      named: arcs.every((a) => (a.getAttribute('aria-label') ?? '').trim().length > 0),
      sampleName: arcs[0]?.getAttribute('aria-label') ?? '',
      tabZero: arcs.filter((a) => a.getAttribute('tabindex') === '0').length,
      tabMinus: arcs.filter((a) => a.getAttribute('tabindex') === '-1').length,
      ariaHidden: document.querySelectorAll('.nx-stage svg [aria-hidden="true"]').length,
    }
  })
  console.log('a11y:', JSON.stringify(a11y))
  assert(a11y.role === 'application', 'dial is not role=application')
  assert(/focus dial/i.test(a11y.label), 'dial application has no descriptive aria-label')
  assert(a11y.describedby && a11y.hintExists, 'aria-describedby does not resolve to a hint element')
  assert(/focus dial/i.test(a11y.heading), 'missing sr-only h2 dial heading')
  assert(a11y.arcCount >= 1, 'no arcs exposed as buttons')
  assert(a11y.named, 'an arc button has no accessible name')
  assert(
    a11y.tabZero === 1,
    `roving tabindex broken: ${a11y.tabZero} arcs have tabindex=0 (want exactly 1)`
  )
  assert(a11y.tabMinus >= a11y.arcCount - 1, 'non-focused arcs are not removed from the tab order')
  assert(a11y.ariaHidden >= 4, 'decorative geometry is not hidden from assistive tech')
  // the demote chip is a named button when something holds the centre
  const demoteName = await page.getAttribute('.pri-demote', 'aria-label')
  assert(demoteName && /run in background/i.test(demoteName), 'demote chip is not a named button')
  // keyboard actually moves focus and acts on it
  await page.focus('.nx-stage svg [tabindex="0"]')
  const before = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
  await page.keyboard.press('ArrowRight')
  /* the roving tabindex lands on the next arc a beat after the keypress (the
     move rides a re-render), so poll briefly — reading the very same tick made
     gate speed masquerade as an a11y failure on fast machines */
  let after = before
  for (const t0 = Date.now(); after === before && Date.now() - t0 < 2000;) {
    await page.waitForTimeout(50)
    after = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
  }
  assert(after && after !== before, `ArrowRight did not move focus (stayed on "${before}")`)
  // Escape demotes the centre item without throwing / losing the keyboard
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  console.log('a11y keyboard: moved focus', JSON.stringify({ before, after }))
}
phase = 'dial-shots'
await page.screenshot({ path: `${outDir}/1-focus-rest.png` })
await page.hover('.nx-stage')
await page.waitForTimeout(700)
await page.screenshot({ path: `${outDir}/2-focus-reveal.png` })

/* 1b · the session log follows its own growth (#250). The log is windowed and
   the shell re-sticks via a ResizeObserver on the [role=log] node — prove both
   live contracts: pinned at the bottom, appended lines re-stick the view
   (scrollTop advances, gap returns to ~0 — three appends together outgrow the
   80px stick band, so a dead follow can't hide inside it); scrolled up, the
   same append surfaces the "↓ new" pill and never yanks the reading position.
   __mewSay is the dev seam: a plain chat append, exactly how a turn grows the
   log. */
{
  const scrollState = () =>
    page.evaluate(() => {
      const el = document.querySelector('.session-scroll')
      return {
        top: el.scrollTop,
        gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
      }
    })
  // grow the log past its viewport so "scrolled up" is a reachable state
  await page.evaluate(async () => {
    const el = document.querySelector('.session-scroll')
    for (let i = 1; el.scrollHeight <= el.clientHeight + 160 && i <= 24; i++) {
      window.__mewSay?.(`warm-up line ${i} — filling the session for the follow check`)
      await new Promise((r) => setTimeout(r, 15))
    }
    el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(300)
  const pinnedBefore = await scrollState()
  for (let i = 1; i <= 3; i++) {
    await page.evaluate((n) => window.__mewSay?.(`follow line ${n} — the log stays with you`), i)
    await page.waitForTimeout(120)
  }
  const pinned = await scrollState()
  assert(pinned.gap <= 1, `pinned reader did not follow appends (gap ${pinned.gap}px)`)
  assert(
    pinned.top > pinnedBefore.top,
    `scrollTop did not advance with the log (${pinnedBefore.top} → ${pinned.top})`
  )
  assert(!(await page.$('.scroll-new')), 'pinned at the bottom, no "↓ new" pill')
  // scrolled up, an append must announce, never yank
  await page.evaluate(() => (document.querySelector('.session-scroll').scrollTop = 0))
  await page.waitForTimeout(200)
  await page.evaluate(() => window.__mewSay?.('a line landing while the reader is up in history'))
  await page.waitForSelector('.scroll-new', { timeout: 3000 })
  /* the yank invariant is about the bottom: the reader must NOT be dragged
     back down to the live edge (absolute scrollTop may shift if paging
     prepends rows above — that shift IS the position being preserved) */
  const up = await scrollState()
  assert(up.gap > 80, `reader was yanked back to the live bottom (gap ${up.gap}px)`)
  console.log(
    'follow:',
    JSON.stringify({
      pinnedGap: pinned.gap,
      scrollTop: `${pinnedBefore.top}→${pinned.top}`,
      scrolledUp: `pill shown, gap ${up.gap}px`,
    })
  )
  // return to the live bottom the way a reader would — through the pill
  await page.click('.scroll-new')
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.session-scroll')
      return (
        el.scrollHeight - el.scrollTop - el.clientHeight <= 80 &&
        !document.querySelector('.scroll-new')
      )
    },
    null,
    { timeout: 5000 }
  )
}

/* 2 · block detail card from an arc (fat invisible hit-targets) */
phase = 'detail-card'
const hits = await page.$$('path[stroke="transparent"]')
if (hits[1]) {
  await hits[1].click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${outDir}/3-detail-card.png` })
  await page.mouse.click(40, 700) // dismiss
}

/* 3 · Week columns */
phase = 'week'
await page.click('.seg2 button:has-text("Week")')
await page.waitForTimeout(600)
console.log('summary:', (await page.textContent('.week-summary'))?.trim())
await page.screenshot({ path: `${outDir}/4-week.png` })

/* 4 · talk-to-schedule through the prompt (acceptance #1). The composer is now a
   <textarea> (aria-label "compose message to MEW", auto-grow, multi-line), not an
   <input>. Target it by its stable a11y label so the shot survives the
   input→textarea swap, and fall back to the tag match that
   scripts/shoot-overlap.mjs uses so both selectors stay in sync. */
phase = 'composer'
const composer =
  '.prompt-row [aria-label="compose message to MEW"], .prompt-row input, .prompt-row textarea'
await page.fill(composer, 'block thursday morning for the deck, keep friday afternoon free')
await page.press(composer, 'Enter')
await page.waitForTimeout(900)
const log = await page.$$eval('.log', (els) => els.map((e) => e.textContent).join('\n'))
console.log('log tail:', log.slice(-220).replace(/\s+/g, ' '))
await page.screenshot({ path: `${outDir}/5-session.png` })

/* 5 · settings + retheme + light */
phase = 'settings'
await page.click('text=settings')
await page.waitForSelector('.set-card h2')
await page.screenshot({ path: `${outDir}/6-settings.png` })
await page.click('.petopt:has-text("Fox")')
await page.click('.segc button:has-text("Pet white")')
await page.waitForTimeout(400)
await page.screenshot({ path: `${outDir}/7-fox-petwhite.png` })

await browser.close()
console.log('done →', outDir)
