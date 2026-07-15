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
  it('exposes an `audit` script that scans the committed lockfile via OSV', () => {
    expect(pkg.scripts.audit).toBeDefined()
    /* npm retired the classic audit API pnpm speaks (410, 2026-07), so the
       gate moved to Google's OSV scanner against the lockfile — same GHSA/npm
       advisory feed, blocks on ANY known vuln (dev deps included; strictly
       stronger than the old prod-only high tier). The workflow installs a
       pinned osv-scanner and runs the same scan — this pin keeps the script
       and CI speaking one contract. */
    expect(pkg.scripts.audit).toContain('osv-scanner')
    expect(pkg.scripts.audit).toContain('--lockfile pnpm-lock.yaml')
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
