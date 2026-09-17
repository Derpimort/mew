/* Every test lives inside a describe. A `it(...)` at file top level still RUNS,
   which is why nothing caught the one that rode into the RC in #150 — it just
   reports with no suite name, so a failure in CI reads without the context that
   tells you which behaviour broke.

   Dependency-free on purpose (#139 review / the manager's call): the obvious fix
   is eslint-plugin-vitest's require-top-level-describe, but a new dependency
   touches the lockfile and re-opens the audit gate on a release whose supply
   chain is already proven clean. This is a ~60-line reader instead, wired into
   `pnpm lint` so it runs in the existing lint-full job and in every local chain
   — no new CI job, so the expected check set stays at six.

   How it decides: a test call written at COLUMN ZERO is top level. That is sound
   here because `prettier --check` is itself a hard gate, so anything nested is
   indented; it needs no parser and cannot disagree with the formatter. A line
   inside a block comment or a template literal is skipped, which is the only
   way column zero lies.

   Usage: node scripts/check-test-structure.mjs [...roots]   (default: src scripts)
   Exit 0 = every test is inside a describe, 1 = at least one is not.

   The pure piece (findTopLevelTests) is exported so
   scripts/__tests__/check-test-structure.test.ts can exercise it without a tree. */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** a test call at column zero: it(, test(, it.each`, test.skip( … */
const TEST_AT_COL_0 = /^(?:it|test)(?:\.\w+)*\s*[(`]/

/** Lines that only LOOK like code: inside a /* … *\/ comment, or inside a
    template literal. Tracked with a tiny scanner rather than a parser — it only
    has to be right about column-zero lines. */
export function findTopLevelTests(source) {
  const out = []
  let inBlockComment = false
  let inTemplate = false
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const hit = !inBlockComment && !inTemplate && TEST_AT_COL_0.test(line)
    if (hit) out.push({ line: i + 1, text: line.trim() })
    /* update the state AFTER judging the line, so a test call that opens a
       template literal on the same line is still reported */
    for (let c = 0; c < line.length; c++) {
      const two = line.slice(c, c + 2)
      if (inBlockComment) {
        if (two === '*/') {
          inBlockComment = false
          c++
        }
        continue
      }
      if (inTemplate) {
        if (line[c] === '`') inTemplate = false
        else if (line[c] === '\\') c++
        continue
      }
      if (two === '/*') {
        inBlockComment = true
        c++
      } else if (two === '//') break
      else if (line[c] === '`') inTemplate = true
    }
  }
  return out
}

function testFiles(dir, found = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return found
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) testFiles(path, found)
    else if (/\.test\.(ts|tsx|mjs|js)$/.test(name)) found.push(path)
  }
  return found
}

/* CLI only when run directly — the same main-guard the changelog guard uses, so
   importing the pure piece from a test cannot scan the tree or exit the run
   (which is exactly what it did the first time, and what its own test caught) */
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isMain) {
  const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['src', 'scripts']
  const offenders = []
  let scanned = 0
  for (const root of roots) {
    for (const file of testFiles(root)) {
      scanned++
      for (const hit of findTopLevelTests(readFileSync(file, 'utf8')))
        offenders.push({ file, ...hit })
    }
  }
  if (offenders.length) {
    console.error(
      `check-test-structure: ${offenders.length === 1 ? '1 test sits' : `${offenders.length} tests sit`} outside a describe.\n` +
        `A top-level test still runs, so no gate fails — it just reports with no suite name.\n`
    )
    for (const o of offenders) console.error(`  ${o.file}:${o.line}  ${o.text.slice(0, 90)}`)
    console.error(`\nWrap each in the describe it belongs to (indentation is the signal).`)
    process.exit(1)
  }
  console.log(`✓ check-test-structure: every test in ${scanned} files sits inside a describe`)
}
