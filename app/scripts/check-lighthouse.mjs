/* Core Web Vitals reporter (issue #187). Reads the Lighthouse-CI run output
   from .lighthouseci/ — the LHR JSON `lhci autorun` writes after auditing the
   built web preview — pulls the three field metrics MEW cares about (FCP / LCP /
   CLS), rates each against its budget, and renders a markdown table for the PR /
   GitHub-Actions job summary.

   FCP tracks bundle size (how fast first paint arrives), LCP tracks the
   aurora/companion render, CLS tracks layout stability. Budgets are the web.dev
   Core Web Vitals "good" thresholds and are the single source of truth here;
   lighthouserc.json carries the same numbers as lhci's own warn assertions, and
   scripts/__tests__/check-lighthouse.test.ts pins the two together.

   WARN-ONLY by design (the issue asks for no hard block at first): an over-budget
   metric is marked in the table and printed as a warning, but the script still
   exits 0. The upgrade-to-blocking path is documented in docs/PERFORMANCE.md.

   Usage: node scripts/check-lighthouse.mjs [lhciDir]   (default: ../.lighthouseci
           — repo-root .lighthouseci from app/; pass an explicit dir otherwise)
   Exit 0 = report produced (even with warnings), 2 = no LHR found (run lhci first).

   The pure pieces (BUDGETS, rateMetric, evaluate, extractMetrics, formatReport)
   are exported so the test can exercise the policy without a real Lighthouse run.
   No filesystem, no process in any of them. */

import { readFileSync, readdirSync, existsSync, statSync, appendFileSync } from 'node:fs'
import path from 'node:path'

// The three Core Web Vitals MEW tracks. `id` is the Lighthouse audit key; `unit`
// drives formatting (ms vs the unitless CLS score). `budget` is the "good"
// threshold from web.dev/vitals — the warn line. `lower` notes that smaller is
// better for all three (kept explicit so the rating never inverts by accident).
export const METRICS = [
  {
    id: 'first-contentful-paint',
    label: 'FCP',
    name: 'First Contentful Paint',
    unit: 'ms',
    budget: 1800,
    lower: true,
  },
  {
    id: 'largest-contentful-paint',
    label: 'LCP',
    name: 'Largest Contentful Paint',
    unit: 'ms',
    budget: 2500,
    lower: true,
  },
  {
    id: 'cumulative-layout-shift',
    label: 'CLS',
    name: 'Cumulative Layout Shift',
    unit: 'score',
    budget: 0.1,
    lower: true,
  },
]

/** Budget map keyed by audit id — the same numbers lighthouserc.json asserts on.
 *  Exported so the test can pin them to the config. */
export const BUDGETS = Object.fromEntries(METRICS.map((m) => [m.id, m.budget]))

/** Format a metric value for display: paints to whole ms, CLS to 3 decimals. */
export function formatValue(value, unit) {
  if (value == null || Number.isNaN(value)) return 'n/a'
  return unit === 'ms' ? `${Math.round(value)} ms` : value.toFixed(3)
}

/** Rate one metric value against its budget. `lower` metrics (all of ours) are
 *  over budget when the value exceeds the budget. A missing value is reported
 *  but never counted as over (we can't fail on a number we don't have). */
export function rateMetric(metric, value) {
  const has = value != null && !Number.isNaN(value)
  const over = has && metric.lower ? value > metric.budget : false
  return {
    id: metric.id,
    label: metric.label,
    name: metric.name,
    unit: metric.unit,
    value: has ? value : null,
    budget: metric.budget,
    over,
    missing: !has,
  }
}

/** Pure policy: given a `{ auditId: numericValue }` map, rate every tracked
 *  metric and return the rated list plus the set of over-budget warnings.
 *  `warnings` (not `failures`) and `ok` reflecting only "did we get the data"
 *  encode the warn-only contract: an over-budget metric is a warning, not a
 *  reason to fail. */
export function evaluate(values, metrics = METRICS) {
  const rated = metrics.map((m) => rateMetric(m, values[m.id]))
  const warnings = []
  for (const r of rated) {
    if (r.over) {
      warnings.push(
        `${r.label} (${r.name}) is ${formatValue(r.value, r.unit)} — over the ${formatValue(r.budget, r.unit)} budget.`
      )
    }
  }
  const missing = rated.filter((r) => r.missing).map((r) => r.label)
  return {
    metrics: rated,
    warnings,
    missing,
    // "ok" = we measured every metric (data completeness), independent of
    // whether any is over budget — this stays warn-only.
    ok: missing.length === 0,
  }
}

