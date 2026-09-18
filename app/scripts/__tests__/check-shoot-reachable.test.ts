/* The policy behind check-shoot-reachable.mjs, exercised without the repo's own
   tree: which proofs count as unreachable, which names point nowhere, and when
   an exemption has outlived its reason. Its gate is `pnpm lint`, so these cases
   are the reason to trust it there.

   The guard exists because twelve of seventeen shoot proofs could only be run by
   typing a path (#171), and evidence nobody consults decays silently. Two of the
   twelve had already rotted by the time anyone ran them. */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs script, no types
import { findUnreachable, proofEntryPoints } from '../check-shoot-reachable.mjs'

type Result = {
  orphans: string[]
  dangling: string[]
  staleExemptions: { file: string; why: string }[]
  scanned: number
}

/** `fileExists` for a fixed set of basenames under scripts/ */
const exists =
  (...files: string[]) =>
  (f: string) =>
    files.includes(f)

const check = (
  proofs: string[],
  scripts: Record<string, string>,
  files: string[],
  exempt: string[] = []
): Result => findUnreachable(proofs, scripts, exists(...files), exempt)

describe('findUnreachable — reachability in both directions', () => {
  it('a proof a script points at is reachable, and nothing is reported', () => {
    const r = check(['shoot-allday.mjs'], { 'shoot:allday': 'node scripts/shoot-allday.mjs' }, [
      'shoot-allday.mjs',
    ])
    expect(r).toMatchObject({ orphans: [], dangling: [], staleExemptions: [] })
  })

  it('a proof no script mentions is an orphan', () => {
    expect(check(['shoot-dial.mjs'], { lint: 'eslint .' }, ['shoot-dial.mjs']).orphans).toEqual([
      'shoot-dial.mjs',
    ])
  })

  it('arguments after the path do not hide the reference', () => {
    /* every proof takes a base URL, so the real entries in CI and in local
       chains carry one; a reader that only matched an exact command would call
       all of them orphans */
    const r = check(
      ['shoot-dial.mjs'],
      { 'shoot:dial': 'node scripts/shoot-dial.mjs http://localhost:5202 9:55' },
      ['shoot-dial.mjs']
    )
    expect(r.orphans).toEqual([])
  })

  it('a script name pointing at a missing file is dangling', () => {
    const r = check(
      ['shoot-allday.mjs'],
      {
        'shoot:allday': 'node scripts/shoot-allday.mjs',
        'shoot:gone': 'node scripts/shoot-gone.mjs',
      },
      ['shoot-allday.mjs']
    )
    expect(r.dangling).toEqual(['shoot-gone.mjs'])
    /* and the other direction stays clean — the two findings are independent */
    expect(r.orphans).toEqual([])
  })

  it('the count it reports is the set it actually read', () => {
    /* the CLI refuses to pass when this is 0: every finding is a filter over
       this set, so an empty one would report a green it never computed */
    expect(check(['shoot-a.mjs', 'shoot-b.mjs'], {}, []).scanned).toBe(2)
    expect(check([], {}, []).scanned).toBe(0)
  })
})

describe('findUnreachable — an exemption cannot outlive its reason', () => {
  it('an exempt proof is not an orphan while it stays unreachable', () => {
    const r = check(
      ['shoot-rescue.mjs'],
      { lint: 'eslint .' },
      ['shoot-rescue.mjs'],
      ['shoot-rescue.mjs']
    )
    expect(r.orphans).toEqual([])
    expect(r.staleExemptions).toEqual([])
  })

  it('an exempt proof that became reachable is stale, and says which script runs it', () => {
    const r = check(
      ['shoot-rescue.mjs'],
      { 'shoot:rescue': 'node scripts/shoot-rescue.mjs' },
      ['shoot-rescue.mjs'],
      ['shoot-rescue.mjs']
    )
    expect(r.staleExemptions).toEqual([
      { file: 'shoot-rescue.mjs', why: 'now reachable via shoot:rescue — repaired?' },
    ])
  })

  it('an exemption naming a file that no longer exists is stale', () => {
    const r = check(
      ['shoot-dial.mjs'],
      { 'shoot:dial': 'node scripts/shoot-dial.mjs' },
      ['shoot-dial.mjs'],
      ['shoot-renamed.mjs']
    )
    expect(r.staleExemptions).toEqual([
      { file: 'shoot-renamed.mjs', why: 'no such file — the proof was renamed or deleted' },
    ])
  })

  it('a repaired proof fails BOTH ways if the exemption is left behind', () => {
    /* the shape that matters: someone repairs a rotted proof, wires it in, and
       forgets the list. Reachability is satisfied, so only rule 3 catches it.
       The filenames below are literals handed to a pure function, which does not
       care what they are called — `shoot-dial.mjs` no longer exists (it became
       `capture-dial.mjs` in #204), so this sentence no longer names a real file
       on purpose. */
    const r = check(
      ['shoot-dial.mjs'],
      { 'shoot:dial': 'node scripts/shoot-dial.mjs' },
      ['shoot-dial.mjs'],
      ['shoot-dial.mjs']
    )
    expect(r.orphans).toEqual([])
    expect(r.staleExemptions).toHaveLength(1)
  })
})

describe('proofEntryPoints — what counts as a proof', () => {
  it('reads shoot*.mjs in the dir, and never the helpers under lib/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shoot-proofs-'))
    mkdirSync(join(dir, 'lib'))
    for (const f of ['shoot.mjs', 'shoot-dial.mjs', 'check-bundle-size.mjs', 'shoot-notes.md'])
      writeFileSync(join(dir, f), '')
    /* lib/shootClock.mjs is imported by five proofs and is not one: counting it
       would inflate the total, which is how a helper became the eighteenth
       "proof" in the first reading of #171 */
    writeFileSync(join(dir, 'lib', 'shootClock.mjs'), '')

    expect(proofEntryPoints(dir)).toEqual(['shoot-dial.mjs', 'shoot.mjs'])
  })

  it('a missing scripts dir reads as no proofs, which the CLI treats as a failure', () => {
    expect(proofEntryPoints(join(tmpdir(), 'definitely-not-here-shoot'))).toEqual([])
  })
})
