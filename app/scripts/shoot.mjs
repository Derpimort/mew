/* Visual + behavioral verification: drives the built app and captures the
   design-canonical moments (Carbon & Pet White system).
   Usage: node scripts/shoot.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { findChromium } from './lib/chromium.mjs'

const base = process.argv[2] ?? 'http://localhost:5199'
/* unpinned chromium (shared resolver, PW_CHROMIUM seam) — this script gates
   CI (ui-overlap.yml), so a hard build-number path is the first thing to break */
const exe = findChromium()
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

/* Build-identity guard: shoot must test THIS worktree's dist, never whatever
   happens to answer on the base port — a stale live-debug server on :5199 once
   turned the whole gate green against an older bundle (#282 review). Vite
   content-hashes the entry, so the main asset's name IS the build identity:
   the served index.html must reference the same entry the local dist built. */
const entryOf = (html) =>
  html.match(/\/assets\/index-[^"']+\.js/)?.[0] ?? '(no recognizable bundle)'
let servedHtml = ''
try {
  servedHtml = await (await fetch(base)).text()
} catch {
  console.log(`BUILD CHECK FAIL: nothing answered at ${base} — serve this worktree's dist first`)
  process.exit(1)
}
const servedEntry = entryOf(servedHtml)
const localEntry = entryOf(readFileSync(path.resolve('dist/index.html'), 'utf8'))
if (servedEntry !== localEntry) {
  console.log(
    `BUILD MISMATCH: ${base} serves ${servedEntry}, local dist built ${localEntry} — ` +
      `shoot is testing a different build than this worktree's dist — is ${base} serving something else?`
  )
  process.exit(1)
}
console.log('build identity:', localEntry)

/* --disable-gpu: new-headless drives rAF off real compositor frames; on CI
   runner images with degraded GL that loop can near-stall, which starves
   every animation-frame-paced thing this gate relies on (the pill's smooth
   scroll, coalesced pointer-move dispatch). Software compositing ticks
   reliably everywhere. */
const browser = await chromium.launch({ executablePath: exe, args: ['--disable-gpu'] })
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
/* frame-pulse probe: when this gate reds on a runner, this one line says
   whether the page had a working frame loop at all — near-zero here means
   every rAF-paced wait below is doomed regardless of its timeout */
const rafPulse = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let n = 0
      const t0 = performance.now()
      const tick = () =>
        performance.now() - t0 > 1200 ? resolve(n) : (n++, requestAnimationFrame(tick))
      requestAnimationFrame(tick)
    })
)
console.log(`raf pulse: ${rafPulse} frames / 1.2s`)

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
  /* re-pin after the growth settles: the warm-up's late renders can land
     under the in-loop pin and leave the reader outside the 80px stick band
     before the follow check even starts (seen on runners — gap 400px+) */
  await page.evaluate(() => {
    const el = document.querySelector('.session-scroll')
    el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(150)
  const pinnedBefore = await scrollState()
  for (let i = 1; i <= 3; i++) {
    await page.evaluate((n) => window.__mewSay?.(`follow line ${n} — the log stays with you`), i)
    await page.waitForTimeout(120)
  }
  /* the re-stick rides the ResizeObserver a beat behind the append — poll
     briefly instead of reading the very next tick (same rhythm as the
     roving-tabindex poll above) */
  let pinned = await scrollState()
  for (const t0 = Date.now(); pinned.gap > 1 && Date.now() - t0 < 1500;) {
    await page.waitForTimeout(100)
    pinned = await scrollState()
  }
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
    /* 15s, not 5: the pill's smooth-scroll ride down a long log is animation-
       frame-paced, and a cold CI runner can spend >5s on it — seen live on the
       v0.4.0 promotion PR. The invariant (bottom reached, pill unmounted) is
       unchanged; only the patience grew. Interval polling, not rAF: on a
       frame-starved runner the default rAF poll can't even observe arrival. */
    { timeout: 15000, polling: 250 }
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

/* 3a · Week grid keyboard access (#303 — the dial's roving grammar on the
   grid; runs after the canonical shot so 4-week.png stays pristine). The pure
   rules are unit-tested; this proves the real DOM carries ONE roving tab stop,
   spoken tile names, the application surface with its grammar hint, a painted
   focus ring, and that an arrow really walks focus while a Shift+arrow ATTEMPT
   always speaks through the live region (never a silent no-op). */
{
  phase = 'week-a11y'
  const wk = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.nxb-blk')]
    const grid = document.querySelector('.wk-grid')
    return {
      tiles: tiles.length,
      tabZero: tiles.filter((t) => t.getAttribute('tabindex') === '0').length,
      tabMinus: tiles.filter((t) => t.getAttribute('tabindex') === '-1').length,
      named: tiles.every((t) => (t.getAttribute('aria-label') ?? '').trim().length > 0),
      role: grid?.getAttribute('role'),
      hintExists: !!(
        grid?.getAttribute('aria-describedby') &&
        document.getElementById(grid.getAttribute('aria-describedby'))
      ),
      live: !!document.querySelector('[data-wk-live][aria-live="polite"]'),
    }
  })
  console.log('week a11y:', JSON.stringify(wk))
  assert(wk.tiles >= 1, 'no week tiles rendered')
  assert(
    wk.tabZero === 1,
    `week roving tabindex broken: ${wk.tabZero} tiles have tabindex=0 (want exactly 1)`
  )
  assert(wk.tabMinus >= wk.tiles - 1, 'non-focused week tiles are not removed from the tab order')
  assert(wk.named, 'a week tile has no accessible name')
  assert(wk.role === 'application', 'week grid is not role=application')
  assert(wk.hintExists, 'week grid aria-describedby does not resolve to the grammar hint')
  assert(wk.live, 'week grid polite live region missing')
  // keyboard actually walks the grid…
  await page.focus('.nxb-blk[tabindex="0"]')
  const wkBefore = await page.evaluate(
    () => document.activeElement?.getAttribute('aria-label') ?? ''
  )
  await page.keyboard.press('ArrowDown')
  /* the roving refocus rides a rAF re-render — poll like the dial gate does */
  let wkAfter = wkBefore
  for (const t0 = Date.now(); wkAfter === wkBefore && Date.now() - t0 < 2000;) {
    await page.waitForTimeout(50)
    wkAfter = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
  }
  assert(wkAfter && wkAfter !== wkBefore, `ArrowDown did not move week focus ("${wkBefore}")`)
  // …the §2.4.7 ring is really painted on the keyboard-focused tile…
  const ring = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement)
    return { style: cs.outlineStyle, width: cs.outlineWidth }
  })
  assert(
    ring.style !== 'none' && parseFloat(ring.width) >= 2,
    `week focus ring not painted (outline: ${ring.style} ${ring.width})`
  )
  // …and a nudge ATTEMPT always speaks — where it landed, or why it stays
  await page.keyboard.press('Shift+ArrowDown')
  let spoken = ''
  for (const t0 = Date.now(); !spoken && Date.now() - t0 < 2000;) {
    await page.waitForTimeout(50)
    spoken = await page.evaluate(
      () => document.querySelector('[data-wk-live]')?.textContent?.trim() ?? ''
    )
  }
  assert(spoken.length > 0, 'a keyboard nudge attempt did not announce')
  console.log('week a11y keyboard:', JSON.stringify({ before: wkBefore, after: wkAfter, spoken }))
}

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

