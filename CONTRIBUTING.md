# Contributing to MEW

Thanks for helping MEW grow. MEW is a calm, local-first weekly planner with a
hexagonal core and a few **product laws** that never bend. This guide gets you
running in minutes, then points you at the deeper references when you need them.

New here? Read this top to bottom once — it is short by design. The two deep
references are [ARCHITECTURE.md](ARCHITECTURE.md) (the shape) and
[code_review_framework.md](code_review_framework.md) (how we review).

---

## 1. Local setup

You need **Node 22** and **pnpm**. No API key is required — MEW runs on a
deterministic parser floor out of the box, so you get a full, working week with
zero secrets.

```sh
make dev          # → http://localhost:5173 (vite + HMR)
```

`make dev` is the one entry point; it wraps `pnpm -C app dev`. First run seeds a
lived-in week (plus three weeks of memory) so the app has honest numbers from the
start. To go beyond the keyless floor, add an Anthropic key in
**Settings → Privacy & model**, or point MEW at a local Ollama — but you never
need a key to develop, test, or review.

Prefer Docker? `make up` runs the same stack on port 3000. Run `make help` to see
every target.

---

## 2. Quality gates

Every PR must be green. The gates run from `app/` and are what CI enforces:

```sh
make check        # tests + typecheck — the pre-commit gate
make build        # production bundle (runs the gates first)
```

Equivalently, from `app/`:

```sh
pnpm install --frozen-lockfile
npx tsc -b        # strict typecheck — no errors
npx vitest run    # the domain + adapter + store suite — all green
pnpm build        # production bundle succeeds (also enforces the size-budget warning)
```

**Tests live with behavior.** Add them at the right layer:

| Change | Test home |
|---|---|
| Pure domain logic | `app/src/domain/**/__tests__` |
| A store flow (speak → executor → week) | `app/src/state/__tests__/scenarios.test.ts` |
| A model adapter | `app/src/adapters/model/__tests__` |

**If you touched `app/src/ui/`,** also run the visual gates — the overlap count
must be **0**:

```sh
pnpm -C app shoot
pnpm -C app shoot:overlap
```

A failing gate is a bug in your change, not the harness. Read the error, fix it,
re-run. Never ship red.

---

## 3. Bundle size budget

The build is **code-split** so the heavy dependency families load lazily and
never bloat first paint: `react`/`zustand`/`dexie` → a `vendor` chunk,
`three`/`@react-three/fiber` → a lazy `three` chunk (only the WebGL companion
needs it), `ai`/`@ai-sdk/*` → a lazy `ai` chunk (only a model call needs it).
The split lives in `app/vite.config.ts` (`build.rolldownOptions.output`).

Two checks guard it:

1. **`pnpm build` warns** when any single chunk exceeds **400 KB** (uncompressed) —
   `build.chunkSizeWarningLimit`.
2. **CI fails** (`app/scripts/check-bundle-size.mjs`, run after `pnpm build` in the
   `desktop.yml` check job) when a chunk or the total crosses its hard budget. It
   reads the build manifest, stats each chunk, and prints a per-chunk breakdown to
   the job summary.

**Budgets** (uncompressed; the targets to keep):

- **main (entry) chunk < 450 KB** — first paint depends on it; keep it tightest.
- **lazy chunks < 300 KB** by default. The known-heavy lazy families have their own
  larger ceilings (`three`, `ai`) — all the hard budgets live in the `BUDGETS` map
  at the top of `app/scripts/check-bundle-size.mjs`; everything else holds the
  300 KB line.
- **first-load JS < 1.2 MB** — the entry chunk plus everything it statically imports
  (today main + vendor), i.e. what a first visit actually downloads. `three` and
  `ai` are lazy and excluded. The script also caps the grand total of all chunks so
  nothing grows unbounded.

A PR that grows a chunk past its budget fails the check with a clear message.
Growing a budget is allowed — but it's a deliberate decision: raise the value in
the `BUDGETS` map in **`app/scripts/check-bundle-size.mjs`** (and the soft
`chunkSizeWarningLimit` in **`app/vite.config.ts`** if you're moving the warn line
too), update this section, and say why in the PR. The default answer to "the bundle
grew" is to lazy-load or split, not to raise the ceiling.

---

## 4. Architecture in one paragraph

MEW is **hexagonal** (ports & adapters). The dependency rule is
`ui → state → domain ← adapters`:

- **`domain/`** is pure TypeScript with zero I/O — the week model, GBrain
  insights, the nudge engine. It is **fully tested** and imports nothing.
