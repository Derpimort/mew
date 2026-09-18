// Cases for the release-notes guard: the pure functions on small logs, and the CLI on
// a throwaway file, so what CI runs is exactly what is tested. Run: `pnpm --dir desktop test`.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkChangelog, checkLinks, compareRange, duplicates, unreleasedEntries, versionLinks } from '../check-changelog.mjs'

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
// The link-reference block that belongs under RELEASED — part 3 of RELEASES.md step 1.
const C = 'https://github.com/Derpimort/mew/compare'
const LINKS = `\n[Unreleased]: ${C}/v0.7.0...HEAD\n[0.7.0]: ${C}/v0.6.0...v0.7.0\n`

test('a clean [Unreleased] passes, and the released sections below it are not judged', () => {
  const text =
    PREAMBLE +
    '## [Unreleased]\n\n### The dial on any day\n- Step through the days from the date line.\n\n### Under the hood\n- Every lockfile is clean of known advisories.\n' +
    RELEASED +
    LINKS
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
    RELEASED +
    LINKS
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
    RELEASED +
    LINKS
  const r = checkChangelog(text)
  assert.equal(r.ok, false)
  assert.deepEqual(r.problems, ['duplicate bullet: "- The Focus dial shows any day, not just today."'])
})

test('different bullets that merely share a heading are not duplicates', () => {
  const text =
    PREAMBLE +
    '## [Unreleased]\n\n### The evening exists\n- Plannable hours have their own row in Settings.\n- Auto-placement lands on human times.\n' +
    RELEASED +
    LINKS
  assert.equal(checkChangelog(text).ok, true)
})

test('no [Unreleased] heading fails on that alone, and an unreadable path exits 2', () => {
  // Deliberately without LINKS: the link rules would add two more problems, so a single
  // problem here is what proves the missing-[Unreleased] verdict returns before them.
  const r = checkChangelog(PREAMBLE + RELEASED)
  assert.equal(r.ok, false)
  assert.equal(r.problems.length, 1)
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

// ── The link-reference block (#186): part 3 of RELEASES.md step 1, which no gate read.
// A promotion renames [Unreleased] to the new version and opens a fresh empty one above
// it; if it stops there, the new version has no compare link and [Unreleased] still
// compares the PREVIOUS tag. Both states below passed every gate before this guard.

// The promotion shape: a fresh empty [Unreleased], the new version, then the old one.
const PROMO = (links) =>
  PREAMBLE +
  '## [Unreleased]\n' +
  '\n## [2026.9.0] — 2026-09-18\n\n### The dial on any day\n- Step through the days from the date line.\n' +
  RELEASED +
  links

const HEALTHY = `\n[Unreleased]: ${C}/v2026.9.0...HEAD\n[2026.9.0]: ${C}/v0.7.0...v2026.9.0\n[0.7.0]: ${C}/v0.6.0...v0.7.0\n`

test('the healthy promotion shape passes — all three parts of the step done', () => {
  const r = checkChangelog(PROMO(HEALTHY))
  assert.equal(r.ok, true, r.problems.join('; '))
  assert.match(r.summary, /links: 2\/2 versions linked/)
  const cli = run(file(PROMO(HEALTHY)))
  assert.equal(cli.code, 0, cli.out)
  assert.match(cli.out, /link block in step/)
})

test('a released section with no link reference fails, naming that version', () => {
  // Part 3 skipped entirely: [Unreleased] and the old version keep their old links, and
  // the version being released has none — it renders as plain text among links.
  const text = PROMO(LINKS)
  const r = checkChangelog(text)
  assert.equal(r.ok, false)
  assert.ok(
    r.problems.some((p) => /^version \[2026\.9\.0\] has a section heading but no link reference/.test(p)),
    r.problems.join('; ')
  )
  assert.match(r.summary, /links: 1\/2 versions linked/)
  const cli = run(file(text))
  assert.equal(cli.code, 1, cli.out)
  assert.match(cli.out, /part 3 of RELEASES\.md step 1/)
})

test('[Unreleased] left pointing at the previous tag fails, naming both ranges', () => {
  // The compare link was added but [Unreleased] was not re-pointed: it describes the
  // wrong range from this release on, and gets wronger with every one after it.
  const stale = `\n[Unreleased]: ${C}/v0.7.0...HEAD\n[2026.9.0]: ${C}/v0.7.0...v2026.9.0\n[0.7.0]: ${C}/v0.6.0...v0.7.0\n`
  const text = PROMO(stale)
  const r = checkChangelog(text)
  assert.equal(r.ok, false)
  assert.deepEqual(r.problems, [
    '[Unreleased] compares v0.7.0...HEAD, but the newest released section is [2026.9.0] — it should compare v2026.9.0...HEAD.',
  ])
  assert.equal(run(file(text)).code, 1)
})

test('the mirror direction: a link reference whose section heading is gone', () => {
  const orphan = HEALTHY + `[0.6.0]: ${C}/v0.5.0...v0.6.0\n`
  const r = checkChangelog(PROMO(orphan))
  assert.equal(r.ok, false)
  assert.deepEqual(r.problems, ['link reference [0.6.0] has no "## [0.6.0]" section heading above it.'])
})

test('anti-vacuous: no version heading fails rather than passing on an empty set', () => {
  // If the heading parser ever stops matching, every "for each version …" rule above is
  // satisfied by nothing. That must read as a broken check, not a clean file.
  const r = checkChangelog(PREAMBLE + '## [Unreleased]\n\n### A\n- One.\n')
  assert.equal(r.ok, false)
  assert.deepEqual(r.problems, [
    'found no "## [X.Y.Z]" version heading — with none to check, every link rule below would pass on an empty set.',
  ])
  assert.match(checkChangelog(PREAMBLE + '## [Unreleased]\n').summary, /links: 0\/0 versions linked/)
})

test('the pure link helpers: labels, file order, and the compare range', () => {
  const { headings, refs } = versionLinks(PROMO(HEALTHY))
  assert.deepEqual(headings, ['Unreleased', '2026.9.0', '0.7.0'])
  assert.deepEqual([...refs.keys()], ['Unreleased', '2026.9.0', '0.7.0'])
  assert.equal(checkLinks(PROMO(HEALTHY)).newest, '2026.9.0')
  assert.equal(compareRange(`${C}/v0.7.0...HEAD`), 'v0.7.0...HEAD')
  assert.equal(compareRange('https://example.com/releases/tag/v0.1.0'), null)
  // A prose link like [semver](…) or a future footnote is not this guard's business.
  assert.deepEqual(versionLinks('## [Notes]\n[semver]: https://semver.org/\n'), { headings: [], refs: new Map() })
})

test('the committed CHANGELOG.md passes the guard', () => {
  const cli = run(COMMITTED)
  assert.equal(cli.code, 0, cli.out)
})

test('the committed CHANGELOG.md: the guard watched EVERY version heading in it', () => {
  // Membership, not "> 0": count the version headings a second way, straight off the
  // file, and require the guard to have linked exactly that set. A parser that quietly
  // narrowed to a subset would still report a tidy all-linked number without this.
  const text = readFileSync(COMMITTED, 'utf8')
  const byHand = text.split('\n').filter((l) => /^## \[\d+\.\d+\.\d+\]/.test(l)).length
  const r = checkLinks(text)
  assert.ok(byHand > 0, 'the committed CHANGELOG has version headings to check')
  assert.equal(r.released, byHand)
  assert.equal(r.linked, byHand)
  assert.deepEqual(r.problems, [])
})
