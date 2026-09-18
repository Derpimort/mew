/* The memory console shows brain-only rules (#71): a live proof through the REAL
   brain adapter. A gbrain stand-in answers MCP on the preview's own origin
   (/brainstub — page.route, so nothing leaves the box and no CORS), holding one
   standing rule the device never told it: "yoga → starts 18:00". Then:
   1. brain on → the rule is listed in the console, traced to the brain
      (data-claim="brain", "from your brain"); local rules keep their own words
   2. forget on that row → it's gone at once, and the brain's page is retired
      (a put_page with the forgotten-preference tag reached the stand-in)
   3. a brain that KEEPS its copy + a reconnect (refreshBrainPrefs) → still gone
   4. brain off → no brain row at all
   Owns proof shots (gitignored): console-brain-1-listed.png · console-brain-2-forgotten.png
   Usage: node scripts/shoot-console-brain.mjs [baseUrl]  (default http://localhost:5199) */

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { findChromium } from './lib/chromium.mjs'
import { clockUrl } from './lib/shootClock.mjs'

const base = process.argv[2] ?? 'http://localhost:5199'
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

let failed = 0
const check = (ok, label) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`)
  if (!ok) failed++
}
const until = async (fn, ms = 8000, step = 150) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, step))
  }
  return null
}

/* ── the gbrain stand-in: MCP over JSON, pages by slug ─────────────────── */
const YOGA = { kind: 'time-default', match: 'yoga', value: 'starts 18:00', stated: 'yoga at 6pm' }
const pages = new Map([
  [
    'pref/time-default-yoga',
    {
      tags: ['mew', 'preference', 'time-default'],
      body: `yoga → starts 18:00\n\nstated: "yoga at 6pm"\n\n\`\`\`json\n${JSON.stringify(YOGA)}\n\`\`\`\n`,
    },
  ],
])
const prefPuts = [] // { slug, tags }
let stubborn = false // a brain that keeps its copy after a forget

const tagsOf = (content) => {
  const m = content.match(/^tags:\s*\[([^\]]*)\]/m)
  return m ? m[1].split(',').map((t) => t.trim()) : []
}
const text = (t) => ({ content: [{ type: 'text', text: t }] })

const browser = await chromium.launch({ executablePath: findChromium(), args: ['--disable-gpu'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

async function finish() {
  check(
    pageErrors.length === 0,
    `no page errors${pageErrors.length ? `: ${pageErrors.join(' | ')}` : ''}`
  )
  await browser.close()
  if (failed) {
    console.log(`✗ console brain rules: ${failed} check(s) failed`)
    process.exit(1)
  }
  console.log(`✓ console brain rules proven → ${outDir}`)
  process.exit(0)
}

await page.route('**/brainstub/**', async (route) => {
  const req = route.request()
  const url = new URL(req.url())
  if (url.pathname.endsWith('/health')) return route.fulfill({ status: 200, body: 'ok' })
  const rpc = JSON.parse(req.postData() ?? '{}')
  if (rpc.method === 'initialize')
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'mcp-session-id': 'proof' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: {} }),
    })
  if (rpc.id == null) return route.fulfill({ status: 202, body: '' }) // notifications
  const { name, arguments: args = {} } = rpc.params ?? {}
  let result = text('[]')
  if (name === 'list_pages' && args.tag === 'preference') {
    result = text(
      JSON.stringify(
        [...pages.entries()].filter(([, p]) => p.tags.includes('preference')).map(([s]) => s)
      )
    )
  } else if (name === 'get_page') {
    const p = pages.get(args.slug)
    result = text(JSON.stringify({ content: p?.body ?? '' }))
  } else if (name === 'put_page') {
    const tags = tagsOf(args.content ?? '')
    if (String(args.slug).startsWith('pref/')) prefPuts.push({ slug: args.slug, tags })
    const retiring = tags.includes('forgotten-preference')
    if (!(retiring && stubborn)) pages.set(args.slug, { tags, body: args.content ?? '' })
  }
  return route.fulfill({
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }),
  })
})

