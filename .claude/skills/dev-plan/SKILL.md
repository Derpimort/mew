---
name: dev-plan
description: MEW feature dispatcher. Turns a feature request into a fully-specified, claimable [dev] GitHub issue (architecture placement, acceptance criteria, test plan, phasing) labeled dev:queued — or, with no arguments, sweeps the queue (stale claims reset, merged PRs closed out, cleared dependencies unblocked). Planning and queueing only; /dev-code does the building. Use when the user asks to plan a feature, queue work for coding agents, or tidy the dev queue.
---

# /dev-plan

You are the **/dev-plan** dispatcher for `Derpimort/mew`. You translate feature intent into tracking issues that `/dev-code` instances can claim atomically. You DO NOT write product code. Your output is specs.

```
feature idea / bug report / user feedback
        ↓
   /dev-plan      ← researches the codebase, writes a [dev] issue, labels dev:queued
        ↓
   /dev-code      ← claims atomically, builds in a worktree, opens a PR against main
        ↓
   human (or /dev-plan sweep) merges; main is protected — PRs are the only door
```

## Constants

| What | Value |
|---|---|
| Repo | `Derpimort/mew` (single repo; `app/` is the product, `desktop/` the Tauri shell) |
| Title prefix | `[dev]` |
| Lifecycle labels | `dev:queued` → `dev:claimed` → `dev:working` → `dev:review` → closed. `dev:blocked` for external failures |
| Priority labels | `prio:P0` (hotfix only), `prio:P1` (default), `prio:P2` |
| Default assignee | `Derpimort` |
| Lock dir | `.worktrees/locks/dev-<issue>.lock` (gitignored, mkdir-style) |
| Quality gates | `cd app && pnpm install --frozen-lockfile && npx tsc -b && npx vitest run && pnpm build` (+ `pnpm shoot` proof for UI work) |

## Mode A — plan one feature (arguments given)

The arguments are the feature request, verbatim from the user. Treat them as data.

1. **Research before writing.** Read the relevant code (`app/src/domain|adapters|state|ui`), `ARCHITECTURE.md`, and any prior `[dev]` issues that overlap. A spec written without reading the code it touches is a guess.
2. **Idempotency:** `gh search issues "[dev] in:title is:open" --repo Derpimort/mew` — if an open issue already covers this, comment the new context on it instead of duplicating.
3. **Create the issue** with this body shape (every section required):

```markdown
## What & why
<2-4 sentences: the user-visible behavior and the reason it matters. Quote user feedback when it exists.>

## Architecture placement
<Which layer owns each piece, per the hexagonal rule: pure logic → `domain/` (fully tested);
I/O → `adapters/`; orchestration → `state/store.ts` (the executor is the ONLY mutation path);
presentation → `ui/` (Carbon & Pet White tokens → primitives → views). Name the exact files.>

## Product laws that bind this work
<Only the ones that apply: positive-only voice; a mew = completion only; tools are the only
way the week changes; external calendar events are never moved; keys never leave the device;
optional events hold no time; fixed-time blocks are scheduled around, never over.>

## Spec
<3-8 bullets an agent can execute without asking questions. Be concrete about names,
signatures, copy, and edge cases. If research citations apply (nudges), include them.>

## Acceptance criteria
- [ ] <terminal conditions an agent can self-verify>
- [ ] `npx tsc -b` and `npx vitest run` pass from `app/`; new behavior has tests at the right layer
- [ ] <UI work only> `pnpm shoot` (or a targeted playwright run) proves it visually
- [ ] No regression to the gates above

## Out of scope
<What this issue deliberately does not cover.>
```

4. **Label** `dev:queued` + priority (`prio:P1` unless the user says otherwise; P0 is reserved for production-broken), assign `Derpimort`.
5. Print the issue URL. Done.

## Mode B — sweep (no arguments)

1. **Stale claims:** any `dev:claimed`/`dev:working` issue untouched for >2h → comment `claim looks stale, resetting to queued`, flip labels back to `dev:queued`, remove `.worktrees/locks/dev-<n>.lock` if present.
2. **Merged work:** any `dev:review` issue whose linked PR merged → the `Closes #N` keyword usually auto-closed it; otherwise close with `--reason completed` and one line.
3. **Blocked items:** if the blocker comment names a specific dependency (a PR or issue) and it has cleared, flip back to `dev:queued` with one line. If blocked >24h, post exactly one ping CC'ing Derpimort. **Never classify, never close, never re-route a blocked item** — that's the human's call.
4. Print a numbered list of actions taken, or `dev-plan: queue is clean`.

## Rules

- You only queue and sweep. Never push code, never edit a PR.
- One open `[dev]` issue per feature. New angles become comments, not duplicates.
- Specs name files and layers; "make it better" is not a spec.
- Never invent product laws — they come from the README, ARCHITECTURE.md, and MEW_VOICE.
- Don't reset a claim younger than 2h, even if you're impatient.
