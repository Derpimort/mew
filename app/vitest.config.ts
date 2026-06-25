import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config'

/* Test config lives apart from the build config so coverage thresholds are
   explicit and reviewable, but it still inherits the build's React plugin and
   `@` alias (mergeConfig) so the suite resolves modules exactly as the app does.

   Coverage is a CONTRACT GATE, not a vanity number: the domain is MEW's tested
   core ("domain as contract"), so it carries the high bar; adapters and state
   carry a moderate floor. Per-glob thresholds (vitest aggregates each glob's
   matched files) hold each layer to its own line — a `vitest run --coverage`
   exits non-zero if any layer slips, so erosion fails the PR instead of landing
   silently. The pure I/O EDGES (browser-only Dexie, network/OAuth shells, the
   native notifier, barrel re-exports) have no unit seam by design and are
   excluded from the gate so they don't drag a layer's honest number. */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        // text (console) · json+lcov (machine/CI) · html (app/coverage/index.html)
        // · json-summary (a tiny totals file the CI comment reads cheaply)
        reporter: ['text', 'json', 'html', 'lcov', 'json-summary'],
        reportsDirectory: './coverage',
        // Report the whole source tree for visibility …
        include: ['src/**'],
        // … but never count non-source, type-only declarations, app entry
        // points, the UI skin (thin, design-driven, gated by shoot/overlap
        // instead), or the pure I/O edges that have no unit seam.
        exclude: [
          'dist/**',
          'node_modules/**',
          'scripts/**',
          'src/**/__tests__/**',
          'src/**/*.test.{ts,tsx}',
          'src/**/types.ts',
          'src/vite-env.d.ts',
          'src/main.tsx',
          'src/App.tsx',
          'src/ui/**',
          'src/lib/**',
          // barrel re-exports — no logic of their own
          'src/adapters/model/index.ts',
          'src/adapters/crypto/index.ts',
          // pure I/O edges (browser/network/OAuth/native), no unit seam:
          'src/adapters/storage.ts',
          'src/adapters/notify.ts',
          'src/adapters/brain/gbrainHttp.ts',
          'src/adapters/calendar/google.ts',
        ],
        // Enforceable floors, per layer. Vitest fails the run (non-zero exit)
        // when a glob's aggregate coverage drops below its threshold, so the
        // PR gate catches regressions automatically.
        thresholds: {
          // the tested core — held high
          'src/domain/**': { lines: 75, branches: 75, functions: 75 },
          // adapters and state — moderate floor
          'src/adapters/**': { lines: 50, branches: 50, functions: 50 },
          'src/state/**': { lines: 50, branches: 50, functions: 50 },
        },
      },
    },
  })
)
