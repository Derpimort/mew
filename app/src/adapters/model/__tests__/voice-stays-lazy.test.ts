/* #80 headroom: MEW_VOICE, the keyed model's ~15 KB system prompt, is defined
   in ./types beside the shared type definitions, and only the lazy AI adapter
   needs it. A bundler keeps a module's own code together, so one eager binding
   of ANY value ./types itself defines puts the whole prompt back into the
   always-loaded main chunk. That was the RC's +16 KB: the keyless floor read
   CHOICES_POSTED from there. Type bindings erase. A name ./types only passes
   through from another module (CHOICES_POSTED, now from ./choicesPosted) binds
   that module instead, so it costs nothing. Checked on the TypeScript AST, so
   multi-line imports, re-exports and import() all count. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { CHOICES_POSTED as fromTypes } from '../types'
import { CHOICES_POSTED as fromOwnModule } from '../choicesPosted'

const SRC = path.resolve(__dirname, '../../..')
const TYPES = path.join(SRC, 'adapters/model/types')
const LAZY_ADAPTER = path.join(SRC, 'adapters/model/aiAdapter.ts')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [full] : []
  })
}

function pointsAtTypes(file: string, spec: string): boolean {
  const target = spec.startsWith('@/')
    ? path.join(SRC, spec.slice(2))
    : spec.startsWith('.')
      ? path.resolve(path.dirname(file), spec)
      : null
  return target != null && target.replace(/\.tsx?$/, '') === TYPES
}

const parse = (file: string) =>
  ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)

/** the runtime values ./types defines itself, not the names it re-exports */
function ownValueExports(): Set<string> {
  const names = new Set<string>()
  for (const st of parse(`${TYPES}.ts`).statements) {
    const exported =
      ts.canHaveModifiers(st) &&
      (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (exported && ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.add(d.name.text)
      }
    if (
      exported &&
      (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) &&
      st.name
    )
      names.add(st.name.text)
    if (ts.isExportDeclaration(st) && !st.moduleSpecifier && !st.isTypeOnly && st.exportClause)
      if (ts.isNamedExports(st.exportClause))
        for (const e of st.exportClause.elements) if (!e.isTypeOnly) names.add(e.name.text)
  }
  return names
}

/** each edge that binds one of those values (or could): `file:line  statement` */
function valueEdges(file: string, own: Set<string>): string[] {
  const sf = parse(file)
  const edges: string[] = []
  const at = (n: ts.Node) =>
    `${path.relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}  ${n.getText().split('\n')[0]}`
  const takesOwn = (n: ts.ImportDeclaration | ts.ExportDeclaration): boolean => {
    if (ts.isImportDeclaration(n)) {
      const clause = n.importClause
      if (!clause) return true // a bare import runs the module
      if (clause.isTypeOnly) return false
      if (clause.name) return true // a default import
      const b = clause.namedBindings
      if (!b) return false
      if (ts.isNamespaceImport(b)) return true
      return b.elements.some((e) => !e.isTypeOnly && own.has((e.propertyName ?? e.name).text))
    }
    if (n.isTypeOnly) return false
    if (!n.exportClause || !ts.isNamedExports(n.exportClause)) return true // export * from
    return n.exportClause.elements.some(
      (e) => !e.isTypeOnly && own.has((e.propertyName ?? e.name).text)
    )
  }
  const visit = (n: ts.Node) => {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      pointsAtTypes(file, n.moduleSpecifier.text) &&
      takesOwn(n)
    )
      edges.push(at(n))
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0]) &&
      pointsAtTypes(file, n.arguments[0].text)
    )
      edges.push(at(n))
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return edges
}

describe('the system prompt stays in the lazy AI chunk (#80 headroom)', () => {
  it('./types defines the prompt and its context block itself; CHOICES_POSTED only passes through', () => {
    const own = ownValueExports()
    expect(own.has('MEW_VOICE')).toBe(true)
    expect(own.has('contextBlock')).toBe(true)
    expect(own.has('CHOICES_POSTED')).toBe(false)
  })

  /* this case walks the TypeScript AST of every eager module: ~5 s on a loaded runner
     (it hit vitest's 5 s default twice in one night under parallel chains), so it gets
     the room it needs — a real regression fails by assertion, not by the clock */
  it(
    'only the lazy AI adapter binds a value ./types defines; every eager module takes types or pass-throughs',
    { timeout: 20_000 },
    () => {
      const own = ownValueExports()
      const files = sourceFiles(SRC)
      expect(files.length).toBeGreaterThan(100) // the walk really covered src/
      const edges = files.filter((f) => f !== LAZY_ADAPTER).flatMap((f) => valueEdges(f, own))
      expect(edges).toEqual([])
      expect(valueEdges(LAZY_ADAPTER, own).length).toBeGreaterThan(0) // the one sanctioned door
    }
  )

  it('CHOICES_POSTED is one token wherever it is read from', () => {
    expect(fromTypes).toBe(fromOwnModule)
    expect(fromOwnModule).toBe('The options are on screen as clickable chips')
  })
})
