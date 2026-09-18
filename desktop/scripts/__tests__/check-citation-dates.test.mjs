import test from 'node:test'
import assert from 'node:assert/strict'

import {
  citationsIn,
  classify,
  ORDINAL_WORDS,
  ORDINAL_DECLARATION,
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
