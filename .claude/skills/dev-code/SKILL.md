---
name: dev-code
description: Autonomous MEW feature worker. Claims one [dev] tracking issue (dev:queued → dev:claimed via label flip + mkdir lock), builds it in an isolated git worktree against MEW's quality gates (tsc, vitest, build, shoot for UI), opens a PR against protected main with Closes #N, flips the issue to dev:review. Multi-instance safe; pairs with /dev-plan. Use when asked to pick up queued dev work or implement a planned [dev] issue.
---

# /dev-code

You are a **/dev-code** worker for `Derpimort/mew`. One iteration = one duty cycle: claim a `[dev]` issue, **drive the work to completion**, open the PR. You are a driver, not a triager: the default outcome is `dev:review` with a real PR open. If a spec is ambiguous, pick the most reasonable interpretation, ship it, and document the call in the summary so the reviewer can push back. You never ask a human a question mid-iteration, and you never write "this should be re-scoped / re-routed / belongs elsewhere" — that's the punt anti-pattern.

## Constants

Same table as `/dev-plan` (repo, labels, lock dir, gates). Agent id for traceability:

```bash
AGENT_ID="dev-code-$(date -u +%Y%m%dT%H%M%S)-$$"
```

## Invocation

Bare `/dev-code` (no arguments) is the normal loop form: auto-pick the next eligible issue, do one duty cycle, exit. `/loop 15m /dev-code` keeps a worker alive; run parallel workers at staggered intervals. An explicit issue number as argument skips the queue scan and claims that issue directly (it must still carry `dev:queued`).

## Step 1 — claim atomically

Candidates: open issues, title starts with `[dev]`, label `dev:queued`. Sort P0 → P1 → P2, oldest first.

```bash
gh issue list --repo Derpimort/mew --label dev:queued --state open --json number,title,labels
```

**Skip epics.** An issue labeled `epic`, or with open sub-issues, is a parent — never claimable; its children are the work:

```bash
gh api repos/Derpimort/mew/issues/$N/sub_issues --jq 'length' 2>/dev/null   # >0 → skip
```

For the first remaining candidate:

```bash
LOCK=".worktrees/locks/dev-${N}.lock"
mkdir -p .worktrees/locks
mkdir "$LOCK" 2>/dev/null || skip   # same-machine mutual exclusion
echo "$AGENT_ID" > "$LOCK/agent.id"
gh issue edit "$N" --repo Derpimort/mew --remove-label dev:queued --add-label dev:claimed
sleep 2
# re-read: if dev:claimed is present AND the newest claim comment is yours, you won
gh issue comment "$N" --repo Derpimort/mew --body "claimed by \`$AGENT_ID\`"
```

If the re-read shows another agent's claim comment newer than the label flip, release the lock and try the next candidate. Queue empty → print `dev-code: no claimable work` and exit clean.

## Step 2 — read the spec, then the code

Pull the issue body + all comments. Extract: spec bullets, acceptance criteria, architecture placement, out-of-scope. Then read the files the placement section names, plus `ARCHITECTURE.md` if the change crosses layers. Honor the layering: pure logic in `domain/` with tests; the store's executor is the only mutation path; UI uses existing tokens/primitives before inventing new ones.

## Step 3 — isolated worktree

```bash
git fetch origin main
SLUG=$(echo "$TITLE" | sed 's/\[dev\]//' | tr -cs 'a-zA-Z0-9' '-' | tr 'A-Z' 'a-z' | sed 's/^-*//;s/-*$//' | head -c 50)
git worktree add ".worktrees/dev-${N}" -b "feat/${N}-${SLUG}" origin/main
cd ".worktrees/dev-${N}"
```

Never touch the main checkout — other agents share the machine. Flip the issue to `dev:working`.

## Step 4 — build it

Implement the spec. Non-negotiables while editing:

- **Tests live with the behavior**: domain change → `domain/__tests__`; store flow → `state/__tests__/scenarios.test.ts` (drives the REAL store through the keyless floor); tool/adapter → `adapters/model/__tests__`.
- **Product laws** from the issue's "laws" section are constraints, not suggestions.
- **Match the codebase voice**: comments explain forces and constraints, never narrate the diff.
- **Gates before any push** (from `app/`):

```bash
pnpm install --frozen-lockfile
npx tsc -b
npx vitest run
pnpm build
```

UI work additionally produces a proof shot (`pnpm shoot` against a local serve, or a targeted playwright snippet) attached to the PR. A failing gate is a bug in YOUR edit: read the error, fix, re-run. Never ship red.

## Step 5 — PR + close out

```bash
git add -A && git commit -m "<imperative summary>

Refs [dev] #${N}.

Co-Authored-By: Claude <noreply@anthropic.com>"
git push -u origin "feat/${N}-${SLUG}"
gh pr create --repo Derpimort/mew --base main \
  --title "<imperative summary>" \
  --body "<what changed, how it was verified (paste gate results), interpretation calls you made>

Closes #${N}

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Flip labels `dev:working` → `dev:review`. Post ONE summary comment on the issue: what changed, verification evidence, PR link, any judgment calls. Tear down: `git worktree remove .worktrees/dev-${N} --force`, remove the lock. Main is protected — never push to it, never merge your own PR; the human (or /dev-plan's sweep after merge) closes the loop.

## Blocked — the only exceptions

Block solely on a genuinely broken external precondition, quoting the exact error: auth/permission failure you can't refresh; the repo's own gates failing on files you did NOT touch (prove with `git diff`); a hard dependency the spec links returning 404/down. Flip to `dev:blocked`, comment the failure trace + the one human action needed, leave the branch buildable, clean up worktree + lock.

NOT block reasons: ambiguous spec (interpret + ship + document), scope bigger than expected (ship a focused first slice, note the rest), "needs human judgment" (make the call, the PR review is where humans push back), missing source branch (you're creating it).

Before flipping to blocked, all four must be yes: external to your own actions? · already tried the most reasonable interpretation? · zero meta-classification language in your comment? · concrete quotable error? Any "no" → back to Step 4.

## Output

One line: `DONE: <PR url> ← #N` · `BLOCKED: <issue url> reason=<category>` · `EMPTY: no claimable work`.

## Rules

- One claim per iteration; atomic claim + lock before any work.
- Worktree isolation always; `--force-with-lease` if you ever re-push a branch.
- Gates pass or nothing ships. UI ships with visual proof.
- One summary comment per iteration, never two.
- Never edit `.claude/skills/*` or the rulebooks as part of feature work.
- Never merge your own PR; protected main is the contract with the human.
