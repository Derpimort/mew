/* Focus management & keyboard operability (issue #175 — WCAG 2.2 §2.4.7 Focus
   Visible, §2.1.1 Keyboard). The app's vitest runs headless (no jsdom), so —
   like ErrorBoundary.test — we render to static markup and assert the *contract*
   that makes a control keyboard-reachable: a tab stop (tabindex / native button),
   the right role, and the focus-ring tokens the stylesheets paint. The visible
   ring itself is proven at runtime by the shoot gates; here we lock the structure
   so it can't silently regress. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Tgl, Segc, Button } from '../index'

const here = dirname(fileURLToPath(import.meta.url))
const css = (rel: string) => readFileSync(resolve(here, '..', rel), 'utf8')
const tokensCss = readFileSync(resolve(here, '../../tokens.css'), 'utf8')
const primitivesCss = css('primitives.css')
const componentsCss = readFileSync(resolve(here, '../../components/components.css'), 'utf8')

describe('Tgl — a toggle is a real keyboard switch', () => {
  it('an interactive toggle is tabbable, role=switch, and reflects aria-checked', () => {
    const html = renderToStaticMarkup(<Tgl on onToggle={() => {}} />)
    expect(html).toContain('role="switch"')
    expect(html).toContain('tabindex="0"') // in the tab order
    expect(html).toContain('aria-checked="true"')
  })

  it('an off toggle still tabs but reads unchecked', () => {
    const html = renderToStaticMarkup(<Tgl onToggle={() => {}} />)
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-checked="false"')
  })

  it('a locked principle is inert — not a tab stop, no switch role (acceptance #9)', () => {
    const html = renderToStaticMarkup(<Tgl lock cap="LOCKED" />)
    expect(html).not.toContain('tabindex') // nothing to change → out of tab order
    expect(html).not.toContain('role="switch"')
    expect(html).toContain('aria-checked="true"') // still announced as on
  })
})

describe('Segc / Button — interactive options are native, focusable buttons', () => {
  it('a Segc with onChange renders <button> options (natively tabbable)', () => {
    const html = renderToStaticMarkup(
      <Segc
        value="a"
        onChange={() => {}}
        options={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ]}
      />
    )
    expect(html).toContain('<button')
    expect(html).not.toContain('tabindex="-1"')
  })

  it('a read-only Segc (no onChange) renders inert <span> options, never buttons', () => {
    const html = renderToStaticMarkup(
      <Segc
        value="a"
        options={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ]}
      />
    )
    expect(html).not.toContain('<button')
  })

  it('Button is a native <button> with an explicit type (focusable, no implicit submit)', () => {
    const html = renderToStaticMarkup(<Button>Go</Button>)
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
  })
})

describe('focus tokens & rings exist in the stylesheets (consistent ring + offset)', () => {
  it('tokens.css defines the global --focus-ring / --focus-offset', () => {
    expect(tokensCss).toMatch(/--focus-ring:\s*2px solid var\(--ice\)/)
    expect(tokensCss).toMatch(/--focus-offset:\s*4px/)
  })

  it('tokens.css paints a global :focus-visible ring and stays quiet on mouse focus', () => {
    expect(tokensCss).toMatch(/:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring\)/)
    // a :focus:not(:focus-visible) reset keeps pointer clicks ring-free
    expect(tokensCss).toMatch(/:focus:not\(:focus-visible\)/)
  })

  it('every named interactive surface carries a :focus-visible rule', () => {
    // segmented controls + the keyboard toggle (primitives layer)
    expect(primitivesCss).toMatch(/\.seg2 button:focus-visible/)
    expect(primitivesCss).toMatch(/\.segc button:focus-visible/)
    expect(primitivesCss).toMatch(/\.tg:focus-visible/)
    // SVG dial arcs + week-grid blocks (components layer)
    expect(componentsCss).toMatch(/\.pri-arc:focus-visible/)
    expect(componentsCss).toMatch(/\.nxb-blk:focus-visible/)
    expect(componentsCss).toMatch(/\.nxb-col:focus-visible/)
  })

  it('no control silences focus without restoring a focus-visible ring (no orphan outline:none)', () => {
    // the two historical `outline: none` selectors must each be paired with a
    // :focus-visible ring (modelsel keeps the caret; keyfield moves it to the wrapper)
    expect(primitivesCss).toMatch(
      /\.modelsel:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring\)/
    )
    expect(primitivesCss).toMatch(/\.keyfield:focus-within[\s,]/)
  })

  it('SVG arcs ring via glow, not outline (outline is unreliable on SVG)', () => {
    // the arc focus rule uses a drop-shadow glow + full opacity, never a bare outline ring
    expect(componentsCss).toMatch(/\.pri-arc:focus-visible\s*\{[^}]*filter:\s*drop-shadow/)
  })
})
