/* Text-overlap guard — the "for everything" net.
   Drives the built app across views and crowded clock times, then PROVES no two
   text runs collide. One pass covers DOM text AND SVG <text> because it measures
   in viewport coordinates via Range.getClientRects() (not SVG-local getBBox()).
   A second dial-specific pass PROVES the centre text stack stays inside the
   drawn inner ring (text↔ring is a different failure mode than text↔text — the
   ri=150-era bug where long titles lapped the ring line). Any collision prints
   the offending pair and exits non-zero, so neither can ship again.
   Usage: node scripts/shoot-overlap.mjs [baseUrl] */

import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5199'
const outDir = path.resolve('shots/overlap')
mkdirSync(outDir, { recursive: true })

/* Resolve the installed chromium without pinning a build number — playwright's
   cache folder name (chromium-NNNN) tracks the playwright version, so a hard
   path breaks across machines/CI. Honor PW_CHROMIUM, else pick the newest
   chromium-* in the cache, else fall back to a known local build. */
function findChromium() {
  if (process.env.PW_CHROMIUM && existsSync(process.env.PW_CHROMIUM)) return process.env.PW_CHROMIUM
  const root = path.join(os.homedir(), '.cache/ms-playwright')
  try {
    const dir = readdirSync(root)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse()[0]
    for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = dir && path.join(root, dir, rel)
      if (p && existsSync(p)) return p
    }
  } catch {
    /* fall through to the pinned default */
  }
  return path.join(root, 'chromium-1223/chrome-linux64/chrome')
}
const exe = findChromium()

/* Runs IN the page. Returns every pair of text runs whose *rendered* boxes
   intersect. The honesty of the gate lives here — it must report what the eye
   sees, not what the layout engine measures. Three corrections make that true:
     · CLIP to overflow:hidden ancestors — Range.getClientRects() ignores
       text-overflow:ellipsis and returns the full unclipped text width, so a
       tidy "Feature work…" label would phantom-collide with its neighbour.
     · INSET vertically — a line box carries leading above/below the glyphs;
       two cleanly-stacked lines touch by a few px of leading that no one sees.
     · drop hidden / zero-area / off-screen / fully-clipped runs.
   Same text node wrapped across lines is never a self-collision. `skip` is a
   CSS selector for intentional overlays (open cards, tooltips). */
const DETECTOR = (pad, skipSel) => {
  const PAD = pad ?? 2
  const vw = innerWidth
  const vh = innerHeight
  const hidden = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n)
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return true
      if (n.getAttribute?.('aria-hidden') === 'true') return true
      if (skipSel && n.matches?.(skipSel)) return true
    }
    return false
  }
  // intersect a rect with every clipping ancestor's box (overflow != visible)
  const clip = (r, el) => {
    let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n)
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const c = n.getBoundingClientRect()
        box = {
          left: Math.max(box.left, c.left),
          top: Math.max(box.top, c.top),
          right: Math.min(box.right, c.right),
          bottom: Math.min(box.bottom, c.bottom),
        }
      }
    }
    return box
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const boxes = []
  let owner = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const txt = node.nodeValue.trim()
    if (!txt) continue
    const el = node.parentElement
    if (!el || hidden(el)) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const id = owner++
    for (const raw of range.getClientRects()) {
      const r = clip(raw, el)
      let w = r.right - r.left
      let h = r.bottom - r.top
      if (w < 1 || h < 1) continue // fully clipped (ellipsis) or empty
      if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue
      // strip line-box leading so cleanly-stacked lines don't graze
      const vi = Math.min(h * 0.16, 6)
      boxes.push({
        id,
        txt: txt.slice(0, 36),
        left: r.left,
        top: r.top + vi,
        right: r.right,
        bottom: r.bottom - vi,
      })
    }
  }
  const seen = new Set()
  const hits = []
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.id === b.id) continue
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (ix > PAD && iy > PAD) {
        const key = `${a.txt}|${b.txt}|${Math.round(Math.max(a.left, b.left))}`
        if (seen.has(key)) continue
        seen.add(key)
        hits.push({
          a: a.txt,
          b: b.txt,
          overlap: `${Math.round(ix)}×${Math.round(iy)}px`,
          at: `${Math.round(Math.max(a.left, b.left))},${Math.round(Math.max(a.top, b.top))}`,
        })
      }
    }
  return hits
}

