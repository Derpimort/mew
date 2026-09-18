import test from 'node:test'
import assert from 'node:assert/strict'

import {
  citationsIn,
  classify,
  ORDINAL_WORDS,
  ORDINAL_DECLARATION,
  ARCHIVE_HIGHEST,
  ceilingFrom,
} from '../check-citation-dates.mjs'

/* THE THREE FIXTURES THIS GUARD MUST NOT FLAG COME FIRST, because that direction is the
   whole reason it exists. A construct-counting guard was refused on this repo for firing
   on correct content; the case for building this one was that it stays silent on #25. If
   these three ever go red, the guard is worse than nothing and should be deleted, not
   loosened. Each is a real site, quoted from the file it lives in. */

const REAL = {
  // app/scripts/shoot.mjs:839 — CORRECT as written. mew#25 "Silent Google token refresh
  // pops the system browser and steals focus" was created 2026-08-11, one day before this
  // line landed, and closed the same day by that very release.
  syncPause: `/* 5b · the sync pause (#25): a live calendar whose sign-in expired shows an`,
  // app/scripts/shoot.mjs:63 — WRONG as written. mew#160 is "A day word in a move's target
  // isn't read", created 2026-09-17, three months AFTER this line.
  conceptTour: `   first-run concept tour (#160) opens over the dial — dismiss it the way a`,
  // app/scripts/shoot.mjs:296 — not a citation at all.
  acceptance: `/* 4 · talk-to-schedule through the prompt (acceptance #1). The composer is now a`,
}

test('FIXTURE 1 — the correct citation stays silent: mew#25 existed when the line was written', () => {
  const [c] = citationsIn(REAL.syncPause)
  assert.equal(c.number, 25, 'the reader must SEE #25 — a guard that silently drops it would pass vacuously')

  const r = classify({
    number: 25,
    introducedAt: ['2026-08-12T00:00:00Z'],
    localCreatedAt: '2026-08-11T21:26:30Z',
  })
  assert.equal(r.fires, false)
  assert.equal(r.verdict, 'silent')
  assert.match(r.why, /does not guess/)
})

test('FIXTURE 2 — an ordinal is skipped BEFORE any date is consulted', () => {
  assert.deepEqual(citationsIn(REAL.acceptance), [], '"acceptance #1" is a list index')

  // And the skip must not depend on the date being favourable: even with dates that WOULD
  // fire, the ordinal never reaches classify(). This is the assertion that proves the skip
  // happens first rather than by luck.
  const wouldFire = classify({ number: 1, introducedAt: ['2020-01-01T00:00:00Z'], localCreatedAt: '2026-01-01T00:00:00Z' })
  assert.equal(wouldFire.fires, true, 'control: these dates DO fire, so fixture 2 is not vacuous')
  assert.deepEqual(citationsIn(REAL.acceptance), [], 'yet the ordinal is never offered to it')
})

test('FIXTURE 3 — fenced examples are invisible, using check-changelog\'s withoutFences', () => {
  const doc = ['a real one #77', '```', 'Closes #139, #161', '```', 'another #78'].join('\n')
  assert.deepEqual(
    citationsIn(doc).map((c) => c.number),
    [77, 78],
    'the fenced #139/#161 must not be offered to the date test'
  )
  // line numbers still index the file on disk, not the fence-stripped copy
  assert.deepEqual(citationsIn(doc).map((c) => c.lineNo), [1, 5])
})

test('FIXTURE 3b — a document that declares its own #N an index opts out wholesale', () => {
  const arch = '> **A bare `#N` in this document is an internal index, not an issue.**\nsee #9 and #4\n'
  assert.ok(ORDINAL_DECLARATION.test(arch))
  assert.deepEqual(citationsIn(arch), [], 'ARCHITECTURE.md:5 says so about itself')
})

/* NOW THE DIRECTION IT MUST FIRE IN. Without these the three above are vacuous — a guard
   that never fires passes every "does not fire" test. */

test('it FIRES when the local issue did not exist yet — shoot.mjs:63', () => {
  const [c] = citationsIn(REAL.conceptTour)
  assert.equal(c.number, 160)

  const r = classify({
    number: 160,
    introducedAt: ['2026-06-25T00:00:00Z'],
    localCreatedAt: '2026-09-17T21:55:37Z',
  })
  assert.equal(r.fires, true)
  assert.equal(r.verdict, 'archive')
  assert.match(r.why, /after this line was written/)
})