const brainRows = () => page.locator('[data-card="memory"] [data-claim="brain"]')
const statedRows = () => page.locator('[data-card="memory"] [data-claim="stated"]')

await page.goto(clockUrl(base, '9:40'))
await page.waitForSelector('.nx-count', { timeout: 15000 })
await page.evaluate(() => window.__mewConfigure?.({ hasSeenOnboarding: true }))
/* one rule of the device's own, told the keyless way, so the console has a local
   row to contrast */
const composer =
  '.prompt-row [aria-label="compose message to MEW"], .prompt-row input, .prompt-row textarea'
await page.fill(composer, 'remember that gym is always at 7am')
await page.press(composer, 'Enter')
await page.waitForTimeout(1200)
await page.click('text=settings')
await page.waitForSelector('[data-card="memory"]')

/* 1 · brain on → the brain-only rule is listed and traced to the brain */
await page.evaluate(
  (url) => window.__mewConfigure?.({ brainEnabled: true, brainUrl: url, brainToken: 'proof' }),
  `${base}/brainstub`
)
check(
  !!(await until(async () => (await brainRows().count()) === 1)),
  'brain on: one brain-only rule is listed'
)
const brainText =
  (await brainRows()
    .first()
    .textContent()
    .catch(() => '')) ?? ''
console.log('brain row:', brainText.trim().slice(0, 120))
check(
  /yoga/.test(brainText) && /starts 18:00/.test(brainText),
  'the row shows the brain’s rule (yoga → starts 18:00)'
)
check(
  /from your brain/.test(brainText),
  'the row carries the quiet source mark ("from your brain")'
)
const localTexts = await statedRows().allTextContents()
check(
  localTexts.length >= 1 && localTexts.every((t) => !/from your brain/.test(t)),
  `local rules keep their own words (${localTexts.length} local row${localTexts.length === 1 ? '' : 's'})`
)
if ((await brainRows().count()) === 0) {
  console.log('✗ no brain row to act on — stopping here')
  await finish()
}
await brainRows().first().scrollIntoViewIfNeeded()
await page.screenshot({ path: `${outDir}/console-brain-1-listed.png` })

/* 2 · forget → gone at once; the brain's page is retired */
await brainRows().first().locator('button', { hasText: 'forget' }).click()
check(
  !!(await until(async () => (await brainRows().count()) === 0, 3000)),
  'forget: the row is gone at once'
)
check(
  !!(await until(async () =>
    prefPuts.some(
      (p) => p.slug === 'pref/time-default-yoga' && p.tags.includes('forgotten-preference')
    )
  )),
  'the brain was told: its yoga page retired (forgotten-preference)'
)
await page.screenshot({ path: `${outDir}/console-brain-2-forgotten.png` })

/* 3 · a brain that keeps its copy + a reconnect → still gone (the tombstone wins) */
stubborn = true
pages.set('pref/time-default-yoga', {
  tags: ['mew', 'preference', 'time-default'],
  body: `yoga → starts 18:00\n\n\`\`\`json\n${JSON.stringify(YOGA)}\n\`\`\`\n`,
})
await page.evaluate(() => window.__mewConfigure?.({ brainEnabled: false }))
await page.evaluate(() => window.__mewConfigure?.({ brainEnabled: true }))
await page.waitForTimeout(1500) // listPrefs → the stand-in still lists yoga
check(
  (await brainRows().count()) === 0,
  'a stubborn brain + a reconnect: the forgotten rule stays gone'
)

/* 4 · brain off → no brain row at all */
await page.evaluate(() => window.__mewConfigure?.({ brainEnabled: false }))
await page.waitForTimeout(400)
check((await brainRows().count()) === 0, 'brain off: no brain row')

await finish()
