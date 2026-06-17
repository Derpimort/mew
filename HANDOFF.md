# MEW — Handoff

_Last updated after the big review-and-merge drain. Branch `main` @ `71a6490`, 337 passing + 1 env-gated skip, Docker healthy on localhost:3000._

## Goal

Make MEW research-grade and robust, and run all feature work through an autonomous **dev loop**: `/dev-plan` writes claimable `[dev]` issues → other agents run `/loop /dev-code` to build them into PRs → `/dev-review` audits → the human (or admin-merge) lands them on protected `main`. Right now the immediate goal is **draining the open PR queue to zero**, which closes the last two feature epics.

## Where things stand

**Two PRs remain open. Everything else is merged.**

| PR | Issue / epic | State | What's needed |
|---|---|---|---|
| **#44** desktop gbrain sidecar | #22 / epic #20 | **CI green**, but `CONFLICTING` (went stale when #51 merged after its rebase) | Just re-run the wholesale-rebase + push. The hard fixes are already on the branch (E0597 borrow fixed; 14 `brainEnabled`→`brainOn()` sites converted). |
| **#52** cross-agent recall scope | #37 / epic #34 | `CONFLICTING`; **fix never landed** (the fix agent died mid-flight on a Fable-5 access error; its dirty worktree was discarded, remote branch is still pre-fix at `1ec626c`) | Rebase onto main **and** apply the 3 review catch-ups (below), then push. Start fresh — nothing salvageable was left. |

Once both land, **epics #20 and #34 fully close.** Four other epics (**#2** Tauri, **#14** background/orbit, **#24** Track A prefs, **#28** Track B entity) have **all sub-issues merged but the parent issue is still OPEN** — close them with `gh issue close <n> --reason completed` (verify `gh api repos/Derpimort/mew/issues/<n>/sub_issues` shows all closed first).

### What's already on main (this session's merges)
Desktop shell phases #4 (scaffold) · #10 (auto-backup) · #11 (OAuth loopback) · #12 (updater) · #46 (serde_json CI fix). Background/orbit #18 (attention model) · #19 (orbit-lanes Focus) · #30 (loose-threads rail). GBrain #39 (BrainPort + senses + recall) · #43 (Supabase engine). Track A #40 (structured `remember` + always-on pref slice) · #41 (prefs applied at placement) · #42 (pref-drift validation). Track B #45 (pre-meeting heads-up) · #47 (project rollups) · #48 (delegation candidates) · #51 (entity-aware durations). Track C #49 (day debrief) · #50 (week-in-review). Plus: the `/dev-plan` `/dev-code` `/dev-review` skills, `code_review_framework.md` + `coding_principles.md` (copied from aisquare-workspace), and **main branch protection** (PR-only, 1 approval, admin-bypass — that's why everything is admin-merged).

## The #52 review catch-ups (from the PR comment)
1. Stamp the `mew` tag on `chatBatchPage` **and** `debriefPage` in `app/src/adapters/brain/senses.ts` (the "every page MEW writes carries the mew tag" claim must hold; extend the senses tests).
2. Thread `brainScope` through main's three newer recall call sites — `primePersonRecall`, `primeWeekColor`, and the `weekContext` recall in `store.ts` — so a "Whole brain" choice actually reaches heads-up / week-review / rollups (they currently default narrow, which is safe but silently ignores the toggle).
3. Over-fetch in `mew` scope (fetch a larger limit, then filter) so a busy shared brain can't starve default recall to zero.

## What worked (reuse these)

