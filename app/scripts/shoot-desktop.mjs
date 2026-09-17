/* Desktop-shell proof: with the shell stubbed before boot (lib/tauri-stub.mjs),
   the Tauri-only surfaces render in a plain headless browser. It covers the
   first-boot restore offer in chat, the Settings "Desktop auto-backup" row, a
   restore that round-trips through the real store, and the backup write path
   (the window's close request flushes a pending snapshot through the stub,
   instead of sitting out the 30s coalescer).
   Owns canon: shots/desktop-1-restore-offer.png · shots/desktop-2-settings-row.png ·
               shots/desktop-3-restored.png
   Usage: node scripts/shoot-desktop.mjs [baseUrl]  (default http://localhost:5199) */

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
import { SHOOT_DATE } from './lib/shootClock.mjs'
import { installTauriStub } from './lib/tauri-stub.mjs'

const base = baseUrl()
await assertBuild(base)
const out = shotsDir()
const { browser, page, pageErrors } = await launch()
const { check, finish } = checks()

/* a backup from the day before the pinned canon day, holding one block on it */
const backup = {
  blocks: [
    {
      id: 'restored-1',
      title: 'the restored block — deep work',
      tag: 'work',
      dayKey: SHOOT_DATE,
      startMin: 13 * 60,
      endMin: 15 * 60,
      protected: true,
      status: 'open',
      calendarRefs: [],
      estimateSource: 'user',
    },
  ],
  captures: [],
  chat: [],
  memory: [],
  settings: null,
}
const prior = new Date(`${SHOOT_DATE}T12:00:00`)
prior.setDate(prior.getDate() - 1)
const priorKey = `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, '0')}-${String(prior.getDate()).padStart(2, '0')}`

await page.addInitScript(installTauriStub, {
  files: {
    'MEW/mew-backup.json': JSON.stringify(backup),
    [`MEW/mew-backup-${priorKey}.json`]: JSON.stringify(backup),
  },
})
await boot(page, base)

/* 1 · first-boot restore offer (an empty profile finds the backup) */
const offerEl = page.locator('.tui-nudge', { hasText: 'Documents/MEW' })
const offer = await until(() => offerEl.textContent(), 8000)
console.log('restore offer:', offer?.trim().slice(0, 110) ?? 'NOT FOUND')
check(!!offer, 'first boot offers the backup found in Documents/MEW')
check(!!offer?.includes(priorKey), 'the offer names the backup date')
await offerEl.scrollIntoViewIfNeeded().catch(() => {})
await shot(page, `${out}/desktop-1-restore-offer.png`)

/* 2 · the Settings row exists only on the desktop */
await page.click('.navlink:has-text("settings")')
await page.waitForSelector('.set-card h2')
const row = page.locator('.set-row', { hasText: 'Desktop auto-backup' })
check((await row.count()) === 1, 'Settings shows the Desktop auto-backup row')
await row.scrollIntoViewIfNeeded().catch(() => {})
await shot(page, `${out}/desktop-2-settings-row.png`)

/* 3 · accepting restores the week through the real store */
await page.click('text=back to your week')
await page.locator('.tui-nudge', { hasText: 'Documents/MEW' }).locator('.tui-btn.pri').click()
const restored = await until(
  async () => (await page.textContent('.session-scroll'))?.includes('Restored —'),
  8000
)
check(!!restored, 'bring it back → "Restored —" in chat')
await shot(page, `${out}/desktop-3-restored.png`)

/* 4 · a change marks the snapshot dirty; the close request flushes it to disk */
const before = await page.evaluate(() => window.__tauri.writes)
await say(page, 'block 30m for inbox today at 16:30')
await until(async () => (await page.textContent('.session-scroll'))?.includes('inbox'), 5000)
await page.evaluate(() => window.__tauri.requestClose())
const wrote = await until(
  async () => (await page.evaluate(() => window.__tauri.writes)) > before,
  5000
)
check(!!wrote, 'the close request writes the backup through the shell (fs.writeTextFile)')
const latest = await page.evaluate(() => window.__tauri.files.get('MEW/mew-backup.json') ?? '')
check(latest.includes('inbox'), 'the written backup carries the new block')

await finish(browser, pageErrors, `✓ desktop surfaces verified → ${out}`)