- **`adapters/`** are the I/O boundary — models (Anthropic / Ollama / the
  rules floor), calendar sync, storage. They implement the domain's ports.
- **`state/store.ts`** is the **only mutation path**: the executor is the single
  place a model — or anything else — can change the week.
- **`ui/`** is a thin, replaceable skin: Carbon & Pet White tokens → primitives →
  views. A design change must never reach domain logic.

Deep reference: **[ARCHITECTURE.md](ARCHITECTURE.md) §2 ("The shared core")**.

---

## 5. Product laws (non-negotiable)

These are enforced in review and encoded in the types where possible. From
**[HANDOFF.md](HANDOFF.md) §60**, the locked laws are:

1. **Positive-only voice.** A completed task is *a mew* — the only thing MEW ever
   counts. No streaks, no shame, no guilt mechanics. Care, not blame.
2. **The executor is the only mutation path.** Tools are the only way the week
   changes; nothing edits the week around the store.
3. **External calendar events are never moved.** They are not ours to move — MEW
   schedules *around* fixed points, never over them.
4. **Keys never leave the device.** Keys and tokens stay on-device (and
   `exportJson` strips them from backups); they are sent only to the model
   endpoint you chose. This one has teeth — see §6.
5. **Graceful keyless / brainless degradation.** Everything works with no API key
   and no brain — `brainEnabled` off means zero network. Only free-form parsing
   quality changes; nudges are fully templated and never need a model.

When in doubt, the review compass is
**[code_review_framework.md](code_review_framework.md) — Dimension 2
("Decision/Action Separation")**: decide, then act; never both in one place.

---

## 6. Secrets never leave the device

MEW holds three on-device secrets — `anthropicKey`, `openaiKey`, `brainToken`.
They live in IndexedDB (browser) or SQLite (desktop) and must not escape through
any exit a backup, a log line, or a crash report can reach:

- **Backups carry zero keys.** `exportJson` runs every settings object through
  `stripSecrets` (`app/src/adapters/storage-port.ts`) — the one source of truth
  for what counts as a secret, shared by both storage vehicles. A backup file
  can travel (downloads, cloud drives, a synced Documents folder); a restore
  re-enters this device's keys in Settings.
- **No key is ever logged or thrown.** Do not pass a secret field — or a whole
  `settings` object that still holds one — to `console.*` or into a thrown
  `Error`. Log the *state* of a key ("no key set"), never its value. Per the
  [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html),
  credentials never belong in logs.
- **The UI masks.** Key fields are `type="password"`; resting readouts show
  `••••••••` + the last 4 chars, never the raw value.
- **A new secret field?** Add it to `SECRET_SETTING_KEYS` in the same change.
  An OAuth *client id* (e.g. `googleClientId`) is a public identifier, not a
  secret, and is intentionally excluded.

This isn't only a convention: the audit at
`app/src/adapters/__tests__/key-audit.test.ts` enforces all four points and
fails CI the day a leak is reintroduced. If it flags your change, the leak is
real — fix the source, not the test.

---

## 7. Claiming work

MEW runs a lightweight dev loop on top of GitHub Issues:

- **Issues labeled `dev:queued` are claimable** — they have a full spec,
  acceptance criteria, and architecture placement.
- **`/dev-plan`** is the entry point for *new* work: it turns a feature request
  into a fully-specified, claimable `[dev]` issue (or, with no arguments, sweeps
  the queue).
- **`/dev-code`** claims a queued issue and builds it in an isolated worktree
  against the gates above, then opens a PR.
- **`/dev-review`** is the audit gate: it reviews a PR against the code review
  framework and the product laws before merge.

Picking up your first change? Start from a `dev:queued` issue (look for
`good first issue` too), or run `/dev-plan` to propose something new.

---

## 8. Shipping

- **`main` is protected.** You cannot push to it directly.
- Open a PR against `main`. It needs **1 approval** and all gates green.
- Merges land via **admin merge from CI** once review and checks pass.

Keep PRs focused — one issue, one collision-group — and write the body so a
reviewer can see *what changed* and *which gates you ran*. Reference the issue
with `Closes #NNN`.

---

## Getting help

- **GitHub Issues** — feature requests and bug reports. New work starts here
  (or via `/dev-plan`).
- **Discussions** — open-ended questions and design talk (once enabled).
- **Code-review comments** — in-line feedback on your PR is the fastest way to
  resolve specifics during review.

Welcome aboard. Keep it calm, keep it kind, keep it green.