/* 4a · the honest day-load meter (#301). Two live contracts, both against the
   REAL seeded history (the data floor honestly passed — three weeks of work
   completions). First the week's density tint: at least one day column
   carries a wk-load class and its day header speaks the hours (the tint from
   the seeded heavy tomorrow already rides 4-week.png above). Then the meter:
   a keyless composer turn that pushes a quiet far day past the demonstrated
   line posts exactly ONE chips message — the kindness line + keep/trim — and
   a second over-placement on the same day re-nudges nothing (once per day
   per day-key). The target day is computed from the run's real weekday
   (offset +4, a day the earlier thursday placement can never collide with),
   so the phase holds on every day of the week. */
phase = 'day-load'
{
  const tint = await page.evaluate(() => ({
    tinted: document.querySelectorAll('.nxb-col[class*="wk-load"]').length,
    spoken: [...document.querySelectorAll('.nxb-dl[aria-label]')].some((e) =>
      /your usual is/.test(e.getAttribute('aria-label') ?? '')
    ),
  }))
  console.log('day-load tint:', JSON.stringify(tint))
  assert(tint.tinted >= 1, 'no day-load density tint rendered from the seeded week')
  assert(tint.spoken, 'the tint a11y label does not carry the hours')

  const word = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
    (new Date().getDay() + 4) % 7
  ]
  const chipsCount = () => page.$$eval('.chip-choices', (els) => els.length)
  const before = await chipsCount()
  /* 5h + 2h clears the seeded line on every weekday (the throughput median
     peaks ~345m when the run lands on a Monday); the 2h piece is the trim
     candidate — small enough to fit a lighter weekday on all seven starts */
  await page.fill(
    composer,
    `block 5h for the quarterly model on ${word} at 8, block 2h for board notes on ${word} at 15`
  )
  await page.press(composer, 'Enter')
  await page.waitForFunction(
    (n) => document.querySelectorAll('.chip-choices').length === n + 1,
    before,
    { timeout: 8000 }
  )
  const meter = await page.evaluate(() => {
    const group = [...document.querySelectorAll('.chip-choices')].pop()
    const buttons = [...group.querySelectorAll('button')]
    return {
      text: group.parentElement?.textContent ?? '',
      chips: buttons.map((b) => b.textContent?.trim()),
      live: buttons.every((b) => !b.disabled),
    }
  })
  console.log('day-load meter:', JSON.stringify(meter.chips))
  assert(
    /against your usual .+ want me to keep it kind\?/.test(meter.text),
    'the meter line lost its kindness shape'
  )
  assert(
    meter.chips.length === 2 &&
      meter.chips[0] === 'keep it as planned' &&
      meter.chips[1] === 'trim to my usual',
    `meter chips wrong: ${JSON.stringify(meter.chips)}`
  )
  assert(meter.live, 'the meter chips are not tappable while the offer is live')
  const session = await page.evaluate(
    () => document.querySelector('.session-scroll')?.textContent ?? ''
  )
  assert(
    !/\b(overloaded|behind|too much)\b/i.test(session),
    'voice law violated: a banned word reached the session'
  )
  await page.evaluate(() =>
    [...document.querySelectorAll('.chip-choices')].pop()?.scrollIntoView({ block: 'center' })
  )
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${outDir}/11-day-load.png` }) // gitignored — proof, not canon
  /* once per day per day-key: more work onto the same day, no second nudge */
  await page.fill(composer, `block 45m for sweep on ${word} at 19`)
  await page.press(composer, 'Enter')
  await page.waitForTimeout(1500)
  const after = await chipsCount()
  assert(after === before + 1, `the meter re-nudged the same day (${before} → ${after})`)
  console.log('day-load: one meter line, once per day, chips live')
}

/* 4b · tool-call activity cards (#282): the canonical multi-tool turn —
   text → three cards → text, one card still running — scripted through the
   dev seams so the tableau is deterministic and keyless. __mewSayStream drives
   the REAL per-chunk flush; __mewSayTool appends receipt rows through the same
   role:'tool' render path the live executor wrappers feed. Two settled cards +
   one running sit exactly at the fold boundary, so every card stays visible.
   The composer turn above already leaves REAL cards of its own, so this phase
   asserts the DELTA it appends and addresses the running card as the LAST one
   — never by absolute index or absolute count. */
phase = 'tool-cards'
{
  const cardsBefore = (await page.$$('.tool-card')).length
  await page.evaluate(async () => {
    await window.__mewSayStream?.(['looking at thursday — ', 'placing the morning now.'], 20)
    window.__mewSayTool?.('placing blocks', 'thursday 9:00–12:00', 'done')
    window.__mewSayTool?.('finding a slot', '45 min today before 17:00', 'done')
    window.__mewSayTool?.('checking what I know', 'the deck', 'running')
    window.__mewSay?.('thursday morning is held — the deck has the room it needs.')
  })
  await page.waitForTimeout(400)
  const cards = await page.$$eval('.tool-card', (els) =>
    els.map((e) => ({
      label: e.getAttribute('aria-label') ?? '',
      running: !!e.querySelector('.tool-run'),
    }))
  )
  assert(
    cards.length - cardsBefore === 3,
    `expected 3 new tool cards, got ${cards.length - cardsBefore} (${cardsBefore} pre-existing)`
  )
  assert(
    cards.every((c) => /^mew action — .+, (running|done|error|interrupted)$/.test(c.label)),
    `a card article is unlabeled: ${JSON.stringify(cards)}`
  )
  assert(
    cards.filter((c) => c.running).length === 1 && cards[cards.length - 1].running,
    'exactly the last card should shimmer as running'
  )
  console.log('tool cards:', JSON.stringify({ before: cardsBefore, total: cards.length, cards }))
}
await page.screenshot({ path: `${outDir}/8-tool-cards.png` })

/* 4c · the morning brief ritual (#285). Boot ran at ?t=9:40 — past the default
   8:30 briefMin, outside quiet hours — so the REAL engine fired the brief on
   its first tick: exactly one card in the session log (a bonus identity
   signal on top of the build-identity guard above — an older bundle has no
   morning-brief nudge to render). Then the once-per-day law, delta-counted:
   three more engine ticks through the __mewSetIdle seam must leave the count
   at one. */
phase = 'morning-brief'
{
  const briefCount = () =>
    page.$$eval(
      '.tui-nudge .h',
      (els) => els.filter((e) => e.textContent?.includes('nudge/morning-brief')).length
    )
  const atBoot = await briefCount()
  assert(atBoot === 1, `expected exactly one morning-brief card at boot, found ${atBoot}`)
  const briefText = await page.$$eval(
    '.tui-nudge',
    (els) =>
      els
        .find((e) => e.querySelector('.h')?.textContent?.includes('nudge/morning-brief'))
        ?.textContent?.replace(/\s+/g, ' ') ?? ''
  )
  assert(/today: /.test(briefText), 'brief card is missing its shape line')
  assert(
    !/\b(missed|failed|behind|overdue)\b/i.test(briefText),
    'voice law violated: a banned word reached the brief card'
  )
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__mewSetIdle?.(0)) // one real store tick each
    await page.waitForTimeout(120)
  }
  const afterTicks = await briefCount()
  assert(
    afterTicks === atBoot,
    `once-per-day broken: ${atBoot} brief card(s) became ${afterTicks} after re-ticks`
  )
  console.log(
    'morning-brief:',
    JSON.stringify({ cards: afterTicks, reticksAdded: afterTicks - atBoot })
  )
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.tui-nudge')].find((e) =>
      e.querySelector('.h')?.textContent?.includes('nudge/morning-brief')
    )
    el?.scrollIntoView({ block: 'center' })
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${outDir}/9-morning-brief.png` })
}

