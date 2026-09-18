/* A CAPTURE TOOL, NOT A PROOF. It takes tight, high-res shots of the focus dial
   for a human to look at. IT VERIFIES NOTHING ABOUT THE DIAL and is not wired
   into any gate. Usage: node scripts/capture-dial.mjs [baseUrl] [HH:MM]

   RENAMED OUT OF THE `shoot*` NAMESPACE (#204). `check-shoot-reachable.mjs`
   treats every `scripts/shoot*.mjs` as a proof, so while this was called
   `shoot-dial.mjs` it was counted as one — sixteen real proofs and this, in the
   same directory, indistinguishable by name or location from files an acceptance
   audit counts as evidence.

   WHAT IT CAN AND CANNOT FAIL ON, measured rather than assumed, because the
   issue's first premise was that it "cannot fail" and that was wrong:
   `node scripts/capture-dial.mjs http://localhost:59999` EXITS 1. Two of its
   FOUR risky steps are unswallowed — the `.nx-stage` wait and `stage.hover()` —
   and a top-level await rejection is fatal in ESM. The other two carry
   `.catch(() => {})`: the `.ob-scrim` wait and the arc hover.
   This said THREE until #212's follow-up, while naming four in the same
   sentence: the count came from the first measurement, taken before the
   `.ob-scrim` catch was noticed, and the list was corrected without the number.
   No line numbers here on purpose — a comment that cites its own file's lines
   goes stale the moment anything above it changes, which is how this one broke.
   So it fails on "the page never rendered" and "the stage is not hoverable". It
   cannot fail on the 2-ring layout or the bottom readout — the things the old
   header said it existed to verify. A proof of the harness, not of its subject.

   THE DIAL'S REAL CONTRACT IS ALREADY ASSERTED, AND BETTER: `shoot.mjs` step 1a
   pins `role="application"`, a descriptive aria-label, the sr-only `h2` heading
   and that ArrowRight actually moves focus, citing mew-archive#172 and WCAG 2.2
   §2.1.1/§1.1.1/§4.1.2. It runs in `ui-proofs.yml` on every PR touching `app/`.
   If you want the dial verified, that is the file — teaching this one to assert
   would either duplicate it or invent a contract nobody decided. */
import { chromium } from 'playwright-core'
import { findChromium } from './lib/chromium.mjs'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5199'
const t = process.argv[3] ?? '9:55'
const tag = t.replace(':', '')
const exe = findChromium()
const outDir = path.resolve('shots')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

await page.goto(`${base}/?t=${t}`)
await page.waitForSelector('.nx-stage')
/* Past the first-run concept tour (#171). This proof predates the tour and
   nobody ran it afterwards, so it sat red: the tour's `.ob-scrim` is a
   role=dialog laid over the whole stage, and every `stage.hover()` below timed
   out on an intercepted pointer event. The failure looked like the dial, and
   the dial was fine.
   These are the same two lines `lib/harness.mjs` `boot()` runs, deliberately
   copied rather than imported: this script builds its own browser and page, and
   migrating it to the harness the night before a promotion is a bigger change
   than the one that was needed. The WAIT is half the fix — configuring the flag
   without waiting for the scrim to detach just races it. */
await page.evaluate(() => window.__mewConfigure?.({ hasSeenOnboarding: true }))
await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 }).catch(() => {})
await page.waitForTimeout(900)

const stage = page.locator('.nx-stage')
await stage.screenshot({ path: `${outDir}/dial-${tag}-rest.png` })

// hover the stage to reveal the readout + labels, then hover a specific arc so
// the readout shows a real time range (not just the idle affordance)
await stage.hover()
await page.waitForTimeout(500)
await stage.screenshot({ path: `${outDir}/dial-hover.png` })

// try to hover an actual arc (the fat invisible hit-target) for a range readout
const arc = page.locator('.nx-stage path[stroke="transparent"]').first()
if (await arc.count()) {
  await arc.hover({ force: true }).catch(() => {})
  await page.waitForTimeout(500)
  await stage.screenshot({ path: `${outDir}/dial-hover-arc.png` })
}

await browser.close()
console.log('done: dial-rest.png, dial-hover.png, dial-hover-arc.png')
