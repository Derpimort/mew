import path from 'node:path'
/* vitest/config is a superset of vite's defineConfig — it adds the `test` field
   while leaving the build untouched (vite ignores `test`). We use it so the unit
   runner can be scoped to src/, keeping the Playwright e2e/*.spec.ts (which
   imports @playwright/test and needs a browser) out of `vitest run`. */
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/* Match an installed package by name, wherever it sits in the tree. pnpm nests
   real packages under `…/node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/…`,
   so anchor on the LAST `node_modules/<pkg>` boundary rather than a fixed depth. */
const pkg = (...names: string[]) =>
  new RegExp(
    `[\\\\/]node_modules[\\\\/](?:\\.pnpm[\\\\/][^\\\\/]+[\\\\/]node_modules[\\\\/])?(?:${names.join('|')})(?:[\\\\/]|$)`
  )

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    /* unit/integration suites live beside the code they cover, under src/. The
       e2e suite is a separate runner (pnpm e2e / Playwright) — never collected
       here, even though it shares the .spec naming. */
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
  build: {
    // Emit dist/.vite/manifest.json so scripts/check-bundle-size.mjs can read
    // the real entry/chunk graph (which file is the main entry, what's lazy)
    // and stat each chunk against its budget. Without this the size check would
    // have to guess from filenames.
    manifest: true,
    // Warn during `vite build` when any single chunk crosses this (uncompressed)
    // size. 400KB is the soft line; the hard budget that fails CI lives in
    // scripts/check-bundle-size.mjs. Keep the two in sync with CONTRIBUTING.md.
    // (three.js is far larger but lands in its own auto-split lazy chunk, which
    // carries a larger hard budget in the BUDGETS map and is off the boot path —
    // a single warning for the known-heavy lazy lib is expected, not a regression.)
    chunkSizeWarningLimit: 400,
    // Vite 8 bundles with rolldown, whose chunk grouping is `codeSplitting.groups`
    // (rolldown's `manualChunks` only accepts a function, not Rollup's object form,
    // and is deprecated — see node_modules/rolldown .d.mts). These manual groups
    // split two heavy dependency families out of the main entry so a change to app
    // code never silently re-bundles react or the AI SDK into the main chunk:
    //   vendor → react/react-dom/scheduler + zustand + dexie + motion + lucide
    //            (the eager framework runtime + small always-on libs; kept lean).
    //            Pulling these out of the entry drops the main chunk under its
    //            450KB budget and lets the browser cache the runtime separately.
    //   ai     → ai + @ai-sdk/* + @anthropic-ai/* (only reached when a model call
    //            runs, behind a dynamic import('./aiAdapter'); stays off the
    //            keyless/brainless boot path).
    //
    // three.js + @react-three/fiber are deliberately NOT given a manual group.
    // They are reached only through the React.lazy imports of aurora-blur / ai-blob,
    // and the default splitter already isolates them in a lazy `three.module` chunk.
    // Forcing them into a manual group makes rolldown promote that chunk to a STATIC
    // import of the entry — pulling three.js back onto the boot path, the exact
    // regression issue #176 removes (proven by codeSplitting.test.ts, which fails
    // the moment a `three` group is added). Leave them to auto-splitting; that test
    // guards they stay off the entry's static graph, and check-bundle-size.mjs
    // recognizes the auto-split chunk by its `three*` name to apply the lazy-three
    // budget rather than the strict default.
    //
    // codeSplitting stays on (the default) so the existing dynamic import() chunks
    // — aiAdapter, ai-blob, aurora-blur — remain separate lazy chunks. Priority
    // orders the groups: a higher-priority group claims its modules first and
    // removes them from lower ones, so the catch-all `vendor` never swallows the
    // AI SDK. The chunk NAMES (vendor/ai) are load-bearing — check-bundle-size.mjs
    // categorizes each chunk by name against its budget (see CONTRIBUTING.md).
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'ai', test: pkg('ai', '@ai-sdk', '@anthropic-ai'), priority: 20 },
            {
              name: 'vendor',
              test: pkg(
                'react',
                'react-dom',
                'scheduler',
                'zustand',
                'motion',
                'lucide-react',
                'dexie'
              ),
              priority: 10,
            },
          ],
        },
      },
    },
  },
})
