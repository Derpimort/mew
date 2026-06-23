import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
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
    chunkSizeWarningLimit: 400,
    // Vite 8 bundles with rolldown, whose chunk grouping is `codeSplitting.groups`
    // (rolldown's `manualChunks` only accepts a function, not Rollup's object form,
    // and is deprecated — see node_modules/rolldown .d.mts). These groups split the
    // three heaviest dependency families out of the main entry so a change to app
    // code never silently re-bundles react/three/the AI SDK into the main chunk:
    //   vendor → react + zustand + dexie (always loaded, kept lean)
    //   three  → three + @react-three/fiber (only the WebGL companion needs it; lazy)
    //   ai     → ai + @ai-sdk/* (only reached when a model call runs; lazy)
    // codeSplitting stays on (the default) so the existing dynamic import() chunks
    // — aiAdapter, ai-blob, aurora-blur — remain separate lazy chunks.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|zustand|dexie)[\\/]/,
            },
            {
              name: 'three',
              test: /[\\/]node_modules[\\/](three|@react-three[\\/]fiber)[\\/]/,
            },
            {
              name: 'ai',
              test: /[\\/]node_modules[\\/](ai|@ai-sdk[\\/](anthropic|openai))[\\/]/,
            },
          ],
        },
      },
    },
  },
})
