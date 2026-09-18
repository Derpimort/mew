#!/usr/bin/env node
// Citation guard: a comment cannot cite an issue that did not exist when it was written.
//
// This repo was migrated from Derpimort/mew-archive and the code kept the predecessor's
// issue numbers, so a bare `#198` in a comment is correct provenance for a repo that is
// not this one. This repo's counter is walking into those numbers: a dead link is loud,
// but once #198 is allocated here the same comment resolves to a real, live, WRONG issue
// with nobody having touched it.
//
// THE IMPLICATION IS ONE-DIRECTIONAL, AND THAT IS THE WHOLE DESIGN.
//
//   mew#N did not exist when the comment was written  =>  the citation means the ARCHIVE.
//   mew#N did exist                                   =>  PROVES NOTHING.
//
// The converse is not true and must never be coded as though it were. A comment written
// after mew#N existed may still have meant the archive — the author may not have known,
// or may have been describing history — and no date can tell you which. So this guard
// FIRES ONLY WHEN IT IS CERTAIN and is silent otherwise. It is a guard, not a classifier.
//
// The next person will be tempted to invert it ("mew#N exists, so the citation is fine,
// so a citation whose subject doesn't match must be wrong") and that inversion is exactly
// what breaks shoot.mjs:839 — see the fixture below.
//
// WHY THIS AND NOT A SWEEP (#195). Correctness here is per-site, not per-number:
//
//   shoot.mjs:63   "first-run concept tour (#160)"   comment 2026-06-25
//                  mew#160 created 2026-09-17 — three months LATER, so impossible.
//                  mew-archive#160 "guided first-run modal: 3-step concept tour". FIRES.
//
//   shoot.mjs:839  "the sync pause (#25)"            comment 2026-08-12
//                  mew#25 created 2026-08-11, ONE DAY EARLIER, and closed that same day
//                  by that very release. The citation is CORRECT. SILENT.
//                  mew-archive#25 is "Preferences: remember policy" — unrelated — and the
//                  archive's copy of this subject is #380, not #25, because the migration
//                  RENUMBERED it. A rule of "qualify everything below the counter" would
//                  have replaced a working link with a broken one while reading as tidying.
//
// Two people (myself included) first judged these by matching SUBJECTS — reading the
// comment, reading both candidate issues, deciding which the sentence is about. That is a
// judgement call on prose and it pointed the wrong way on #25. Dates need no judgement.
//
// WHAT IT REFUSES TO GUESS, each an explicit branch rather than a fall-through:
//   - a line whose introducing commit is AMBIGUOUS (`git log -S` matched more than one)
//     is reported as ambiguous, never resolved by picking the first. An ambiguous answer
//     reported as a verdict is how predicates go wrong;
//   - a line no commit introduced cannot be dated at all, and says so;
//   - a number this repo has NEVER allocated has no created_at. That is not an exception
//     falling through the bottom — the repo never had the number, so the citation is an
//     archive reference by the same logic, and it is its own branch and its own message.
//
// ORDINALS ARE SKIPPED BEFORE DATES ARE EVER ASKED FOR. "acceptance #1" is a list index,
// not a citation, and a guard that date-checks a list index will fire on it confidently.
// ARCHITECTURE.md:5 already documents this for itself; that declaration is honoured as a
// file-level opt-out, and the word list is derived from ARCHITECTURE.md:6's own examples
// plus the one hyphenated case in CHANGELOG. The asymmetry is deliberate and worth stating:
// missing an ordinal makes the guard FIRE ON CORRECT CONTENT, which is how a gate gets
// deleted in a hurry; skipping too much only makes it quieter. So this list errs generous.
//
// Fences are stripped with check-changelog.mjs's withoutFences — IMPORTED, not copied. A
// second copy of that function was just deleted in #207 and this is not the place to mint
// a third.
//
// Usage:
//   node desktop/scripts/check-citation-dates.mjs <file…> --issues <json>
//
// --issues is a JSON map of "<number>": "<created_at ISO>" | null, gathered OUT of band
// exactly as check-promotion-closes.mjs takes --linked. The guard does no network I/O: it
// stays deterministic, runs offline, and is testable without a token.
//
// Exit 0 = nothing certain to report · 1 = at least one citation proven to mean the
// archive · 2 = unreadable input.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { withoutFences } from './check-changelog.mjs'

