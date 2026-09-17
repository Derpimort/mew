# AGENTS.md — working on MEW as an agent

The operating manual for AI agents (Claude Code and peers) contributing to MEW. It complements
the human docs — read those for the *what*, this is the *how we work*:

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — setup, the quality gates, the hex architecture, product laws, claiming work.
- **[HANDOFF.md](HANDOFF.md)** — the locked product laws (the **Product laws** bullet under *Key facts / gotchas*) and deeper handoff.
- **[.github/RELEASES.md](.github/RELEASES.md)** — how releases are cut.
- **[code_review_framework.md](code_review_framework.md)** — the 9 review dimensions.

## The dev loop

Feature intent → a specced `[dev]` issue → an isolated build → review → merge.

- **`/dev-plan`** turns a request into a claimable `[dev]` issue (spec + acceptance + architecture placement). One issue per feature; new angles are comments, not duplicates.
- **`/dev-code`** claims an issue, builds it in a **git worktree** (`.worktrees/dev-<n>`), runs the gates, opens a PR into the active RC branch (`v*-rc*`, named `vYYYY.MM-rcN`, e.g. `v2026.09-rc1`).
- **`/dev-review`** audits the PR against `code_review_framework.md` + the product laws.

## The merge bar (non-negotiable)

**Plain Approve, zero 🟡.** Loop fix → re-review until clean. Gates must *prove they engage* — paste the actual output (tsc · vitest · lint · build; shoot for UI) into the PR body/review. Verify law-critical invariants with **tests**, not prose. Every 🔴 names the law or dimension it breaks.

## Product laws (never bend)

Positive-only voice (a *mew* = a completion; no streaks/shame) · the store executor is the **only** mutation path · external calendar events are never moved · fixed-time is scheduled *around*, never over · keys never leave the device · graceful keyless/brainless degradation · **every feature is user-intent-driven and human-in-the-loop — MEW offers, the owner decides; never an autonomous move.** Full text: HANDOFF.md (*Product laws*, under Key facts / gotchas) + CONTRIBUTING.md §6.

## Orchestrating a build (multi-lane)

- **≤2 build lanes at a time**, paired by **disjoint file territory** so they don't collide on `store.ts`/`week.ts` (e.g. one lane on `scheduler.ts`+`execPlan`, another on `recurrence.ts`+`execEdit`/`execRemove`). Longest pole first.
- Each lane branches from the freshest `v*-rc*` and, at PR time, **merges the fresh base** (merge commit, never force-push) and reconciles — conflicts are usually small and additive (enum unions, adjacent lines).
- **An agent merges feature PRs into `v*-rc*` itself** (`gh pr merge --squash`, **never** `--admin`). **Merges to `main` are the owner's click** — it's branch-protected and requires a review you can't self-issue. This self-merge lane assumes **write access** (maintainer-run agents); external contributors fork + PR, and a maintainer merges.
- The loop is **notification-driven**: lane-completion events + a branch-merge monitor drive it. Scheduled wakeups / cron are unreliable (sometimes environment-blocked) — treat them as a fallback only, and keep shell commands simple (compound `git fetch` + `gh` chains can be blocked).
- A lane killed mid-work (e.g. a session-limit reset) leaves its changes **staged** in its worktree — recover it (commit, sync base, open the PR) rather than rebuilding from scratch.
- Before reporting status, **re-check GitHub** — the owner may have merged or acted between turns.

## Releasing (the gitflow)

Feature PRs → `v*-rc*` (the RC branch is `vYYYY.MM-rcN`, e.g. `v2026.09-rc1`; quick gate: tsc · vitest · lint · prettier). The promotion PR **`v*-rc* → main`** runs the heavy suite (e2e · Lighthouse · desktop `cargo` build · ui-overlap · bundle-size · audit). A **`v*` tag** on `main` triggers `desktop.yml` → installers + the GitHub Release.

**Release-version rule (learned from the v0.6.0 near-miss; CalVer since 2026.9.0).** Versions are `YYYY.M.PATCH` (no leading zero in the month; `PATCH` counts that month's releases), the RC branch is `vYYYY.MM-rcN` and its config reads `YYYY.M.PATCH-rc.N`. tauri-action stamps the installers **and** the updater manifest from `desktop/src-tauri/tauri.conf.json`, **not** the git tag. So in the promotion PR, **bump the config from `YYYY.M.PATCH-rc.N` to the clean `YYYY.M.PATCH`**, keep `bundle.windows.wix.version` at `(YYYY-2000).M.PATCH` (WiX caps the MSI major at 255: `2026.9.0` → `26.9.0`), mirror `desktop/package.json`, and add the `CHANGELOG [YYYY.M.PATCH]` section (the release body reads from it) *before* tagging `vYYYY.M.PATCH` — or the release ships mislabeled artifacts. Enforced by `desktop/scripts/check-release-version.mjs`: `--shape` on every desktop PR and dry-run (CalVer shape + MSI mapping), `--promotion` on the promotion PR (also fails on a prerelease), `--tag` on the release (also fails if the tag ≠ the config). Full scheme + worked example: `.github/RELEASES.md`. Auto-update also needs the `TAURI_SIGNING_PRIVATE_KEY` secret — unset → self-update stays dormant (installers still ship).

## gbrain — the vision

gbrain must be **operative**, not advisory: learn from what the owner *does* (repetition), apply deterministically at placement (keyless too), stay local-first + always-on, and be visible/correctable. Autonomy model: **offer once, then remember** — ask a single chip the first time a pattern appears, then just do it (undo one tap away). Shipped as the v0.6 marquee; passive/advisory memory is considered a vision failure.

## Architecture in one line

Hexagonal: `ui → state → domain ← adapters`. `domain/` is pure + fully tested; `adapters/` are the I/O boundary; `state/store.ts` is the single mutation path; `ui/` is a tokens-first replaceable skin. A design change never reaches domain logic. Deep reference: [ARCHITECTURE.md](ARCHITECTURE.md).
