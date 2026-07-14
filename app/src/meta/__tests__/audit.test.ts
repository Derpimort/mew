/* Supply-chain wiring (issue #178) — the audit gate is non-functional plumbing,
   so its "behaviour" is the package.json contract the CI workflow depends on.
   These assertions fail loudly if a refactor drops the `audit` script or renames
   a security-sensitive dependency out from under the Dependabot fast-track group,
   which would otherwise silently stop auditing/auto-merging it. Reads only the
   adjacent app/package.json — no network, no fixtures, stays in the pure suite. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')
) as { scripts: Record<string, string>; dependencies: Record<string, string> }

describe('dependency audit wiring', () => {
  it('exposes a prod-scoped `audit` script (CI runs `pnpm audit --prod` before build)', () => {
    expect(pkg.scripts.audit).toBeDefined()
    // --prod scopes the gate to what ships to users; the workflow appends
    // --audit-level high to make high/critical the blocking threshold.
    expect(pkg.scripts.audit).toContain('pnpm audit')
    expect(pkg.scripts.audit).toContain('--prod')
  })

  it('keeps the Dependabot security fast-track group anchored to real dependencies', () => {
    // These are the highest-blast-radius packages (key handling + on-device
    // crypto + the AI SDK the keys ride through): the `security` group in
    // .github/dependabot.yml auto-merges their patch/minor bumps. If one is
    // renamed/removed here, the group goes stale — this guard makes that a
    // failed test, not a silent gap. (@anthropic-ai/sdk left the list with the
    // hand-rolled adapters, #152 — the AI SDK packages carry that duty now.)
    const fastTracked = [
      '@noble/ciphers',
      '@noble/post-quantum',
      'ai',
      '@ai-sdk/anthropic',
      '@ai-sdk/openai',
      '@ai-sdk/openai-compatible',
      'hash-wasm',
    ]
    for (const dep of fastTracked) {
      expect(pkg.dependencies[dep], `${dep} should remain a direct dependency`).toBeDefined()
    }
  })
})
