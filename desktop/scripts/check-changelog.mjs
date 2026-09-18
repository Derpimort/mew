#!/usr/bin/env node
// Release-notes guard: the [Unreleased] section of CHANGELOG.md must never repeat a
// section heading or a bullet, and the link-reference block at the bottom must stay in
// step with the version headings above it.
//
// Why (duplicates): every PR into the RC adds its own [Unreleased] line, and squash
// merges make every other open PR re-sync its CHANGELOG with a keep-both resolution. On
// the v2026.09 RC one such re-sync (#106, whose branch predated the #105 audit that had
// regrouped the sections) re-introduced seven whole sections word for word. The
// [Unreleased] body becomes the release body at promotion, so a duplicate there is a
// release defect, not a nit.
//
// Why (links): RELEASES.md step 1 has three parts — rename [Unreleased] to the new
// version, open a fresh empty [Unreleased] above it, and update the link-reference
// block. The first is guarded by check-release-version.mjs --promotion, the second by
// the rule below, and until #186 the third was guarded by nothing: skip it and the new
// version renders as plain text where every other version is a link, while [Unreleased]
// keeps comparing the *previous* tag and gets wronger with every release. Every other
// gate passes. This is a hand-edited file outside the format gate, so this script is the
// only thing reading it.
//
// This guard runs in the release-guard workflow on every PR that touches CHANGELOG.md,
// and fails before anything is merged.
//
// Rules: within [Unreleased] (from its heading to the next "## [" heading)
//   - no two "### " headings may be equal (whitespace-normalized);
//   - no two bullets may be equal — a bullet is a "- " line plus its indented
//     continuation lines, joined and whitespace-normalized.
// A CHANGELOG without an [Unreleased] heading fails too: RELEASES.md keeps an empty
// [Unreleased] above every released version.
// And across the whole file:
//   - every "## [X.Y.Z]" heading has a matching "[X.Y.Z]:" link reference, and every
//     version link reference has a heading (a deleted section must not leave one behind);
//   - "[Unreleased]:" compares v<newest released version>...HEAD.
// Only the *existence* of each version's link is checked, not its range: the range is
// history and does not always read v<prev>...v<this> (e.g. [0.3.0] ends at a bare sha,
// 26024e7, from before the tag existed). [Unreleased] is the one that must track the
// newest release, so it is the one whose range is checked.
//
// Usage: node desktop/scripts/check-changelog.mjs [path]   (default: CHANGELOG.md)
// Exit 0 = clean, 1 = a duplicate or a broken link block, 2 = the file can't be read.

import { readFileSync } from 'node:fs'

const norm = (t) => t.replace(/\s+/g, ' ').trim()

/** Pure: the [Unreleased] headings and bullets of a CHANGELOG text, normalized. */
export function unreleasedEntries(text) {
  const start = text.indexOf('## [Unreleased]')
  if (start < 0) return null
  const next = text.indexOf('\n## [', start + 5)
  const body = text.slice(start, next < 0 ? text.length : next)
  const headings = []
  const bullets = []
  let current = null
  for (const line of body.split('\n')) {
    if (line.startsWith('### ')) headings.push(norm(line.slice(4)))
    if (line.startsWith('- ')) {
      if (current !== null) bullets.push(norm(current))
      current = line.slice(2)
    } else if (line.startsWith('  ') && current !== null) {
      current += ' ' + line
    } else {
      if (current !== null) bullets.push(norm(current))
      current = null
    }
  }
  if (current !== null) bullets.push(norm(current))
  return { headings, bullets }
}

/** Pure: the entries that appear more than once, each named once. */
export function duplicates(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    if (seen.has(item) && !out.includes(item)) out.push(item)
    seen.add(item)
  }
  return out
}

/** A label this guard owns: the standing [Unreleased] or a bare X.Y.Z. Anything else in
 *  the file (a prose link like [semver], a future footnote) is none of its business. */
const isVersionLabel = (label) => label === 'Unreleased' || /^\d+\.\d+\.\d+$/.test(label)

/** Pure: the version headings (in file order, newest first) and the version link
 *  references of a CHANGELOG text. */
export function versionLinks(text) {
  const headings = []
  const refs = new Map()
  for (const line of text.split('\n')) {
    const h = /^## \[([^\]]+)\]/.exec(line)
    if (h && isVersionLabel(h[1])) headings.push(h[1])
    const r = /^\[([^\]]+)\]:\s*(\S+)/.exec(line)
    if (r && isVersionLabel(r[1])) refs.set(r[1], r[2])
  }
  return { headings, refs }
}

