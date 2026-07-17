/* The three guided first-run steps (#306). The app's vitest is headless (no
   DOM), so — like the tour + ApiKeySetupFlow tests — we render each step to
   static markup and assert the contract that matters: the keys step reuses the
   real probe field and links the keys page; the calendar step lists the three
   loopback redirect URIs (copyable) + the Google console link + a client-ID
   field; the plan step offers an editable braindump and a "plan my day" CTA.
   Every step has a positive-voice "later", and no step's markup threatens the
   floor. Clicking through (probe round-trip, pick, apply) is the E2E's job. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OnboardingKeysStep, OnboardingCalendarStep, OnboardingPlanStep } from '../OnboardingSteps'
import { OAUTH_PORTS } from '../../../adapters/desktop'

const ids = { titleId: 'ob-t', bodyId: 'ob-b' }
const keys = () => renderToStaticMarkup(<OnboardingKeysStep {...ids} />)
const cal = () => renderToStaticMarkup(<OnboardingCalendarStep {...ids} />)
const plan = () => renderToStaticMarkup(<OnboardingPlanStep {...ids} />)

/** The product laws every step honors, checked on the raw markup. */
function assertPositiveFloor(html: string) {
  const low = html.toLowerCase()
  expect(low).not.toContain('error')
  expect(low).not.toContain('warning')
  expect(low).not.toContain('failed')
  expect(low).not.toContain('missed')
}

describe('OnboardingKeysStep (#306) — reuses the #161 probe, floor stays', () => {
  it('carries the dialog labelling ids on its heading', () => {
    const html = keys()
    expect(html).toContain('id="ob-t"')
    expect(html).toContain('id="ob-b"')
  })

  it('links the provider keys page and offers the real password probe field', () => {
    const html = keys()
    // default provider is anthropic → the anthropic keys page, new tab, no opener leak
    expect(html).toContain('href="https://console.anthropic.com/keys"')
    expect(html).toContain('rel="noreferrer noopener"')
    // the shared KeyProbeField — a labelled password field + a Test CTA, not a chat box
    expect(html).toContain('type="password"')
    expect(html).toContain('aria-label="Anthropic API key"')
    expect(html).toContain('placeholder="sk-ant-…"')
    expect(html).toMatch(/test key/i)
  })

  it('offers a positive-voice "later" that keeps the keyless floor', () => {
    const html = keys()
    expect(html).toMatch(/later — stay keyless/i)
    expect(html).toMatch(/keyless floor stays/i)
    assertPositiveFloor(html)
  })
})

describe('OnboardingCalendarStep (#306) — loopback, copyable URIs, local-only later', () => {
  it('explains the loopback in one sentence and links the Google console', () => {
    const html = cal()
    expect(html).toMatch(/no server/i)
    expect(html).toMatch(/back to this device/i)
    expect(html).toContain('href="https://console.cloud.google.com/apis/credentials"')
    expect(html).toContain('rel="noreferrer noopener"')
  })

  it('lists all three OAUTH_PORTS redirect URIs, each with a copy affordance', () => {
    const html = cal()
    for (const port of OAUTH_PORTS) {
      expect(html).toContain(`http://localhost:${port}`)
    }
    // one copy button per URI
    expect(html.match(/class="ob-copy/g)?.length).toBe(OAUTH_PORTS.length)
  })

  it('offers a labelled client-ID field and a positive-voice local-only "later"', () => {
    const html = cal()
    expect(html).toContain('aria-label="Google OAuth client ID"')
    expect(html).toMatch(/apps\.googleusercontent\.com/) // the placeholder shape
    expect(html).toMatch(/later — stay local-only/i)
    assertPositiveFloor(html)
  })
})

describe('OnboardingPlanStep (#306) — an editable braindump → a real turn', () => {
  it('pre-fills an editable braindump whose clauses route keyless to the picker', () => {
    const html = plan()
    expect(html).toContain('aria-label="your first braindump"')
    // ≥3 un-pinned "block …" clauses is what the keyless grammar routes to the
    // scenario picker (#293) — the demo depends on it.
    const dumpClauses = (html.match(/block /g) ?? []).length
    expect(dumpClauses).toBeGreaterThanOrEqual(3)
  })

  it('offers "plan my day" and a positive-voice "later" (an empty week)', () => {
    const html = plan()
    expect(html).toMatch(/plan my day/i)
    expect(html).toMatch(/later — an empty week/i)
    assertPositiveFloor(html)
  })
})
