/* Desktop OAuth proof: stubs window.__TAURI__ (withGlobalTauri shape), then
   drives the REAL Settings connect flow: connect → system browser receives
   the implicit-grant URL for the loopback port → simulated redirect carries
   the token back → the flow proceeds to the calendar API (which fails here,
   factually, in Settings — no Google on this box).
   Usage: node scripts/shoot-oauth.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { findChromium } from './lib/chromium.mjs'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5253'
const exe = findChromium()
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 840 } })).newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

await page.addInitScript(() => {
  window.__oauthListeners = new Map()
  window.__openedUrls = []
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
    opener: {
      openPath: async () => {},
      openUrl: async (url) => {
        window.__openedUrls.push(url)
      },
    },
    window: {
      getCurrentWindow: () => ({ onCloseRequested: async () => {}, destroy: async () => {} }),
    },
    core: { invoke: async (cmd) => (cmd === 'plugin:oauth|start' ? 17893 : undefined) },
    event: {
      listen: async (name, cb) => {
        window.__oauthListeners.set(name, cb)
        return () => window.__oauthListeners.delete(name)
      },
    },
  }
})

await page.goto(`${base}/?t=9:40`)
await page.waitForSelector('.nx-count', { timeout: 15000 })
await page.waitForTimeout(1500)
await page.evaluate(() =>
  window.__mewConfigure?.({ googleClientId: 'proof-client-id.apps.googleusercontent.com' })
)

await page.click('text=settings')
await page.waitForSelector('.set-card h2')
await page.click('text=+ Connect a calendar').catch(() => page.click('text=connect'))
await page.waitForTimeout(800)

const opened = await page.evaluate(() => window.__openedUrls)
console.log('system browser received:', opened[0]?.slice(0, 120) ?? 'NOTHING')
const u = opened[0] ? new URL(opened[0]) : null
const ok =
  u &&
  u.origin + u.pathname === 'https://accounts.google.com/o/oauth2/v2/auth' &&
  u.searchParams.get('redirect_uri') === 'http://localhost:17893' &&
  u.searchParams.get('response_type') === 'token'
console.log('auth URL shape:', ok ? '✓ implicit grant on loopback port 17893' : '✗ wrong')
await page.screenshot({ path: `${outDir}/oauth-1-connecting.png` })

/* deliver the redirect like the loopback would, token in forwarded query */
await page.evaluate(() => {
  window.__oauthListeners.get('oauth://url')?.({
    payload: 'http://localhost:17893/?access_token=proof-token&expires_in=3599',
  })
})
await page.waitForTimeout(2500)
/* token accepted → flow reached the calendar API; offline box → factual error in Settings */
const errText = await page.textContent('.set-card:has-text("Calendars")').catch(() => '')
console.log(
  'settings after redirect:',
  errText?.includes('google') || errText?.includes('failed')
    ? '✓ factual API error surfaced (flow passed auth)'
    : '(no error text found)'
)
await page.screenshot({ path: `${outDir}/oauth-2-after-redirect.png` })

await browser.close()
if (!ok) process.exit(1)
console.log('✓ oauth loopback proof →', outDir)
