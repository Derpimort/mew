#!/usr/bin/env node
// Promotion guard: the closing block in a promotion PR's DESCRIPTION is the thing that
// closes the release's issues, so check it before the click rather than after.
//
// Why (#192, measured on the v2026.9.0 promotion #185): twenty-five issues were listed
// to close. The runbook and the PR body both led with the squash box — clear GitHub's
// pre-filled text, paste the block at the click — and that step WAS NOT DONE: the squash
// body is 3,915 lines of un-replaced commit messages carrying exactly four closing
// keywords. All twenty-five closed anyway, because the PR DESCRIPTION carried an
// un-fenced block and GitHub linked them when the body was saved. So the description is
// the mechanism and the squash box is the redundancy, not the other way round.
//
// And the description only works un-fenced. GitHub does not parse closing keywords
// inside a fenced code block: measured at totalCount 0 while fenced and 25 after
// un-fencing, against promotion #32 as a control. A fenced block and an un-fenced one
// are byte-identical to every other gate we run.
//
// What it checks, given a promotion PR's body:
//   - INTENDED  = every closing keyword in the body, fences ignored — what the author meant;
//   - EFFECTIVE = the ones OUTSIDE fenced blocks — what GitHub will actually act on;
//   - they must be the same set, so a fenced block fails by naming the issues it would
//     silently strand;
//   - INTENDED must be non-empty. A promotion that links nothing fails rather than
//     passing on an empty set — `all([])` is true, and that is how this ships wrong;
//   - and when the live linked set is supplied (--linked, from the GraphQL
//     closingIssuesReferences on the OPEN pr), it must equal EFFECTIVE — which is the
//     whole advantage of this path: the result is readable BEFORE the merge.
//
// Scope, said rather than implied: this has a subject ONLY on a promotion PR. GitHub
// links closing keywords for the default branch alone, so `closingIssuesReferences` is
// empty on any PR into a v*-rc* branch — four such zeros were nearly published as proof
// during v2026.9.0 and proved nothing. It also does not judge whether the list is the
// RIGHT one; that is the promotion checklist issue's job.
//
// Usage: node desktop/scripts/check-promotion-closes.mjs <body-file> [--linked 1,2,3]
// Exit 0 = the description will close what it claims, 1 = it will not, 2 = unreadable.

import { readFileSync } from 'node:fs'

/* GitHub's own set, and the spellings matter: this repo has closed an issue by accident
   from "whoever fixes #161 deletes the skip" in ordinary prose, and a line-start-only
   reader missed two of four on the promotion commit. Case-insensitive, anywhere. */
const KEYWORD = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi

/** Pure: the text with every fenced code block removed, fences included. A fence opens
    on ``` or ~~~ and closes on the next one of the SAME kind; an unterminated fence runs
    to the end, which is what GitHub does with it too. */
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

/** Pure: the issue numbers a closing keyword names, in first-seen order, de-duplicated. */
export function closingIssues(text) {
  const seen = []
  for (const m of text.matchAll(KEYWORD)) {
    const n = Number(m[1])
    if (!seen.includes(n)) seen.push(n)
  }
  return seen
}

/** Pure verdict for a promotion PR body: { ok, summary, problems[] }.
    `linked` is the live closingIssuesReferences set, or null when not supplied. */
export function checkPromotionCloses(body, linked = null) {
  const intended = closingIssues(body)
  const effective = closingIssues(withoutFences(body))
  const problems = []
  // ANTI-VACUOUS, and it is the first check on purpose: every rule below is a set
  // comparison, and two empty sets are equal. A promotion linking nothing must fail.
  if (intended.length === 0) {
    problems.push(
      'no closing keyword in the promotion PR description — a promotion that closes nothing is the empty set every comparison below would accept.'
    )
  }
  const stranded = intended.filter((n) => !effective.includes(n))
  if (stranded.length > 0) {
    problems.push(
      `${stranded.length} closing keyword(s) sit inside a fenced code block, where GitHub does not read them: ` +
        `${stranded.map((n) => `#${n}`).join(' ')} — un-fence the block (a list, not a code fence) or they stay open.`
    )
  }
  if (linked !== null) {
    const missing = effective.filter((n) => !linked.includes(n))
    const extra = linked.filter((n) => !effective.includes(n))
    if (missing.length > 0)
      problems.push(`GitHub has not linked: ${missing.map((n) => `#${n}`).join(' ')} — re-save the body and re-read.`)
    if (extra.length > 0)
      problems.push(`GitHub links issues the body does not claim: ${extra.map((n) => `#${n}`).join(' ')}.`)
  }
  const summary =
    `description claims ${intended.length} issue(s), ${effective.length} outside fences` +
    (linked === null ? ' (live link set not supplied)' : `, ${linked.length} linked by GitHub`)
  return { ok: problems.length === 0, summary, problems }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isMain) {
  const args = process.argv.slice(2)
  const path = args.find((a) => !a.startsWith('--'))
  const i = args.indexOf('--linked')
  const linked =
    i >= 0 && args[i + 1]
      ? args[i + 1]
          .split(',')
          .map((s) => Number(s.trim().replace(/^#/, '')))
          .filter((n) => Number.isFinite(n))
      : null
  let body
  try {
    body = readFileSync(path ?? '', 'utf8')
  } catch (e) {
    console.error(`✗ promotion closes guard: could not read ${path}: ${e.message}`)
    process.exit(2)
  }
  const r = checkPromotionCloses(body, linked)
  if (r.ok) {
    console.log(`✓ promotion closes guard: ${r.summary}`)
  } else {
    console.error(`✗ promotion closes guard: ${r.summary}`)
    for (const p of r.problems) console.error(`  ${p}`)
    console.error('  Read it before the click: gh api graphql on closingIssuesReferences of the OPEN pr (.github/RELEASES.md).')
    process.exit(1)
  }
}
