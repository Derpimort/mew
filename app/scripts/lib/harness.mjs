/* The shared harness for the scenario shoot scripts (#31): one launch, one boot,
   one way to wait and one way to fail. It carries the same contract as
   shoot.mjs:
   - Chromium from findChromium(), with --disable-gpu (software compositing
     keeps the frame loop steady on runners).
   - A build-identity guard: the preview must serve THIS worktree's dist.
   - The canon day pinned via ?d= (lib/shootClock.mjs), so pixels never drift
     with the real date.
   - The first-run onboarding scrim dismissed the way a returning user has it.
   - Polling in place of fixed sleeps.
   - Any failed check OR page error exits 1. */
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { findChromium } from './chromium.mjs'
import { clockUrl } from './shootClock.mjs'

export const baseUrl = () => process.argv[2] ?? 'http://localhost:5199'

export function shotsDir() {
  const dir = path.resolve('shots')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** shoot.mjs's guard: the served index must reference the entry this dist built */
export async function assertBuild(base) {
  const entryOf = (html) => html.match(/\/assets\/index-[^"']+\.js/)?.[0] ?? '(none)'
  let served = ''
  try {
    served = await (await fetch(base)).text()
  } catch {
    console.log(`BUILD CHECK FAIL: nothing answered at ${base} — serve this worktree's dist first`)
    process.exit(1)
  }
  const local = entryOf(readFileSync(path.resolve('dist/index.html'), 'utf8'))
  if (entryOf(served) !== local) {
    console.log(`BUILD MISMATCH: ${base} serves ${entryOf(served)}, local dist built ${local}`)
    process.exit(1)
  }
  console.log('build identity:', local)
}

export async function launch() {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--disable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 840 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => {
    pageErrors.push(e.message)
    console.log('PAGE ERROR:', e.message)
  })
  return { browser, ctx, page, pageErrors }
}

/** open the app on the pinned day at `t`, past the first-run tour */
export async function boot(page, base, t = '9:40') {
  await page.goto(clockUrl(base, t))
  await page.waitForSelector('.nx-stage', { timeout: 15000 })
  await page.evaluate(() => window.__mewConfigure?.({ hasSeenOnboarding: true }))
  await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 }).catch(() => {})
}

/** poll an async predicate until it's truthy (returns its value) or time runs out (null) */
export async function until(fn, timeout = 5000, interval = 100) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() - t0 > timeout) return null
    await new Promise((r) => setTimeout(r, interval))
  }
}

/** screenshot once the page is still: poll until no FINITE animation is running
    (entrance fades, blur-ins); an endless one like the live dot's pulse never
    blocks. Capped, so a stuck animation can't hang a proof. */
export async function shot(page, file, timeout = 4000) {
  await until(
    () =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (a) =>
                a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity
            ).length === 0
      ),
    timeout
  )
  await page.screenshot({ path: file })
}

/** the composer: type an ask and send it, as the owner would */
export async function say(page, text) {
  const box = '.prompt-row input, .prompt-row textarea'
  await page.fill(box, text)
  await page.press(box, 'Enter')
}

/** collect checks; finish() exits 1 on any miss or any page error */
export function checks() {
  const fails = []
  return {
    check(ok, msg) {
      console.log(`${ok ? '✓' : '✗'} ${msg}`)
      if (!ok) fails.push(msg)
      return ok
    },
    async finish(browser, pageErrors, doneMsg) {
      await browser.close()
      for (const e of pageErrors) fails.push(`page error: ${e}`)
      if (fails.length) {
        console.log(`✗ ${fails.length} failure(s):\n  - ${fails.join('\n  - ')}`)
        process.exit(1)
      }
      console.log(doneMsg)
    },
  }
}