test('it FIRES on a number this repo has never allocated — its own branch, not a fall-through', () => {
  const never = classify({ number: 9999, introducedAt: ['2026-06-25T00:00:00Z'], localCreatedAt: null })
  assert.equal(never.fires, true)
  assert.equal(never.verdict, 'archive')
  assert.match(never.why, /never allocated/)

  // absent from the map reads the same as an explicit null — both mean "no such issue here"
  const absent = classify({ number: 9999, introducedAt: ['2026-06-25T00:00:00Z'], localCreatedAt: undefined })
  assert.equal(absent.fires, true)
  assert.equal(absent.verdict, 'archive')
})

/* THE TWO LIMITS, HANDLED RATHER THAN HIDDEN. Both are cases where the honest answer is
   "I cannot tell", and both must be REPORTED rather than resolved — an ambiguous answer
   dressed as a verdict is how every predicate on this shift went wrong. */

test('a line that MOVED is ambiguous, and is never resolved by taking the first commit', () => {
  const r = classify({
    number: 160,
    introducedAt: ['2026-06-25T00:00:00Z', '2026-08-01T00:00:00Z'],
    localCreatedAt: '2026-09-17T21:55:37Z',
  })
  assert.equal(r.verdict, 'ambiguous')
  assert.equal(r.fires, false, 'the earliest date WOULD have fired — taking it is the bug this guards against')
  assert.match(r.why, /not knowable/)
})

test('a line no commit introduces is undatable — for a number this repo DOES have', () => {
  // NOTE, because the first version of this test was wrong in a way worth keeping visible:
  // it passed `localCreatedAt: null` and asserted `fires: false`, commented "even though
  // #160 has no local issue — no date, no verdict". That enshrined a MISS as intent. A
  // number this repo never allocated is certain whatever the date, so the undatable branch
  // has to be exercised with a number that actually exists here.
  const r = classify({ number: 160, introducedAt: [], localCreatedAt: '2026-09-17T21:55:37Z' })
  assert.equal(r.verdict, 'undatable')
  assert.equal(r.fires, false, 'the date is what is missing, and without it there is no verdict')
})

test('never-allocated is DATE-INDEPENDENT: it fires with no date, and with an ambiguous one', () => {
  for (const introducedAt of [[], ['2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z'], ['2026-01-01T00:00:00Z']]) {
    const r = classify({ number: 9999, introducedAt, localCreatedAt: null })
    assert.equal(r.fires, true, `never-allocated must fire regardless of ${introducedAt.length} dates`)
    assert.equal(r.verdict, 'archive')
    assert.match(r.why, /whenever it was written/)
  }
  // the control that makes the loop non-vacuous: the SAME date shapes on a number this
  // repo does have are NOT certain, so the three greens above come from the number and
  // not from the dates being permissive
  assert.equal(classify({ number: 160, introducedAt: [], localCreatedAt: '2026-09-17T21:55:37Z' }).fires, false)
  assert.equal(
    classify({ number: 160, introducedAt: ['2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z'], localCreatedAt: '2026-09-17T21:55:37Z' }).fires,
    false
  )
})

/* THE ONE-DIRECTIONALITY ITSELF, asserted rather than left to the header. */

test('the implication is one-directional: "mew#N existed" is never evidence the citation is local', () => {
  const sameDay = classify({
    number: 25,
    introducedAt: ['2026-08-12T00:00:00Z'],
    localCreatedAt: '2026-08-12T00:00:00Z',
  })
  assert.equal(sameDay.fires, false)
  assert.equal(sameDay.verdict, 'silent', 'silent means UNJUDGED, not "confirmed local"')

  // an issue created long before the line: still silent, still not a positive finding
  const longBefore = classify({
    number: 25,
    introducedAt: ['2026-08-12T00:00:00Z'],
    localCreatedAt: '2020-01-01T00:00:00Z',
  })
  assert.equal(longBefore.verdict, 'silent')
})

/* The reader itself. */

test('citationsIn finds ordinary citations, including the hyphen-prefixed ones', () => {
  // `pre-#27` is a REAL citation — "a pre-#27 pull" means "before issue #27" — and lives at
  // app/src/adapters/calendar/sync.ts:28. It must not be mistaken for an ordinal just
  // because a word precedes the hash.
  assert.deepEqual(citationsIn('/** the shape a pre-#27 pull minted */').map((c) => c.number), [27])
  assert.deepEqual(citationsIn('see #1, #22 and #327').map((c) => c.number), [1, 22, 327])
  assert.ok(!ORDINAL_WORDS.has('pre'), 'pre- prefixes a citation, not an index')
})

test('the ordinal list is exactly what the repo documents, not a guess', () => {
  // ARCHITECTURE.md:6 names these three by example; CHANGELOG.md:687 carries "image-#7".
  assert.deepEqual([...ORDINAL_WORDS].sort(), ['acceptance', 'criterion', 'image', 'nudge'])
  for (const w of ORDINAL_WORDS) assert.deepEqual(citationsIn(`the ${w} #7 case`), [])
})

