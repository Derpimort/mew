/* Where a proof writes, as a rule rather than a habit.

   Nineteen PNGs under `app/shots/` are tracked (README embeds two) inside a
   directory that is otherwise gitignored, and five proofs write exactly those
   names. Before this rule, every run rewrote committed evidence in place and
   the remedy was remembering `git checkout -- app/shots`; two runs in one night
   rewrote seven and then sixteen of them. These cases pin the opt-in, because a
   default that silently flips back to writing canon is the whole defect
   returning. */

import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs helper, no types
import { isPinningCanon, shotsRelDir } from '../lib/shotsPath.mjs'

const dir = (env: Record<string, string>): string => shotsRelDir(env)
const pinning = (env: Record<string, string>): boolean => isPinningCanon(env)

describe('shotsRelDir — a run writes beside the canon, not over it', () => {
  it('writes to shots/latest when nothing asks for a re-pin', () => {
    expect(dir({})).toBe('shots/latest')
  })

  it('writes the tracked canon names only under PIN_CANON=1', () => {
    expect(dir({ PIN_CANON: '1' })).toBe('shots')
  })

  it('the two modes are different directories', () => {
    /* the assertion that cannot pass vacuously: a refactor returning one path
       for both modes would satisfy every other case here by accident, and the
       canon would be silently overwritten again */
    expect(dir({ PIN_CANON: '1' })).not.toBe(dir({}))
  })

  it('only the literal "1" pins — a stray value never re-pins by accident', () => {
    /* deliberate strictness: re-pinning committed evidence is a decision, so an
       inherited PIN_CANON=0 or a copy-pasted PIN_CANON=true must not make one.
       The cost is that `true` does nothing, which fails in the safe direction */
    for (const v of ['0', 'true', 'yes', '', ' 1'])
      expect(dir({ PIN_CANON: v })).toBe('shots/latest')
  })

  it('isPinningCanon agrees with the directory it chose', () => {
    expect(pinning({ PIN_CANON: '1' })).toBe(true)
    expect(pinning({})).toBe(false)
    expect(pinning({ PIN_CANON: 'true' })).toBe(false)
  })
})
