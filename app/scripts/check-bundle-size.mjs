/* Bundle-size budget gate. Reads dist/.vite/manifest.json (emitted because
   vite.config.ts sets build.manifest=true), stats every JS chunk it lists,
   sorts each into a budget category, and fails the build when a chunk — or the
   total — crosses its ceiling. Catches the "Some chunks are larger than 500 kB"
   class of regression at PR time instead of in a release.

   Budgets are the single source of truth here and mirror CONTRIBUTING.md. They
   live just above today's measured sizes so an untouched tree is green while a
   real regression (e.g. re-bundling react/three/the AI SDK into the main chunk,
   or +50KB of new app code) trips the gate with a clear message.

   Usage: node scripts/check-bundle-size.mjs [distDir]   (default: ./dist)
   Exit 0 = within budget, 1 = over budget, 2 = no manifest (build first).

   The pure pieces (BUDGETS, categorize, evaluate, eagerFiles, formatReport) are
   exported so scripts/__tests__/check-bundle-size.test.ts can exercise the
   policy without a real build. */

import { readFileSync, statSync, existsSync, appendFileSync } from 'node:fs'
import path from 'node:path'

const KB = 1024

// Per-category ceilings, uncompressed bytes. `main` is the entry chunk the
// browser must download before anything renders — kept tightest. Named lazy
// families (vendor/three/ai) carry the heavy deps that are code-split out, so
// they get their own (larger) ceilings; every other lazy chunk falls under the
// strict `lazy` default. See vite.config.ts codeSplitting.groups.
export const BUDGETS = {
  // entry (main) chunk — first paint depends on it
  main: 450 * KB,
  // always-loaded vendor split: react, react-dom, zustand, dexie
  vendor: 340 * KB,
  // backstop only: three.js / @react-three were removed (the ambient WebGL anims
  // are gone). No build emits a three chunk today; this ceiling stays so a stray
  // re-introduction is caught with a budget rather than going unnoticed.
  three: 950 * KB,
  // lazy, only when a model call runs: ai + @ai-sdk/*
  ai: 560 * KB,
  // any other lazy chunk (dynamic import())
  lazy: 300 * KB,
  // what a first visit actually downloads: the entry chunk + everything it
  // statically imports (today: main + vendor). The three / ai chunks are lazy
  // and excluded. This is the budget that maps to "total build < 1.2 MB".
  firstLoad: 1200 * KB,
  // grand total of every JS chunk shipped (uncompressed) — a backstop so no
  // lazy chunk grows unbounded even though it's off the first-load path.
  total: 2300 * KB,
}

/** A chunk whose name is three.js / @react-three (its code). three was removed
 *  from the app, so no build emits such a chunk today — this matcher exists only
 *  so a re-introduced three chunk would be sorted into the `three` backstop budget
 *  rather than silently failing the strict `lazy` default. Anchored at the start /
 *  on a `react-three`|`fiber` token. */
const isThreeChunk = (name) => /^three(\.|-|$)|react-three|fiber/i.test(name)

/** Sort one chunk into a budget category by its manifest role + name.
 *  entry → 'main'; a named group chunk → that group; everything else → 'lazy'. */
export function categorize(chunk) {
  if (chunk.isEntry) return 'main'
  if (chunk.name === 'vendor') return 'vendor'
  if (isThreeChunk(chunk.name)) return 'three'
  if (chunk.name === 'ai') return 'ai'
  return 'lazy'
}

/** Pure policy: given the JS chunks ({ file, name, isEntry, bytes }) and a
 *  budget map, return the rated chunks plus total + first-load verdicts and a
 *  list of human-readable failures. `eagerFiles` is the set of chunk `file`s a
 *  first visit downloads (entry + its static imports); when omitted it's
 *  derived from chunk roles (main + vendor) so the function stays pure +
 *  testable. No filesystem, no process. */
export function evaluate(chunks, budgets = BUDGETS, eagerFiles = null) {
  const rated = chunks.map((c) => {
    const category = categorize(c)
    const budget = budgets[category]
    return { ...c, category, budget, over: c.bytes > budget }
  })
  const totalBytes = rated.reduce((sum, c) => sum + c.bytes, 0)
  const totalOver = totalBytes > budgets.total

  const isEager = (c) =>
    eagerFiles ? eagerFiles.has(c.file) : c.category === 'main' || c.category === 'vendor'
  const firstLoadBytes = rated.filter(isEager).reduce((sum, c) => sum + c.bytes, 0)
  const firstLoadOver = firstLoadBytes > budgets.firstLoad

  const failures = []
  for (const c of rated) {
    if (c.over) {
      failures.push(
        `${c.file} (${c.category}) is ${kb(c.bytes)} — over the ${kb(c.budget)} ${c.category} budget by ${kb(c.bytes - c.budget)}.`
      )
    }
  }
  if (firstLoadOver) {
    failures.push(
      `first-load JS is ${kb(firstLoadBytes)} — over the ${kb(budgets.firstLoad)} first-load budget by ${kb(firstLoadBytes - budgets.firstLoad)}.`
    )
  }
  if (totalOver) {
    failures.push(
      `total bundle is ${kb(totalBytes)} — over the ${kb(budgets.total)} budget by ${kb(totalBytes - budgets.total)}.`
    )
  }

  return {
    chunks: rated,
    totalBytes,
    totalBudget: budgets.total,
    firstLoadBytes,
    firstLoadBudget: budgets.firstLoad,
    firstLoadOver,
    totalOver,
    ok: failures.length === 0,
    failures,
  }
}