/* 4d · plan mode's scenario picker (#293): the canonical propose moment —
   three named mini-week cards in the stream, scripted through __mewSayScenarios
   (the render seam beside __mewSay) so the tableau is deterministic and
   keyless. The a11y contract is asserted, not eyeballed: a labeled group,
   one article per option, spoken strips, real enabled pick buttons. */
phase = 'plan-picker'
{
  await page.evaluate(() => {
    window.__mewSayScenarios?.([
      {
        name: 'protected mornings',
        line: 'deep work in your best mornings — all 4 fit',
        places: [
          { title: 'investor memo', tag: 'work', dayOffset: 0, startMin: 600, durationMin: 90 },
          { title: 'budget review', tag: 'work', dayOffset: 1, startMin: 540, durationMin: 60 },
          { title: 'gym session', tag: 'private', dayOffset: 2, startMin: 420, durationMin: 60 },
          { title: 'errands', tag: 'private', dayOffset: 3, startMin: 900, durationMin: 45 },
        ],
      },
      {
        name: 'spread even',
        line: 'every block gets breathing room — all 4 fit',
        places: [
          { title: 'investor memo', tag: 'work', dayOffset: 1, startMin: 840, durationMin: 90 },
          { title: 'budget review', tag: 'work', dayOffset: 3, startMin: 600, durationMin: 60 },
          { title: 'gym session', tag: 'private', dayOffset: 4, startMin: 1080, durationMin: 60 },
          { title: 'errands', tag: 'private', dayOffset: 5, startMin: 900, durationMin: 45 },
        ],
      },
      {
        name: 'front-loaded',
        line: 'the heavy work lands early, the week clears sooner — all 4 fit',
        places: [
          { title: 'investor memo', tag: 'work', dayOffset: 0, startMin: 585, durationMin: 90 },
          { title: 'budget review', tag: 'work', dayOffset: 0, startMin: 690, durationMin: 60 },
          { title: 'gym session', tag: 'private', dayOffset: 1, startMin: 420, durationMin: 60 },
          { title: 'errands', tag: 'private', dayOffset: 1, startMin: 900, durationMin: 45 },
        ],
      },
    ])
  })
  await page.waitForSelector('.scn-cards', { timeout: 5000 })
  await page.waitForTimeout(400)
  const picker = await page.evaluate(() => {
    const group = document.querySelector('.scn-cards')
    const cards = [...document.querySelectorAll('.scn-card')]
    const buttons = cards.map((c) => c.querySelector('button'))
    return {
      groupLabel: group?.getAttribute('aria-label') ?? '',
      cardCount: cards.length,
      labeled: cards.every((c) => /^plan option — .+/.test(c.getAttribute('aria-label') ?? '')),
      days: document.querySelectorAll('.scn-day').length,
      tinted: document.querySelectorAll('.scn-day.l1, .scn-day.l2, .scn-day.l3').length,
      slivers: document.querySelectorAll('.scn-slv').length,
      stripsSpoken: [...document.querySelectorAll('.scn-strip')].every((s) =>
        (s.getAttribute('aria-label') ?? '').trim()
      ),
      pickable: buttons.every((b) => b && !b.disabled && (b.getAttribute('aria-label') ?? '')),
    }
  })
  console.log('plan picker:', JSON.stringify(picker))
  assert(picker.groupLabel === 'plan options', 'picker group is not labeled "plan options"')
  assert(picker.cardCount === 3, `expected 3 scenario cards, found ${picker.cardCount}`)
  assert(picker.labeled, 'a scenario card is missing its "plan option — <name>" article label')
  assert(picker.days === 21, `expected 7 day columns × 3 cards, found ${picker.days}`)
  assert(picker.tinted >= 9, 'the day-load density tint classes are missing from the strips')
  assert(picker.slivers === 12, `expected 12 place slivers, found ${picker.slivers}`)
  assert(picker.stripsSpoken, 'a mini-week strip has no spoken summary (aria-label)')
  assert(picker.pickable, 'a pick button is disabled or unnamed while the offer is live')
  await page.evaluate(() =>
    document.querySelector('.scn-cards')?.scrollIntoView({ block: 'center' })
  )
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${outDir}/10-plan-picker.png` })
}

/* 4e · the block-card remove affordance + done-block confirm (#334). A done
   block is no longer walled off: its detail card offers Remove, and one confirm
   deletes it — the block AND its mew — in the built app, through the real
   week-view card + store. Proves the cage-lift end-to-end, not just in units. */
phase = 'remove-affordance'
{
  await page.click('.seg2 button:has-text("Week")')
  const doneSel = '.nxb-blk[aria-label*="done"]'
  await page.waitForSelector(doneSel, { timeout: 5000 })
  const doneBefore = (await page.$$(doneSel)).length
  await page.click(doneSel) // pin the done block → its detail card docks
  await page.waitForSelector('.nx-card', { timeout: 5000 })
  const removeBtn = await page.$('.nx-card .ca:has-text("Remove")')
  assert(removeBtn, "a done block's detail card offers no Remove control (the cage did not lift)")
  await removeBtn.click() // → the one-line confirm
  const confirmBtn = await page.waitForSelector('.nx-card .ca:has-text("Remove the mew?")', {
    timeout: 3000,
  })
  assert(confirmBtn, 'the remove control did not reveal a confirm step')
  await page.screenshot({ path: `${outDir}/12-remove-affordance.png` }) // gitignored — proof, not canon
  await confirmBtn.click() // confirm → delete the block and its completion
  await page.waitForFunction(
    (n) => document.querySelectorAll('.nxb-blk[aria-label*="done"]').length === n - 1,
    doneBefore,
    { timeout: 5000 }
  )
  const doneAfter = (await page.$$(doneSel)).length
  const session = await page.evaluate(
    () => document.querySelector('.session-scroll')?.textContent ?? ''
  )
  assert(/Removed —/.test(session), 'no positive-voice confirmation of the done-block removal')
  assert(
    !/resurrect|reopened|failed/i.test(session),
    'a removed mew must not be re-opened or spoken as a failure'
  )
  console.log('remove affordance:', JSON.stringify({ doneBefore, doneAfter, confirmed: true }))
}

/* 4f · drag-to-reschedule (#347): direct manipulation on the week grid, proven
   end-to-end with real pointer drags — a RESIZE (edge grip) then a MOVE (carry
   to another day). Both commit through the SAME dragMove door a chat command
   uses (executor law), so the proof is the executor's own "Resized —"/"Moved —"
   line in the session, not a pixel guess. A deterministic demo block lands in
   the empty evening (nothing on the seeded today after ~19:00), so the gesture
   can't collide with the seeded day. */
phase = 'drag-reschedule'
{
  await page.click('.seg2 button:has-text("Week")')
  await page.fill(composer, 'block 90m for drag demo today at 8pm')
  await page.press(composer, 'Enter')
  const tileSel = '.nxb-blk[aria-label*="drag demo" i]'
  await page.waitForSelector(tileSel, { timeout: 6000 })

  /* count what the page actually receives — when this gate reds on a runner,
     the probe line says whether the drag's events reached the window at all
     (browser input pipeline) or arrived and the app declined (product) */
  await page.evaluate(() => {
    window.__dragProbe = { move: 0, up: 0, cmove: 0, cup: 0, dragstart: 0, sel: 0, last: null }
    const p = window.__dragProbe
    window.addEventListener('mousemove', (e) => {
      p.move++
      p.last = [Math.round(e.clientX), Math.round(e.clientY)]
    })
    window.addEventListener('mouseup', () => p.up++)
    /* capture-phase twins: if these count while the bubble pair stays flat,
       something mid-tree is stopping propagation; if BOTH stay flat while
       dragstart ticks, a native drag session has eaten the pointer stream */
    window.addEventListener('mousemove', () => p.cmove++, { capture: true })
    window.addEventListener('mouseup', () => p.cup++, { capture: true })
    window.addEventListener('dragstart', () => p.dragstart++, { capture: true })
    document.addEventListener(
      'selectionchange',
      () => (p.sel = (window.getSelection()?.toString() ?? '').length)
    )
  })
  const drag = async (fromX, fromY, toX, toY) => {
    await page.mouse.move(fromX, fromY)
    await page.mouse.down()
    await page.mouse.move(fromX, fromY + 6) // arm past the 4px threshold
    /* paced, not burst: coalescing folds a same-tick flood of interpolated
       moves; spaced singles give the renderer a frame per waypoint */
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(
        fromX + ((toX - fromX) * i) / 12,
        fromY + 6 + ((toY - fromY - 6) * i) / 12
      )
      await page.waitForTimeout(40)
    }
    await page.mouse.up()
    await page.waitForTimeout(450)
    console.log('drag probe:', JSON.stringify(await page.evaluate(() => window.__dragProbe)))
  }
  const sessionText = () =>
    page.evaluate(() => document.querySelector('.session-scroll')?.textContent ?? '')
  /* the executor line lands async after pointer-up — poll for it instead of
     trusting a fixed sleep (slow CI runners lose that race); the assert after
     a timed-out poll still owns the canonical failure line */
  const sessionSettled = (pattern) =>
    page
      .waitForFunction(
        (src) =>
          new RegExp(src, 'i').test(document.querySelector('.session-scroll')?.textContent ?? ''),
        pattern,
        { timeout: 8000, polling: 250 }
      )
      .catch(() => {})

  // RESIZE — grab the bottom grip and stretch the duration down into the void
  const handle = await page.waitForSelector(`${tileSel} .nxb-resize.bottom`, { timeout: 5000 })
  const hb = await handle.boundingBox()
  await drag(hb.x + hb.width / 2, hb.y + hb.height / 2, hb.x + hb.width / 2, hb.y + 48)
  await page.waitForSelector(tileSel, { timeout: 5000 })
  await sessionSettled('Resized — drag demo')
  assert(
    /Resized — drag demo/i.test(await sessionText()),
    'a pointer edge-drag did not commit a resize through the executor'
  )
  await page.screenshot({ path: `${outDir}/14-drag-resize.png` }) // gitignored — proof, not canon

  // MOVE — carry the block to a different day column at the same time (every
  // seeded day's evening is clear, so the horizontal drop always lands free)
  const box = await (await page.$(tileSel)).boundingBox()
  const tileCx = box.x + box.width / 2
  const cols = await page.$$eval('.wk-grid [data-daykey]', (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      return { left: r.left, right: r.right, cx: r.left + r.width / 2 }
    })
  )
  const target = cols.find((c) => !(tileCx >= c.left && tileCx < c.right))
  assert(target, 'no neighbouring day column to move the block into')
  const midY = box.y + box.height / 2
  await drag(tileCx, midY, target.cx, midY)
  await page.waitForSelector(tileSel, { timeout: 5000 })
  await sessionSettled('Moved — drag demo')
  assert(
    /Moved — drag demo/i.test(await sessionText()),
    'a pointer drag did not commit a move through the executor'
  )
  await page.screenshot({ path: `${outDir}/13-drag-move.png` }) // gitignored — proof, not canon
  console.log('drag-reschedule: resize + move committed via the executor')
}

/* 4c · the quick-capture inbox (#348) — capture an intent that holds no time,
   then gbrain's fitting-slot offer the owner confirms. Driven through the REAL
   capture field + the real fitOffers, keyless; back to the week when done so
   the settings phase below finds its navlink. */
phase = 'inbox'
await page.click('.navlink:has-text("inbox")')
await page.waitForSelector('.inbox-page')
for (const t of ['call the bank', 'ship the deck for the review']) {
  await page.fill('.inbox-input', t)
  await page.click('.inbox-capture button:has-text("add")')
  await page.waitForTimeout(150)
}
await page.waitForSelector('.inbox-item')
await page.screenshot({ path: `${outDir}/15-inbox.png` }) // gitignored — proof, not canon
await page.click('.inbox-head button') // ← week
await page.waitForSelector('.seg2')

/* 5 · settings + retheme + light */
phase = 'settings'
await page.click('text=settings')
await page.waitForSelector('.set-card h2')
await page.screenshot({ path: `${outDir}/6-settings.png` })
await page.click('.petopt:has-text("Fox")')
await page.click('.segc button:has-text("Pet white")')
await page.waitForTimeout(400)
await page.screenshot({ path: `${outDir}/7-fox-petwhite.png` })

/* 6 · what mew's noticed (#287) — the insights card shows the science from
   the seeded memory (populated rides in 6-settings.png), each row carrying
   its data-claim traceability pin and never failure language. */
phase = 'insights-card'
const claims = await page.$$eval('[data-card="noticed"] [data-claim]', (els) =>
  els.map((e) => ({ claim: e.getAttribute('data-claim'), text: e.textContent ?? '' }))
)
console.log('insights card:', JSON.stringify(claims.map((c) => c.claim)))
assert(
  claims.length >= 1 && claims.length <= 4,
  `insights card: want 1–4 claim rows, got ${claims.length}`
)
assert(
  claims.every((c) => c.text.trim().length > 0),
  'an insights row rendered empty'
)
assert(
  !/missed|failed|behind|overdue/i.test(claims.map((c) => c.text).join(' ')),
  'insights card leaked failure language'
)

/* 6a · the memory console (#330) — "what I've picked up about you" extends the
   insights card: it renders from the SAME seeded local memory, every row
   carrying its own data-claim traceability pin (a rule's support count, an
   insights fn, a stated rule), and never failure language. Scoped to its own
   card so it can't be confused with the noticed card above. Populated rides in
   6-settings.png; this asserts the live contract and captures a proof shot. */
phase = 'memory-console'
{
  const rows = await page.$$eval('[data-card="memory"] [data-claim]', (els) =>
    els.map((e) => ({ claim: e.getAttribute('data-claim'), text: e.textContent ?? '' }))
  )
  console.log(
    'memory console:',
    JSON.stringify({ rows: rows.length, claims: rows.map((r) => r.claim) })
  )
  assert(rows.length >= 1, 'memory console shows nothing from the seeded memory')
  assert(
    rows.every((r) => r.text.trim().length > 0),
    'a memory console row rendered empty'
  )
  assert(
    !/missed|failed|behind|overdue/i.test(rows.map((r) => r.text).join(' ')),
    'memory console leaked failure language'
  )
  await page.evaluate(() =>
    document.querySelector('[data-card="memory"]')?.scrollIntoView({ block: 'center' })
  )
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${outDir}/12-memory-console.png` }) // gitignored — proof, not canon
}