/* Runs IN the page. The dial-specific companion net: the centre stack
   (.clk-center — countdown → meta → task) must stay INSIDE the drawn inner
   ring, never touch or cross its stroke. Geometry is read from the live SVG
   (circle.r × getScreenCTM), not re-derived from OG constants, so the gate
   follows any future retune of OG.ri / .clk-center width for free and measures
   what the eye sees. The clear limit is the stroke's INNER edge minus antialias
   slack: touching the drawn line fails; daylight inside it — including the
   designed worst case (text-box corners ≈168 vs ri=170, see .clk-center's
   comment in components.css) — passes. */
const RING_DETECTOR = () => {
  const centerBox = document.querySelector('.clk-center')
  if (!centerBox) return { engaged: false, hits: [] } // not on the dial view
  // the two drawn rings are the only fill="none" var(--line2) circles;
  // the inner ring is the smaller radius (ri < pm)
  const rings = [...document.querySelectorAll('.nx-stage svg circle[fill="none"]')]
    .filter((c) => (c.getAttribute('stroke') ?? '').includes('--line2'))
    .sort((a, b) => a.r.baseVal.value - b.r.baseVal.value)
  const ring = rings[0]
  const ctm = ring?.getScreenCTM()
  if (!ring || !ctm) return { engaged: false, hits: [] }
  const scale = Math.hypot(ctm.a, ctm.b) // dial svg scales uniformly
  const cx = ctm.a * ring.cx.baseVal.value + ctm.c * ring.cy.baseVal.value + ctm.e
  const cy = ctm.b * ring.cx.baseVal.value + ctm.d * ring.cy.baseVal.value + ctm.f
  const halfStroke = (parseFloat(ring.getAttribute('stroke-width') ?? '1.6') / 2) * scale
  const limit = ring.r.baseVal.value * scale - halfStroke - 0.5
  // hidden-ANCESTOR walk, mirroring the text↔text net's `hidden()` semantics
  const hidden = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n)
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return true
    }
    return false
  }
  const hits = []
  const walker = document.createTreeWalker(centerBox, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const txt = node.nodeValue.trim()
    if (!txt) continue
    const el = node.parentElement
    if (!el || hidden(el)) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue
      // strip line-box leading like the text↔text net — glyphs graze, not leading
      const vi = Math.min(r.height * 0.16, 6)
      const corners = [
        [r.left, r.top + vi],
        [r.right, r.top + vi],
        [r.left, r.bottom - vi],
        [r.right, r.bottom - vi],
      ]
      let worst = 0
      for (const [x, y] of corners) worst = Math.max(worst, Math.hypot(x - cx, y - cy))
      if (worst > limit) {
        hits.push({
          a: txt.slice(0, 36),
          b: 'inner ring',
          overlap: `corner ${(worst - limit).toFixed(1)}px past the clear limit (${worst.toFixed(1)} > ${limit.toFixed(1)})`,
          at: `${Math.round(cx)},${Math.round(cy)}`,
        })
      }
    }
  }
  return { engaged: true, hits }
}

const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 840 } })).newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

// intentional overlays whose text legitimately sits over content
const SKIP = '.nx-card, .detail-card, [role="dialog"], .toast, .tooltip'
const PAD = 2 // sub-pixel antialias slack — only real overlaps clear this

// re-define the detectors on every fresh document (runs before page scripts)
await page.addInitScript((src) => {
  window.__overlapDetect = (0, eval)('(' + src + ')')
}, DETECTOR.toString())
await page.addInitScript((src) => {
  window.__ringClear = (0, eval)('(' + src + ')')
}, RING_DETECTOR.toString())

const findings = []
let ringEngagements = 0
const detect = async (label, shot = true) => {
  const textHits = await page.evaluate(([p, s]) => window.__overlapDetect(p, s), [PAD, SKIP])
  const ring = await page.evaluate(() => window.__ringClear())
  if (ring.engaged) ringEngagements++
  const hits = [...textHits, ...ring.hits]
  if (shot) await page.screenshot({ path: `${outDir}/${label.replace(/[^a-z0-9]+/gi, '-')}.png` })
  if (hits.length) {
    console.log(`✗ ${label}: ${hits.length} overlap(s)`)
    for (const h of hits.slice(0, 12))
      console.log(`    "${h.a}" ⟂ "${h.b}"  (${h.overlap} @ ${h.at})`)
  } else {
    console.log(`✓ ${label}: clean`)
  }
  findings.push({ label, hits })
}

