/* Self-update proof: stubs the shell global, fires mew://update-ready like
   the Rust side does after staging a download, and verifies the chat offer:
   suggest-don't-seize copy, install ONLY on accept (apply_update invoked).
   Usage: node scripts/shoot-update.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { findChromium } from './lib/chromium.mjs'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5257'
const exe = findChromium()
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 840 } })).newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

await page.addInitScript(() => {
  window.__applied = 0
  window.__listeners = new Map()
  window.__TAURI_INTERNALS__ = {}
  window.__TAURI__ = {
    fs: {
      mkdir: async () => {},
      writeTextFile: async () => {},
      readTextFile: async () => {
        throw new Error('ENOENT')
      },
      readDir: async () => [],
      remove: async () => {},
    },
    path: {
      BaseDirectory: { Document: 6 },
      documentDir: async () => '/d',
      join: async (...x) => x.join('/'),
    },
    opener: { openPath: async () => {}, openUrl: async () => {} },
    window: {
      getCurrentWindow: () => ({ onCloseRequested: async () => {}, destroy: async () => {} }),
    },
    core: {
      invoke: async (cmd) => {
        if (cmd === 'apply_update') window.__applied++
        return undefined
      },
    },
    event: {
      listen: async (name, cb) => {
        window.__listeners.set(name, cb)
        return () => window.__listeners.delete(name)
      },
    },
  }
})

await page.goto(`${base}/?t=9:40`)
await page.waitForSelector('.nx-count', { timeout: 15000 })
await page.waitForTimeout(1500)

/* the shell announces a staged update */
await page.evaluate(() => window.__listeners.get('mew://update-ready')?.({ payload: '0.2.0' }))
await page.waitForTimeout(600)

const offer = page.locator('.tui-nudge', { hasText: 'restart when you like' })
const text = await offer.textContent().catch(() => null)
console.log('update offer:', text?.trim().slice(0, 110) ?? 'NOT FOUND')
if (!text?.includes('v0.2.0')) {
  console.log('✗ update offer missing')
  process.exit(1)
}
let applied = await page.evaluate(() => window.__applied)
console.log('installs before accept:', applied, applied === 0 ? '✓ never on its own' : '✗ seized')
await offer.scrollIntoViewIfNeeded()
await page.screenshot({ path: `${outDir}/update-1-offer.png` })

await offer.locator('.tui-btn.pri').click() // "restart now"
await page.waitForTimeout(600)
applied = await page.evaluate(() => window.__applied)
console.log('installs after accept:', applied, applied === 1 ? '✓ apply_update invoked once' : '✗')
await page.screenshot({ path: `${outDir}/update-2-accepted.png` })

await browser.close()
if (applied !== 1) process.exit(1)
console.log('✓ update flow verified →', outDir)
