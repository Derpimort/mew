/* The guided key-setup modal (#161). The app's vitest is headless (no DOM), so
   we render each step to static markup and assert the contract that matters:
   it's a labelled dialog, the keyless floor is reassured (positive-only voice +
   graceful degradation laws), Step 2 links the real keys page, and Step 3 offers
   a labelled key field + a Test CTA — not a chat box. Live clicking through the
   stepper and the probe round-trip is the E2E's job; here `initialStep` renders
   a later step directly. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ApiKeySetupFlow } from '../ApiKeySetupFlow'
import { keySetupView } from '../apiKeySetup'

const noop = () => {}

function render(step: 0 | 1 | 2, provider: 'anthropic' | 'openai' = 'anthropic') {
  return renderToStaticMarkup(
    <ApiKeySetupFlow provider={provider} onClose={noop} onDone={noop} initialStep={step} />
  )
}

describe('ApiKeySetupFlow — a labelled dialog, keyless floor reassured', () => {
  it('renders an accessible dialog titled "Set up AI"', () => {
    const html = render(0)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-labelledby="aks-title"')
    expect(html).toContain('Set up AI')
    expect(html).toContain('Close setup') // the ✕ has an accessible name
  })

  it('Step 1 (Why?) names the no-key floor and never threatens it', () => {
    const html = render(0)
    expect(html).toMatch(/Why connect a key/i)
    // graceful degradation + positive-only voice: the floor stays, nothing breaks
    expect(html).toMatch(/nothing breaks without a key|keyless floor stays|skip this anytime/i)
  })

  it('Step 2 (Get a key) links the provider keys page in a new tab + offers copyable steps', () => {
    const anth = render(1, 'anthropic')
    expect(anth).toContain('href="https://console.anthropic.com/keys"')
    expect(anth).toContain('target="_blank"')
    expect(anth).toContain('rel="noreferrer noopener"') // no opener leak
    expect(anth).toMatch(/copy steps/i)

    const oa = render(1, 'openai')
    expect(oa).toContain('href="https://platform.openai.com/api-keys"')
    expect(oa).toMatch(/OpenAI/)
  })

  it('Step 3 (Paste & test) is a labelled password field + a Test CTA, not a chat turn', () => {
    const html = render(2, 'anthropic')
    expect(html).toContain('type="password"')
    expect(html).toContain('aria-label="Anthropic API key"')
    expect(html).toContain('placeholder="sk-ant-…"')
    expect(html).toMatch(/test key/i)
    // the copy makes the harmless-probe promise explicit (apostrophe is entity-encoded in SSR)
    expect(html).toMatch(/touch your week/i)
  })

  it('Step 3 placeholder follows the provider (OpenAI keys look different)', () => {
    expect(render(2, 'openai')).toContain('placeholder="sk-…"')
  })
})

describe('keySetupView — the Privacy & model gate (zero-key floor intact)', () => {
  it('no key, not editing → the guided "setup" affordance (dense form hidden)', () => {
    expect(keySetupView('', false)).toBe('setup')
    expect(keySetupView('   ', false)).toBe('setup') // whitespace is not a key
  })

  it('a key is set → the normal "masked" edit/swap field', () => {
    expect(keySetupView('sk-ant-abc123', false)).toBe('masked')
  })

  it('editing always wins → the raw paste field (the escape hatch / swap)', () => {
    expect(keySetupView('', true)).toBe('edit')
    expect(keySetupView('sk-ant-abc123', true)).toBe('edit')
  })
})
