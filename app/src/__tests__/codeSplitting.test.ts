/* Bundle-shape guard: three.js stays out of the bundle entirely.

   three.js + @react-three/fiber were the app's heaviest dependency, reached only
   through the ambient aurora and the companion blob. Both ambient WebGL anims were
   removed (they pegged a rAF loop and heated the machine for pure ornament), and
   the libraries were dropped from the app. This test runs the real production build
   (in memory, no writes) and asserts no emitted chunk is three.js / @react-three —
   so a stray re-introduction (a new `import 'three'`, a re-added dependency) trips
   here rather than shipping a 3D engine the UI no longer renders.

   It also keeps the main-chunk size budget (acceptance #1: "main chunk < 500 kB"). */

import { beforeAll, describe, expect, it } from 'vitest'
import { build, type Rollup } from 'vite'

/** A chunk's file name matches three.js / @react-three (their code). */
const isThreeChunk = (file: string) => /three|react-three|fiber/i.test(file)

/** The entry's main JS chunk must stay under this minified size (acceptance #1:
    "main chunk < 500 kB"). The headroom catches real regressions without
    flapping on small additions. */
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

describe('three.js stays out of the bundle entirely', () => {
  it('emits no three.js / @react-three chunk', () => {
    const threeChunks = chunks.filter((c) => isThreeChunk(c.fileName))
    expect(threeChunks).toEqual([])
  })
})

describe('main chunk budget (acceptance #1)', () => {
  it('the entry chunk is under 500 kB minified', () => {
    const bytes = Buffer.byteLength(entry.code)
    expect(bytes).toBeLessThan(MAIN_CHUNK_LIMIT)
  })
})
