/* Desktop-shell proof: stubs window.__TAURI__ (exactly what withGlobalTauri
   provides) before the app boots, so the Tauri-only surfaces render in a
   plain headless browser: the first-boot restore offer in chat, and the
   Settings "Desktop auto-backup" row. Also proves the backup write path
   fires through the stub. Usage: node scripts/shoot-desktop.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5251'
const exe = path.join(os.homedir(), '.cache/ms-playwright/chromium-1223/chrome-linux64/chrome')
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 840 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

await page.addInitScript(() => {
  const files = new Map([
    [
      'MEW/mew-backup.json',
      JSON.stringify({
        blocks: [
          {
            id: 'restored-1',
            title: 'the restored block — deep work',
            tag: 'work',
            dayKey: new Date().toISOString().slice(0, 10),
            startMin: 540,
            endMin: 660,
            status: 'open',
          },
        ],
        captures: [],
        chat: [],
        memory: [],
        settings: null,
      }),
    ],
    ['MEW/mew-backup-2026-06-08.json', '{}'],
  ])
  window.__TAURI_INTERNALS__ = {}
  window.__TAURI__ = {
    fs: {
      mkdir: async () => {},
      writeTextFile: async (p, c) => {
        files.set(p, c)
        window.__backupWrites = (window.__backupWrites ?? 0) + 1
      },
      readTextFile: async (p) => {
        if (!files.has(p)) throw new Error('ENOENT')
        return files.get(p)
      },
      readDir: async (dir) =>
        [...files.keys()]
          .filter((p) => p.startsWith(dir + '/'))
          .map((p) => ({ name: p.slice(dir.length + 1) })),
      remove: async (p) => files.delete(p),
    },
    path: {
      BaseDirectory: { Document: 6 },
      documentDir: async () => '/home/user/Documents',
      join: async (...xs) => xs.join('/'),
    },
    opener: { openPath: async () => {} },
    window: {
      getCurrentWindow: () => ({ onCloseRequested: async () => {}, destroy: async () => {} }),
    },
  }
})

await page.goto(`${base}/?t=9:40`)
await page.waitForSelector('.nx-count', { timeout: 15000 })
await page.waitForTimeout(2500)

/* 1 · first-boot restore offer (empty profile → seed + offer) */
const offerEl = page.locator('.tui-nudge', { hasText: 'Documents/MEW' })
const offer = await offerEl.textContent().catch(() => null)
console.log('restore offer:', offer?.trim().slice(0, 110) ?? 'NOT FOUND')
if (!offer) {
  console.log('✗ restore offer missing')
  process.exit(1)
}
await offerEl.scrollIntoViewIfNeeded()
await page.screenshot({ path: `${outDir}/desktop-1-restore-offer.png` })

/* 2 · Settings row, desktop only */
await page.click('text=settings')
await page.waitForSelector('.set-card h2')
const row = await page.textContent('text=Desktop auto-backup').catch(() => null)
console.log('settings row:', row ? 'present' : 'NOT FOUND')
if (!row) process.exit(1)
await page.screenshot({ path: `${outDir}/desktop-2-settings-row.png` })

/* 3 · accept restores the week through the real store */
await page.click('text=back to your week')
await page.locator('.tui-nudge', { hasText: 'Documents/MEW' }).locator('.tui-btn.pri').click() // "bring it back"
await page.waitForTimeout(1200)
const log = await page.textContent('.session-scroll')
const restored = log?.includes('Restored —')
console.log('restore round-trip:', restored ? '✓ Restored — message in chat' : '✗ missing')
await page.screenshot({ path: `${outDir}/desktop-3-restored.png` })

/* 4 · auto-backup write fired through the stub after a change */
await page.fill('.prompt-row input, .prompt-row textarea', 'block 30m for inbox today at 16:30')
await page.press('.prompt-row input, .prompt-row textarea', 'Enter')
await page.waitForTimeout(31_000)
const writes = await page.evaluate(() => window.__backupWrites ?? 0)
console.log(`backup writes after change + 30s: ${writes}`)

await browser.close()
if (!restored || writes < 1) process.exit(1)
console.log('✓ desktop surfaces verified →', outDir)
