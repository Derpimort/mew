/* #182 — a fifth rulebook tap cannot arrive unguarded.

   The fix for #182 was four call sites given a snapshot by hand, and four sites
   fixed by hand is a convention, not a guarantee. #165 is the same argument one
   floor down: the arity pin exists because "remember the third place" failed.
   This is that pin for the rulebook.

   THE RULE, and it is about KINDS rather than names so a rename cannot escape
   it: `learned_rule`, `dismissed_rule` and `preference` are the three memory
   kinds the OWNER creates and removes — the rulebook, the thing the memory
   console edits. Every write of one must sit inside a snapshot and a mark, so
   "undo that" reaches it instead of walking past it into unrelated work. MEW's
   own bookkeeping (`completed`, `drift`, `rest_kept`, `nudge_outcome`,
   `interruption`) is out of scope BY KIND: the owner did not write it, and
   #130's guard deliberately ignores it.

   THE SCOPE THAT COUNTS IS THE TIGHT ONE, and getting this wrong is how the
   check would pass while being useless. Asking "does the enclosing function
   mention snapshotForUndo" lets a new `case` in a big switch through, because a
   SIBLING case's snapshot satisfies it — measured: under that looser rule all
   ten sites read guarded, including ones that are not. So the search stops at
   the first `case`/`default` clause or function boundary, and a new case must
   carry its own.

   TWO EXEMPTIONS, NAMED WITH THEIR REASONS, and the list is checked for stale
   entries the way check-shoot-reachable checks KNOWN_BROKEN — an exemption that
   stops matching anything is a lie that reads like caution. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const STORE = fileURLToPath(new URL('../store.ts', import.meta.url))

/** the memory kinds the owner authors and can take back */
const RULEBOOK = new Set(['learned_rule', 'dismissed_rule', 'preference'])

/** Guarded one level up instead of in place, and why that is right:
    - `execRemember` is reached through `runChange` from the executor wrapper,
      which snapshots before it and marks after — the tool path's own shape.
    - `execUndo` IS the undo: it drops memory while restoring a snapshot, so a
      snapshot of its own would be a loop. */
const EXEMPT = ['execRemember', 'execUndo']

interface Site {
  line: number
  kind: string
  owner: string
  guarded: boolean
}

const isFnLike = (n: ts.Node): boolean =>
  ts.isArrowFunction(n) ||
  ts.isFunctionExpression(n) ||
  ts.isFunctionDeclaration(n) ||
  ts.isMethodDeclaration(n)

const nameOf = (fn: ts.Node): string => {
  if (ts.isMethodDeclaration(fn) && fn.name) return fn.name.getText()
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.getText()
  const p = fn.parent
  if (p && ts.isPropertyAssignment(p)) return p.name.getText()
  if (p && ts.isVariableDeclaration(p)) return p.name.getText()
  return '(anonymous)'
}

function rulebookSites(): Site[] {
  const src = readFileSync(STORE, 'utf8')
  const sf = ts.createSourceFile(STORE, src, ts.ScriptTarget.Latest, true)
  const sites: Site[] = []

  /* ancestors of the write, up to and INCLUDING the first case clause or
     function body — never past it, so sibling cases cannot vouch for it */
  const guardScope = (call: ts.Node): ts.Node[] => {
    const out: ts.Node[] = []
    let up: ts.Node | undefined = call.parent
    while (up) {
      out.push(up)
      if (ts.isCaseClause(up) || ts.isDefaultClause(up) || isFnLike(up)) break
      up = up.parent
    }
    return out
  }

  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText()
      let kind: string | null = null
      if (
        callee === 'logMemory' &&
        n.arguments[0] &&
        ts.isObjectLiteralExpression(n.arguments[0])
      ) {
        for (const p of n.arguments[0].properties)
          if (
            ts.isPropertyAssignment(p) &&
            p.name.getText() === 'kind' &&
            ts.isStringLiteral(p.initializer)
          )
            kind = p.initializer.text
        if (kind && !RULEBOOK.has(kind)) kind = null
      } else if (callee === 'persistDeleteMemory') {
        /* a delete names no kind at the call, so every one counts and an
           exemption is how a non-rulebook delete is accounted for */
        kind = 'delete'
      }
      if (kind) {
        const text = guardScope(n)
          .map((x) => x.getText())
          .join('\n')
        let owner = '(top level)'
        let up: ts.Node | undefined = n.parent
        while (up) {
          if (isFnLike(up)) {
            owner = nameOf(up)
            break
          }
          up = up.parent
        }
        sites.push({
          line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          kind,
          owner,
          guarded:
            text.includes('snapshotForUndo()') &&
            (text.includes('markUndoLeft()') || text.includes('runChange(')),
        })
      }
    }
    n.forEachChild(walk)
  }
  walk(sf)
  return sites
}

describe('#182 — every rulebook write is inside a snapshot and a mark', () => {
  it('the reader finds the writes, and the exemption list is not stale', () => {
    /* ASSERTED BEFORE ANYTHING IS ASSERTED ABOUT THEM. A reader that silently
       stops matching turns this file green while watching nothing — the shape of
       the two vacuous guards this cycle has already had to fix. */
    const sites = rulebookSites()
    expect(sites.length).toBeGreaterThan(0)

    /* the console's own taps must be among what was found, by name: the set
       shrinking quietly is the failure mode a bare count cannot see */
    const owners = new Set(sites.map((s) => s.owner))
    for (const tap of ['confirmTaskRule', 'forgetRule', 'reEnableRule', 'forgetStandingPref'])
      expect(owners).toContain(tap)

    /* and every exemption still names a real site — an exemption that matches
       nothing reads like caution and is a lie (the KNOWN_BROKEN discipline) */
    const stale = EXEMPT.filter((name) => !sites.some((s) => s.owner === name))
    expect(stale).toEqual([])
  })

  it('no rulebook write is left unguarded', () => {
    const unguarded = rulebookSites()
      .filter((s) => !s.guarded && !EXEMPT.includes(s.owner))
      .map((s) => `${s.owner} writes ${s.kind} at store.ts:${s.line} with no snapshot or no mark`)
    expect(unguarded).toEqual([])
  })
})