function kb(bytes) {
  return `${(bytes / KB).toFixed(1)} KB`
}

/** Markdown report (chunk breakdown + total) for the PR / step summary. */
export function formatReport(result) {
  const rows = [...result.chunks]
    .sort((a, b) => b.bytes - a.bytes)
    .map((c) => {
      const mark = c.over ? '🔴' : '✅'
      return `| ${mark} | \`${c.file}\` | ${c.category} | ${kb(c.bytes)} | ${kb(c.budget)} |`
    })
  const firstLoadMark = result.firstLoadOver ? '🔴' : '✅'
  const totalMark = result.totalOver ? '🔴' : '✅'
  return [
    '### Bundle size budget',
    '',
    '| | chunk | category | size | budget |',
    '| --- | --- | --- | ---: | ---: |',
    ...rows,
    `| ${firstLoadMark} | **first load** (eager) | | **${kb(result.firstLoadBytes)}** | **${kb(result.firstLoadBudget)}** |`,
    `| ${totalMark} | **total** | | **${kb(result.totalBytes)}** | **${kb(result.totalBudget)}** |`,
    '',
    result.ok
      ? '_Within budget._'
      : '**Over budget** — split the chunk, lazy-load it, or (with a decision in the PR) raise the budget in the `BUDGETS` map in `scripts/check-bundle-size.mjs` and `CONTRIBUTING.md`.',
  ].join('\n')
}

/** Read a Vite manifest and stat each JS chunk it references.
 *  Returns { chunks, manifest } — manifest is the raw object so eagerFiles()
 *  can walk the static-import graph. */
export function readChunks(distDir) {
  const manifestPath = path.join(distDir, '.vite', 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error(
      `no manifest at ${manifestPath} — run \`pnpm build\` first (vite.config.ts sets build.manifest=true).`
    )
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  // De-dupe by output file: a chunk can appear under several manifest keys
  // (e.g. an entry referenced by its src key and by index.html).
  const seen = new Map()
  for (const entry of Object.values(manifest)) {
    if (!entry.file || !entry.file.endsWith('.js')) continue
    if (seen.has(entry.file)) {
      // keep the richest record (prefer one that flags isEntry)
      if (entry.isEntry) seen.get(entry.file).isEntry = true
      continue
    }
    seen.set(entry.file, {
      file: entry.file,
      name: entry.name ?? entry.file,
      isEntry: Boolean(entry.isEntry),
      bytes: statSync(path.join(distDir, entry.file)).size,
    })
  }
  return { chunks: [...seen.values()], manifest }
}

/** The set of output chunk `file`s a first visit downloads: every entry chunk
 *  plus everything reachable through its *static* `imports` (dynamicImports are
 *  lazy and excluded). Walked over the raw Vite manifest. */
export function eagerFiles(manifest) {
  const files = new Set()
  const visited = new Set()
  const visit = (key) => {
    if (visited.has(key)) return
    visited.add(key)
    const node = manifest[key]
    if (!node) return
    if (node.file && node.file.endsWith('.js')) files.add(node.file)
    for (const imp of node.imports ?? []) visit(imp)
  }
  for (const [key, node] of Object.entries(manifest)) {
    if (node.isEntry) visit(key)
  }
  return files
}

// ---- CLI ----------------------------------------------------------------
// Run only when invoked directly (`node scripts/check-bundle-size.mjs`), so
// importing the pure helpers in a test doesn't trigger a build read / exit.
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)

if (invokedDirectly) {
  const distDir = path.resolve(process.argv[2] ?? 'dist')
  let chunks, manifest
  try {
    ;({ chunks, manifest } = readChunks(distDir))
  } catch (err) {
    console.error(`check-bundle-size: ${err.message}`)
    process.exit(2)
  }

  const result = evaluate(chunks, BUDGETS, eagerFiles(manifest))
  const report = formatReport(result)
  console.log(report)

  // Surface the breakdown in the GitHub Actions job summary when running in CI.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n')
  }

  if (!result.ok) {
    console.error('\ncheck-bundle-size: FAIL')
    for (const line of result.failures) console.error(`  - ${line}`)
    process.exit(1)
  }
  console.log('\ncheck-bundle-size: OK')
}
