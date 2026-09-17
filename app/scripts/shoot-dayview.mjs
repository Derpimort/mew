/* The Focus dial on any day (#23 slice 1): the date line steps the dial to
   the day before or after, and away from today nothing pretends it's now.
   Drives the real app against a served dist with today pinned via ?d= (a
   Wednesday) and fails loudly on any miss:
     · today: the steps are invisible at rest, the live clock and countdown
       stand, the hand sweeps, the stage ticks every second
     · a past day (Tuesday): no now-hand, the wash is FULL, no countdown, the
       centre names the day with its summary, the stage stops ticking, the
       dial's name says the day, a block card offers Done/Hold/Remove but never
       Start now/Interrupt/Move
     · a future day (Thursday): no hand, the wash is EMPTY, same resting centre
     · "back to today" restores the live countdown; the picked day survives a
       trip through Week and back
     · zero text collisions on the past and the future day
   Usage: node scripts/shoot-dayview.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { findChromium } from './lib/chromium.mjs'

const base = process.argv[2] ?? 'http://localhost:5199'
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

const TODAY = '2026-09-16' // a Wednesday
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 840 } })
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text())
})
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

const assert = (cond, msg) => {
  if (!cond) {
    console.log('DAYVIEW FAIL:', msg)
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
    .screenshot({ path: `${outDir}/fail-dayview-${phase}.png` })
    .then(() => console.log('fail shot →', `${outDir}/fail-dayview-${phase}.png`))
    .catch(() => {})
    .finally(() => process.exit(1))
})

/* 0 · build identity: the served page must carry THIS checkout's bundle */
phase = 'identity'
const distHtml = readFileSync(path.resolve('dist/index.html'), 'utf8')
const wantSrc = distHtml.match(/src="([^"]*assets\/index-[^"]+\.js)"/)?.[1]
assert(wantSrc, 'dist/index.html has no hashed index bundle — run pnpm build first')
await page.goto(`${base}/?d=${TODAY}&t=9:40`)
const servedSrc = await page.evaluate(() =>
  [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).join(' ')
)
assert(servedSrc.includes(wantSrc), `served bundle (${servedSrc}) is not this build's (${wantSrc})`)
console.log('build identity:', wantSrc)

/* the text-collision net, the same rules as shoot-overlap.mjs */
const collisions = () =>
  page.evaluate(() => {
    const hidden = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const s = getComputedStyle(n)
        if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0)
          return true
        if (n.getAttribute?.('aria-hidden') === 'true') return true
      }
      return false
    }
    const clip = (r, el) => {
      let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const s = getComputedStyle(n)
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
          const c = n.getBoundingClientRect()
          box = {
            left: Math.max(box.left, c.left),
            top: Math.max(box.top, c.top),
            right: Math.min(box.right, c.right),
            bottom: Math.min(box.bottom, c.bottom),
          }
        }
      }
      return box
    }
    const walker = document.createTreeWalker(
      document.querySelector('.nx-stage'),
      NodeFilter.SHOW_TEXT
    )
    const boxes = []
    let owner = 0
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const txt = node.nodeValue.trim()
      const el = node.parentElement
      if (!txt || !el || hidden(el)) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const id = owner++
      for (const raw of range.getClientRects()) {
        const r = clip(raw, el)
        if (r.right - r.left < 1 || r.bottom - r.top < 1) continue
        const vi = Math.min((r.bottom - r.top) * 0.16, 6)
        boxes.push({ id, txt: txt.slice(0, 36), ...r, top: r.top + vi, bottom: r.bottom - vi })
      }
    }
    const hits = []
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        if (a.id === b.id) continue
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (ix > 2 && iy > 2) hits.push(`"${a.txt}" ⟂ "${b.txt}"`)
      }
    return hits
  })