/* …and the empty state: wipe ONLY the memory table — blocks/settings stay,
   so the reload skips the first-run seed and the floor is honestly empty */
phase = 'insights-empty'
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('mew')
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
  await new Promise((res, rej) => {
    const tx = db.transaction('memory', 'readwrite')
    tx.objectStore('memory').clear()
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
  db.close()
})
await page.reload()
await page.waitForSelector('.nx-stage', { timeout: 10000 })
await page.click('text=settings')
await page.waitForSelector('.set-card h2')
assert(
  await page.$('text=still learning your week'),
  'below the data floor the card must show the kind empty state'
)
assert(!(await page.$('[data-claim]')), 'below the floor the card must not claim science')
await page.screenshot({ path: `${outDir}/8-insights-empty.png` }) // gitignored — proof, not canon
console.log('insights: populated rows asserted; empty state honest')

/* 6b · the memory console under the same wiped floor (#330): with nothing
   learned or stated, it drops every row and speaks one kind line — never thin
   claims from noise, and no data-claim under its card. */
phase = 'memory-console-empty'
{
  const memText = (await page.textContent('[data-card="memory"]')) ?? ''
  assert(
    /still getting to know you/.test(memText),
    'below the floor the memory console must show the kind empty state'
  )
  assert(
    !(await page.$('[data-card="memory"] [data-claim]')),
    'below the floor the memory console must not claim anything'
  )
  await page.evaluate(() =>
    document.querySelector('[data-card="memory"]')?.scrollIntoView({ block: 'center' })
  )
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${outDir}/12-memory-console-empty.png` }) // gitignored — proof
  console.log('memory console: populated rows asserted; empty state honest')
}

await browser.close()
console.log('done →', outDir)
