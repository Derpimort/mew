# Performance — Core Web Vitals in CI

**Status:** shipped · for #187 · part of the v0.2 industry-alignment batch.
**In one line:** every PR runs Lighthouse against the built web preview and reports **FCP / LCP / CLS**; the budgets are **warn-only for now** (they show up, they don't block) with a documented path to making them block once a stable CI baseline exists.

---

## Why these three metrics

MEW's first impression is its first paint, and three [Core Web Vitals](https://web.dev/vitals/) bound it — each tied to a real part of MEW's architecture, so a regression in one points at a specific cause:

| Metric | What it measures | What it tracks in MEW |
|---|---|---|
| **FCP** — First Contentful Paint | time to first pixel of content | **bundle size** — the entry chunk the browser must download before anything renders. Guarded alongside the bundle-size budget (#177). |
| **LCP** — Largest Contentful Paint | time to the largest element painted | the **companion / aurora render** — the WebGL blob and aurora layer are the heaviest visual, and they're code-split lazy for exactly this reason. |
| **CLS** — Cumulative Layout Shift | how much layout jumps after paint | **layout stability** — fonts are self-hosted and preloaded (`app/index.html`) precisely so late-arriving faces don't reflow the week. |

## How it runs

- **Config:** [`lighthouserc.json`](../lighthouserc.json) at the repo root. `lhci autorun` builds nothing itself — the workflow runs `pnpm --dir app build` first — then starts `vite preview` on `:4173`, audits it **three times** (median, because single paint timings are noisy), asserts the warn budgets, and writes the raw LHRs to `.lighthouseci/`.
- **Workflow:** [`.github/workflows/lighthouse.yml`](../.github/workflows/lighthouse.yml) — a **separate** workflow, not the `desktop.yml` check job, on purpose: this is a web-preview perf measurement, independent of the Rust/Tauri build, and is allowed to be slower and non-blocking without holding up the release gate. lhci runs via ephemeral `npx @lhci/cli` (no dependency added to `app/package.json`, the same pattern `ui-overlap.yml` uses for playwright).
- **Report:** [`app/scripts/check-lighthouse.mjs`](../app/scripts/check-lighthouse.mjs) reads the representative run's LHR, pulls the three metrics, rates each against its budget, and renders a markdown table to the **GitHub Actions job summary** — marked ✅ within budget, 🟠 over, ⚪ no data. The raw LHRs are also uploaded as the `lighthouse-reports` build artifact for trend-tracking. Its pure policy is unit-tested in [`app/scripts/__tests__/check-lighthouse.test.ts`](../app/scripts/__tests__/check-lighthouse.test.ts).

Nothing is uploaded to a public LHCI server — in keeping with MEW's local-first, nothing-leaves-the-device stance, the reports stay as CI artifacts on the repo.

## Budgets

The warn line is the web.dev Core Web Vitals **"good"** threshold for each metric. These numbers live in **two** places kept in lockstep by a test: the `assert.assertions` in `lighthouserc.json` (what lhci warns on) and the `METRICS`/`BUDGETS` in `check-lighthouse.mjs` (what the table rates against).

| Metric | Budget (warn) | Aspirational |
|---|---|---|
| FCP | **≤ 1800 ms** | < 1000 ms |
| LCP | **≤ 2500 ms** | < 2000 ms |
| CLS | **≤ 0.1** | < 0.05 |

The aspirational column is the bar to tighten toward once a CI baseline is established (the original #187 ask floated FCP < 1s); the "good" thresholds are the honest starting line that won't drown the signal in noise on day one.

## Merge policy

While the budgets are warn-only, the human judgment is the gate:

> **Merging a PR that increases FCP by > 200 ms or LCP by > 300 ms (vs. the metric on `main`) requires a justification and a perf-improvement plan in the PR description.** The default answer to "a vital regressed" is to lazy-load, split, or defer the cost — not to accept the regression. CLS should not regress at all; a layout jump is almost always a fixable missing dimension or a late style.

This mirrors the bundle-size budget's stance (#177): the cheap default is to keep first paint lean; growing the cost is a deliberate, written decision.

## Making it block (the next step)

Warn-only is the first pass, on purpose — CI paint timings vary run-to-run, and a brand-new check that blocks on its first noisy median teaches people to ignore it. To turn the budgets into a hard gate once a stable baseline exists:

1. Capture a baseline: let the workflow run on a few merged PRs and read the medians off the job summaries / uploaded LHRs.
2. Set realistic block thresholds from that baseline (a little above the observed median, not the theoretical "good" line if the app isn't there yet).
3. Flip the assertions in `lighthouserc.json` from `"warn"` to `"error"` (and update `BUDGETS` + this table to match — the lockstep test enforces they move together), and drop the `|| true` after `lhci autorun` in the workflow so a budget miss fails the job.
4. Keep the metric table; it stays useful as the at-a-glance summary whether the check warns or blocks.