/** Pull the tracked metrics' numericValues out of a Lighthouse result (LHR).
 *  Returns a `{ auditId: numericValue }` map; a metric absent from the LHR is
 *  simply omitted (rated as missing downstream). Pure — takes the parsed LHR. */
export function extractMetrics(lhr, metrics = METRICS) {
  const audits = (lhr && lhr.audits) || {}
  const out = {}
  for (const m of metrics) {
    const audit = audits[m.id]
    if (audit && typeof audit.numericValue === 'number') out[m.id] = audit.numericValue
  }
  return out
}

/** Markdown report (one row per metric) for the PR / job summary. */
export function formatReport(result) {
  const rows = result.metrics.map((m) => {
    const mark = m.missing ? '⚪' : m.over ? '🟠' : '✅'
    return `| ${mark} | **${m.label}** ${m.name} | ${formatValue(m.value, m.unit)} | ${formatValue(m.budget, m.unit)} |`
  })
  const footer = result.missing.length
    ? `_No data for ${result.missing.join(', ')} — check the Lighthouse run._`
    : result.warnings.length
      ? '_Over budget on the metric(s) above. **Warn-only** for now — see `docs/PERFORMANCE.md` for the merge policy and the path to making these block._'
      : '_All Core Web Vitals within budget._'
  return [
    '### Core Web Vitals (Lighthouse)',
    '',
    '| | metric | measured | budget |',
    '| --- | --- | ---: | ---: |',
    ...rows,
    '',
    footer,
  ].join('\n')
}

/** Read the representative Lighthouse result from an .lighthouseci/ directory.
 *  lhci writes one lhr-<ms>.json per run plus a manifest.json marking the
 *  representative (median) run; prefer that, else fall back to the newest
 *  lhr-*.json. Returns the parsed LHR object. Throws if none is found. */
export function readLatestLhr(lhciDir) {
  if (!existsSync(lhciDir)) {
    throw new Error(
      `no Lighthouse output at ${lhciDir} — run lhci (the workflow does \`lhci autorun\`) first.`
    )
  }
  // Prefer the manifest's representative run (the median lhci would assert on).
  const manifestPath = path.join(lhciDir, 'manifest.json')
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const rep =
        Array.isArray(manifest) && (manifest.find((e) => e.isRepresentativeRun) || manifest[0])
      if (rep && rep.jsonPath && existsSync(rep.jsonPath)) {
        return JSON.parse(readFileSync(rep.jsonPath, 'utf8'))
      }
    } catch {
      /* fall through to the newest lhr-*.json */
    }
  }
  const lhrs = readdirSync(lhciDir)
    .filter((f) => f.startsWith('lhr-') && f.endsWith('.json'))
    .map((f) => path.join(lhciDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (!lhrs.length) {
    throw new Error(`no lhr-*.json in ${lhciDir} — the Lighthouse run produced no report.`)
  }
  return JSON.parse(readFileSync(lhrs[0], 'utf8'))
}

// ---- CLI ----------------------------------------------------------------
// Run only when invoked directly, so importing the pure helpers in a test
// doesn't read the filesystem or exit.
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)

if (invokedDirectly) {
  // Default to repo-root .lighthouseci (this script runs from app/).
  const lhciDir = path.resolve(process.argv[2] ?? path.join('..', '.lighthouseci'))
  let lhr
  try {
    lhr = readLatestLhr(lhciDir)
  } catch (err) {
    console.error(`check-lighthouse: ${err.message}`)
    process.exit(2)
  }

  const result = evaluate(extractMetrics(lhr))
  const report = formatReport(result)
  console.log(report)

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n')
  }

  // Warn-only: surface over-budget metrics as GitHub Actions warnings (and plain
  // stderr locally), but never exit non-zero on a budget miss. Only a complete
  // absence of data (handled above as exit 2) is a hard problem.
  for (const line of result.warnings) {
    console.error(
      process.env.GITHUB_ACTIONS ? `::warning title=Core Web Vitals::${line}` : `warning: ${line}`
    )
  }
  if (result.warnings.length) {
    console.log(
      '\ncheck-lighthouse: within data, some metrics over budget (warn-only — not blocking).'
    )
  } else {
    console.log('\ncheck-lighthouse: OK')
  }
}
