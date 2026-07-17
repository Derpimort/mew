/* KeyProbeField (#306) — the paste+test+probe interaction extracted so the
   guided setup (#161) and first-run onboarding (#306) share ONE probe surface.
   Headless vitest: static markup pins the contract both consumers rely on — a
   labelled password field (never a chat box), the provider-specific placeholder,
   and a Test CTA. The live probe round-trip is the E2E's job. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { KeyProbeField } from '../KeyProbeField'

const noop = () => {}
const render = (provider: 'anthropic' | 'openai') =>
  renderToStaticMarkup(<KeyProbeField provider={provider} onValidated={noop} />)

describe('KeyProbeField — a labelled password probe, not a chat turn', () => {
  it('anthropic: labelled password field + sk-ant placeholder + a Test CTA', () => {
    const html = render('anthropic')
    expect(html).toContain('type="password"')
    expect(html).toContain('aria-label="Anthropic API key"')
    expect(html).toContain('placeholder="sk-ant-…"')
    expect(html).toMatch(/test key/i)
  })

  it('placeholder + label follow the provider (OpenAI keys look different)', () => {
    const html = render('openai')
    expect(html).toContain('aria-label="OpenAI API key"')
    expect(html).toContain('placeholder="sk-…"')
  })

  it('idle render carries no failure copy (positive voice)', () => {
    const low = render('anthropic').toLowerCase()
    expect(low).not.toContain('error')
    expect(low).not.toContain('failed')
  })
})