// .nx-stage is the dial container — always present; .nx-count is conditional
// (only when a block is active), so it can't be the readiness signal.
const ready = () => page.waitForSelector('.nx-stage', { timeout: 20000 })
const seed = async (cmds) => {
  for (const cmd of cmds) {
    await page.fill('.prompt-row input, .prompt-row textarea', cmd).catch(() => {})
    await page.press('.prompt-row input, .prompt-row textarea', 'Enter').catch(() => {})
    await page.waitForTimeout(550)
  }
}

/* start clean, then seed a real day spread across the clock so the time sweep
   exercises block labels at many angles (seeded at 00:05 so all are ahead). */
await page.goto(`${base}/?t=00:05`)
await ready()
await page.evaluate(() => window.__mewReset?.())
await ready()
/* the wipe re-seeds, so the first-run concept tour (#160) reopens — dismiss it
   (persists to storage, so it stays gone across every later goto) before the
   composer seed, which the modal would otherwise cover */
await page.evaluate(() => window.__mewConfigure?.({ hasSeenOnboarding: true }))
await page.waitForSelector('.ob-scrim', { state: 'detached', timeout: 5000 }).catch(() => {})
await seed([
  'block 1h for standup today at 9',
  'block 1.5h for design review today at 11',
  'block 1h for lunch with sam today at 12:30',
  // deliberately long title: at 15:20 it wraps to a tall centre stack, so the
  // focus-15:20 state exercises the text↔inner-ring net (RING_DETECTOR) at the
  // designed envelope — on the ri=150 geometry this exact state lapped the ring
  'block 2h for quarterly investor narrative deck review with legal and finance today at 15',
  'block 1h for gym today at 18:30',
])

/* 1 · focus dial across the clock — the now-hand, date, countdown and block
   labels must never stack. 11:09 is the time from the user's bug report. */
const TIMES = ['00:05', '06:30', '09:40', '11:09', '12:00', '15:20', '18:45', '23:59']
for (const t of TIMES) {
  await page.goto(`${base}/?t=${t}`)
  await ready()
  await page.waitForTimeout(1300) // let entrance/toast animations settle
  await detect(`focus-${t}`)
}

/* 2 · week columns */
await page.goto(`${base}/?t=11:09`)
await ready()
await page.click('.seg2 button:has-text("Week")').catch(() => {})
await page.waitForTimeout(700)
await detect('week')

/* 3 · settings */
await page.click('text=settings').catch(() => {})
await page.waitForTimeout(600)
await detect('settings')

/* 4 · crowded focus — pile blocks onto one morning so dial labels must de-collide */
await page.goto(`${base}/?t=09:40`)
await ready()
await seed([
  'block 1h for candidate interview today at 10',
  'block 45m for code review today at 9:45',
  'block 30m for sync today at 9:15',
])
await page.waitForTimeout(600)
await detect('focus-crowded')

await browser.close()

/* the ring net must have ENGAGED on the dial states — if a design drop renames
   .clk-center or restyles the ring circles, the detector would silently skip
   instead of measuring, and "0 collisions" would be a lie. Silence is failure. */
if (ringEngagements === 0) {
  console.log('✗ ring-clearance net never engaged — .clk-center / inner-ring selector drift?')
  findings.push({
    label: 'ring-net-engagement',
    hits: [{ a: 'ring net', b: 'dial states', overlap: 'never engaged', at: '-' }],
  })
} else {
  console.log(`✓ ring-clearance net engaged on ${ringEngagements} dial state(s)`)
}

const total = findings.reduce((n, f) => n + f.hits.length, 0)
console.log(
  `\n${total === 0 ? '✓' : '✗'} overlap guard: ${total} collision(s) across ${findings.length} states → ${outDir}`
)
if (total > 0) process.exit(1)
