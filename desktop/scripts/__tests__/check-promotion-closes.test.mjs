// Cases for the promotion closing-block guard (#192): the pure functions on small
// bodies, and the CLI on a throwaway file, so what a maintainer runs is what is tested.
// Run: `pnpm --dir desktop test`.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkPromotionCloses,
  closingIssues,
  withoutComments,
  withoutFences,
} from '../check-promotion-closes.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'check-promotion-closes.mjs')
const dir = mkdtempSync(join(tmpdir(), 'mew-promotion-closes-'))
after(() => rmSync(dir, { recursive: true, force: true }))
let n = 0
const file = (text) => {
  const f = join(dir, `body.${n++}.md`)
  writeFileSync(f, text)
  return f
}
const run = (...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

const LIST = ['Closes #139', 'Closes #161', 'Closes #176', 'Closes #182'].join('\n')
const UNFENCED = `## What ships\n\nThe October release.\n\n${LIST}\n`
const FENCED = `## What ships\n\nThe October release.\n\n\`\`\`\n${LIST}\n\`\`\`\n`

test('an un-fenced block passes — the shape that actually closed 21 of 25 on v2026.9.0', () => {
  const r = checkPromotionCloses(UNFENCED)
  assert.equal(r.ok, true, r.problems.join('; '))
  assert.match(r.summary, /claims 4 issue\(s\), 4 outside fences/)
  const cli = run(file(UNFENCED))
  assert.equal(cli.code, 0, cli.out)
})

test('THE NEGATIVE CONTROL: a fenced block fails, naming every issue it would strand', () => {
  /* Byte-identical to the passing case but for the fence, and invisible to every other
     gate we run. Measured on #185: totalCount 0 while fenced, 25 after un-fencing. */
  const r = checkPromotionCloses(FENCED)
  assert.equal(r.ok, false)
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0], /#139 #161 #176 #182/)
  assert.match(r.problems[0], /hidden from GitHub/)
  const cli = run(file(FENCED))
  assert.equal(cli.code, 1, cli.out)
  assert.match(cli.out, /plain list/)
})

test('ANTI-VACUOUS: a body that closes nothing fails rather than passing on an empty set', () => {
  /* Every other rule here is a set comparison and two empty sets are equal, so without
     this a promotion PR with no block at all is the quietest possible pass. */
  const r = checkPromotionCloses('## What ships\n\nNothing to see.\n')
  assert.equal(r.ok, false)
  assert.match(r.problems[0], /no closing keyword/)
  assert.equal(run(file('## nothing\n')).code, 1)
})

test('a mismatch fails on the DIFFERENCE, not only on zero', () => {
  // twenty-four listed, twenty-five intended — the case a zero-check cannot see.
  const r = checkPromotionCloses(UNFENCED, [139, 161, 176])
  assert.equal(r.ok, false)
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0], /^GitHub has not linked: #182 —/)
  const extra = checkPromotionCloses(UNFENCED, [139, 161, 176, 182, 999])
  assert.equal(extra.ok, false)
  assert.match(extra.problems[0], /links issues the body does not claim: #999/)
})

test('the live linked set agreeing is a pass, and it is readable before the click', () => {
  const r = checkPromotionCloses(UNFENCED, [182, 176, 161, 139]) // order must not matter
  assert.equal(r.ok, true, r.problems.join('; '))
  assert.match(r.summary, /4 linked by GitHub/)
  const cli = run(file(UNFENCED), '--linked', '139,161,176,182')
  assert.equal(cli.code, 0, cli.out)
})

// ── coderpb + coderpa, on this PR: the guard failed open in the one case it exists for.

