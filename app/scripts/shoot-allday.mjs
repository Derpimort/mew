/* All-day lane proof (#27 slice 2): holidays, time off and birthdays are day
   labels on a strip between the date header and 0:00 — never 24-hour blocks.
   Drives the __mewSimulatePull dev seam (the REAL pull path) against a served
   dist and fails loudly on any miss:
     · a Mon–Wed OOO is ONE chip spanning exactly Monday → Wednesday
     · a date-only holiday lands on the week's busiest day, whose timed tiles
       keep their width — no squeezed second lane — and the week's hours hold
     · the page keeps its height: the time grid gives up exactly the lane
     · spans running past the week square off on that side
     · a crowded day folds to "+N more", opens on click, folds back on "less"
     · chips share the grid's single tab stop, walk in reading order, open the
       dock card (all day, no Done/Start/Move/Hold), and a nudge only speaks
     · zero text collisions across the collapsed and expanded lane
   Usage: node scripts/shoot-allday.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { findChromium } from './lib/chromium.mjs'

const base = process.argv[2] ?? 'http://localhost:5199'
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: findChromium(), args: ['--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 840 } })
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text())
})
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

const assert = (cond, msg) => {
  if (!cond) {
    console.log('ALLDAY FAIL:', msg)
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
    .screenshot({ path: `${outDir}/fail-allday-${phase}.png` })
    .then(() => console.log('fail shot →', `${outDir}/fail-allday-${phase}.png`))
    .catch(() => {})
    .finally(() => process.exit(1))
})

/* 0 · build identity: the served page must carry THIS checkout's bundle */
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

/* the text-collision net, the same rules as shoot-overlap.mjs: clip to
   overflow ancestors (ellipsis never phantom-collides), inset line leading,
   skip hidden/zero-area runs — so it reports what the eye sees */
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
    const root = document.querySelector('.nxs1')
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
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
        const w = r.right - r.left
        const h = r.bottom - r.top
        if (w < 1 || h < 1) continue
        const vi = Math.min(h * 0.16, 6)
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

/* 1 · stage: the seeded week, in the Week view */
phase = 'stage'
await page.waitForSelector('.nx-stage', { timeout: 15000 })
await page.evaluate(() => window.__mewConfigure?.({ hasSeenOnboarding: true }))
await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 }).catch(() => {})
await page.click('.seg2 button:has-text("Week")')
await page.waitForSelector('.wk-grid [data-daykey]', { timeout: 10000 })
await page.waitForTimeout(500)

const weekState = () =>
  page.evaluate(() => {
    const cols = [...document.querySelectorAll('.wk-grid [data-daykey]')].map((c) => {
      const r = c.getBoundingClientRect()
      return {
        dayKey: c.getAttribute('data-daykey'),
        left: r.left,
        right: r.right,
        tiles: [...c.querySelectorAll('.nxb-blk')].map((t) => ({
          title: t.getAttribute('aria-label') ?? '',
          width: Math.round(t.getBoundingClientRect().width),
        })),
      }
    })
    return {
      cols,
      summary: document.querySelector('.week-summary')?.textContent?.trim() ?? '',
      pageH: Math.round(document.querySelector('.nxs1')?.getBoundingClientRect().height ?? 0),
      gridH: Math.round(document.querySelector('.wk-grid')?.getBoundingClientRect().height ?? 0),
      lane: !!document.querySelector('.wk-allday'),
    }
  })

/* 2 · the busy day: the owner's Monday lineup lands on this week's Thursday
   through the real pull path — back-to-back meetings plus an overlap, so the
   day already has a two-lane stretch of its own. Measured BEFORE any all-day
   entry exists: the holiday must not change a single tile's width. */
phase = 'busy-day'
const keys = await page.evaluate(() =>
  [...document.querySelectorAll('.wk-grid [data-daykey]')].map((c) => c.getAttribute('data-daykey'))
)
assert(keys.length === 7, `expected 7 day columns, got ${keys.length}`)
const busyIdx = 3 // Thursday: clear of the Mon–Wed span and the Sunday conference
const crowdIdx = 5 // Saturday: the crowded day
const busyDay = keys[busyIdx]
const crowd = keys[crowdIdx]
const timed = [
  { eventId: 'ad-plan', title: 'Planning', startMin: 9 * 60, endMin: 10 * 60, dayKey: busyDay },
  {
    eventId: 'ad-kick',
    title: 'Sprint Kickoff',
    startMin: 9 * 60 + 30,
    endMin: 10 * 60 + 30,
    dayKey: busyDay,
  },
  {
    eventId: 'ad-dsu',
    title: 'Hiring DSU',
    startMin: 11 * 60,
    endMin: 11 * 60 + 30,
    dayKey: busyDay,
  },
  { eventId: 'ad-push', title: 'Prod push', startMin: 16 * 60, endMin: 17 * 60, dayKey: busyDay },
]
await page.evaluate((events) => window.__mewSimulatePull?.(events), timed)
await page.waitForTimeout(500)
const before = await weekState()
assert(!before.lane, 'a week without all-day entries must draw no lane')
const busy = before.cols[busyIdx]
assert(
  busy.tiles.length >= 4,
  `the busy day should hold the lineup (got ${busy.tiles.length} tiles)`
)
const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number)
  const x = new Date(y, m - 1, d + n)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
