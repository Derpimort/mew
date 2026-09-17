/* Self-update proof: the desktop shell stages a download and fires
   mew://update-ready; MEW offers it in chat (suggest, never seize) and installs
   ONLY when the owner accepts, invoking apply_update exactly once.
   Owns canon: shots/update-1-offer.png · shots/update-2-accepted.png
   Usage: node scripts/shoot-update.mjs [baseUrl]  (default http://localhost:5199) */

import {
  assertBuild,
  baseUrl,
  boot,
  checks,
  launch,
  shot,
  shotsDir,
  until,
} from './lib/harness.mjs'
import { installTauriStub } from './lib/tauri-stub.mjs'

const base = baseUrl()
await assertBuild(base)
const out = shotsDir()
const { browser, page, pageErrors } = await launch()
const { check, finish } = checks()
const applied = () =>
  page.evaluate(() => window.__tauri.invokes.filter((i) => i.cmd === 'apply_update').length)

await page.addInitScript(installTauriStub, {})
await boot(page, base)

/* the shell announces a staged update, the way the Rust side does */
await until(() => page.evaluate(() => window.__tauri && true))
await page.evaluate(() => window.__tauri.emit('mew://update-ready', '2026.9.1'))

const offer = page.locator('.tui-nudge', { hasText: 'restart when you like' })
const text = await until(() => offer.textContent(), 5000)
console.log('update offer:', text?.trim().slice(0, 110) ?? 'NOT FOUND')
check(!!text?.includes('v2026.9.1'), 'the offer names the staged version')
check((await applied()) === 0, 'nothing installs on its own — the offer only suggests')
await offer.scrollIntoViewIfNeeded()
await shot(page, `${out}/update-1-offer.png`)

await offer.locator('.tui-btn.pri').click() // "restart now"
check(
  (await until(async () => (await applied()) === 1, 3000)) === true,
  'accepting invokes apply_update exactly once'
)
await shot(page, `${out}/update-2-accepted.png`)

await finish(browser, pageErrors, `✓ update flow verified → ${out}`)
