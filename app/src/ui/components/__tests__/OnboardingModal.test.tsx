/* The app's vitest runs headless (no jsdom), so we render the tour to static
   markup the way ErrorBoundary's test does. Static render proves the contract
   the eye can't: the dialog semantics (role/aria), the first step's copy, the
   always-present skip, and the nav affordances. Step-to-step navigation is
   client state (useState) — exercised end-to-end by the Playwright e2e and the
   store-flow scenario; here we hold the entry render honest. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OnboardingModal } from '../OnboardingModal'

const html = () => renderToStaticMarkup(<OnboardingModal />)

describe('OnboardingModal — first-run concept tour (#160)', () => {
  it('renders as an accessible modal dialog', () => {
    const out = html()
    expect(out).toContain('role="dialog"')
    expect(out).toContain('aria-modal="true"')
    // labelled + described by its own title/body for screen readers
    expect(out).toContain('aria-labelledby=')
    expect(out).toContain('aria-describedby=')
  })

  it('opens on step one — the Focus dial', () => {
    const out = html()
    expect(out).toContain('Focus dial')
    expect(out).toContain('See your now, minute by minute')
    expect(out).toContain('1 / 3') // three steps, starting at the first
  })

  it('is always skippable and offers forward nav', () => {
    const out = html()
    expect(out).toContain('Skip all') // the mandatory escape hatch (NN/g)
    expect(out).toContain('>Next<') // advances; never "Done" on step one
    expect(out).toContain('>Back<') // present but disabled on the first step
    expect(out).toContain('disabled') // Back is disabled at step one
  })

  it('keeps the voice positive — an invitation, never a warning', () => {
    const out = html().toLowerCase()
    expect(out).not.toContain('error')
    expect(out).not.toContain('warning')
    expect(out).not.toContain('failed')
    expect(out).not.toContain("don't")
  })

  it('illustrations are inline SVG — nothing for the CSP to fetch', () => {
    const out = html()
    expect(out).toContain('<svg')
    expect(out).not.toContain('<img') // no remote GIF/screenshot
    expect(out).not.toContain('http') // no external asset URLs
  })
})