/* what the dial shows right now */
const dial = () =>
  page.evaluate(() => {
    const stage = document.querySelector('.nx-stage')
    const steps = [...document.querySelectorAll('.nx-day-step')]
    return {
      date: document.querySelector('.nx-day .dt')?.textContent?.trim() ?? '',
      label: stage?.getAttribute('aria-label') ?? '',
      stepsVisible: steps.map((s) => Number(getComputedStyle(s).opacity)),
      stepNames: steps.map((s) => s.getAttribute('aria-label') ?? ''),
      time: !!document.querySelector('.nx-clock .nx-time'),
      back: !!document.querySelector('.nx-day-today'),
      count: document.querySelector('.clk-center .nx-count')?.textContent?.trim() ?? null,
      task: document.querySelector('.clk-center .nx-task')?.textContent?.trim() ?? '',
      meta: document.querySelector('.clk-center .nx-meta')?.textContent?.trim() ?? '',
      /* the day wash: the AM disk (0.18) and PM band (0.12) sectors */
      washInner: !!stage?.querySelector('svg path[fill="var(--ice)"][opacity="0.18"]'),
      washOuter: !!stage?.querySelector('svg path[fill="var(--ice)"][opacity="0.12"]'),
      /* the now-hand: its glowing tip circle (r 5.5) */
      hand: !!stage?.querySelector('svg circle[r="5.5"]'),
      arcs: stage?.querySelectorAll('svg [role="button"]').length ?? 0,
    }
  })

/* does the stage re-render on its own? count DOM mutations over ~2.2s */
const ticks = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        let n = 0
        const mo = new MutationObserver((rs) => (n += rs.length))
        mo.observe(document.querySelector('.nx-stage'), {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        })
        setTimeout(() => {
          mo.disconnect()
          resolve(n)
        }, 2200)
      })
  )

/* open the roving arc's card the keyboard way — focus it, Space (the dial's
   'open' key); an arc path's box centre can miss its own thin stroke */
const openArcCard = async () => {
  await page.focus('.nx-stage svg [role="button"][tabindex="0"]')
  await page.keyboard.press(' ')
  await page.waitForSelector('.nx-card.center', { timeout: 3000 })
}

/* 1 · today */
phase = 'today'
await page.waitForSelector('.nx-stage', { timeout: 15000 })
await page.evaluate(() => window.__mewConfigure?.({ hasSeenOnboarding: true }))
await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 }).catch(() => {})
await page.mouse.move(8, 830)
await page.waitForTimeout(1500)
const today = await dial()
console.log('today:', JSON.stringify(today))
assert(
  today.date.startsWith('Wed'),
  `the date line should read today (a Wednesday): "${today.date}"`
)
assert(
  today.label === "focus dial: 12-hour clock showing today's tasks",
  'today’s dial name changed'
)
assert(
  today.stepsVisible.every((o) => o === 0),
  'the day steps must be invisible at rest on today'
)
assert(today.time && !today.back, 'today shows the live time, not "back to today"')
assert(today.hand, 'today’s now-hand is missing')
assert((await ticks()) > 0, 'today’s stage should tick every second')

/* 2 · a past day: the previous-day step (keyboard: focus reveals it, Enter steps) */
phase = 'past'
await page.focus('.nx-day-step.prev')
await page.waitForTimeout(300) // the reveal is an 0.18s opacity transition
assert(
  Number(await page.$eval('.nx-day-step.prev', (el) => getComputedStyle(el).opacity)) > 0,
  'a focused day step must be visible'
)
await page.keyboard.press('Enter')
await page.mouse.move(8, 830)
await page.waitForTimeout(1200)
const past = await dial()
console.log('past:', JSON.stringify(past))
assert(past.date.startsWith('Tue'), `the previous-day step should show Tuesday: "${past.date}"`)
assert(/showing the tasks for Tuesday, September 15/.test(past.label), `dial name: "${past.label}"`)
assert(
  past.stepsVisible.every((o) => o === 1),
  'away from today the steps stay shown'
)
assert(!past.time && past.back, 'away from today the live time gives way to "back to today"')
assert(!past.hand, 'a past day has no now-hand')
assert(past.washInner && past.washOuter, 'a past day’s wash should be FULL')
assert(past.count == null, 'a past day shows no countdown')
assert(/^Tuesday, Sep 15/.test(past.task), `the centre should name the day: "${past.task}"`)
assert(
  /^(a clear day|\d+ blocks?)/.test(past.meta),
  `the centre should summarise the day: "${past.meta}"`
)
assert((await ticks()) === 0, 'a past day’s stage must not tick')
assert(
  (await collisions()).length === 0,
  `text collisions (past): ${(await collisions()).join('; ')}`
)
await page.screenshot({ path: `${outDir}/dayview-past.png` })