/* FOUND BY RUNNING IT ON THE REAL FILE RATHER THAN ON FIXTURES — both of these were
   defects in the first version of this guard, and #208 merging mid-build is what exposed
   them. Kept as the pair they are: the same site before and after it was fixed. */

test('FIXTURE 4 — an ALREADY-QUALIFIED citation is skipped, not re-opened', () => {
  // shoot.mjs:63 as it reads on the RC TODAY, after #208 qualified it.
  const fixed = `   first-run concept tour (mew-archive#160) opens over the dial — dismiss it the way a`
  assert.deepEqual(citationsIn(fixed), [], 'the repo is already named; there is nothing left to judge')

  // the same line BEFORE #208, which must still be seen — otherwise fixture 4 passes by
  // breaking the reader rather than by understanding qualification
  assert.deepEqual(citationsIn(REAL.conceptTour).map((c) => c.number), [160])

  // other qualified spellings
  assert.deepEqual(citationsIn('see Derpimort/mew#5 for the rest'), [])
  // and the one that LOOKS qualified and is not: `pre-#27` means "before issue #27"
  assert.deepEqual(citationsIn('a pre-#27 pull minted this').map((c) => c.number), [27])
})

test('a later edit makes a line look young, and that only ever makes the guard quieter', () => {
  // the real shape: the line was written 2026-06-25 but #208 rewrote it 2026-09-18, so -S
  // reports the young date. mew#160 (2026-09-17) then predates it and the guard goes silent.
  const young = classify({
    number: 160,
    introducedAt: ['2026-09-18T00:00:00Z'],
    localCreatedAt: '2026-09-17T21:55:37Z',
  })
  assert.equal(young.fires, false, 'silent, not wrong — the error is one-directional')

  // and the control: with the TRUE introduction date the same citation fires. Without this
  // the assertion above would pass for a guard that never fires at all.
  const truthful = classify({
    number: 160,
    introducedAt: ['2026-06-25T00:00:00Z'],
    localCreatedAt: '2026-09-17T21:55:37Z',
  })
  assert.equal(truthful.fires, true)
})

/* THE BUG MY OWN FIXTURES COULD NOT SEE, because every one of them wrote both sides in
   the same spelling. The real inputs do not: `git log %cI` emits a local offset and the
   GitHub API emits UTC. Fixtures prove the logic; they do not prove the instrument. */

test('MIXED OFFSETS — the same instant compared across spellings, not as strings', () => {
  // the real pair: ui-proofs.yml's "#202" line, and mew#202. String-compared, "17:48:25Z"
  // reads as LATER than "15:48:14-04:00" and fires. As instants, 15:48-04:00 is 19:48Z,
  // so the issue is two hours EARLIER and there is nothing to report.
  const written = '2026-09-18T15:48:14-04:00' // = 19:48:14Z
  const r = classify({ number: 202, introducedAt: [written], localCreatedAt: '2026-09-18T17:48:25Z' })
  assert.equal(r.fires, false, 'the issue predates the line; the offsets only make it look otherwise')
  assert.equal(r.verdict, 'silent')

  // the control that makes it non-vacuous: an issue genuinely later, same mixed spellings
  const later = classify({ number: 202, introducedAt: [written], localCreatedAt: '2026-09-18T21:00:00Z' })
  assert.equal(later.fires, true, 'a real "created after" must still fire across offsets')

  // and a string compare would get BOTH of these wrong in the same direction
  assert.ok('2026-09-18T17:48:25Z' > written, 'this is what the old code compared, and why it fired')
})

test('an unreadable date is its own verdict, not a comparison against NaN', () => {
  const r = classify({ number: 7, introducedAt: ['not-a-date'], localCreatedAt: '2026-09-18T00:00:00Z' })
  assert.equal(r.fires, false)
  assert.equal(r.verdict, 'undatable')
  assert.match(r.why, /could not read a date/)

  // NaN comparisons are false in BOTH directions, so without this branch the case would
  // fall through to 'silent' and claim it had been judged
  assert.equal(classify({ number: 7, introducedAt: ['2026-01-01T00:00:00Z'], localCreatedAt: 'nope' }).verdict, 'undatable')
})

/* A NUMBER NEITHER REPOSITORY HAS IS NOT A CITATION. Found by runner2 verifying the
   #195 re-derivation: 15 sites in this repo were being reported as "PROVEN to mean
   Derpimort/mew-archive" when they are CSS hex colours, a test fixture and another
   project's issue. Every one landed in `dead`, so no published live figure moved — but
   the guard's own instruction, followed on `glitch-text.tsx`, would have rewritten a
   colour literal and broken the file. */

