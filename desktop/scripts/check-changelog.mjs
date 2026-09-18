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
//   - "[Unreleased]:" compares v<newest released version>...HEAD;
//   - no version label is defined twice — a keep-both re-sync duplicates the link
//     block as readily as it duplicates a section, and a Map lookup would silently
//     take the last line, making the verdict depend on the order of the merge.
// Every rule here reads the file with FENCED CODE BLOCKS REMOVED, because a renderer
// ignores them: a link block inside a fence must not satisfy the existence check, and an
// example heading inside a fence must not be mistaken for a release. See withoutFences.
// Only the *existence* of each version's link is checked, not its range: the range is
// history and does not always read v<prev>...v<this> (e.g. [0.3.0] ends at a bare sha,
// 26024e7, from before the tag existed). [Unreleased] is the one that must track the
// newest release, so it is the one whose range is checked.
//
// Usage: node desktop/scripts/check-changelog.mjs [path]   (default: CHANGELOG.md)
// Exit 0 = clean, 1 = a duplicate or a broken link block, 2 = the file can't be read.

import { readFileSync } from 'node:fs'

const norm = (t) => t.replace(/\s+/g, ' ').trim()

/** Pure: the text with every fenced code block removed, fences included. A fence opens
    on ``` or ~~~ and closes on the next one of the SAME kind; an unterminated fence runs
    to the end, which is what a renderer does with it too.

    WHY EVERY READER BELOW GOES THROUGH THIS, and it is two defects rather than one — both
    measured on the head before this landed:
      - a link-reference block inside a fence still SATISFIED the per-version existence
        check, so commenting the block out passed identically to having it. This repo lost
        `closingIssuesReferences` to a fence during 2026.9.0 — a 25-line block read ZERO —
        so a guard satisfied by content a renderer ignores is that same defect one layer out;
      - and the mirror, which is the worse one: a `## [9.9.9]` heading shown as an EXAMPLE
        inside a fence was counted as a real release and demanded a link, failing a correct
        file. RELEASES.md documents this format with exactly such a fenced example. A guard
        that fires on correct content is one the next person deletes in a hurry. */
export function withoutFences(text) {
  const out = []
  let fence = null
  for (const line of text.split('\n')) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (m && m[1][0] === fence) fence = null
      continue
    }
    if (m) {
      fence = m[1][0]
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

/** Pure: the [Unreleased] headings and bullets of a CHANGELOG text, normalized. */
export function unreleasedEntries(text) {
  const md = withoutFences(text)
  const start = md.indexOf('## [Unreleased]')
  if (start < 0) return null
  const next = md.indexOf('\n## [', start + 5)
  const body = md.slice(start, next < 0 ? md.length : next)
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
  /* EVERY reference line in order, duplicates kept. `refs` is a Map, so a second
     "[Unreleased]:" overwrites the first and the verdict would depend on which
     order a keep-both merge happened to leave them in — the same two lines
     passing for one developer and failing for another. The list is what makes
     that visible; the Map stays for lookup. */
  const labels = []
  for (const line of withoutFences(text).split('\n')) {
    const h = /^## \[([^\]]+)\]/.exec(line)
    if (h && isVersionLabel(h[1])) headings.push(h[1])
    const r = /^\[([^\]]+)\]:\s*(\S+)/.exec(line)
    if (r && isVersionLabel(r[1])) {
      labels.push(r[1])
      refs.set(r[1], r[2])
    }
  }
  return { headings, refs, labels }
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
  const { headings, refs, labels } = versionLinks(text)
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
  /* The same rule this file already applies to sections and bullets, one block
     down: a keep-both re-sync duplicates the link block too, and that is the very
     defect this script was written for — but the duplicate rules above run only
     INSIDE [Unreleased], so the block was the one part not covered by them. */
  const problems = duplicates(labels).map((l) => `duplicate link reference: "[${l}]:"`)
  problems.push(
    ...missing.map(
      (v) => `version [${v}] has a section heading but no link reference — add a "[${v}]: …/compare/…" line at the bottom.`
    )
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
