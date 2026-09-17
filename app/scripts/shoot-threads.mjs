/* Loose-threads proof: stages all four thread states through real product flows
   (a capture → unplaced · a block whose window passed → slipped · an interrupted
   live block → paused · an accepted start-by → running), then verifies the
   collapsed pill (count + one dot per thread), the expanded box (all four groups
   in spec order) and the rows' own actions: `place` lands the capture on the
   week, and `resume` restarts the slipped block now.
   Owns canon: shots/threads-1-pill.png · shots/threads-2-box.png ·
               shots/threads-3-placed.png · shots/threads-4-resumed.png
   Usage: node scripts/shoot-threads.mjs [baseUrl]  (default http://localhost:5199) */

import {
  assertBuild,
  baseUrl,
  boot,
  checks,
  launch,
  shot,
  say,
  shotsDir,
  until,
} from './lib/harness.mjs'

const base = baseUrl()
await assertBuild(base)
const out = shotsDir()
const { browser, page, pageErrors } = await launch()
const { check, finish } = checks()
const log = () => page.textContent('.session-scroll')
const pillState = () =>
  page.$eval('.frail', (el) => ({
    count: Number(el.querySelector('.cnt')?.textContent ?? 0),
    dots: el.querySelectorAll('.dot').length,
  }))
/* a row's own action chip, by the row's title and the chip's label */
const rowAction = (title, label) =>
  page.locator('.tbox .trow', { hasText: title }).locator('button', { hasText: label })

await boot(page, base) // a fresh browser context IS a clean profile: the seed week, nothing else

/* unplaced: a bare capture */
await say(page, 'call the bank')
await until(async () => (await log())?.includes('call the bank'))
/* slipped: a block whose window already passed */
await say(page, 'block 30m for journal pages today at 8')
await until(async () => (await log())?.includes('journal pages'))
/* running: a background hold whose deadline is tight enough that start-by fires now; accept */
await say(page, 'organize backups 2h in the background due 11:40')
const startBy = page.locator('.tui-nudge', { hasText: 'organize backups' }).locator('.tui-btn.pri')
check(
  !!(await until(async () => (await startBy.count()) > 0, 8000)),
  'start-by offers to start organize backups'
)
await startBy.first().click()
/* paused: interrupt the live block through its centre card */
await page.click('.nx-task')
await page.click('text=Interrupt — finish later')

/* 1 · collapsed pill: count + one dot per thread */
const pill = await until(async () => {
  const p = await pillState()
  return p.count >= 4 ? p : null
}, 8000)
console.log('pill:', JSON.stringify(pill))
check(
  !!pill && pill.count === pill.dots && pill.dots >= 4,
  'the pill counts every thread, one dot each'
)
await shot(page, `${out}/threads-1-pill.png`)

/* 2 · expanded box: the four groups in spec order */
await page.click('.frail')
await page.waitForSelector('.tbox')
const groups = await page.$$eval('.tbox .tgrp', (els) => els.map((e) => e.textContent?.trim()))
console.log('groups:', groups.join(' · '))
check(
  JSON.stringify(groups) === JSON.stringify(['running', 'slipped', 'paused', 'unplaced']),
  'all four groups, in spec order'
)
await shot(page, `${out}/threads-2-box.png`)

/* 3 · place: the capture's own action lands it on the week */
const logBefore = ((await log()) ?? '').length
await rowAction('call the bank', 'place').click()
const placed = await until(async () => {
  const fresh = ((await log()) ?? '').slice(logBefore)
  const stillUnplaced = await page
    .locator('.tbox .trow', { hasText: 'call the bank' })
    .count()
    .catch(() => 0)
  return /call the bank/i.test(fresh) && stillUnplaced === 0
}, 5000)
check(
  !!placed,
  '`place` lands the capture on the week (a new reply names it; the unplaced row is gone)'
)
await shot(page, `${out}/threads-3-placed.png`)

/* 4 · resume: the slipped block's own action starts it now */
if ((await page.$('.tbox')) == null) await page.click('.frail')
await rowAction('journal pages', 'resume').click()
const resumed = await until(async () => {
  const slippedRows = await page.$$eval(
    '.tbox .trow',
    (els) =>
      els.filter((e) => e.textContent?.includes('journal pages') && e.textContent?.includes('was'))
        .length
  )
  return slippedRows === 0
}, 5000)
check(!!resumed, '`resume` restarts the slipped block (it leaves the slipped group)')
await shot(page, `${out}/threads-4-resumed.png`)

await finish(browser, pageErrors, `✓ loose-threads rail verified → ${out}`)