/* a block card off today: Done/Hold/Remove, never Start now/Interrupt/Move */
if (past.arcs > 0) {
  await openArcCard()
  const actions = await page.$$eval('.nx-card.center .cacts button', (bs) =>
    bs.map((b) => b.textContent?.trim())
  )
  console.log('past card actions:', JSON.stringify(actions))
  assert(
    !actions.some((a) => /start now|interrupt|^move$/i.test(a ?? '')),
    `off today a card offers a time-relative action: ${actions}`
  )
  await page.screenshot({ path: `${outDir}/dayview-past-card.png` })
  await page.mouse.click(40, 800)
  await page.waitForTimeout(300)
}

/* 3 · a future day: back to today, then the next-day step */
phase = 'future'
await page.click('.nx-day-today')
await page.waitForTimeout(300)
await page.hover('.nx-day .dt')
await page.click('.nx-day-step.next')
await page.mouse.move(8, 830)
await page.waitForTimeout(1200)
const future = await dial()
console.log('future:', JSON.stringify(future))
assert(future.date.startsWith('Thu'), `the next-day step should show Thursday: "${future.date}"`)
assert(!future.hand, 'a future day has no now-hand')
assert(!future.washInner && !future.washOuter, 'a future day’s wash should be EMPTY')
assert(future.count == null && /^Thursday, Sep 17/.test(future.task), 'future centre')
assert(
  (await collisions()).length === 0,
  `text collisions (future): ${(await collisions()).join('; ')}`
)
await page.screenshot({ path: `${outDir}/dayview-future.png` })

/* an OPEN block off today keeps Done, Hold and Remove — and only those */
if (future.arcs > 0) {
  await openArcCard()
  const actions = await page.$$eval('.nx-card.center .cacts button', (bs) =>
    bs.map((b) => b.textContent?.trim())
  )
  console.log('future card actions:', JSON.stringify(actions))
  assert(actions.includes('Done — a mew'), `an open block off today should offer Done: ${actions}`)
  assert(
    actions.some((a) => /hold/i.test(a ?? '')) && actions.includes('Remove'),
    `an open block off today should keep Hold and Remove: ${actions}`
  )
  assert(
    !actions.some((a) => /start now|interrupt|^move$/i.test(a ?? '')),
    `off today a card offers a time-relative action: ${actions}`
  )
  await page.screenshot({ path: `${outDir}/dayview-future-card.png` })
  await page.mouse.click(40, 800)
  await page.waitForTimeout(300)
}

/* 4 · the picked day survives Focus → Week → Focus */
phase = 'week-trip'
await page.click('.seg2 button:has-text("Week")')
await page.waitForTimeout(500)
await page.click('.seg2 button:has-text("Focus")')
await page.waitForSelector('.nx-stage')
await page.waitForTimeout(500)
assert((await dial()).date.startsWith('Thu'), 'the picked day did not survive Focus → Week → Focus')

/* 5 · back to today restores the live dial */
phase = 'back'
await page.click('.nx-day-today')
await page.mouse.move(8, 830)
await page.waitForTimeout(1200)
const back = await dial()
assert(back.date === today.date && back.time && !back.back && back.hand, 'today did not come back')
assert(
  back.count === today.count || (back.count != null) === (today.count != null),
  'the countdown did not come back'
)
assert(
  back.stepsVisible.every((o) => o === 0),
  'back on today the steps rest invisible again'
)
assert((await ticks()) > 0, 'back on today the stage ticks again')

console.log(
  'dial on any day: steps (keyboard + pointer), past full / future empty wash, no hand or tick off today, resting centre, card actions, week round-trip, back to today — proven'
)
await browser.close()
