# MEW — `docs/`

Release plans, performance budgets and design spikes. The operating manual is
[`AGENTS.md`](../AGENTS.md); the technical shape is [`ARCHITECTURE.md`](../ARCHITECTURE.md).

> **Most `#NNN` in this directory are `mew-archive` numbers.** MEW was migrated from
> `Derpimort/mew-archive` and these documents kept the predecessor's issue numbers, so a
> citation means `mew-archive#NNN` rather than this repo's issue of that number. This
> repo's own counter has since grown past many of them, so in **six of the seven documents
> below** a citation now answers with a real, live, unrelated issue or pull request here —
> a wrong answer rather than no answer. `v0.7-plan.md` is the exception and the reason is
> the rule: it was written *after* the migration, so its numbers are this repo's own and
> are correct. **Resolving here and being wrong are not the same thing.**
> The archive is private, so a qualified link answers **404 unless you are a maintainer,
> and that 404 is the expected result, not a broken link**. Counts measured per file at
> this commit with `desktop/scripts/check-citation-dates.mjs`; the wider sweep is #195.

| document | what it covers |
|---|---|
| [`PERFORMANCE.md`](PERFORMANCE.md) | Core Web Vitals budgets (FCP/LCP/CLS), the CI Lighthouse check and the merge policy |
| [`v0.5-plan.md`](v0.5-plan.md) | v0.5 "the daily companion" — release plan |
| [`v0.6-plan.md`](v0.6-plan.md) | v0.6 "gbrain, working" — release plan |
| [`v0.7-plan.md`](v0.7-plan.md) | v0.7 "calm connections" — release plan. **Written after the migration: its `#NNN` are this repo's own and resolve correctly.** |
| [`spikes/mew-core-runtime.md`](spikes/mew-core-runtime.md) | ADR — MEW Core runtime and the post-quantum crypto stack |
| [`spikes/model-reasoning-snapshot.md`](spikes/model-reasoning-snapshot.md) | Spike — pre-tool model-reasoning snapshot |
| [`spikes/scheduling.md`](spikes/scheduling.md) | Spike — proactive, overlap-free, rest-aware scheduling |

Release plans are kept as they were written. They describe the shape of a release at the
time it was planned, not the shape of the repository now.