/** Words that make the following `#N` a list index rather than an issue. Derived from
    ARCHITECTURE.md:6 ("Acceptance criterion #2", "acceptance #7", "nudge #4") and the one
    hyphenated case at CHANGELOG.md:687 ("image-#7"). Deliberately generous: a miss here
    fires on correct content, which is the failure that gets a guard removed. */
export const ORDINAL_WORDS = new Set(['acceptance', 'criterion', 'nudge', 'image'])

/** A document that declares its own bare `#N` to be an index opts out wholesale.
    ARCHITECTURE.md:5 carries exactly this sentence. */
export const ORDINAL_DECLARATION = /bare `#N`[^\n]*internal index, not an issue/i

/** Pure. Every `#N` in the text that is a citation candidate: fenced blocks removed, and
    ordinals skipped BEFORE any date is consulted. Returns the 1-based line number of the
    ORIGINAL text, and the full original line, which is the needle `git log -S` needs. */
export function citationsIn(text) {
  if (ORDINAL_DECLARATION.test(text)) return []
  // withoutFences drops fenced lines entirely, so blank them in place instead to keep
  // line numbers aligned with the file on disk. Same decision, line numbers preserved.
  const kept = new Set(withoutFences(text).split('\n'))
  const out = []
  text.split('\n').forEach((line, i) => {
    if (!kept.has(line)) return
    for (const m of line.matchAll(/(?:([A-Za-z][A-Za-z]*)([ -]))?#(\d+)\b/g)) {
      // ALREADY QUALIFIED — `mew-archive#160`, `Derpimort/mew#5`. A letter, digit, slash or
      // underscore hard against the hash means the repo is already named, which is the
      // FIXED state this guard exists to produce. Reading a bare number back out of one
      // re-opens a question somebody already closed. `pre-#27` is NOT this: the separator
      // is a hyphen with the hash after it, and it means "before issue #27".
      const at = m.index + m[0].length - m[3].length - 1
      if (at > 0 && /[A-Za-z0-9_/]/.test(line[at - 1])) continue
      const before = (m[1] || '').toLowerCase()
      if (ORDINAL_WORDS.has(before)) continue
      out.push({ number: Number(m[3]), lineNo: i + 1, line })
    }
  })
  return out
}

/** Pure, and the whole predicate. Takes gathered facts, returns a verdict and never a
    guess. `introducedAt` is the list of commit dates whose diff changed the number of
    occurrences of this line in this file — one means the line was introduced there, more
    than one means it moved and the date is not knowable from this. */
export function classify({ number, introducedAt, localCreatedAt }) {
  // NEVER ALLOCATED COMES FIRST, BECAUSE IT DOES NOT DEPEND ON THE DATE AT ALL. If this
  // repo has never had #N, no date of writing could have meant a local issue — so this
  // case is certain even when the line is undatable or has moved, and asking git first
  // would throw that certainty away. It also means these sites need no `git log -S` at
  // all, which is what makes a whole-repo run affordable.
  //
  // The first version of this file checked it LAST, behind both date branches, and a test
  // asserted the resulting miss as though it were intended — "even though #160 has no
  // local issue — no date, no verdict". That comment was confidently wrong and is the
  // reason this ordering is spelled out rather than left to read.
  if (localCreatedAt === null || localCreatedAt === undefined)
    return {
      verdict: 'archive',
      fires: true,
      why: `this repo has never allocated #${number}, so the citation cannot mean a local issue whenever it was written`,
    }
  if (!introducedAt || introducedAt.length === 0)
    return { verdict: 'undatable', fires: false, why: `no commit introduces this line` }
  if (introducedAt.length > 1)
    return {
      verdict: 'ambiguous',
      fires: false,
      why: `the line moved — ${introducedAt.length} commits changed it, so the date it was written is not knowable from git alone`,
    }
  const written = introducedAt[0]
  if (localCreatedAt > written)
    return {
      verdict: 'archive',
      fires: true,
      why: `mew#${number} was created ${localCreatedAt.slice(0, 10)}, after this line was written ${written.slice(0, 10)}`,
    }
  return {
    verdict: 'silent',
    fires: false,
    why: `mew#${number} already existed on ${written.slice(0, 10)} — the date cannot tell whether the author meant it, and this guard does not guess`,
  }
}

/** The one impure part: when this line's CURRENT TEXT first appeared in this file.

    THAT IS NOT THE SAME AS WHEN THE CITATION WAS FIRST WRITTEN, and the difference is a
    limit rather than a bug. `-S` counts occurrences of a string, so ANY later edit to the
    line — a reflow, a typo fix, qualifying a different citation on the same line — retires
    the old string and mints a new one. The line then reads as young.
    MEASURED, on this repo, while building this: #208 rewrote shoot.mjs:63 to qualify its
    citation, and the line's first appearance moved from 2026-06-25 to 2026-09-18.

    The predicate stays SOUND under that, which is why this is documented and not patched:
    whoever wrote the text at time T could not have meant an issue created after T, whether
    or not an earlier version of the line existed. A young date only makes the guard go
    SILENT more often — it can never make it fire wrongly. The error is one-directional in
    the safe direction, which is the same property the whole guard is built on.

    --reverse so the FIRST is first, and every match is returned so the caller can see
    ambiguity rather than have it hidden. */
export function introducedDates(file, line, cwd = process.cwd()) {
  const out = execFileSync(
    'git',
    ['log', '--reverse', '--format=%cI', `-S${line}`, '--', file],
    { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  )
  return out.split('\n').filter(Boolean)
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isMain) {
  const argv = process.argv.slice(2)
  const at = argv.indexOf('--issues')
  if (at === -1 || !argv[at + 1]) {
    console.error('usage: check-citation-dates.mjs <file…> --issues <json>')
    process.exit(2)
  }
  let issues
  const files = [...argv.slice(0, at), ...argv.slice(at + 2)]
  try {
    issues = JSON.parse(readFileSync(argv[at + 1], 'utf8'))
  } catch (e) {
    console.error(`cannot read --issues: ${e.message}`)
    process.exit(2)
  }
  if (files.length === 0) {
    console.error('no files given')
    process.exit(2)
  }

  const fired = []
  const said = []
  for (const file of files) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch (e) {
      console.error(`cannot read ${file}: ${e.message}`)
      process.exit(2)
    }
    for (const c of citationsIn(text)) {
      const localCreatedAt = Object.prototype.hasOwnProperty.call(issues, String(c.number))
        ? issues[String(c.number)]
        : undefined
      // A `git log -S` per site is the expensive part, and for a number this repo has
      // never allocated the answer does not depend on it. Skipping it here is not an
      // optimisation that changes behaviour: classify() reaches the same verdict either
      // way, which the fixtures assert both with a date and without one.
      const introducedAt =
        localCreatedAt === null || localCreatedAt === undefined
          ? []
          : introducedDates(file, c.line)
      const r = classify({ number: c.number, introducedAt, localCreatedAt })
      const at = `${file}:${c.lineNo}`
      if (r.fires) fired.push(`${at}  #${c.number}  ${r.why}`)
      else if (r.verdict !== 'silent') said.push(`${at}  #${c.number}  ${r.verdict}: ${r.why}`)
    }
  }

  // Reported, never resolved. These are the cases the predicate refuses to answer, and
  // they are printed whether or not anything fired, because a guard that hides what it
  // could not judge is claiming coverage it does not have.
  for (const s of said) console.log(`  ? ${s}`)
  if (fired.length === 0) {
    console.log(`citation dates: nothing proven to mean the archive${said.length ? ` (${said.length} not judged)` : ''}`)
    process.exit(0)
  }
  for (const f of fired) console.error(`  ✗ ${f}`)
  console.error(
    `\n${fired.length} citation(s) PROVEN to mean Derpimort/mew-archive: the local issue did not exist when the line was written.`
  )
  console.error(`Qualify them as mew-archive#N. Do not renumber — most have no counterpart here.`)
  process.exit(1)
}
