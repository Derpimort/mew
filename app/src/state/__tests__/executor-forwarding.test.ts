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
function declaredArities(): {
  arities: Map<string, number>
  members: number
  objectArg: Set<string>
} {
  const arities = new Map<string, number>()
  /* methods converted to a single named options object (#165): exactly one
     parameter whose type is a `…Args` reference. Read from the TYPE rather than
     the parameter's name, so a method converts into this set the moment its
     signature does, with nobody remembering to list it here. */
  const objectArg = new Set<string>()
  let members = 0
  const walk = (n: ts.Node): void => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === 'ToolExecutor') {
      members = n.members.length
      for (const m of n.members) {
        if (ts.isMethodSignature(m) && m.name) {
          const name = m.name.getText()
          arities.set(name, m.parameters.length)
          /* SHAPE, NOT NAME (coderpa's finding on the first pass). This used to
             require the type to be called `…Args`, so a method converted under
             any other name escaped the check silently — and the anti-vacuous
             guard could not see it, because the other converted methods kept
             the set non-empty. With 23 conversions coming, a naming convention
             is the wrong thing to hang the set on. Any method taking exactly
             ONE parameter qualifies: the single-primitive ones (capture, clear,
             analyze) already forward their argument straight through, so the
             rule costs them nothing and cannot be escaped by a rename. */
          if (m.parameters.length === 1) objectArg.add(name)
        }
      }
    }
    n.forEachChild(walk)
  }
  walk(parse(TYPES))
  return { arities, members, objectArg }
}

/* WHAT THIS FILE COVERS, AND WHERE IT STOPS (#183). Three seams exist between a
   model's tool call and the store, and the clauses below hold two of them:

     1. interface -> wrapper      the wrapper declares every parameter  (clause 2)
     2. wrapper   -> exec*        it passes the options object WHOLE    (clause 3)
     3. exec*     -> exec*        an adapter rebuilds a DIFFERENT shape (clause 5)

   Seam 3 is the one #183 filed. `execResize` takes `ResizeArgs` and calls
   `execEdit` with an `EditArgs` it builds by hand — a legitimate adapter, because
   the two types are different shapes and "forward it whole" is not available to
   it. But it is the #165 hazard one layer in: add an optional field to
   `ResizeArgs`, forget it at that call, and `tsc` exits 0 while clause 3 never
   looks inside an `exec*`. Clause 5 closes it by a weaker but available rule —
   every field of the caller's own options type must be READ somewhere in its
   body. Reading is not forwarding, and the gap between them is stated in the
   clause itself.

   STILL NOT COVERED, deliberately: whether a field that IS read reaches the right
   place, whether the adapter's TARGET type is complete, and anything the model
   passes that the interface never declared. The first two are what a reviewer
   reads a diff for; the third is the parser's problem, not the executor's. */
interface Wrapper {
  params: string[]
  /** the arguments of every `exec*(…)` call in the body, as written */
  execArgs: string[][]
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
        const execArgs: string[][] = []
        const calls = (x: ts.Node): void => {
          if (
            ts.isCallExpression(x) &&
            ts.isIdentifier(x.expression) &&
            /^exec[A-Z]/.test(x.expression.text)
          )
            execArgs.push(x.arguments.map((a) => a.getText()))
          x.forEachChild(calls)
        }
        calls(fn.body)
        wrappers.set(p.name.getText(), {
          params: fn.parameters.map((x) => x.name.getText()),
          rest: fn.parameters.some((x) => !!x.dotDotDotToken),
          used,
          execArgs,
        })
      }
    }
    n.forEachChild(walk)
  }
  walk(parse(STORE))
  return { wrappers, properties }
}

/** every `…Args` interface declared in types.ts, with the fields it declares.
    Read from the TYPE, so a field added there is watched the moment it exists. */
function argsFields(): Map<string, string[]> {
  const fields = new Map<string, string[]>()
  const walk = (n: ts.Node): void => {
    if (ts.isInterfaceDeclaration(n) && /Args$/.test(n.name.text))
      fields.set(
        n.name.text,
        n.members.filter(ts.isPropertySignature).map((m) => m.name.getText())
      )
    n.forEachChild(walk)
  }
  walk(parse(TYPES))
  return fields
}

