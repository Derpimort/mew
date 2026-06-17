# MEW — Validation surface · 2026-06-13 shipped batch

> Transient working doc (untracked). Delete when this batch is signed off.
> Built from `main @ ab98e74`. Web app rebuilt + running at **http://localhost:3000** (Docker `mew-mew-1`).

## Read this first

**These 14 issues are already CLOSED.** The dev-loop auto-closes an issue the moment its PR
merges (`Closes #N`), and `/dev-plan`'s sweep re-closes anything reopened-but-merged. So the
"validate, *then* close" flow isn't reachable here — the close already happened. This is a
**post-merge validation pass** instead:

- **PASS** → nothing to do. The issue is already closed and correct.
- **FAIL** → reopen *that one* issue (`gh issue reopen N`), drop a comment with the repro, and
  queue a fix with `/dev-plan`. Don't bulk-reopen — the sweep would just re-close them.

All 14 still wear a stale `dev:review` label (means "PR open, review pending" — now false).
Optional one-shot hygiene to strip it is in **Close-out** at the bottom.

### Two markers you'll see

- **★ brain** — needs the brain **ON**. The web app at `:3000` runs the brain **OFF by default**,
  so these degrade (honest "I can't see that yet" / silent) until a brain is wired. Easiest brain:
  run the **desktop app** (§C) — it auto-spawns the bundled gbrain sidecar, no setup. Or point
  Settings → Privacy & model → Brain at a local `gbrain serve` endpoint.
- **🌱 seed / ⏱ time-gated** — needs past data, or only fires in a specific window (Monday,
  evening wind-down, 10 min before a meeting). For these, the **automated scenario tests** (Layer 1)
  are the real proof — they seed the data and mock the clock. Do the live UI check where you can.

---

## Layer 1 — run the automated suite (covers the acceptance-criteria math for all 14)

The dev-loop encoded each issue's acceptance criteria as tests. One command validates the bulk:

```sh
cd /home/work/work/mew
make check          # = pnpm -C app test (vitest) + pnpm -C app typecheck (tsc -b)
```

**✓ Already run on `ab98e74` (2026-06-13 08:39): 348 passed, 1 skipped — green.** This is the
mechanical backstop for every ⏱/🌱 feature below (pref-drift thresholds, delegation co-occurrence
math, week-review lines, duration medians, debrief composer, orbit/label geometry). Re-run any time;
if a *specific* test fails, note which `it(...)` — it maps straight to the issue.

> Note: the one scenario `desktop backup & restore > changes coalesce … 30s later` has a tight 5s
> timeout and **flakes under heavy concurrent CPU load** (it failed once when run alongside the
> sidecar build, passed cleanly in isolation). If you see it red, re-run the file alone:
> `pnpm -C app exec vitest run src/state/__tests__/scenarios.test.ts`. Worth a follow-up to bump
> that test's timeout, but not a product bug.

---

## Layer 2 — manual experience pass (what tests can't feel: voice, layout, the actual click)

Open **http://localhost:3000**. Work top-down. Tick each box as you confirm it.

### Track A — Durable preferences (epic #24) · works brain-OFF (MemoryEvent fallback)

