#!/usr/bin/env node
// Release-notes guard: the [Unreleased] section of CHANGELOG.md must never repeat a
// section heading or a bullet.
//
// Why: every PR into the RC adds its own [Unreleased] line, and squash merges make
// every other open PR re-sync its CHANGELOG with a keep-both resolution. On the
// v2026.09 RC one such re-sync (#106, whose branch predated the #105 audit that had
// regrouped the sections) re-introduced seven whole sections word for word. The
// [Unreleased] body becomes the release body at promotion, so a duplicate there is a
// release defect, not a nit. This guard runs in the release-guard workflow on every
// PR that touches CHANGELOG.md, and fails before anything is merged.
//
// Rules: within [Unreleased] (from its heading to the next "## [" heading)
//   - no two "### " headings may be equal (whitespace-normalized);
//   - no two bullets may be equal — a bullet is a "- " line plus its indented
//     continuation lines, joined and whitespace-normalized.
// A CHANGELOG without an [Unreleased] heading fails too: RELEASES.md keeps an empty
// [Unreleased] above every released version.
//
// Usage: node desktop/scripts/check-changelog.mjs [path]   (default: CHANGELOG.md)
// Exit 0 = unique, 1 = duplicates or a missing section, 2 = the file can't be read.

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

/** Pure verdict for a CHANGELOG text: { ok, summary, problems[] }. */
export function checkChangelog(text) {
  const entries = unreleasedEntries(text)
  if (!entries) {
    return {
      ok: false,
      summary: 'no "## [Unreleased]" section',
      problems: ['CHANGELOG.md has no "## [Unreleased]" heading — RELEASES.md keeps one above every released version.'],
    }
  }
  const dupHeadings = duplicates(entries.headings)
  const dupBullets = duplicates(entries.bullets)
  const summary =
    `[Unreleased]: ${entries.headings.length} sections (${new Set(entries.headings).size} unique) · ` +
    `${entries.bullets.length} bullets (${new Set(entries.bullets).size} unique)`
  const problems = [
    ...dupHeadings.map((h) => `duplicate section heading: "### ${h}"`),
    ...dupBullets.map((b) => `duplicate bullet: "- ${b.length > 100 ? b.slice(0, 97) + '…' : b}"`),
  ]
  return { ok: problems.length === 0, summary, problems }
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
    console.log(`✓ changelog guard: ${r.summary} — no repeats`)
  } else {
    console.error(`✗ changelog guard: ${r.summary}`)
    for (const p of r.problems) console.error(`  ${p}`)
    console.error(
      '  A keep-both CHANGELOG re-sync kept both copies. Delete the repeated block; the [Unreleased] body is the release body.'
    )
    process.exit(1)
  }
}