console.log('stage:', JSON.stringify({ busy: busyDay, tiles: busy.tiles.length, crowd }))

/* 3 · the landing — the SAME listing plus the all-day entries (a listing is
   the calendar's whole truth, so the timed lineup rides along) */
phase = 'landing'
const allDay = (eventId, title, dayKey, endDayKey) => ({
  eventId,
  title,
  startMin: 0,
  endMin: 0,
  allDay: true,
  dayKey,
  ...(endDayKey ? { endDayKey } : {}),
})
await page.evaluate(
  (events) => window.__mewSimulatePull?.(events),
  [
    ...timed,
    allDay('ad-ooo', 'OOO — team offsite', keys[0], keys[2]),
    allDay('ad-holiday', 'Civic Holiday', busyDay),
    allDay('ad-trip', 'Trip home', addDays(keys[0], -3), keys[0]),
    allDay('ad-conf', 'Design conference', keys[6], addDays(keys[6], 2)),
    allDay('ad-pay', 'Payday', crowd),
    allDay('ad-bday', "Sam's birthday", crowd),
    allDay('ad-school', 'School closed', crowd),
    allDay('ad-recycle', 'Recycling day', crowd),
  ]
)
await page.waitForSelector('.wk-allday', { timeout: 5000 })
await page.waitForTimeout(500)

const chips = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.wk-allday-chip')].map((c) => {
      const r = c.getBoundingClientRect()
      return {
        text: c.textContent?.trim() ?? '',
        label: c.getAttribute('aria-label') ?? '',
        cls: c.className,
        left: r.left,
        right: r.right,
        top: Math.round(r.top),
      }
    })
  )
const after = await weekState()
const lane1 = await chips()
console.log('lane:', JSON.stringify(lane1.map((c) => c.text)))

/* ONE continuous chip across Monday → Wednesday */
const ooo = lane1.filter((c) => c.text === 'OOO — team offsite')
assert(ooo.length === 1, `the Mon–Wed OOO must be ONE chip (got ${ooo.length})`)
const near = (a, b) => Math.abs(a - b) <= 2
assert(
  near(ooo[0].left, after.cols[0].left + 4) && near(ooo[0].right, after.cols[2].right - 4),
  `OOO chip ${Math.round(ooo[0].left)}→${Math.round(ooo[0].right)} does not span Monday ${Math.round(after.cols[0].left)} → Wednesday ${Math.round(after.cols[2].right)}`
)
assert(
  /all day, monday to wednesday, from your calendar/.test(ooo[0].label),
  `OOO chip is not named as an all-day span: "${ooo[0].label}"`
)

/* the holiday sits over the busy day alone, and its tiles keep their width */
const hol = lane1.find((c) => c.text === 'Civic Holiday')
const busyAfter = after.cols[busyIdx]
assert(hol, 'the date-only holiday did not land in the lane')
assert(
  near(hol.left, busyAfter.left + 4) && near(hol.right, busyAfter.right - 4),
  'the holiday chip does not span exactly its day'
)
assert(
  after.cols.every((c) =>
    c.tiles.every((t) => !/civic holiday|offsite|birthday|payday/i.test(t.title))
  ),
  'an all-day entry leaked into the time grid as a tile'
)
assert(
  JSON.stringify(busyAfter.tiles) === JSON.stringify(busy.tiles),
  `the busy day's tiles changed width with a holiday present:\n  before ${JSON.stringify(busy.tiles)}\n  after  ${JSON.stringify(busyAfter.tiles)}`
)
assert(
  after.summary.split('·')[0] === before.summary.split('·')[0],
  `the week's hours moved: "${before.summary}" → "${after.summary}"`
)
assert(near(after.pageH, before.pageH), `the page height moved ${before.pageH} → ${after.pageH}`)
assert(after.gridH < before.gridH, 'the time grid did not give the lane its height')

/* spans running past the visible week square off on that side */
assert(
  /\bcont-l\b/.test(lane1.find((c) => c.text === 'Trip home')?.cls ?? ''),
  'Trip home should continue from before the week'
)
assert(
  /\bcont-r\b/.test(lane1.find((c) => c.text === 'Design conference')?.cls ?? ''),
  'Design conference should continue past the week'
)