test('BLOCKER: --linked with an EMPTY list means GitHub linked nothing, and must FAIL', () => {
  /* RELEASES.md's recipe pipes the GraphQL result into --linked, and it prints an
     EMPTY LINE precisely when GitHub has linked NOTHING. That used to read as "flag
     absent", skip the live comparison and exit 0 — the documented happy path handed
     the guard the one input that switched it off. Present-but-empty is not absent. */
  const r = checkPromotionCloses(UNFENCED, [])
  assert.equal(r.ok, false)
  assert.match(r.problems[0], /^GitHub has not linked: #139 #161 #176 #182 —/)
  assert.match(r.summary, /0 linked by GitHub/)
  const cli = run(file(UNFENCED), '--linked', '')
  assert.equal(cli.code, 1, cli.out)
  // and the same when the flag is last with nothing after it at all
  assert.equal(run(file(UNFENCED), '--linked').code, 1)
})

test('no --linked at all still passes, but says so rather than reading as a clearance', () => {
  const cli = run(file(UNFENCED))
  assert.equal(cli.code, 0, cli.out)
  assert.match(cli.out, /LIVE LINK SET NOT CHECKED/)
  assert.equal(checkPromotionCloses(UNFENCED, null).ok, true)
})

test('a keyword inside an HTML comment is hidden from GitHub too', () => {
  const hidden = `## What ships\n\n<!-- Closes #139 -->\nCloses #161\n`
  const r = checkPromotionCloses(hidden)
  assert.equal(r.ok, false)
  assert.match(r.problems[0], /#139/)
  assert.match(r.problems[0], /hidden from GitHub/)
  assert.deepEqual(closingIssues(withoutComments(hidden)), [161])
})

test('THE LIMIT, pinned so it is not mistaken for coverage: one line claims ONE issue', () => {
  /* `Closes #139, #161, #176, #182` links exactly one issue on GitHub, and this reader
     agrees — so BOTH halves say yes while four issues strand. No check can tell "meant
     one" from "meant four"; RELEASES.md carries the one-per-line rule for the human.
     Pinned here so a later reader sees the gap is known rather than missed. */
  const oneLine = '## What ships\n\nCloses #139, #161, #176, #182\n'
  assert.deepEqual(closingIssues(oneLine), [139])
  assert.equal(checkPromotionCloses(oneLine, [139]).ok, true)
})

test('the other limit: a four-space indented block is caught by the LIVE half, not the reader', () => {
  /* GFM renders a four-space indented block byte-identical to a fenced one, but
     indentation is ambiguous — four spaces under a list item is continuation — so this
     reader does not strip it and a stripper that guessed would fail a correct
     description. The live comparison is the layer that covers it, which is exactly why
     the empty-string bug above mattered. */
  const indented = '## What ships\n\n    Closes #139\n    Closes #161\n\nend.\n'
  assert.deepEqual(closingIssues(withoutFences(indented)), [139, 161]) // the reader still sees them
  assert.equal(checkPromotionCloses(indented, []).ok, false) // GitHub linked nothing -> caught
})

test('the spellings GitHub actually honours, including the ones that bit this repo', () => {
  /* A line-start-only reader read 2 of 4 on the promotion commit, and `grep -c` read 3.
     Mid-prose and lowercase both count — this repo closed #161 by accident from
     "whoever fixes #161 deletes the skip" buried in a commit body. */
  const body = 'Closes #1 — the first.\nthe comment says whoever fixes #2 deletes the skip\nResolved #3, and CLOSED #4.\n'
  assert.deepEqual(closingIssues(body), [1, 2, 3, 4])
  // a bare reference is NOT a close
  assert.deepEqual(closingIssues('see issue #9 and for #10'), [])
  // named once even when repeated
  assert.deepEqual(closingIssues('Closes #5. Closes #5.'), [5])
})

test('fence handling: ``` and ~~~, nesting of the other kind, and an unterminated fence', () => {
  assert.equal(withoutFences('a\n```\nb\n```\nc\n').split('\n').filter(Boolean).join(','), 'a,c')
  assert.equal(withoutFences('a\n~~~\nb\n~~~\nc\n').split('\n').filter(Boolean).join(','), 'a,c')
  // a ``` inside a ~~~ block does not close it — the fence kind must match
  assert.equal(withoutFences('a\n~~~\n```\nb\n```\n~~~\nc\n').split('\n').filter(Boolean).join(','), 'a,c')
  // an unterminated fence swallows the rest, which is what GitHub does too
  assert.equal(withoutFences('a\n```\nb\nc\n').split('\n').filter(Boolean).join(','), 'a')
  // and an indented fence still opens one
  assert.deepEqual(closingIssues(withoutFences('  ```\n  Closes #7\n  ```\n')), [])
})

test('an unreadable path exits 2', () => {
  assert.equal(run(join(dir, 'nope.md')).code, 2)
})

test('an unlinked number is told it might be a PULL REQUEST, which re-saving can never fix', () => {
  // Measured on this repo: #172 is a pull request, so `Closes #172` is inert — GitHub links
  // closing keywords to issues only. The guard already FAILED on it via the --linked
  // difference, but its remedy offered only "re-save the body and re-read", which for a PR
  // number cannot work. A correct failure with an impossible remedy sends a maintainer round
  // a loop with no hint of the cause.
  const r = checkPromotionCloses('Closes #172\nCloses #183\n', [183])
  assert.equal(r.ok, false)
  const msg = r.problems.join(' ')
  assert.match(msg, /#172/)
  assert.match(msg, /PULL REQUEST/)
  assert.match(msg, /issues only/)

  // control: the remedy it already had must survive, since fences remain the common cause
  assert.match(msg, /fenced/)
})
