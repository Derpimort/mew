// Cases for the release-notes guard: the pure functions on small logs, and the CLI on
// a throwaway file, so what CI runs is exactly what is tested. Run: `pnpm --dir desktop test`.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkChangelog, duplicates, unreleasedEntries } from '../check-changelog.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'check-changelog.mjs')
const COMMITTED = join(HERE, '..', '..', '..', 'CHANGELOG.md')
const dir = mkdtempSync(join(tmpdir(), 'mew-changelog-guard-'))
after(() => rmSync(dir, { recursive: true, force: true }))
let n = 0
function file(text) {
  const f = join(dir, `changelog.${n++}.md`)
  writeFileSync(f, text)
  return f
}
function run(f) {
  const r = spawnSync(process.execPath, [SCRIPT, f], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

const PREAMBLE = '# Changelog\n\nAll notable changes.\n\n'
const RELEASED = '\n## [0.7.0] — 2026-08-12\n\n### Calm connections\n- Same words twice here are fine.\n- Same words twice here are fine.\n'

test('a clean [Unreleased] passes, and the released sections below it are not judged', () => {
  const text =
    PREAMBLE +
    '## [Unreleased]\n\n### The dial on any day\n- Step through the days from the date line.\n\n### Under the hood\n- Every lockfile is clean of known advisories.\n' +
    RELEASED
  const r = checkChangelog(text)
  assert.equal(r.ok, true, r.problems.join('; '))
  assert.match(r.summary, /2 sections \(2 unique\) · 2 bullets \(2 unique\)/)
  const cli = run(file(text))
  assert.equal(cli.code, 0, cli.out)
  assert.match(cli.out, /✓ changelog guard/)
})

test('a repeated section heading fails and is named once', () => {
  const text =
    PREAMBLE +
    '## [Unreleased]\n\n### Overlap on your say-so\n- Tell MEW an overlap is fine.\n\n### Under the hood\n- One.\n\n### Overlap on your say-so\n- Tell MEW an overlap is fine.\n' +
    RELEASED
  const r = checkChangelog(text)
  assert.equal(r.ok, false)
  assert.deepEqual(r.problems, [
    'duplicate section heading: "### Overlap on your say-so"',
    'duplicate bullet: "- Tell MEW an overlap is fine."',
  ])
  const cli = run(file(text))
  assert.equal(cli.code, 1, cli.out)
  assert.match(cli.out, /duplicate section heading: "### Overlap on your say-so"/)
  assert.match(cli.out, /3 sections \(2 unique\)/)
})

test('a bullet repeated with different line wrapping is still the same bullet', () => {
  const text =
    PREAMBLE +
    '## [Unreleased]\n\n### A\n- The Focus dial shows any day,\n  not just today.\n\n### B\n- The Focus dial shows\n  any day, not just today.\n' +
    RELEASED
  const r = checkChangelog(text)
  assert.equal(r.ok, false)
  assert.deepEqual(r.problems, ['duplicate bullet: "- The Focus dial shows any day, not just today."'])
})

test('different bullets that merely share a heading are not duplicates', () => {
  const text =
    PREAMBLE +
    '## [Unreleased]\n\n### The evening exists\n- Plannable hours have their own row in Settings.\n- Auto-placement lands on human times.\n' +
    RELEASED
  assert.equal(checkChangelog(text).ok, true)
})

test('no [Unreleased] heading fails, and an unreadable path exits 2', () => {
  const r = checkChangelog(PREAMBLE + RELEASED)
  assert.equal(r.ok, false)
  assert.match(r.problems[0], /no "## \[Unreleased\]" heading/)
  assert.equal(run(file(PREAMBLE + RELEASED)).code, 1)
  assert.equal(run(join(dir, 'nope.md')).code, 2)
})

test('the pure helpers: entries are whitespace-normalized, duplicates are named once', () => {
  const e = unreleasedEntries('## [Unreleased]\n### A  b\n- x   y\n  z\n- x y z\n- x y z\n')
  assert.deepEqual(e.headings, ['A b'])
  assert.deepEqual(e.bullets, ['x y z', 'x y z', 'x y z'])
  assert.deepEqual(duplicates(e.bullets), ['x y z'])
})

test('the committed CHANGELOG.md passes the guard', () => {
  const cli = run(COMMITTED)
  assert.equal(cli.code, 0, cli.out)
})