- **The wholesale-rebase protocol** for stale feature branches. Naive `git merge origin/main` is dangerous (see below); instead: start the merge, then `git checkout origin/main -- .` to take main's tree wholesale, then re-apply only the PR's own payload via `git diff $(git merge-base origin/main origin/$BR) origin/$BR > /tmp/p.patch && git apply --3way --index /tmp/p.patch`. Union any `<<<<<<< ours/theirs` markers (keep both sides where they differ and neither contains the other), then close the brace-seams.
- **Parallel `/dev-review` agents** (one `general-purpose` subagent per PR, dispatched in one message) — each runs the real gates in an isolated **absolute-path** worktree (`/home/work/work/mew/.worktrees/review-N`), posts one structured comment, returns a verdict line. Fast and caught real bugs (the #19 promote-wrong-block, #12 TDZ-hid-its-own-tests, #44 E0597, #40 silent-revert).
- **Admin squash-merge**: `gh pr merge N --repo Derpimort/mew --squash --delete-branch --admin`. Protected main needs `--admin` for solo merges.
- **`/dev-review` then fix-on-branch** (a `general-purpose` agent with the wholesale protocol) then merge — this review→fix→merge cycle drained ~16 PRs.

## What did NOT work (don't repeat)

- **Blind `git merge origin/main` on a branch forked many PRs back silently reverts merged work** — git auto-merges deletions of code the branch never saw. The #40 near-miss stripped the #18 attention model + its tests. **Mandatory audit after any merge**: `git diff origin/main --stat` should show *only* the PR's own surface, and scan every deletion line for lost keywords (`attention|due|looseThreads|start-by|prefs|brainMode|remember|delegate`). If a non-feature file shows removals, you resolved wrong — redo it from `origin/main` and re-graft the PR delta.
- **Blind union of conflict markers leaves brace-seams open** between adjacent `describe(...)` blocks / methods — the union drops the `})` between them, so `tsc` fails with `'}' expected`. After every union pass, find seams: a `describe(`/`/* ──`/`export function` that opens at nonzero brace depth means the prior block never closed. **Verify with `tsc`, never by counting braces — string literals contain `{` `}` and fool counters.**
- **Duplicate `import ... from 'X'` lines** after union → `TS2300 Duplicate identifier`. Merge consecutive (and non-adjacent) same-module imports into one line; type-only + value imports merge by prefixing `type ` per-name.
- **`mergeStateStatus` races to `UNKNOWN`/`CONFLICTING` for a few seconds right after another PR merges** — poll `gh pr view N --json mergeable` until `MERGEABLE` before merging; a `CONFLICTING` reading is often just stale.
- **`/tmp` helper scripts do NOT persist across sessions/context** — I'd written `/tmp/mew-wholesale.sh`, `/tmp/dedupe-imports.py`, `/tmp/find-seams.py` and they're gone. Re-create them inline if useful (logic is documented above).
- **Fable-5 model access errors killed two subagents mid-task** (`#52` fix, one earlier). Spawn review/fix agents on the default/inherited model.
- **Worktrees created with a relative path land wherever the shell's cwd drifted** (one ended up under `desktop/src-tauri/.worktrees/`). Always use absolute paths: `/home/work/work/mew/.worktrees/<name>`.
- A couple of merges left a **nested `app/app/shots/`** from a verification script run with the wrong cwd; it's gitignored now but watch for cwd drift in playwright/shoot scripts.

## Next steps (in order)

1. **Land #44**: `git worktree add /home/work/work/mew/.worktrees/m44 origin/<headRef>`, wholesale-rebase onto main, run gates from `app/` (`pnpm install --frozen-lockfile && npx tsc -b && npx vitest run && pnpm build`), push, wait for `MERGEABLE`, admin-squash-merge. CI `desktop / check` is the Rust compile gate (local `cargo check` can't finish in this WSL — missing webkit/dbus sys-libs; that's environmental, not a code failure).
2. **Land #52**: wholesale-rebase + the 3 catch-ups above + gates + push + merge.
3. **Close the 6 epics**: #20, #34 auto-progress as their last child merges; then `gh issue close 2 14 20 24 28 34 --reason completed` after confirming sub-issues are all closed.
4. **Redeploy + smoke-test**: `cd /home/work/work/mew && docker compose up -d --build` (Docker Desktop must be running — on WSL it drops after reboots; relaunch `"/mnt/c/Program Files/Docker/Docker/Docker Desktop.exe"` and wait for `docker info`), then `curl -s localhost:3000/healthz`. Optionally `pnpm shoot http://localhost:3000` for visual proof. The user wants to **test locally before a release** — once the queue is clear, that's the moment.
5. **Then**: the queue is empty. Either `/dev-plan` the next wave (the GBrain desktop sidecar is the real differentiator now that it's merging; cloud sync via AISquare auth was discussed as a future epic), or cut the first desktop **release** — tag `v0.x.y` to trigger the `desktop.yml` release job (needs `TAURI_SIGNING_PRIVATE_KEY` + `_PASSWORD` repo secrets, which only the human can add — see issue #8 / PR #12).

## Key facts / gotchas

- **Repo**: `Derpimort/mew` (private). Single repo: `app/` = the product (React SPA), `desktop/` = Tauri 2 shell. Main is protected.
- **Gates** (from `app/`): `pnpm install --frozen-lockfile && npx tsc -b && npx vitest run && pnpm build`. UI work also wants a `pnpm shoot` proof. Main currently: **337 passing + 1 skipped** (the skip is a CI-gated live-gbrain test).
- **`time` crate is pinned to 0.3.47** in `desktop/src-tauri/Cargo.lock` — `0.3.48` breaks `tauri-utils 2.9.2` with E0119. Any lockfile regen must re-pin (`cargo update -p time --precise 0.3.47`). `serde_json` is a direct dep of the desktop crate (PR #46) because `generate_context!` expands references to it.
- **Architecture**: hexagonal. `domain/` pure + fully tested; `adapters/` for I/O; `state/store.ts` is the ONLY mutation path (the executor); `ui/` uses Carbon & Pet White tokens. The brain is optional and degrades to a keyless floor — `brainEnabled` off means zero network.
- **Product laws** (enforced in review): positive-only voice; a mew = a completion only; tools are the only way the week changes; external calendar events are never moved; keys/tokens never leave the device (and `exportJson` strips them from backups); optional events hold no time; fixed-time blocks are scheduled around, never over.
