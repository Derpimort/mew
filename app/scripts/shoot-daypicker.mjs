/* The Focus dial's day picker (#23 slice 2): the date is a real button whose
   calendar glyph opens a month grid. Drives the real app against a served dist
   with today pinned by scripts/lib/shootClock.mjs (the shoot.mjs gate's
   Wednesday; SHOOT_DATE probes another day, and every date checked below derives
   from it) and fails loudly on any miss:
     · at rest on today the trigger IS the date: no box of its own (its rect is
       the date text's), the glyph and pill invisible, named by the date it shows
     · keyboard focus reveals the glyph like hover; Enter opens a modal dialog
       on the dial's day (aria-selected + aria-current, one roving tab stop)
     · open, the picker sits inside the stage and on top of everything under it
       (every day's centre hit-tests to the picker), the live time it stands in
       for is hidden, and the header + picker carry zero text collisions
     · ←/PageDown/PageUp/Enter move and pick; the dial shows the picked day and
       focus comes home to the trigger, with its focus ring
     · the light theme: reopened by pointer on the picked day, today still marked;
       a press outside dismisses; back on today the glyph rests invisible again
   Shots (cropped to the top of the stage): daypicker-trigger.png (hover),
   daypicker-today.png (open on today), daypicker-away-light.png (open off today).
   Usage: node scripts/shoot-daypicker.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { findChromium } from './lib/chromium.mjs'
import { PROBING, SHOOT_DATE, clockUrl, shootDay } from './lib/shootClock.mjs'

const base = process.argv[2] ?? 'http://localhost:5199'
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

/* every date this proof checks derives from the pinned day, so a SHOOT_DATE probe
   walks the same keys on any weekday (a Wednesday on the pin) */
const TODAY = SHOOT_DATE
const pinned = shootDay() // the pinned day at noon, local
const dayAt = (n) => new Date(pinned.getFullYear(), pinned.getMonth(), pinned.getDate() + n, 12)
const keyOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** the picker's PageDown/PageUp: same day-of-month, clamped to the month's end */
const addMonths = (d, n) => {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1, 12)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(d.getDate(), last))
  return target
}
const weekday = (d) => d.toLocaleDateString('en-US', { weekday: 'long' }) // "Monday"
const month = (d, style) => d.toLocaleDateString('en-US', { month: style }) // "September" | "Sep"
const dateLine = (d) => `${weekday(d).slice(0, 3)} · ${month(d, 'short')} ${d.getDate()}` // "Wed · Sep 16"
/** the day keys of d's month grid, exactly as dayPickerKeys.monthGrid lays it out:
    whole Monday-first weeks, from the Monday on or before the 1st through the week
    that holds the month's last day (28, 35 or 42 cells) */
const monthGridKeys = (d) => {
  const first = new Date(d.getFullYear(), d.getMonth(), 1, 12)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)
  const cursor = new Date(first)
  cursor.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  const keys = []
  while (cursor <= last) {
    for (let i = 0; i < 7; i++) {
      keys.push(keyOf(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  return keys
}
const PICKED = dayAt(-2) // two ArrowLefts back from today
console.log('pinned day:', SHOOT_DATE, PROBING ? '(probe)' : '(the pin)')
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 840 } })
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text())
})
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

const assert = (cond, msg) => {
  if (!cond) {
    console.log('DAYPICKER FAIL:', msg)
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
    .screenshot({ path: `${outDir}/fail-daypicker-${phase}.png` })
    .then(() => console.log('fail shot →', `${outDir}/fail-daypicker-${phase}.png`))
    .catch(() => {})
    .finally(() => process.exit(1))
})

/* 0 · build identity: the served page must carry THIS checkout's bundle */
phase = 'identity'
const distHtml = readFileSync(path.resolve('dist/index.html'), 'utf8')
const wantSrc = distHtml.match(/src="([^"]*assets\/index-[^"]+\.js)"/)?.[1]
assert(wantSrc, 'dist/index.html has no hashed index bundle — run pnpm build first')
await page.goto(clockUrl(base, '9:40'))
const servedSrc = await page.evaluate(() =>
  [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).join(' ')
)
assert(servedSrc.includes(wantSrc), `served bundle (${servedSrc}) is not this build's (${wantSrc})`)
console.log('build identity:', wantSrc)

/* the text-collision net (shoot-overlap.mjs's rules), over one subtree */
const collisions = (root) =>
  page.evaluate((sel) => {
    const hidden = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const s = getComputedStyle(n)
        if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0)
          return true
        if (n.getAttribute?.('aria-hidden') === 'true') return true
      }
      return false
    }
    const walker = document.createTreeWalker(document.querySelector(sel), NodeFilter.SHOW_TEXT)
    const boxes = []
    let owner = 0
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const txt = node.nodeValue.trim()
      const el = node.parentElement
      if (!txt || !el || hidden(el) || el.closest('.sr-only')) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const id = owner++
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue
        const vi = Math.min(r.height * 0.16, 6)
        boxes.push({
          id,
          txt: txt.slice(0, 36),
          left: r.left,
          right: r.right,
          top: r.top + vi,
          bottom: r.bottom - vi,
        })
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
  }, root)

