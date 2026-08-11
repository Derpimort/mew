# MEW — My Entire Week

A calm AI companion that runs your week *with* you — and keeps you well while you run it.
Local-first, research-backed, yours.

> block thursday morning for the deck, keep friday afternoon free

**Positive only.** A completed task is *a mew* — the only thing MEW ever counts. No streaks,
no shame, no guilt mechanics. Care, not blame; suggest, don't seize: MEW proposes, you decide.

## New in v0.6 — *gbrain, working*

MEW now **learns you and stops making you repeat yourself.** Memory forms rules from what you
actually *do* (not just what you say) and applies them at placement — offer once, then it just
does it. Around that: a full **calendar command surface** (surgical name+time edits, recurring-edit
scope, resize/duplicate/relative-move, drag-to-reschedule on the grid, a quick-capture inbox, and
propose-then-confirm deletion of done blocks) and a **weekly rhythm** (energy-aware scheduling
learned from what you finish, estimate correction, a weekly review that rolls unfinished work
forward, and gbrain drafting next week your usual way). Every new capability offers first and
waits for your yes. Ships as **desktop apps** (macOS · Windows · Linux) alongside the web build.

## What it does

- **One week, two views.** A 12-hour focus dial for today (PM outer ring, AM inner);
  honest time-true columns for the week. Hover details dock where they never cover your blocks.
- **Talk to schedule.** Placement, in-place edits, moves, targeted removal, slot search
  ("find 45 min before 5pm" — checked against every time-holding block), and day analysis
  (dead gaps, 90-minute focus ceilings, missing post-meeting buffers) — all conversational.
- **Scheduling that understands time.** Interviews, calls, and meetings are *fixed points*;
  tasks are *flexible* and give way. Collisions are named in the tool results, so the model
  fixes them in the same turn.
- **GBrain — a brain that learns you, and acts on it.** Append-only memory forms task rules
  from repetition and applies the full spec at placement (keyless too) — offer once, then it
  just does it, undo one tap away. It still feeds the pattern analyses (realistic best — trailing
  median, not hope; follow-through by time of day; chronic rollers; lateness bias; drift clusters)
  and now a *"what I know about you"* console you can see, correct, and forget. Local-first: the
  graph enriches, it never gates.
- **Research-backed nudges, not nagging.** Thirteen cited entries — right-sizing (planning
  fallacy, Buehler 1994), drift check-ins (attention residue, Leroy 2009), micro-breaks
  (Albulescu 2022), post-meeting buffers (Microsoft HFL 2021), protected rest (WHO ICD-11),
  fresh starts, kinder plans. Declining a nudge stretches its cooldown up to 3× — it learns
  your taste.
- **Private by design.** No server. Your data lives in your browser (IndexedDB). Keys are
  entered in Settings, stay on-device, and are sent only to the model endpoint you chose.

## Run it

```sh
cd app
pnpm install
pnpm dev          # → http://localhost:5173
```

First run seeds a lived-in week (plus three weeks of memory) so MEW has honest numbers from
day one. It works with **no API key** (deterministic parser floor). Add your Anthropic key in
Settings → *Privacy & model* for full natural language (`claude-fable-5`), or point it at a
local Ollama for fully-local inference.

```sh
make dev      # local vite + HMR        make check    # tests + typecheck
make up       # docker, port 3000       make shoot    # Playwright screenshots
```

What each release added — and how releases are cut — lives in
**[Releases & changelog](CHANGELOG.md)**.

## Architecture

Hexagonal, with the domain pure and fully tested:

| Where | What |
|---|---|
| `app/src/domain/` | The week model, GBrain insights, nudge engine — pure TS, no I/O |
| `app/src/adapters/` | Models (Anthropic / Ollama / rules floor), calendar sync, storage |
| `app/src/state/` | One Zustand store; the executor is the only path from a model to the week |
| `app/src/ui/` | Carbon & Pet White design system: tokens → primitives → views |
| `design_handoff_mew_mvp/` | Design handoff (reference; drops replace this folder wholesale) |
| `ARCHITECTURE.md` · `IMPLEMENTATION_PLAN.md` | Decisions, phases, acceptance criteria |
| `docs/PERFORMANCE.md` | Core Web Vitals (FCP/LCP/CLS) budgets, the CI Lighthouse check, and the merge policy |

Every conversational provider advertises the same neutral tool registry; tool results are
the only ground truth the model may claim. The deterministic parser keeps everything working
keyless — degradation is graceful by construction.

**Google Calendar** syncs two-way with a per-calendar routing matrix (real titles, opaque
*Busy*, or nothing — private stays private). MEW never moves external events: not ours to move.

**Docker:** multi-stage build (tests + typecheck run inside it), static bundle on
unprivileged nginx with a strict CSP, `/healthz`, config-free image — keys never touch it.

