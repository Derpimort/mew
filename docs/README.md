# MEW — `docs/`

Release plans, performance budgets and design spikes. The operating manual is
[`AGENTS.md`](../AGENTS.md); the technical shape is [`ARCHITECTURE.md`](../ARCHITECTURE.md).

> **`#NNN` in this directory is a `mew-archive` number.** MEW was migrated from
> `Derpimort/mew-archive` and these documents kept the predecessor's issue numbers, so a
> citation means `mew-archive#NNN` rather than this repo's issue of that number. This
> repo's own counter has since grown past many of them — **every file below has at least
> one citation that now resolves to a real, live, unrelated issue or pull request here**,
> which is a wrong answer rather than no answer. The archive is private, so a qualified
> link answers **404 unless you are a maintainer, and that 404 is the expected result, not
> a broken link**. Counts measured per file at this commit; the repo-wide sweep is #195.

| document | what it covers |
|---|---|
| [`PERFORMANCE.md`](PERFORMANCE.md) | Core Web Vitals budgets (FCP/LCP/CLS), the CI Lighthouse check and the merge policy |
| [`v0.5-plan.md`](v0.5-plan.md) | v0.5 "the daily companion" — release plan |
| [`v0.6-plan.md`](v0.6-plan.md) | v0.6 "gbrain, working" — release plan |
| [`v0.7-plan.md`](v0.7-plan.md) | v0.7 "calm connections" — release plan |
| [`spikes/mew-core-runtime.md`](spikes/mew-core-runtime.md) | ADR — MEW Core runtime and the post-quantum crypto stack |
| [`spikes/model-reasoning-snapshot.md`](spikes/model-reasoning-snapshot.md) | Spike — pre-tool model-reasoning snapshot |
| [`spikes/scheduling.md`](spikes/scheduling.md) | Spike — proactive, overlap-free, rest-aware scheduling |

Release plans are kept as they were written. They describe the shape of a release at the
time it was planned, not the shape of the repository now.