/* 4 · crowded day: "+N more", open, fold back */
phase = 'collapse'
const crowdCol = after.cols[crowdIdx]
const inCrowd = (list) =>
  list.filter((c) => c.left >= crowdCol.left - 1 && c.right <= crowdCol.right + 1)
const moreBtn = page.locator('.wk-allday-more')
assert((await moreBtn.count()) === 1, `expected one "+N more" (got ${await moreBtn.count()})`)
const moreText = (await moreBtn.textContent())?.trim()
assert(moreText === '+2 more', `expected "+2 more", got "${moreText}"`)
assert(
  inCrowd(lane1).length === 2,
  `the crowded day should show 2 chips folded (got ${inCrowd(lane1).length})`
)
const foldedHits = await collisions()
assert(foldedHits.length === 0, `text collisions (folded): ${foldedHits.join('; ')}`)
await page.screenshot({ path: `${outDir}/allday-week.png` })

await moreBtn.click()
await page.waitForTimeout(300)
const lane2 = await chips()
assert(
  inCrowd(lane2).length === 4,
  `opened, the crowded day should show 4 chips (got ${inCrowd(lane2).length})`
)
assert(
  (await page.locator('.wk-allday-less').count()) === 1,
  'an opened crowded lane offers "less"'
)
const opened = await weekState()
assert(
  near(opened.pageH, before.pageH),
  `opening the lane moved the page height ${before.pageH} → ${opened.pageH}`
)
const openHits = await collisions()
assert(openHits.length === 0, `text collisions (opened): ${openHits.join('; ')}`)
await page.screenshot({ path: `${outDir}/allday-week-open.png` })
await page.click('.wk-allday-less')
await page.waitForTimeout(300)
assert(inCrowd(await chips()).length === 2, '"less" did not fold the lane back')

/* 5 · keyboard + card: one tab stop, reading order, the dock card */
phase = 'keyboard'
const stops = await page.evaluate(
  () => document.querySelectorAll('.wk-allday-chip[tabindex="0"], .nxb-blk[tabindex="0"]').length
)
assert(stops === 1, `chips and tiles must share ONE tab stop (got ${stops})`)
await page.locator('.wk-allday-chip', { hasText: 'OOO — team offsite' }).focus()
const active = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
await page.keyboard.press('ArrowDown')
await page.waitForTimeout(150)
const down = await active()
assert(
  /^Trip home, all day/.test(down),
  `↓ from the OOO should reach Monday's next chip, got "${down}"`
)
await page.keyboard.press('ArrowUp')
await page.waitForTimeout(150)
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(150)
const right = await active()
console.log('keyboard:', JSON.stringify({ down, right }))
assert(right && !/^OOO/.test(right), '→ from the OOO must leave the span')
await page.locator('.wk-allday-chip', { hasText: 'OOO — team offsite' }).focus()
await page.keyboard.press('Shift+ArrowDown')
await page.waitForTimeout(200)
const spoken = (await page.textContent('[data-wk-live]'))?.trim() ?? ''
assert(
  /covers monday to wednesday — it stays/.test(spoken),
  `a nudge on a chip must only speak, got "${spoken}"`
)
await page.keyboard.press('Enter')
await page.waitForSelector('.wk-dock .nx-card', { timeout: 3000 })
const card = await page.evaluate(() => {
  const c = document.querySelector('.wk-dock .nx-card')
  return {
    title: c?.querySelector('.ct')?.textContent ?? '',
    meta: c?.querySelector('.cm')?.textContent ?? '',
    tag: c?.querySelector('.ctag')?.textContent ?? '',
    actions: [...(c?.querySelectorAll('.cacts button') ?? [])].map((b) => b.textContent?.trim()),
  }
})
console.log('card:', JSON.stringify(card))
assert(card.title === 'OOO — team offsite', 'Enter on a chip did not open its card')
assert(
  /^all day · Mon – Wed/.test(card.meta),
  `the card must say all day, not a clock span: "${card.meta}"`
)
assert(
  !card.actions.some((a) => /done|start|move|hold/i.test(a ?? '')),
  `a calendar all-day card offers actions: ${card.actions}`
)
await page.screenshot({ path: `${outDir}/allday-card.png` })

/* 6 · Pet White: the same lane on the light tokens — still collision-free */
phase = 'white'
await page.evaluate(() => window.__mewConfigure?.({ themeMode: 'white' }))
await page.click('.week-summary') // a click on the week's own surface unpins the card
await page.waitForTimeout(500)
const whiteHits = await collisions()
assert(whiteHits.length === 0, `text collisions (Pet White): ${whiteHits.join('; ')}`)
await page.screenshot({ path: `${outDir}/allday-week-white.png` })
await page.evaluate(() => window.__mewConfigure?.({ themeMode: 'carbon' }))

console.log(
  'all-day lane: continuous span, full-width tiles, height kept, fold/unfold, keyboard + card — proven'
)
await browser.close()