## One brain across devices (Supabase, opt-in)

MEW's optional brain speaks one wire contract — BrainPort → a `gbrain serve` —
no matter which engine keeps the memory. The hosted recipe: put the brain's engine on
**your** Supabase project, run the serve in front of it, and point every MEW (web, desktop,
and any agent that fills the same brain) at the same URL.

Why a serve and not Supabase directly: gbrain's hybrid ranking (keyword + vector legs, RRF
fusion, expansion) runs inside gbrain, not in SQL that PostgREST could call — a browser-direct
client would mean reimplementing that pipeline and keeping it in lockstep. One ranking
implementation, every engine; the serve is where it lives.

```sh
# 1. The brain's engine on your Supabase — new brain, or migrate an existing one.
#    Uses your project's Postgres connection string (prompted, or GBRAIN_DATABASE_URL).
gbrain init --supabase
gbrain migrate --to supabase      # …or move an existing local (PGLite) brain

# 2. The serve, with auth on. Set your own admin bootstrap token (32+ chars,
#    [A-Za-z0-9_-]) — without the env var the serve generates one and prints it.
export GBRAIN_ADMIN_BOOTSTRAP_TOKEN="$(head -c 32 /dev/urandom | base64 | tr -d '+/=' | head -c 48)"
gbrain serve --http --port 3131 --public-url https://brain.yourdomain.dev
```

Then mint MEW its own key: open `https://brain.yourdomain.dev/admin`, sign in with the
bootstrap token, and create an API key (it'll look like `gbrain_…`; revocable any time).
In MEW: **Settings → Privacy & model → Brain → on → Supabase** — paste the serve URL and
that key. The key is sent only to your serve, as `Authorization: Bearer`. Self-hosting the
web build? Append the serve's origin to `connect-src` in the CSP — the comment block in
`app/docker/security-headers.conf` shows the exact line; the desktop shell documents the
same edit in `desktop/README.md` (*Brain endpoints and the CSP*).

**Auth & RLS:** row-level security on gbrain's tables keeps other Supabase clients out of
your rows (`gbrain doctor` verifies it) — but MEW reaches the brain *through your serve*,
which holds the Postgres credentials. The serve's API key is the lock on that door: always
start it with a bootstrap token you set, put HTTPS in front, and give MEW its own key. The
Supabase URL and anon/service keys never enter MEW — the browser talks only to your serve,
your serve talks to your Supabase.

**Your brain, your Supabase — opt-in.** The brain is off by default, and off means no
network. The serve key stays on the device that entered it and never rides in backups —
`exportJson` strips it, like every other key.

## Dependency security

MEW ships your API keys (Anthropic, OpenAI, gbrain) and on-device crypto
(`@noble/ciphers`, `@noble/post-quantum`) — so the supply chain is part of the
threat model, not an afterthought. Two controls run continuously
(OWASP A06:2021, *Vulnerable and Outdated Components*):

- **Auditing in CI** (`.github/workflows/audit.yml`). Every PR, every push to
  `main`, and a weekly cron scan both pnpm lockfiles (`app/`, `desktop/`) with
  Google's OSV scanner, plus `cargo audit` over the Rust shell. **Any known JS
  advisory blocks the merge** (dev deps included — strictly stronger than the
  old prod-only high/critical tier); a finding that must ship anyway needs an
  explicit, justified ignore in `osv-scanner.toml`, never a removed gate. The
  same check guards the desktop build job, so no PR reaches a release with a
  known serious CVE.
- **Dependabot** (`.github/dependabot.yml`) opens PRs for new CVEs across npm,
  Cargo, and the GitHub Actions themselves — typically within 24h of disclosure.
  Patch/minor bumps of the security-sensitive packages (crypto + AI SDKs +
  Tauri/serde/tokio) auto-merge *once the audit checks pass*; majors and
  everything else stay manual.

Findings and the dependency graph live on the repo's
[Security tab](https://github.com/Derpimort/mew/security). Lock files
(`app/pnpm-lock.yaml`, `desktop/pnpm-lock.yaml`,
`desktop/src-tauri/Cargo.lock`) pin every resolved version, so a build is
reproducible and auditable.

Run the same checks locally:

```sh
pnpm --dir app audit          # JS/TS, production deps
pnpm --dir desktop audit:desktop   # Rust crates (needs `cargo install cargo-audit`)
```
## Community

MEW is built in the open and contributions are welcome. Before you start:

- **[Contributing guide](CONTRIBUTING.md)** — local setup (`make dev`, no key needed), the quality gates, the hex architecture in a paragraph, the product laws, and how to claim work via `/dev-plan`.
- **[Code of Conduct](CODE_OF_CONDUCT.md)** — the Contributor Covenant we follow
- **[Security policy](.github/SECURITY.md)** — how to report a vulnerability privately

## License

[MIT](LICENSE)