/* what the header and the picker show right now */
const state = () =>
  page.evaluate(() => {
    const trigger = document.querySelector('.nx-day-pick')
    const dt = trigger?.querySelector('.dt')
    const dialog = document.querySelector('[role="dialog"].dp')
    const a = document.activeElement
    const rect = (el) => {
      const r = el?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
    }
    return {
      date: dt?.textContent?.trim() ?? '',
      name: trigger?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      haspopup: trigger?.getAttribute('aria-haspopup'),
      expanded: trigger?.getAttribute('aria-expanded'),
      triggerRect: rect(trigger),
      dtRect: rect(dt),
      glyph: Number(getComputedStyle(document.querySelector('.nx-day-glyph')).opacity),
      pill: Number(getComputedStyle(trigger, '::before').opacity),
      ring: getComputedStyle(trigger, '::before').outlineStyle,
      open: !!dialog,
      modal: dialog?.getAttribute('aria-modal') ?? null,
      month: dialog?.querySelector('.dp-month')?.textContent?.trim() ?? null,
      selected: [...document.querySelectorAll('.dp td[aria-selected="true"]')].map(
        (t) => t.dataset.daykey
      ),
      current: [...document.querySelectorAll('.dp td[aria-current="date"]')].map(
        (t) => t.dataset.daykey
      ),
      stops: document.querySelectorAll('.dp td[tabindex="0"]').length,
      active:
        a?.dataset?.daykey ?? (a?.classList?.contains('nx-day-pick') ? 'trigger' : a?.tagName),
      timeHidden: (() => {
        const t = document.querySelector('.nx-clock .nx-time')
        return t ? getComputedStyle(t).visibility === 'hidden' : null
      })(),
      label: document.querySelector('.nx-stage')?.getAttribute('aria-label') ?? '',
    }
  })

/* the stage-top crop the PR shows */
const cropShot = async (name) => {
  const st = await page.locator('.nx-stage').boundingBox()
  await page.screenshot({
    path: `${outDir}/${name}`,
    clip: { x: st.x + 150, y: st.y, width: 460, height: 340 },
  })
}

/* 1 · at rest on today the trigger is the date, nothing more */
phase = 'rest'
await page.waitForSelector('.nx-stage', { timeout: 15000 })
await page.evaluate(() => window.__mewConfigure?.({ hasSeenOnboarding: true }))
await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 }).catch(() => {})
await page.waitForSelector('.nx-count', { timeout: 10000 })
await page.mouse.move(8, 830)
await page.waitForTimeout(1200)
const rest = await state()
console.log('rest:', JSON.stringify(rest))
assert(rest.date === dateLine(pinned), `the date should read today: "${rest.date}"`)
assert(rest.name === `${dateLine(pinned)} — change day`, `the trigger's name: "${rest.name}"`)
assert(rest.haspopup === 'dialog' && rest.expanded === 'false', 'trigger popup semantics')
const same = (a, b) => Math.abs(a - b) < 0.01
assert(
  same(rest.triggerRect.x, rest.dtRect.x) &&
    same(rest.triggerRect.y, rest.dtRect.y) &&
    same(rest.triggerRect.w, rest.dtRect.w) &&
    same(rest.triggerRect.h, rest.dtRect.h),
  `the trigger must have no box of its own: ${JSON.stringify([rest.triggerRect, rest.dtRect])}`
)
assert(rest.glyph === 0 && rest.pill === 0, 'glyph and pill must be invisible at rest on today')
assert(!rest.open, 'the picker must be closed at rest')

/* 2 · hover shows the button; keyboard focus shows it the same way */
phase = 'reveal'
await page.hover('.nx-day-pick .dt')
await page.waitForTimeout(300)
const hover = await state()
assert(hover.glyph === 1 && hover.pill === 1, 'hover must reveal the glyph and the pill')
await cropShot('daypicker-trigger.png')
await page.mouse.move(8, 830)
await page.focus('.nx-day-pick')
await page.waitForTimeout(300)
assert((await state()).glyph === 1, 'keyboard focus must reveal the glyph like hover')

