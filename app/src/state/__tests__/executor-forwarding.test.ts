/* #165 part 1: every ToolExecutor wrapper forwards every argument it declares.

   THE HOLE THIS CLOSES, which is a bug I wrote (#160): `ToolExecutor` is
   implemented once, as an object literal in store.ts whose 23 methods each
   forward their arguments BY HAND. Add a parameter to a tool and you must
   remember it in three places — the interface, the `exec*` implementation, and
   that forwarding list. Miss the third and nothing tells you: TypeScript accepts
   a function with FEWER parameters where one with more is expected (ordinary
   assignability, not a config gap), so the wrapper still satisfies the interface
   and `tsc` is silent. So is eslint. The failure signature is A CORRECT PARSE +
   A CORRECT STORE + NO EFFECT — it reads like a store bug, because the store is
   where the effect is missing, and the argument never arrived.

   This is the tripwire, not the fix. #165 proper is the structural change
   (options objects, so a dropped field is a type error at the forwarding site);
   the two are not alternatives and this is worth keeping afterwards.

   WHY THE AST AND NOT `Function.length`: the obvious pin is to compare each
   wrapper's `.length` against the interface. It would LIE here. `Function.length`
   stops counting at the first parameter with a default or a rest element, and
   `execMove` has `allowOverlap = false` in the middle of its list — measured:
   `((q, d, t, rel, at, allowOverlap = false, fromDayOffset) => {}).length` is 5,
   for a seven-parameter function. A guard that reads 5 of 7 and calls it a match
   is worse than no guard. Interface arity is also erased at runtime, so there is
   nothing to compare against without a hand-maintained table — which is the very
   thing that failed.

   WHY THE AST AND NOT TEXT: an earlier audit of this same list produced a false
   alarm by counting a comma INSIDE A DOC COMMENT as a parameter separator. The
   TypeScript AST has no nodes for comments or for the insides of strings, so
   neither can fool it in either direction — a parameter that appears only in a
   comment reads as unused, which is exactly right. Uses the `typescript` package
   the repo already builds with: no new dependency, no lockfile change, and no
   re-opening the audit gate on a release whose supply chain is already proven. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const TYPES = fileURLToPath(new URL('../../adapters/model/types.ts', import.meta.url))
const STORE = fileURLToPath(new URL('../store.ts', import.meta.url))

const parse = (path: string) =>
  ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)

/** every `name(…): T` on the ToolExecutor interface, with how many parameters it
    declares. `members.length` comes back too so the caller can prove the reader
    understood the whole interface rather than the part it recognised. */
function declaredArities(): { arities: Map<string, number>; members: number } {
  const arities = new Map<string, number>()
  let members = 0
  const walk = (n: ts.Node): void => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === 'ToolExecutor') {
      members = n.members.length
      for (const m of n.members) {
        if (ts.isMethodSignature(m) && m.name) arities.set(m.name.getText(), m.parameters.length)
      }
    }
    n.forEachChild(walk)
  }
  walk(parse(TYPES))
  return { arities, members }
}

interface Wrapper {
  params: string[]
  /** a `...rest` forwards whatever it is given, so arity stops being the question */
  rest: boolean
  /** identifiers REFERENCED in the body, collected from the AST */
  used: Set<string>
}

/** the `const exec: ToolExecutor = { … }` literal in store.ts, one entry per
    property. `properties` comes back for the same reason `members` does above. */
