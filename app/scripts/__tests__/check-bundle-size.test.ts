import { describe, expect, it } from 'vitest'
import { BUDGETS, categorize, evaluate, eagerFiles, formatReport } from '../check-bundle-size.mjs'

const KB = 1024

// A chunk set that mirrors a healthy build, each comfortably under budget.
function healthyChunks() {
  return [
    { file: 'assets/index-x.js', name: 'index', isEntry: true, bytes: 300 * KB },
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
    expect(categorize({ isEntry: false, name: 'aiAdapter' })).toBe('lazy')
  })

  it('passes a healthy build (every chunk + total within budget)', () => {
    const result = evaluate(healthyChunks())
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.totalOver).toBe(false)
  })

  it('fails when the main chunk regresses by 50KB past its budget (acceptance: a +50KB main regression fails)', () => {
    // main budget is 440KB; sit at 400KB so a +50KB regression lands at 450KB.
    const chunks = healthyChunks()
    chunks[0].bytes = 400 * KB
    expect(evaluate(chunks).ok).toBe(true) // baseline within budget

    chunks[0].bytes += 50 * KB // the regression
    const regressed = evaluate(chunks)
    expect(regressed.ok).toBe(false)
    expect(
      regressed.failures.some((f) => f.includes('assets/index-x.js') && f.includes('main'))
    ).toBe(true)
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
    expect(BUDGETS.main).toBe(440 * KB)
    expect(BUDGETS.firstLoad).toBe(1200 * KB)
    expect(BUDGETS.total).toBe(2300 * KB)
  })

  it('counts only main + vendor toward first-load by default (three/ai are lazy)', () => {
    const result = evaluate(healthyChunks())
    // 300 (main) + 280 (vendor) = 580KB; three/ai excluded
    expect(result.firstLoadBytes).toBe(580 * KB)
    expect(result.firstLoadOver).toBe(false)
  })

  it('fails when eager (first-load) JS exceeds the 1.2MB budget', () => {
    // Spread the eager weight across chunks each under its own cap (the eager app
    // under main, vendor and a statically imported ai chunk under theirs), so only
    // the first-load *sum* is what trips — proving that budget is real.
    const eager = [
      { file: 'a.js', name: 'index', isEntry: true, bytes: 200 * KB }, // main (eager app) < 440
      { file: 'b.js', name: 'vendor', isEntry: false, bytes: 450 * KB }, // < 460 vendor
      { file: 'c.js', name: 'ai', isEntry: false, bytes: 540 * KB }, // < 620 ai
    ]
    const allEager = new Set(['a.js', 'b.js', 'c.js'])
    // 200 + 450 + 540 = 1190KB, still under 1200
    expect(evaluate(eager, BUDGETS, allEager).firstLoadOver).toBe(false)

    // one more small eager chunk pushes the first-load sum past 1.2MB (the eager
    // app becomes 220KB, still well under main)
    eager.push({ file: 'd.js', name: 'shared', isEntry: false, bytes: 20 * KB })
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

/* #80: the entry chunk no longer holds the eager app on its own. Rolldown hoists
   shared eager code into sibling chunks the entry statically imports (Button,
   rules, primitives on the RC), so `main` sums the entry with those siblings. The
   fixture mirrors that shape: a small entry file and a big shared sibling. */
describe('main is the eager app: the entry plus its static non-vendor chunks (#80)', () => {
  const manifest = (button: 'static' | 'dynamic') => ({
    'index.html': {
      file: 'assets/index.js',
      name: 'index',
      isEntry: true,
      imports: ['_vendor.js', '_rules.js', ...(button === 'static' ? ['_Button.js'] : [])],
      dynamicImports: button === 'dynamic' ? ['_Button.js'] : [],
    },
    '_vendor.js': { file: 'assets/vendor.js', name: 'vendor' },
    '_Button.js': { file: 'assets/Button.js', name: 'Button' },
    '_rules.js': { file: 'assets/rules.js', name: 'rules' },
  })
  const chunks = (buttonKB: number) => [
    { file: 'assets/index.js', name: 'index', isEntry: true, bytes: 120 * KB },
    { file: 'assets/vendor.js', name: 'vendor', isEntry: false, bytes: 400 * KB },
    { file: 'assets/Button.js', name: 'Button', isEntry: false, bytes: buttonKB * KB },
    { file: 'assets/rules.js', name: 'rules', isEntry: false, bytes: 80 * KB },
  ]
  const button = { file: 'assets/Button.js', name: 'Button', isEntry: false }

  it('rates a statically imported sibling as main, the same chunk behind a dynamic import as lazy', () => {
    expect(categorize(button, eagerFiles(manifest('static')))).toBe('main')
    expect(categorize(button, eagerFiles(manifest('dynamic')))).toBe('lazy')
    // the named families keep their own budgets even when eager
    expect(
      categorize(
        { file: 'assets/vendor.js', name: 'vendor', isEntry: false },
        eagerFiles(manifest('static'))
      )
    ).toBe('vendor')
  })

  it('fails when a static side chunk pushes the eager app past main, though the entry file is small', () => {
    const result = evaluate(chunks(250), BUDGETS, eagerFiles(manifest('static')))
    // 120 + 250 + 80 = 450KB of eager app; the entry file alone is 120KB and every
    // file sits under the 300KB lazy line, so the old per-file rating passed this
    expect(result.mainBytes).toBe(450 * KB)
    expect(result.mainOver).toBe(true)
    expect(result.ok).toBe(false)
    expect(
      result.failures.some(
        (f) => f.startsWith('main (the eager app:') && f.includes('assets/Button.js 250.0 KB')
      )
    ).toBe(true)
    expect(
      result.chunks
        .filter((c) => c.over)
        .map((c) => c.file)
        .sort()
    ).toEqual(['assets/Button.js', 'assets/index.js', 'assets/rules.js'])
  })

  it('passes the same bytes when the sibling is loaded lazily', () => {
    const result = evaluate(chunks(250), BUDGETS, eagerFiles(manifest('dynamic')))
    expect(result.mainBytes).toBe(200 * KB) // entry + rules; Button left the eager graph
    expect(result.ok).toBe(true)
    expect(result.chunks.find((c) => c.file === 'assets/Button.js')).toMatchObject({
      category: 'lazy',
      over: false,
    })
  })

  it('passes an eager app under the line and reports it as its own row', () => {
    const result = evaluate(chunks(190), BUDGETS, eagerFiles(manifest('static')))
    expect(result.mainBytes).toBe(390 * KB)
    expect(result.ok).toBe(true)
    const report = formatReport(result)
    expect(report).toContain(
      '| ✅ | **main** (entry + its static non-vendor chunks) | | **390.0 KB** | **440.0 KB** |'
    )
    expect(report).toContain('| ✅ | `assets/Button.js` | main | 190.0 KB | in main |')
  })
})