interface ArgsConsumer {
  /** the `…Args` type this exec* takes as its single options object */
  type: string
  /** fields of that type the body reads, through the parameter or any alias */
  read: Set<string>
  /** the object left whole — spread, or handed to a callee — so nothing here can
      drop a field and the field-by-field rule has no subject */
  whole: boolean
}

/** every `function exec*(args: SomeArgs)` in store.ts, with the fields it reads.
 *
 *  FOLLOWING ALIASES IS WHAT MAKES THIS SOUND, and it is not a refinement — it is
 *  the difference between a pin and a false alarm. Three functions here take the
 *  object and immediately re-type it: `const opts: { at?: string; … } = args`,
 *  then read `opts.at`. A reader that only watches the PARAMETER's name sees
 *  `execRemove` read one field of five and reports four dropped. Measured on this
 *  tree before the aliases were followed: execRemove, execSplit and execDuplicate
 *  all read as defective and NONE of them is. So the alias set starts at the
 *  parameter and grows to a fixpoint over `const x = <alias>`. */
function argsConsumers(fields: Map<string, string[]>): Map<string, ArgsConsumer> {
  const consumers = new Map<string, ArgsConsumer>()
  const walk = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name && /^exec[A-Z]/.test(n.name.text) && n.body) {
      const type = n.parameters[0]?.type?.getText()
      if (type && fields.has(type)) {
        const param = n.parameters[0].name.getText()
        const aliases = new Set([param])
        for (let before = -1; before !== aliases.size;) {
          before = aliases.size
          const grow = (x: ts.Node): void => {
            if (
              ts.isVariableDeclaration(x) &&
              x.initializer &&
              ts.isIdentifier(x.name) &&
              aliases.has(x.initializer.getText())
            )
              aliases.add(x.name.getText())
            x.forEachChild(grow)
          }
          grow(n.body)
        }
        const read = new Set<string>()
        let whole = false
        const collect = (x: ts.Node): void => {
          /* `const { a, b } = args` reads a and b; `...rest` takes the remainder */
          if (
            ts.isVariableDeclaration(x) &&
            x.initializer &&
            aliases.has(x.initializer.getText()) &&
            ts.isObjectBindingPattern(x.name)
          )
            for (const el of x.name.elements) {
              if (el.dotDotDotToken) whole = true
              else read.add((el.propertyName ?? el.name).getText())
            }
          /* `args.at` / `opts.at` */
          if (ts.isPropertyAccessExpression(x) && aliases.has(x.expression.getText()))
            read.add(x.name.getText())
          /* `{ ...args }` and `f(...args)` carry every field */
          if (ts.isSpreadAssignment(x) && aliases.has(x.expression.getText())) whole = true
          if (ts.isSpreadElement(x) && aliases.has(x.expression.getText())) whole = true
          /* `f(args)` hands the object on entire — that IS forwarding whole */
          if (ts.isCallExpression(x) && x.arguments.some((a) => aliases.has(a.getText())))
            whole = true
          x.forEachChild(collect)
        }
        collect(n.body)
        consumers.set(n.name.text, { type, read, whole })
      }
    }
    n.forEachChild(walk)
  }
  walk(parse(STORE))
  return consumers
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

  it('a method taking a named options object forwards it WHOLE', () => {
    /* #165, and this clause is why the refactor does not LOSE protection.
       Converting a method to an options object removes the thing the arity check
       above was watching: there are no longer seven positions to come up short
       on, there is one. And a wrapper that destructures that object and rebuilds
       it can silently drop an OPTIONAL field — measured, not assumed: with
       `execMove({ query: args.query, … })` missing fromDayOffset, `tsc` exits 0
       AND all three checks above pass. The type system does not help either,
       because a missing optional field is not an error (a missing REQUIRED one
       is, TS2345). Every argument this codebase has dropped so far was optional.
       So the guarantee is the forwarding style, and this is what makes it
       mechanical rather than a convention someone remembers: a wrapper whose
       interface method takes a single `…Args` object must pass that identifier
       straight through to the exec* call. Rebuild it and this fails by name. */
    const { arities, members, objectArg } = declaredArities()
    const { wrappers } = wrapperShapes()

    expect(objectArg.size).toBeGreaterThan(0) // the set is read from the interface; an empty one would pass vacuously

    /* AND THE SET MUST COVER EVERY MEMBER, not merely be non-empty. `size > 0`
       was already too weak once tonight: coderpa renamed one converted method's
       options type and the clause stopped watching it while the other three kept
       the set non-empty, so the guard passed with the drop invisible. The same
       weakness in a new dress is a member this rule cannot watch BY
       CONSTRUCTION — anything with two or more parameters, which is where #160
       lived. So account for all 23: every member is either watched (exactly one
       parameter, and this clause proves its wrapper forwards it whole) or takes
       no parameters at all and has nothing to drop. Reads 22 + 1 === 23 today;
       the moment someone adds a two-parameter member it fails NAMING it, which
       is the difference between a guarantee in a PR body and one the suite
       re-proves on every run. */
    const multiParam = [...arities].filter(([, n]) => n > 1).map(([name]) => name)
    expect(multiParam).toEqual([])
    const zeroParam = [...arities].filter(([, n]) => n === 0).length
    expect(objectArg.size + zeroParam).toBe(members)

    const rebuilt: string[] = []
    for (const name of objectArg) {
      const w = wrappers.get(name)
      if (!w) {
        rebuilt.push(`${name}: takes a named object but has no wrapper in the exec literal`)
        continue
      }
      const [param] = w.params
      for (const args of w.execArgs) {
        if (args.length !== 1 || args[0] !== param)
          rebuilt.push(`${name}: forwards (${args.join(', ')}) instead of passing ${param} whole`)
      }
    }
    expect(rebuilt).toEqual([])
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

  it('an exec* that takes an options object reads every field of it (#183)', () => {
    /* THE SEAM CLAUSE 3 CANNOT REACH. Clause 3 proves the wrapper hands the object
       to its exec* whole; it says nothing about what happens next. One exec* takes
       an options object and builds a DIFFERENT one for another exec*:
       `execResize(args: ResizeArgs)` -> `execEdit({ query, patch, at, scope })`.
       Forwarding whole is not available there — the shapes differ on purpose — so
       the available guarantee is weaker and stated as such: EVERY FIELD OF THE
       CALLER'S OWN TYPE MUST BE READ SOMEWHERE IN ITS BODY. Measured: add
       `note?: string` to `ResizeArgs` and leave `execResize` alone and `tsc -b`
       exits 0 while this clause exits 1 naming `ResizeArgs.note`.
       READING IS NOT FORWARDING and the gap is real: a body could read a field and
       then drop it on the floor. What this removes is the silent case — a field
       that arrives, is declared, and is never looked at once. That is the shape
       every argument this codebase has lost so far had. */
    const fields = argsFields()
    const consumers = argsConsumers(fields)

    /* ANTI-VACUOUS, in the shape the rest of this file uses: the sets are read
       from source, so a rename that makes either reader find nothing would turn
       the loop below into a pass. Assert the discovery before asserting anything
       about it — and assert MEMBERSHIP rather than a count, because one declared
       type nobody consumes plus one consumer of a type nobody declares still
       reads equal on both sides. */
    expect(fields.size).toBeGreaterThan(0)
    expect(consumers.size).toBeGreaterThan(0)
    const consumed = new Set([...consumers.values()].map((c) => c.type))
    const unconsumed = [...fields.keys()].filter((t) => !consumed.has(t))
    expect(unconsumed).toEqual([])
    expect(consumed.size).toBe(fields.size)

    /* and a type with no fields would make its own row vacuous */
    const empty = [...consumers].filter(([, c]) => (fields.get(c.type) ?? []).length === 0)
    expect(empty.map(([n]) => n)).toEqual([])

    const unread: string[] = []
    for (const [name, c] of consumers) {
      if (c.whole) continue // the object left entire; nothing can be dropped here
      for (const f of fields.get(c.type) ?? [])
        if (!c.read.has(f)) unread.push(`${name}: ${c.type}.${f} is never read in the body`)
    }
    expect(unread).toEqual([])
  })
})