test('hex colours made only of digits are not citations', () => {
  for (const line of [
    "expect(relativeLuminance('#000000')).toBeCloseTo(0, 6)",
    "fox: { pal: '#b0522a', pbl: '#876652' },",
    "bg: '#060708',",
    "expect(ratioToFixed(contrastRatio('#777777', '#ffffff'))).toBe('4.48')",
    "expect(() => parseHex('#12345')).toThrow()",
  ]) {
    assert.deepEqual(citationsIn(line), [], `should see no citation in: ${line}`)
  }
  // `#ffffff` was never at risk — `f` is not a digit — and that is luck, not design,
  // which is why the rule is about the NUMBER and not about spotting colours.
  assert.deepEqual(citationsIn("const c = '#ffffff'"), [])
})

test('a synthetic number in a fixture, and another project\'s issue, are not ours', () => {
  assert.deepEqual(citationsIn('assert.match(p[0], /links issues the body does not: #999/)'), [])
  // desktop/scripts/build-sidecar.mjs:61 — a real citation, to a different project
  assert.deepEqual(citationsIn('// pinned to the gbrain #1340 protocol revision'), [])
})

test('the ceiling is the archive\'s frozen highest, and it is tested from BOTH sides', () => {
  // mew-archive is `archived: true`, so 384 can never move. The boundary must admit the
  // last real number and reject the first impossible one — a ceiling only ever tested
  // from the rejecting side would pass with an off-by-one that silently drops #384.
  assert.deepEqual(citationsIn('see #384 for the dial').map((c) => c.number), [384])
  assert.deepEqual(citationsIn('see #385 for the dial'), [])
  assert.equal(ARCHIVE_HIGHEST, 384)

  // and it is a PARAMETER, not a constant welded in: raise it and the same token is seen
  assert.deepEqual(citationsIn('see #777 here', { highest: 1000 }).map((c) => c.number), [777])
  assert.deepEqual(citationsIn('see #777 here'), [])
})

test('zero and negative-shaped numbers are rejected, and a real citation survives', () => {
  assert.deepEqual(citationsIn("contrastRatio('#000000', '#ffffff')"), [])
  // the control: the SAME file that carries those colours also carries a real citation,
  // and it must still be found — app/src/ui/colorContrast.ts:12
  assert.deepEqual(
    citationsIn(' * Carbon (dark) tokens are not enumerated here: this issue (#174) is the Pet').map((c) => c.number),
    [174]
  )
})

test('ceilingFrom counts ALLOCATED numbers, not every key in the map', () => {
  // the bug I wrote first and caught before it ran: the map's keys include numbers this
  // repo has never had. One impossible number would have raised the ceiling past every
  // colour and silently disabled the rule.
  const map = { '12': '2026-08-11T00:00:00Z', '876652': null, '999': null }
  assert.equal(ceilingFrom(map), 384, 'a null entry must not raise the ceiling')

  // and it DOES rise for a real local number past the archive's frozen highest
  assert.equal(ceilingFrom({ '400': '2026-09-01T00:00:00Z' }), 400)
  assert.equal(ceilingFrom({}), 384, 'an empty map falls back to the archive bound')
})

/* THE CASE A PREFIX WORD LIST WOULD HAVE BROKEN. Measured, not imagined: a PROJECT_WORDS
   set was written, tested and reverted because it dropped HANDOFF.md:30 from the proven
   set. These two pin both halves so the idea cannot be re-introduced without failing. */

test('a project name before a hash can be a QUALIFIER or a SUBJECT — only the number tells them apart', () => {
  // build-sidecar.mjs:61 — a qualifier. Rejected because 1340 is a number neither repo
  // has, which is the right reason rather than because "gbrain" is in a list.
  assert.deepEqual(citationsIn("   compiled binary's vfs (gbrain #1340: every PGLite command ENOENTs on"), [])

  // HANDOFF.md:30 — the SAME token as a subject noun, and #39 IS mew-archive#39
  // ("brain: BrainPort + gbrain adapter"). It must stay a citation.
  assert.deepEqual(
    citationsIn('· #30 (loose-threads rail). GBrain #39 (BrainPort + senses + recall)').map((c) => c.number),
    [30, 39]
  )
})

test('the stated residual gap is real, and pinned so nobody thinks it is covered', () => {
  // a cross-project citation with a number both repos could have reads as ours. This repo
  // has zero of these today; the assertion exists so the limit is not rediscovered.
  assert.deepEqual(citationsIn('see gbrain #42 for the handshake').map((c) => c.number), [42])
})
