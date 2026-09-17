/* Desktop OAuth proof: with the shell stubbed (lib/tauri-stub.mjs), drives the
   REAL Settings connect flow end to end, fully offline:
   1. connect → the system browser receives today's implicit-grant URL for the
      loopback port
   2. a simulated loopback redirect carries the token back
   3. the flow calls the Calendar API with that token (answered by page.route —
      nothing leaves the box) and Settings offers the account's calendars
   4. picking one connects it
   Any request to a host other than localhost/googleapis is aborted and fails
   the proof.
   Owns canon: shots/oauth-1-connecting.png · shots/oauth-2-after-redirect.png
   Usage: node scripts/shoot-oauth.mjs [baseUrl]  (default http://localhost:5199) */

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

const PORT = 17893
const TOKEN = 'proof-token'
const apiCalls = [] // { path, auth }
const strayHosts = new Set()

/* the Calendar API, answered locally: a primary account + one read-only calendar */
await page.route('https://www.googleapis.com/**', async (route) => {
  const req = route.request()
  const url = new URL(req.url())
  apiCalls.push({ path: url.pathname, auth: req.headers()['authorization'] ?? '' })
  const body = url.pathname.endsWith('/users/me/calendarList')
    ? {
        items: [
          { id: 'you@proof.dev', summary: 'you@proof.dev', primary: true, accessRole: 'owner' },
          { id: 'team-offsites@proof.dev', summary: 'Team offsites', accessRole: 'reader' },
        ],
      }
    : { items: [] }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
})
/* everything else off-box is a leak: abort it and remember the host */
await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|www\.googleapis\.com)/, async (route) => {
  strayHosts.add(new URL(route.request().url()).host)
  await route.abort()
})

await page.addInitScript(installTauriStub, { oauthPort: PORT })
await boot(page, base)
await page.evaluate(() =>
  window.__mewConfigure?.({ googleClientId: 'proof-client-id.apps.googleusercontent.com' })
)

/* 1 · connect → the system browser gets the implicit-grant URL on the loopback port */
await page.click('.navlink:has-text("settings")')
await page.waitForSelector('.set-card h2')
const connect = page.locator('button', { hasText: '+ connect a calendar' })
await connect.scrollIntoViewIfNeeded()
await connect.click()
const opened = await until(() => page.evaluate(() => window.__tauri.openedUrls[0]), 5000)
console.log('system browser received:', opened?.slice(0, 120) ?? 'NOTHING')
const u = opened ? new URL(opened) : null
check(
  !!u && u.origin + u.pathname === 'https://accounts.google.com/o/oauth2/v2/auth',
  'the auth URL goes to Google’s OAuth endpoint'
)
check(
  u?.searchParams.get('redirect_uri') === `http://localhost:${PORT}`,
  `redirect_uri is the loopback port ${PORT}`
)
check(u?.searchParams.get('response_type') === 'token', 'implicit grant (response_type=token)')
check(
  u?.searchParams.get('client_id') === 'proof-client-id.apps.googleusercontent.com',
  'carries the configured client id'
)
await shot(page, `${out}/oauth-1-connecting.png`)

/* 2 · the loopback re-posts the response-bearing URL; the token flows on */
await page.evaluate(
  ({ port, token }) =>
    window.__tauri.emit(
      'oauth://url',
      `http://localhost:${port}/?access_token=${token}&expires_in=3599`
    ),
  { port: PORT, token: TOKEN }
)
const picker = page.locator('text=pick calendars:')
check(
  !!(await until(async () => (await picker.count()) > 0, 8000)),
  'Settings offers the account’s calendars'
)
const listCall = apiCalls.find((c) => c.path.endsWith('/users/me/calendarList'))
check(listCall?.auth === `Bearer ${TOKEN}`, 'the Calendar API was called with the redirected token')
check(
  (await page.locator('button', { hasText: '+ Team offsites (ro)' }).count()) === 1,
  'a read-only calendar is marked (ro)'
)
await picker.scrollIntoViewIfNeeded()
await shot(page, `${out}/oauth-2-after-redirect.png`)

/* 3 · picking one connects it */
await page.locator('button', { hasText: '+ Team offsites' }).click()
check(
  !!(await until(
    async () => (await page.locator('text=Google · Team offsites').count()) > 0,
    5000
  )),
  'picking a calendar connects it (Google · Team offsites)'
)

check(
  strayHosts.size === 0,
  `nothing left the box${strayHosts.size ? `: ${[...strayHosts].join(', ')}` : ''}`
)
await finish(browser, pageErrors, `✓ oauth loopback proof → ${out}`)