/** Pure: the compare range of a GitHub compare URL ("v0.7.0...HEAD"), or null. */
export function compareRange(target) {
  const m = /\/compare\/(.+)$/.exec(target ?? '')
  return m ? m[1] : null
}

/** Pure: link-block problems, plus the counts that prove the check looked at something.
 *  Newest = the first version heading in the file, which is the Keep a Changelog order
 *  the whole file (and desktop.yml's release-notes awk) already relies on. */
export function checkLinks(text) {
  const { headings, refs } = versionLinks(text)
  const released = headings.filter((h) => h !== 'Unreleased')
  // Anti-vacuous: no version headings means the parser stopped matching, not that the
  // file is clean. Every other rule here is "for each heading …" and would pass on an
  // empty set, so the whole check has to fail loudly instead.
  if (released.length === 0) {
    return {
      released: 0,
      linked: 0,
      newest: null,
      problems: [
        'found no "## [X.Y.Z]" version heading — with none to check, every link rule below would pass on an empty set.',
      ],
    }
  }
  const missing = released.filter((v) => !refs.has(v))
  const problems = missing.map(
    (v) => `version [${v}] has a section heading but no link reference — add a "[${v}]: …/compare/…" line at the bottom.`
  )
  for (const label of refs.keys()) {
    if (label !== 'Unreleased' && !headings.includes(label)) {
      problems.push(`link reference [${label}] has no "## [${label}]" section heading above it.`)
    }
  }
  const newest = released[0]
  const want = `v${newest}...HEAD`
  const target = refs.get('Unreleased')
  if (target === undefined) {
    problems.push(`no "[Unreleased]:" link reference — it should compare ${want}.`)
  } else if (compareRange(target) !== want) {
    problems.push(
      `[Unreleased] compares ${compareRange(target) ?? target}, but the newest released section is [${newest}] — it should compare ${want}.`
    )
  }
  return { released: released.length, linked: released.length - missing.length, newest, problems }
}

/** Pure verdict for a CHANGELOG text: { ok, summary, problems[], hints[] }. */
export function checkChangelog(text) {
  const entries = unreleasedEntries(text)
  if (!entries) {
    return {
      ok: false,
      summary: 'no "## [Unreleased]" section',
      problems: ['CHANGELOG.md has no "## [Unreleased]" heading — RELEASES.md keeps one above every released version.'],
      hints: [],
    }
  }
  const dupHeadings = duplicates(entries.headings)
  const dupBullets = duplicates(entries.bullets)
  const links = checkLinks(text)
  const summary =
    `[Unreleased]: ${entries.headings.length} sections (${new Set(entries.headings).size} unique) · ` +
    `${entries.bullets.length} bullets (${new Set(entries.bullets).size} unique) · ` +
    `links: ${links.linked}/${links.released} versions linked`
  const dupProblems = [
    ...dupHeadings.map((h) => `duplicate section heading: "### ${h}"`),
    ...dupBullets.map((b) => `duplicate bullet: "- ${b.length > 100 ? b.slice(0, 97) + '…' : b}"`),
  ]
  const hints = []
  if (dupProblems.length > 0) {
    hints.push(
      'A keep-both CHANGELOG re-sync kept both copies. Delete the repeated block; the [Unreleased] body is the release body.'
    )
  }
  if (links.problems.length > 0) {
    hints.push(
      'The link-reference block at the bottom is part 3 of RELEASES.md step 1 — the part a promotion forgets.'
    )
  }
  return { ok: dupProblems.length + links.problems.length === 0, summary, problems: [...dupProblems, ...links.problems], hints }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isMain) {
  const path = process.argv[2] ?? 'CHANGELOG.md'
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    console.error(`✗ changelog guard: could not read ${path}: ${e.message}`)
    process.exit(2)
  }
  const r = checkChangelog(text)
  if (r.ok) {
    console.log(`✓ changelog guard: ${r.summary} — no repeats, link block in step`)
  } else {
    console.error(`✗ changelog guard: ${r.summary}`)
    for (const p of r.problems) console.error(`  ${p}`)
    for (const h of r.hints) console.error(`  ${h}`)
    process.exit(1)
  }
}
