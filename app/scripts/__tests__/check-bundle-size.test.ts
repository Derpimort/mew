import { describe, expect, it } from 'vitest'
import { BUDGETS, categorize, evaluate, eagerFiles, formatReport } from '../check-bundle-size.mjs'

const KB = 1024

// A chunk set that mirrors a healthy build, each comfortably under budget.
function healthyChunks() {
  return [
    { file: 'assets/index-x.js', name: 'index', isEntry: true, bytes: 360 * KB },
    { file: 'assets/vendor-x.js', name: 'vendor', isEntry: false, bytes: 280 * KB },
    { file: 'assets/three-x.js', name: 'three', isEntry: false, bytes: 850 * KB },
    { file: 'assets/ai-x.js', name: 'ai', isEntry: false, bytes: 470 * KB },
    { file: 'assets/aiAdapter-x.js', name: 'aiAdapter', isEntry: false, bytes: 13 * KB },
  ]
}

describe('bundle-size budget policy', () => {
  it('sorts chunks into categories by manifest role + name', () => {
    expect(categorize({ isEntry: true, name: 'index' })).toBe('main')
    expect(categorize({ isEntry: false, name: 'vendor' })).toBe('vendor')
    expect(categorize({ isEntry: false, name: 'three' })).toBe('three')
    expect(categorize({ isEntry: false, name: 'ai' })).toBe('ai')
    expect(categorize({ isEntry: false, name: 'aurora-blur' })).toBe('lazy')
  })

  it('passes a healthy build (every chunk + total within budget)', () => {
    const result = evaluate(healthyChunks())
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.totalOver).toBe(false)
  })

  it('fails when the main chunk regresses by 50KB past its budget (acceptance: a +50KB main regression fails)', () => {
    // main budget is 450KB; sit at 410KB so a +50KB regression lands at 460KB.
    const chunks = healthyChunks()
    chunks[0].bytes = 410 * KB
    expect(evaluate(chunks).ok).toBe(true) // baseline within budget

    chunks[0].bytes += 50 * KB // the regression
    const regressed = evaluate(chunks)
    expect(regressed.ok).toBe(false)
    expect(regressed.failures.some((f) => f.includes('assets/index-x.js') && f.includes('main'))).toBe(true)
  })

  it('flags an oversized lazy chunk against the strict 300KB default', () => {
    const chunks = healthyChunks()
    chunks.push({ file: 'assets/huge-lazy.js', name: 'huge-lazy', isEntry: false, bytes: 320 * KB })
    const result = evaluate(chunks)
    expect(result.ok).toBe(false)
    expect(result.failures.some((f) => f.includes('huge-lazy') && f.includes('lazy'))).toBe(true)
  })

  it('fails when the total exceeds the total budget even if every chunk is individually fine', () => {
    // Many medium lazy chunks, each under 300KB, summing past the 2300KB total.
    const chunks = Array.from({ length: 10 }, (_, i) => ({
      file: `assets/part-${i}.js`,
      name: `part-${i}`,
      isEntry: i === 0,
      bytes: 250 * KB,
    }))
    const result = evaluate(chunks)
    expect(result.chunks.every((c) => !c.over)).toBe(true) // no single chunk over
    expect(result.totalOver).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.failures.some((f) => f.includes('total'))).toBe(true)
  })

  it('keeps the documented budget caps (CONTRIBUTING.md contract)', () => {
    expect(BUDGETS.main).toBe(450 * KB)
    expect(BUDGETS.firstLoad).toBe(1200 * KB)
    expect(BUDGETS.total).toBe(2300 * KB)
  })

  it('counts only main + vendor toward first-load by default (three/ai are lazy)', () => {
    const result = evaluate(healthyChunks())
    // 360 (main) + 280 (vendor) = 640KB; three/ai excluded
    expect(result.firstLoadBytes).toBe(640 * KB)
    expect(result.firstLoadOver).toBe(false)
  })

  it('fails when eager (first-load) JS exceeds the 1.2MB budget', () => {
    // Spread the eager weight across chunks each under its own per-chunk cap, so
    // only the first-load *sum* is what trips — proving that budget is real.
    const eager = [
      { file: 'a.js', name: 'index', isEntry: true, bytes: 440 * KB }, // < 450 main
      { file: 'b.js', name: 'vendor', isEntry: false, bytes: 330 * KB }, // < 340 vendor
      { file: 'c.js', name: 'shared', isEntry: false, bytes: 290 * KB }, // < 300 lazy
    ]
    const allEager = new Set(['a.js', 'b.js', 'c.js'])
    // 440 + 330 + 290 = 1060KB, still under 1200
    expect(evaluate(eager, BUDGETS, allEager).firstLoadOver).toBe(false)

    // one more eager chunk pushes the first-load sum past 1.2MB
    eager.push({ file: 'd.js', name: 'shared2', isEntry: false, bytes: 290 * KB })
    allEager.add('d.js')
    const result = evaluate(eager, BUDGETS, allEager)
    expect(result.chunks.every((c) => !c.over)).toBe(true) // no single chunk over its cap
    expect(result.firstLoadOver).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.failures.some((f) => f.includes('first-load'))).toBe(true)
  })

  it('derives the eager set from a Vite manifest (entry + static imports, not dynamicImports)', () => {
    const manifest = {
      'index.html': {
        file: 'assets/index.js',
        name: 'index',
        isEntry: true,
        imports: ['_vendor.js'],
        dynamicImports: ['src/lazy.tsx'],
      },
      '_vendor.js': { file: 'assets/vendor.js', name: 'vendor' },
      'src/lazy.tsx': { file: 'assets/lazy.js', name: 'lazy', isDynamicEntry: true },
    }
    const eager = eagerFiles(manifest)
    expect(eager.has('assets/index.js')).toBe(true)
    expect(eager.has('assets/vendor.js')).toBe(true) // static import → eager
    expect(eager.has('assets/lazy.js')).toBe(false) // dynamic import → lazy
  })

  it('renders a markdown report with a row per chunk plus first-load and total lines', () => {
    const report = formatReport(evaluate(healthyChunks()))
    expect(report).toContain('### Bundle size budget')
    expect(report).toContain('| | chunk | category | size | budget |')
    expect(report).toContain('first load')
    expect(report).toContain('**total**')
    expect(report).toContain('Within budget')
  })
})
