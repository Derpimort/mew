/* Guards the lint/format tooling contract (#165). These configs are load-bearing:
   the pre-commit hook and the lint CI gate both read them, and a silent edit
   (e.g. flipping `semi` and churning the whole tree, or dropping the eslint step
   from lint-staged) would slip past every other gate. So we pin the invariants
   that matter here, in the suite the gates already run. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// app/ root — two levels up from src/__tests__/
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const readJson = (rel: string) => JSON.parse(readFileSync(resolve(appRoot, rel), 'utf8'))
const readText = (rel: string) => readFileSync(resolve(appRoot, rel), 'utf8')

describe('Prettier config (.prettierrc.json)', () => {
  const prettier = readJson('.prettierrc.json')

  it('encodes the house style the codebase already uses', () => {
    expect(prettier.singleQuote).toBe(true)
    expect(prettier.trailingComma).toBe('es5')
    expect(prettier.printWidth).toBe(100)
  })

  it('keeps semicolons off — the codebase is no-semi; flipping this churns every file', () => {
    expect(prettier.semi).toBe(false)
  })
})

describe('Prettier ignore (.prettierignore)', () => {
  const ignore = readText('.prettierignore')

  it('excludes build output and the pnpm-owned lockfile so they are never reformatted', () => {
    for (const path of ['dist', 'node_modules', 'shots', 'pnpm-lock.yaml']) {
      expect(ignore).toContain(path)
    }
  })
})

describe('lint-staged config (.lintstagedrc.json)', () => {
  const staged = readJson('.lintstagedrc.json')

  it('runs eslint --fix then prettier --write on staged TS/TSX, in that order', () => {
    expect(staged['*.{ts,tsx}']).toEqual(['eslint --fix', 'prettier --write'])
  })

  it('formats other staged sources with prettier but does not lint them', () => {
    const others = staged['*.{js,mjs,cjs,json,css,html,md}']
    expect(others).toEqual(['prettier --write'])
  })
})

describe('package.json scripts', () => {
  const pkg = readJson('package.json')

  it('exposes lint, format, and format:check for CI and local fix-all', () => {
    expect(pkg.scripts.lint).toBe('eslint .')
    expect(pkg.scripts.format).toBe('prettier . --write')
    expect(pkg.scripts['format:check']).toBe('prettier . --check')
  })

  it('installs husky hooks via prepare (resolves git root from app/)', () => {
    expect(pkg.scripts.prepare).toContain('husky')
  })

  it('declares the tooling as devDependencies', () => {
    for (const dep of ['prettier', 'husky', 'lint-staged']) {
      expect(pkg.devDependencies).toHaveProperty(dep)
    }
  })
})