function wrapperShapes(): { wrappers: Map<string, Wrapper>; properties: number } {
  const wrappers = new Map<string, Wrapper>()
  let properties = 0
  const walk = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText() === 'exec' &&
      n.initializer &&
      ts.isObjectLiteralExpression(n.initializer)
    ) {
      properties = n.initializer.properties.length
      for (const p of n.initializer.properties) {
        if (!ts.isPropertyAssignment(p)) continue
        const fn = p.initializer
        if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) continue
        const used = new Set<string>()
        const collect = (x: ts.Node): void => {
          /* AN IDENTIFIER CAN APPEAR WITHOUT REFERENCING ANYTHING, and counting
             those two cases would let a dropped argument hide behind a mention of
             its own name: `o.fromDayOffset` carries it as the right-hand side of a
             property access, and `{ fromDayOffset: 1 }` carries it as a literal
             key. Neither reads the parameter. With the argument dropped at the
             call and either shape anywhere in the same body, every test in this
             file passed — a masked drop, which is the exact bug this pin exists
             for wearing a disguise the pin could not see.
             It matters most where the pin matters most: #165's real fix is
             options objects, which are a world of `{ name: value }`, so the naive
             reader would degrade exactly as the refactor it is holding the line
             for lands. Found in review by coderpb, who also wrote and ran these
             four lines; kept here because the file's header claims the AST cannot
             be fooled by text, and this was the one way it still could be.
             Shorthand (`{ fromDayOffset }`) and computed keys
             (`{ [fromDayOffset]: 1 }`) DO reference, and both still count. */
          if (ts.isPropertyAccessExpression(x)) {
            collect(x.expression) // `o` references; `.name` does not
            return
          }
          if (ts.isPropertyAssignment(x) && !ts.isComputedPropertyName(x.name)) {
            collect(x.initializer) // the value references; the key does not
            return
          }
          if (ts.isIdentifier(x)) used.add(x.text)
          x.forEachChild(collect)
        }
        collect(fn.body)
        wrappers.set(p.name.getText(), {
          params: fn.parameters.map((x) => x.name.getText()),
          rest: fn.parameters.some((x) => !!x.dotDotDotToken),
          used,
        })
      }
    }
    n.forEachChild(walk)
  }
  walk(parse(STORE))
  return { wrappers, properties }
}

describe('#165 part 1 — every executor wrapper forwards every argument it declares', () => {
  /* THE ANTI-VACUOUS PIN, and it comes first on purpose. Every assertion below
     is a loop over what the reader found. If a rename or a move ever makes the
     reader find NOTHING — the interface renamed, the literal no longer bound to
     `exec` — those loops iterate zero times and pass, and this whole file
     becomes a green that means nothing. So the discovery is asserted before
     anything is asserted about it, and both sides are checked against the
     interface's own member count rather than a number typed in here. */
  it('the reader finds the interface and the literal, and understands every member', () => {
    const { arities, members } = declaredArities()
    const { wrappers, properties } = wrapperShapes()

    expect(members).toBeGreaterThan(0)
    expect(properties).toBeGreaterThan(0)
    /* every member is a method this reader understood — a `foo: (a) => string`
       property signature would slip past `isMethodSignature` and silently shrink
       the set being checked */
    expect(arities.size).toBe(members)
    /* and every property of the literal is a function this reader understood */
    expect(wrappers.size).toBe(properties)
    /* the two sides describe the same surface */
    expect(wrappers.size).toBe(arities.size)
  })

  it('no wrapper declares fewer parameters than its interface method', () => {
    const { arities } = declaredArities()
    const { wrappers } = wrapperShapes()

    const short: string[] = []
    for (const [name, declared] of arities) {
      const w = wrappers.get(name)
      if (!w) {
        short.push(`${name}: declared on ToolExecutor but absent from the exec literal`)
        continue
      }
      /* a rest element forwards whatever arrives, so it cannot drop an argument */
      if (!w.rest && w.params.length < declared) {
        short.push(`${name}: wrapper takes ${w.params.length}, interface declares ${declared}`)
      }
    }
    expect(short).toEqual([])
  })

  it('no wrapper accepts a parameter it then never uses', () => {
    const { wrappers } = wrapperShapes()

    /* the other half of the hole: a wrapper can declare all seven and still drop
       the last one at the call. Declaring an argument is not forwarding it, and
       the arity check above cannot see the difference. */
    const dropped: string[] = []
    for (const [name, w] of wrappers) {
      for (const p of w.params) {
        if (!w.used.has(p)) dropped.push(`${name}: parameter "${p}" is never used in the body`)
      }
    }
    expect(dropped).toEqual([])
  })
})
