/* Bundle-shape guard for the lazy-load contract (issue #176).

   three.js + @react-three/fiber are the app's heaviest dependency, reached only
   through the React.lazy() imports of aurora-blur / ai-blob. They must NEVER sit
   on the boot path: a keyless, settings-only session that never reaches the stage
   should not pay for a 3D engine it won't render. Lazy splitting is easy to break
   silently — a stray top-level `import 'three'`, or a manual chunk group that
   makes Rolldown promote the three chunk to a static import of the entry — so this
   test runs the real production build (in memory, no writes) and asserts the
   invariants directly on the emitted module graph.

   It is the regression net behind vite.config.ts's deliberate choice to leave
   three.js to the default splitter rather than force it into a vendor group. */

import { beforeAll, describe, expect, it } from 'vitest'
import { build, type Rollup } from 'vite'

/** A chunk's file name matches one of three.js / @react-three (their code). */
const isThreeChunk = (file: string) => /three|react-three|fiber/i.test(file)

/** The entry's main JS chunk must stay under this minified size (acceptance #1:
    "main chunk < 500 kB"). Today it is ~371 kB after the vendor split; the
    headroom catches real regressions without flapping on small additions. */
const MAIN_CHUNK_LIMIT = 500 * 1024

let chunks: Rollup.OutputChunk[]
let entry: Rollup.OutputChunk

beforeAll(async () => {
  // write:false keeps this hermetic — build in memory, inspect, touch no dist.
  const result = await build({
    root: process.cwd(),
    logLevel: 'error',
    build: { write: false },
  })
  const out = Array.isArray(result) ? result[0] : result
  if (!('output' in out)) throw new Error('expected a rollup build output (not a watcher)')
  chunks = out.output.filter((o): o is Rollup.OutputChunk => o.type === 'chunk')
  const e = chunks.find((c) => c.isEntry)
  if (!e) throw new Error('no entry chunk emitted')
  entry = e
}, 120_000)

describe('lazy-load contract: three.js / @react-three stay off the boot path', () => {
  it('the entry does not STATICALLY import three.js or @react-three', () => {
    const eagerThree = entry.imports.filter(isThreeChunk)
    expect(eagerThree).toEqual([])
  })

  it('aurora-blur and ai-blob are reached only via the entry\'s DYNAMIC imports', () => {
    // the lazy wrappers must be dynamic (React.lazy), never static, on the entry.
    const dyn = entry.dynamicImports
    expect(dyn.some((f) => /aurora-blur/.test(f))).toBe(true)
    expect(dyn.some((f) => /ai-blob/.test(f))).toBe(true)
    const eagerWrappers = entry.imports.filter((f) => /aurora-blur|ai-blob/.test(f))
    expect(eagerWrappers).toEqual([])
  })

  it('a dedicated three.js chunk exists and is imported only by the lazy wrappers', () => {
    const threeChunks = chunks.filter((c) => isThreeChunk(c.fileName))
    expect(threeChunks.length).toBeGreaterThan(0)

    // every static importer of a three chunk must itself be a deferred wrapper
    // (aurora-blur / ai-blob), so three only loads when the stage mounts.
    for (const tc of threeChunks) {
      const staticImporters = chunks
        .filter((c) => c.imports.includes(tc.fileName))
        .map((c) => c.fileName)
      for (const importer of staticImporters) {
        expect(importer, `${importer} statically imports ${tc.fileName}`).toMatch(/aurora-blur|ai-blob/)
      }
    }
  })

  it('no eager (statically reachable) chunk contains three.js', () => {
    // walk the entry's static-import closure; none of it may be a three chunk.
    const byName = new Map(chunks.map((c) => [c.fileName, c]))
    const seen = new Set<string>()
    const stack = [entry.fileName]
    while (stack.length) {
      const name = stack.pop()!
      if (seen.has(name)) continue
      seen.add(name)
      const c = byName.get(name)
      if (c) stack.push(...c.imports)
    }
    const eagerThree = [...seen].filter(isThreeChunk)
    expect(eagerThree).toEqual([])
  })
})

describe('main chunk budget (acceptance #1)', () => {
  it('the entry chunk is under 500 kB minified', () => {
    const bytes = Buffer.byteLength(entry.code)
    expect(bytes).toBeLessThan(MAIN_CHUNK_LIMIT)
  })
})