/* 3 · Enter opens a modal grid on the dial's day, on top and inside the stage */
phase = 'open'
await page.keyboard.press('Enter')
await page.waitForSelector('[role="dialog"].dp', { timeout: 3000 })
await page.waitForTimeout(350) // the rise animation
const open = await state()
console.log('open:', JSON.stringify(open))
assert(open.open && open.modal === 'true' && open.expanded === 'true', 'modal dialog, expanded')
assert(
  open.month === `${month(pinned, 'long')} ${pinned.getFullYear()}`,
  `month heading: "${open.month}"`
)
assert(open.active === TODAY, `focus should land on the dial's day: ${open.active}`)
assert(open.selected.join() === TODAY && open.current.join() === TODAY, 'selected/current')
assert(open.stops === 1, `one roving tab stop, got ${open.stops}`)
assert(open.timeHidden === true, 'the live time the picker stands in for should be hidden')
const layering = await page.evaluate(() => {
  const dp = document.querySelector('[role="dialog"].dp')
  const stage = document.querySelector('.nx-stage').getBoundingClientRect()
  const r = dp.getBoundingClientRect()
  const covered = [...dp.querySelectorAll('td')].filter((td) => {
    const c = td.getBoundingClientRect()
    const hit = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2)
    return !hit || !dp.contains(hit)
  })
  return {
    inside:
      r.left >= stage.left &&
      r.right <= stage.right &&
      r.top >= stage.top &&
      r.bottom <= stage.bottom,
    cells: dp.querySelectorAll('td').length,
    covered: covered.map((td) => td.dataset.daykey),
  }
})
console.log('layering:', JSON.stringify(layering))
assert(layering.inside, 'the picker must sit inside the stage')
/* the pinned month's grid size is 28, 35 or 42 cells — derived, never September's 35 */
const gridCells = monthGridKeys(pinned).length
assert(
  layering.cells === gridCells && layering.covered.length === 0,
  `cells ${layering.cells}/${gridCells}, covered days: ${layering.covered}`
)
const openHits = await collisions('.nx-clock')
assert(openHits.length === 0, `text collisions in the open header: ${openHits.join('; ')}`)
await cropShot('daypicker-today.png')

/* 4 · keys move, Enter picks, focus comes home */
phase = 'pick'
for (const [key, want] of [
  ['ArrowLeft', keyOf(dayAt(-1))],
  ['ArrowLeft', keyOf(PICKED)],
  ['PageDown', keyOf(addMonths(PICKED, 1))],
  ['PageUp', keyOf(addMonths(addMonths(PICKED, 1), -1))],
]) {
  await page.keyboard.press(key)
  await page.waitForTimeout(60)
  const s = await state()
  assert(s.active === want, `${key} should reach ${want}, got ${s.active}`)
}
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
const picked = await state()
console.log('picked:', JSON.stringify(picked))
assert(!picked.open && picked.expanded === 'false', 'Enter should close the picker')
assert(picked.active === 'trigger', `focus should come home to the trigger: ${picked.active}`)
assert(picked.ring === 'solid', 'the trigger should show its keyboard focus ring')
/* PageDown then PageUp returns to the picked day's own date unless the month
   between clamped it (a 31st), so the dial shows exactly where the keys landed */
const LANDED = addMonths(addMonths(PICKED, 1), -1)
assert(picked.date === dateLine(LANDED), `the dial should show the picked day: "${picked.date}"`)
assert(
  picked.label.includes(
    `showing the tasks for ${weekday(LANDED)}, ${month(LANDED, 'long')} ${LANDED.getDate()}`
  ),
  `"${picked.label}"`
)

/* 5 · light theme, off today, reopened by pointer; a press outside dismisses */
phase = 'light'
await page.evaluate(() => window.__mewConfigure?.({ themeMode: 'white' }))
await page.waitForTimeout(400)
await page.click('.nx-day-pick')
await page.waitForSelector('[role="dialog"].dp', { timeout: 3000 })
await page.mouse.move(8, 830)
await page.waitForTimeout(350)
const light = await state()
console.log('light:', JSON.stringify(light))
assert(light.selected.join() === keyOf(LANDED), 'reopens on the picked day')
/* today is marked only when the picked day's month grid reaches today (a picked
   Oct 30 shows October, whose last row ends Sun Nov 1, so a Nov 2 today isn't on it) */
const todayOnGrid = monthGridKeys(LANDED).includes(TODAY)
assert(
  light.current.join() === (todayOnGrid ? TODAY : ''),
  `today stays marked off today: ${light.current.join() || '(none)'}, expected ${todayOnGrid ? TODAY : '(none: not on this grid)'}`
)
const lightHits = await collisions('.nx-clock')
assert(lightHits.length === 0, `text collisions (light, off today): ${lightHits.join('; ')}`)
await cropShot('daypicker-away-light.png')
await page.mouse.click(40, 800)
await page.waitForTimeout(300)
assert(!(await state()).open, 'a press outside should dismiss the picker')

/* 6 · back on today the trigger rests as the date again */
phase = 'back'
await page.evaluate(() => window.__mewConfigure?.({ themeMode: 'carbon' }))
await page.click('.nx-day-today')
await page.mouse.move(8, 830)
await page.waitForTimeout(600)
const back = await state()
assert(back.date === dateLine(pinned) && back.glyph === 0 && back.pill === 0, 'rest on today again')
assert(
  (await collisions('.nx-stage')).length === 0,
  `text collisions (today, closed): ${(await collisions('.nx-stage')).join('; ')}`
)

console.log(
  'day picker: trigger at rest = the date (no box, glyph hidden), hover/focus reveal, modal grid on the dial’s day, on top + inside the stage, zero collisions, keys + Enter pick, focus home with its ring, light theme off today, outside press dismisses — proven'
)
await browser.close()