- [ ] **#25 — remember policy + always-on context.**
  In chat: type `remember that gym is always at 7am`.
  - Expect: MEW acknowledges and stores it as a *standing rule* (not a one-off).
  - Negative (important): type `move gym to 8 today` → must **not** create a preference (it's a move).
  - Upsert: type `actually gym is always at 6am` → replaces; you still have one gym rule, not two.
  - Persistence: reload the page / open a fresh chat → MEW still "knows" gym → 7am.

- [ ] **#26 — preferences actually change mechanics (not just prose).**
  With the gym→7am rule set: type `add gym tomorrow`.
  - Expect: block auto-placed at **07:00**, and the reply **credits the rule** ("…your standing rule").
  - Explicit wins: type `add gym tomorrow at 6pm` → placed at **18:00** (explicit time overrides the rule).
  - Duration default: `remember deploys always take 45 minutes`, then `block a deploy tomorrow` → sized **45 min**.
  - Flexibility: `remember my syncs are movable`, then add a "sync" block → it's treated as flexible
    (scheduled-around language changes), not a hard fixed block.

- [ ] **#27 — pref-drift nudge** ★🌱⏱ *(best proven by Layer 1)*
  Math: a rule contradicted by ≥3 real placements ≥60 min off, over 14 days, fires **one** gentle nudge:
  *"your rule says gym starts 07:00, but it's lived near 18:00 five times running — update, or keep?"*
  with **update** / **keep** actions. Live trigger needs seeded contradicting history; rely on the
  scenario test (`prefContradictions` / `pref-drift`) unless you want to hand-seed.

### Track B — Entity intelligence (epic #28)

- [ ] **#33 — entity-aware durations** 🌱 *(brain-OFF ok; local events)*
  Needs ≥3 completed blocks of the same kind to set a median. To see it live: complete a few
  "interview prep" blocks around ~40 min, then `block interview prep tomorrow`.
  - Expect: auto-sized to **~40 min** (your real median, not the default 60), reply credits "your usual".
  - Precedence: explicit time/duration in the message still wins over the median.

- [ ] **#31 — project rollups** ★🌱
  Brain ON + a project with linked completed blocks. Ask: `how much has <project> eaten this week`
  (use a real project name from your data, e.g. a client/project you track).
  - Expect: a reply with a **real summed number** from your events — not an estimate.
  - Honesty: ask about a project that doesn't exist → "I can't see that yet", **no invention**.
  - Brain OFF → it should decline cleanly, not fabricate.

- [ ] **#32 — delegation candidates** ★🌱⏱ *(best proven by Layer 1)*
  Math: same task-kind × same person ≥3 in 28 days, where the task also appears without that person,
  surfaces at the **fresh-start window** only: *"doc reviews have run with Robin four times this month —
  worth handing him the thread this week?"* → accepting **creates a capture** (never reassigns).
  Live trigger needs seeded co-occurrence + the weekly window; rely on the scenario test.

### Track C — Narrative layer (epic #34)

- [ ] **#35 — day debrief** ⏱ *(brain-OFF ok; richer with brain)*
  Fires in the **evening wind-down window**, after close-loop, once/day: two or three kind lines —
  *"5 mews; the deploy slipped 40 past its window; rest held. tomorrow opens heavy — 7h against your 5.5."*
  Voice law: "slipped/carried", never "failed". Live = evening only; otherwise trust the composer test.

- [ ] **#36 — week-in-review on Monday** 🌱⏱ *(brain-OFF ok; richer with brain)*
  The **Monday fresh-start** nudge leads with last week's truth:
  *"last week: 18 mews, carry-over 22%, mornings held 9/10, …"* + the shape-the-week actions.
  Week one (no history) → original copy, unchanged. Live = needs Monday + prior week; else trust the test.

- [ ] **#29 — pre-meeting heads-up** ★🌱⏱
  Brain ON + a fixed-time block linked to a known person. **8–12 min before** it starts, an
  info-only nudge surfaces 1–2 recall lines (last interaction / outcome). No action buttons.
  Live trigger is tight timing; easiest via the desktop app with a block placed ~10 min out, or trust the test.

### Focus view (epic #14) · pure UI, no brain, easy to check live

- [ ] **#16 — orbit-lanes Focus view.** Open the **Focus** view.
  - Rolling next-12h orbit; "now" pinned at top; every item a thin labeled arc; the focus item on the
    outer orbit, others stepping inward — **no overlapping arcs, no overlapping labels** even when busy.
  - Click any arc/label → it **promotes** to focus (center swaps, countdown to its end). Demote chip
    ("↓ let it run in background") sends it inward.
  - Empty state reads **"Nothing holds you."**
  - A background item with a due time renders as **dashed gold** ending at a glowing due tick.

- [ ] **#17 — loose-threads rail.** On the Focus view, left edge.
  - A slim vertical **THREADS** pill: count + one colored dot per thread state. Click → expands in place
    to a box grouping **running / slipped / paused / unplaced** in that order, each row with an action.
  - Row actions use existing flows: running → open, slipped/paused → resume (start now), unplaced → place.
  - Zero threads → the pill is **hidden entirely** (no dead chrome). Esc / background click collapses.

### GBrain spine (epic #20) — the plumbing under Track B/C ★

- [ ] **#21 — BrainPort round-trip.** With brain ON (desktop sidecar or a `gbrain serve` endpoint):
  - Complete a block → a timeline entry + a `task/<title>` page get written to the brain.
  - `remember: gym is always 7am` → a `pref/…` page is created.
  - Next conversation's context contains a recall line (MEW "remembers" across the window).
  - **Brain OFF**: zero behavior change, no console errors beyond one warn, suite still green (Layer 1).

- [ ] **#23 — brain engine choice.** Settings → Privacy & model → Brain.
  - Engine selector offers **local (sidecar) / my gbrain endpoint / supabase**; switching round-trips
    (re-opening Settings shows the saved choice).
  - Unreachable endpoint degrades to the floor (no errors, week still works).
  - *(Supabase end-to-end is opt-in and needs your own Supabase + serve — out of scope for a quick pass;
    confirm the option exists and saves.)*

---

## C. Desktop app + the one-time backup/restore test

The desktop app (Tauri 2) wraps the same SPA **and** auto-runs the bundled gbrain sidecar, so it's
also the easiest way to get **brain ON** for the ★ items above.

### C.1 — Prerequisites (this WSL2 box is missing the GUI libs)

Already present: node, pnpm, bun, rustc, cargo, WSLg display. **Missing: the Tauri Linux GUI libs.**
Install them once (Ubuntu/Debian):

```sh
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### C.2 — Build the sidecar + launch (run from a terminal with the GUI, i.e. `! ` in this session or your own shell)

```sh
cd /home/work/work/mew/desktop
# Sidecar is ALREADY BUILT for you: src-tauri/binaries/gbrain-x86_64-unknown-linux-gnu (178 MB, pin garrytan/gbrain#eefe8b5).
# Only rebuild if you bump gbrain.version:  node scripts/build-sidecar.mjs
pnpm install
pnpm dev                            # first cargo build is slow (minutes); a 1440×900 MEW window opens
```

On launch the shell inits a PGLite brain under the app data dir, mints a token, spawns
`gbrain serve` on a random loopback port, and hands it to the webview — brain ON, no setup.

### C.3 — Backup & restore (the manual one-time test)

The export is one `.json` of your week + captures + chat + memory. **API keys are stripped on export**
and each device keeps its own — so a restore never leaks keys.

1. **Make a backup that has real data.** In the **web app** (`:3000`, where your real data lives):
   Settings → Privacy & model → **Backup & restore → download**. You get `mew-backup-YYYY-MM-DD.json`.
2. **Restore into the desktop app.** In the desktop window: Settings → Privacy & model →
   **Backup & restore → restore…** → pick that JSON.
   - ✅ Expect your week blocks, captures, chat history, and memory to appear in the desktop app.
3. **Verify desktop auto-backup.** Make any change in the desktop app (add a block), wait ~60 s, then
   Settings → **Desktop auto-backup → open folder**.
   - ✅ Expect `~/Documents/MEW/mew-backup.json` + a dated copy `mew-backup-YYYY-MM-DD.json`.
4. **Verify the startup restore offer.** Quit and relaunch the desktop app.
   - ✅ Expect a chat nudge: *"found a backup from <date> in Documents/MEW — want me to bring it back?"*
     with a **bring it back** button. Click it → data restored.
5. **(Sidecar lifecycle, #22)** Optional: `pkill -f "gbrain serve"` while the app runs → the app keeps
   working on the keyless floor (no crash); relaunch restores the brain.

---

## Close-out procedure

As you finish each section, record the outcome here. Then:

- **All pass** → batch is validated. Optionally strip the stale `dev:review` label from the 14
  closed issues (they're already closed; this is just hygiene):
  ```sh
  for n in 16 17 21 22 23 25 26 27 29 31 32 33 35 36; do
    gh issue edit "$n" --repo Derpimort/mew --remove-label dev:review
  done
  ```
- **Any fail** → for that issue only:
  ```sh
  gh issue reopen N --repo Derpimort/mew
  gh issue comment N --repo Derpimort/mew --body "Validation fail (2026-06-13): <repro + expected vs actual>"
  # then /dev-plan to queue the fix
  ```

### Sign-off log

| Issue | Feature | Surface | Result | Notes |
|------:|---------|---------|:------:|-------|
| #25 | prefs: remember policy | web | ☐ | |
| #26 | prefs: applied | web | ☐ | |
| #27 | prefs: drift nudge | test | ☐ | |
| #33 | durations: real median | web | ☐ | |
| #31 | project rollups | desktop★ | ☐ | |
| #32 | delegation candidates | test | ☐ | |
| #35 | day debrief | web (eve) | ☐ | |
| #36 | week-in-review | web (Mon) | ☐ | |
| #29 | pre-meeting heads-up | desktop★ | ☐ | |
| #16 | orbit-lanes Focus | web | ☐ | |
| #17 | loose-threads rail | web | ☐ | |
| #21 | BrainPort round-trip | desktop★ | ☐ | |
| #23 | brain engine choice | web/desktop | ☐ | |
| #22 | desktop sidecar + backup/restore | desktop | ☐ | |

> Not in this batch: **#37 cross-agent recall** (PR #52 still open, not on main — validate after it merges).
