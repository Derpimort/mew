import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  METRICS,
  BUDGETS,
  rateMetric,
  evaluate,
  extractMetrics,
  formatValue,
  formatReport,
} from '../check-lighthouse.mjs'

// A Lighthouse result (LHR) shaped like the real thing — only the audits the
// reporter reads, each comfortably within budget.
function healthyLhr() {
  return {
    audits: {
      'first-contentful-paint': { numericValue: 900 },
      'largest-contentful-paint': { numericValue: 1600 },
      'cumulative-layout-shift': { numericValue: 0.02 },
      // an unrelated audit the reporter must ignore
      'speed-index': { numericValue: 1200 },
    },
  }
}

const byId = (id: string) => METRICS.find((m) => m.id === id)!

describe('core-web-vitals reporter policy', () => {
  it('extracts only the tracked metrics out of an LHR (ignores other audits)', () => {
    const values = extractMetrics(healthyLhr())
    expect(values).toEqual({
      'first-contentful-paint': 900,
      'largest-contentful-paint': 1600,
      'cumulative-layout-shift': 0.02,
    })
  })

  it('passes a healthy run — every metric measured and within budget', () => {
    const result = evaluate(extractMetrics(healthyLhr()))
    expect(result.ok).toBe(true) // all metrics present
    expect(result.warnings).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.metrics.every((m) => !m.over && !m.missing)).toBe(true)
  })

  it('flags FCP over budget as a warning but stays warn-only (ok reflects data, not budget)', () => {
    // Acceptance: a regression shows up as an FCP delta in the check. FCP budget
    // is 1800ms; push past it and the metric is marked over — yet ok stays true,
    // because over-budget is a warning, not a failure.
    const lhr = healthyLhr()
    lhr.audits['first-contentful-paint'].numericValue = 1920 // +120ms past budget
    const result = evaluate(extractMetrics(lhr))

    const fcp = result.metrics.find((m) => m.id === 'first-contentful-paint')!
    expect(fcp.over).toBe(true)
    expect(result.warnings.some((w) => w.startsWith('FCP'))).toBe(true)
    expect(result.ok).toBe(true) // warn-only: a budget miss never flips ok
  })

  it('flags LCP and CLS over their budgets independently', () => {
    const lhr = healthyLhr()
    lhr.audits['largest-contentful-paint'].numericValue = 3000 // > 2500
    lhr.audits['cumulative-layout-shift'].numericValue = 0.25 // > 0.1
    const result = evaluate(extractMetrics(lhr))
    expect(result.metrics.find((m) => m.id === 'largest-contentful-paint')!.over).toBe(true)
    expect(result.metrics.find((m) => m.id === 'cumulative-layout-shift')!.over).toBe(true)
    expect(result.warnings.length).toBe(2)
    expect(result.ok).toBe(true)
  })

  it('treats a value exactly at the budget as within budget (boundary)', () => {
    expect(rateMetric(byId('first-contentful-paint'), 1800).over).toBe(false)
    expect(rateMetric(byId('first-contentful-paint'), 1801).over).toBe(true)
    expect(rateMetric(byId('cumulative-layout-shift'), 0.1).over).toBe(false)
  })

  it('reports a metric the LHR did not provide as missing (never as over budget)', () => {
    const lhr = healthyLhr()
    delete (lhr.audits as Record<string, unknown>)['largest-contentful-paint']
    const result = evaluate(extractMetrics(lhr))
    const lcp = result.metrics.find((m) => m.id === 'largest-contentful-paint')!
    expect(lcp.missing).toBe(true)
    expect(lcp.over).toBe(false)
    expect(result.missing).toContain('LCP')
    expect(result.ok).toBe(false) // incomplete data is the one thing that's not ok
  })

  it('formats paints as whole ms and CLS as a 3-decimal score', () => {
    expect(formatValue(917.4, 'ms')).toBe('917 ms')
    expect(formatValue(0.0234, 'score')).toBe('0.023')
    expect(formatValue(undefined, 'ms')).toBe('n/a')
  })

  it('renders a markdown table with a row per metric and a within-budget footer', () => {
    const report = formatReport(evaluate(extractMetrics(healthyLhr())))
    expect(report).toContain('### Core Web Vitals (Lighthouse)')
    expect(report).toContain('| | metric | measured | budget |')
    expect(report).toContain('**FCP**')
    expect(report).toContain('**LCP**')
    expect(report).toContain('**CLS**')
    expect(report).toContain('All Core Web Vitals within budget')
  })

  it('footer points at the merge policy when a metric is over budget', () => {
    const lhr = healthyLhr()
    lhr.audits['first-contentful-paint'].numericValue = 5000
    const report = formatReport(evaluate(extractMetrics(lhr)))
    expect(report).toContain('Warn-only')
    expect(report).toContain('docs/PERFORMANCE.md')
  })

  it('keeps the documented Core Web Vitals "good" budgets (web.dev thresholds)', () => {
    expect(BUDGETS['first-contentful-paint']).toBe(1800)
    expect(BUDGETS['largest-contentful-paint']).toBe(2500)
    expect(BUDGETS['cumulative-layout-shift']).toBe(0.1)
  })

  it('stays in lockstep with lighthouserc.json (same warn thresholds)', () => {
    // The config asserts the same numbers lhci warns on; the script renders the
    // table. If one moves without the other, the warn line and the report drift.
    const rcPath = path.resolve(fileURLToPath(import.meta.url), '../../../../lighthouserc.json')
    const rc = JSON.parse(readFileSync(rcPath, 'utf8'))
    const assertions = rc.ci.assert.assertions
    for (const m of METRICS) {
      const [level, opts] = assertions[m.id]
      expect(level).toBe('warn') // warn-only first pass
      expect(opts.maxNumericValue).toBe(m.budget)
    }
  })
})
