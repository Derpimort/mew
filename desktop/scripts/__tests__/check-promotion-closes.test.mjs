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
import { checkPromotionCloses, closingIssues, withoutFences } from '../check-promotion-closes.mjs'

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
  assert.match(r.problems[0], /fenced code block/)
  const cli = run(file(FENCED))
  assert.equal(cli.code, 1, cli.out)
  assert.match(cli.out, /un-fence the block/)
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
  assert.deepEqual(r.problems, ['GitHub has not linked: #182 — re-save the body and re-read.'])
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
