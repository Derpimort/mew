/* The policy behind check-test-structure.mjs, exercised without a tree: a test
   written at column zero is top level and is reported; anything indented, or
   merely LOOKING like a test call (inside a block comment, inside a template
   literal, behind a line comment), is not. The script's own gate is `pnpm lint`,
   so these cases are the reason to trust it there. */

import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs script, no types
import { findTopLevelTests } from '../check-test-structure.mjs'

const find = (src: string): { line: number; text: string }[] => findTopLevelTests(src)

describe('findTopLevelTests — what counts as outside a describe', () => {
  it('a test inside a describe is indented, so it is not reported', () => {
    expect(
      find(`describe('a thing', () => {
  it('does it', () => {
    expect(1).toBe(1)
  })
})`)
    ).toEqual([])
  })

  it('a test at column zero is reported, with its line and its text', () => {
    const hits = find(`describe('a thing', () => {
  it('inside', () => {})
})

it('orphaned', () => {})`)
    expect(hits).toEqual([{ line: 5, text: "it('orphaned', () => {})" }])
  })

  it('every flavour of test call counts', () => {
    const hits = find(`it('plain', () => {})
it.skip('skipped', () => {})
it.fails('expected to fail', () => {})
test('the other name', () => {})
test.each([1, 2])('each %i', () => {})
it.each\`
  a
\`('tagged each', () => {})`)
    expect(hits.map((h) => h.line)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('a describe at column zero is not a test', () => {
    expect(find(`describe('a thing', () => {})`)).toEqual([])
  })
})

describe('findTopLevelTests — what only looks like a test', () => {
  it('prose inside a block comment is skipped, even at column zero', () => {
    /* the exact shape that bit the real repo: two file headers mention the
       convention in prose, and a grep for the words alone reports them */
    expect(
      find(`/* a journey that finds a bug pins it as a filed issue
it('this is prose, not code', () => {})
   and then reads like this */
describe('real', () => {
  it('inside', () => {})
})`)
    ).toEqual([])
  })

  it('a line comment does not hide a real test, but does hide a mention', () => {
    expect(find(`// it('just talking about it', () => {})`)).toEqual([])
    expect(find(`it('real', () => {}) // with a trailing comment`).map((h) => h.line)).toEqual([1])
  })

  it('a test call written inside a template literal is skipped', () => {
    expect(
      find(`const sample = \`
it('this is a fixture string', () => {})
\`
describe('real', () => {
  it('inside', () => {})
})`)
    ).toEqual([])
  })

  it('but a test that OPENS a template literal on its own line is still reported', () => {
    /* the state machine judges the line before it updates itself, so the
       backtick that starts a tagged template does not hide its own call */
    expect(find(`it.each\`\n  a\n\`('tagged', () => {})`).map((h) => h.line)).toEqual([1])
  })

  it('an empty file, and a file with no tests at all, are both fine', () => {
    expect(find('')).toEqual([])
    expect(find(`export const helper = () => 1\n`)).toEqual([])
  })
})
