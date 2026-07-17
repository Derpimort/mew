/* Weekly ritual proof (#304): a Sunday 17:04 boot (via the ?d= clock shift)
   against the REAL seeded week + a simulated 12-meeting pull for the coming
   Mon–Thu. The engine posts ONE ritual invite (once per ISO week — re-ticks
   add nothing), the "plan my week" chip becomes an ordinary user turn, and
   the keyless floor answers with the #293 picker: ≥2 named scenarios laid
   AROUND the fixed meetings, nothing placed until a pick. Fails loudly on
   any miss: build identity, exactly one invite, the chip's user turn, the
   picker's card count. Usage: node scripts/shoot-ritual.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { findChromium } from './lib/chromium.mjs'

const base = process.argv[2] ?? 'http://localhost:5217'
const exe = findChromium()
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

/* the next Sunday from the host clock (today if Sunday) — the ?d= override
   shifts the app's day there so the ritual window is real, not simulated */
const sunday = new Date()
sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7))
const pad = (n) => String(n).padStart(2, '0')
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dayAfter = (d, n) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return key(x)
}

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 840 } })
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text())
})
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

const assert = (cond, msg) => {
  if (!cond) {
    console.log('RITUAL FAIL:', msg)
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
    .screenshot({ path: `${outDir}/fail-ritual-${phase}.png` })
    .then(() => console.log('fail shot →', `${outDir}/fail-ritual-${phase}.png`))
    .catch(() => {})
    .finally(() => process.exit(1))
})

/* 0 · build-identity guard: the served page must carry THIS checkout's bundle */
phase = 'identity'
const distHtml = readFileSync(path.resolve('dist/index.html'), 'utf8')
const wantSrc = distHtml.match(/src="([^"]*assets\/index-[^"]+\.js)"/)?.[1]
assert(wantSrc, 'dist/index.html has no hashed index bundle — run pnpm build first')
await page.goto(`${base}/?d=${key(sunday)}&t=17:04`)
const servedSrc = await page.evaluate(() =>
  [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).join(' ')
)
assert(
  servedSrc.includes(wantSrc),
  `served bundle (${servedSrc}) is not this build's (${wantSrc}) — wrong server?`
)
console.log('build identity:', wantSrc, '· app day:', key(sunday), '(sunday) 17:04')

/* 1 · Sunday evening boot; a 12-meeting coming week rides the real pull path */
phase = 'seed'
await page.waitForSelector('.nx-stage', { timeout: 15000 })
await page.evaluate(() => window.__mewConfigure?.({ hasSeenOnboarding: true }))
await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 }).catch(() => {})
await page.evaluate(
  (days) => {
    const events = []
    for (let d = 0; d < 4; d++) {
      ;[13 * 60, 14.5 * 60, 16 * 60].forEach((startMin, i) => {
        events.push({
          eventId: `rit-${d}-${i}`,
          title: `Sync ${d + 1}.${i + 1}`,
          startMin,
          endMin: startMin + 45,
          dayKey: days[d],
        })
      })
    }
    window.__mewSimulatePull?.(events)
  },
  [dayAfter(sunday, 1), dayAfter(sunday, 2), dayAfter(sunday, 3), dayAfter(sunday, 4)]
)

/* 2 · the ritual invite: one card, once — re-ticks add nothing (weekKey law) */
phase = 'invite'
const ritualCards = () =>
  page.$$eval('.tui-nudge', (els) =>
    els.filter((e) => e.querySelector('.h')?.textContent?.includes('nudge/weekly-ritual'))
  )
for (let i = 0; i < 4 && (await ritualCards()).length === 0; i++) {
  await page.evaluate(() => window.__mewSetIdle?.(0)) // one real engine tick
  await page.waitForTimeout(150)
}
assert((await ritualCards()).length === 1, 'no weekly-ritual invite after 4 ticks')
const inviteText = await page.$$eval(
  '.tui-nudge',
  (els) =>
    els
      .find((e) => e.querySelector('.h')?.textContent?.includes('nudge/weekly-ritual'))
      ?.textContent?.replace(/\s+/g, ' ') ?? ''
)
assert(/shape the coming week/.test(inviteText), `invite voice off: ${inviteText}`)
assert(/12 fixed meetings/.test(inviteText), `invite misses the pulled load: ${inviteText}`)
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.__mewSetIdle?.(0))
  await page.waitForTimeout(120)
}
assert((await ritualCards()).length === 1, 'once-per-week broken: the invite multiplied')

/* 3 · the chip is the turn: "plan my week" → the keyless picker, ≥2 shapes */
phase = 'chip'
await page.click('.tui-nudge button:has-text("plan my week")')
await page.waitForSelector('.scn-cards', { timeout: 15000 })
const userTurn = await page.$$eval('.log', (els) =>
  els.some((e) => (e.textContent ?? '').includes('plan my week'))
)
assert(userTurn, 'the chip did not post its words as a user turn')
const cardCount = await page.$$eval('.scn-card', (els) => els.length)
assert(cardCount >= 2, `picker holds ${cardCount} scenario(s) — expected ≥2`)
const names = await page.$$eval('.scn-name', (els) => els.map((e) => e.textContent))
console.log('picker scenarios:', JSON.stringify(names))

/* 4 · the shot: the invite + the picker in one frame of the session log —
   pin the invite card to the top of the scroll pane so the chip, the user
   turn, and the first picker cards all share the frame */
phase = 'shot'
await page.evaluate(() => {
  const invite = [...document.querySelectorAll('.tui-nudge')].find((e) =>
    e.querySelector('.h')?.textContent?.includes('nudge/weekly-ritual')
  )
  const scroll = document.querySelector('.session-scroll')
  if (invite && scroll) {
    scroll.scrollTop =
      invite.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 8
  }
})
await page.waitForTimeout(400)
await page.screenshot({ path: `${outDir}/10-weekly-ritual.png` })

await browser.close()
console.log('ritual proof: invite ×1 (re-ticks held) · chip → user turn · picker ≥2 scenarios')
console.log('done →', `${outDir}/10-weekly-ritual.png`)
