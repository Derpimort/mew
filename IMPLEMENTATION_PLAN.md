# MEW — Implementation Plan

*Executes `ARCHITECTURE.md` (Alternative A: local-first SPA). Phases follow the PRD's build order §11. Each phase ends runnable. Phase 1–7 = the MVP; Phase 8+ is the planned arc.*

App lives in `app/`. Design handoff stays untouched in `design_handoff_mew_mvp/` as reference.

---

## Phase 0 — Foundation *(this session)*
Scaffold Vite + React + TS (strict), Vitest, deps (`zustand`, `dexie`, `@anthropic-ai/sdk`), fonts (Hanken Grotesk, Newsreader), `pixie-poly-face.svg` copied to assets, folder layout per ARCHITECTURE §2, `prefers-reduced-motion` global kill-switch.

## Phase 1 — Tokens & primitives *(this session)*
`ui/tokens.css` verbatim from DESIGN_LANGUAGE.md (light + dark + shadows + type scale). Primitives matching handoff class names 1:1: `Check`, `TagChip`, `VisChip`, `PillStat`, `Label`, `Toggle` (off/on/locked + cap), `Segmented`, `Composer`, `ActionChip`, icons (bell/send/check). **Exit:** a token change recolors the whole app; primitives visually match the handoff frames.

## Phase 2 — Week model & today *(this session)*
`domain/`: types, `time.ts`, `week.ts` (place/move/complete/roll/load math/free-slot search), `liveNow.ts`, seed week anchored to the real today. UI: top bar, week rail (load bars vs 10 h, today ring, past dim, click-to-focus, legend, teaser), now card (Newsreader headline, meta line, 7-segment progress), timeline (`Tl` rows, now-line between blocks, active/done/rest states). **Exit:** PRD acceptance **#2** (now card transitions on the minute tick, no reload); week rail bars correct.

## Phase 3 — Chat & talk-to-schedule *(this session)*
Chat column (user/mew bubbles, bottom-anchored, composer), `parse.ts` rule-based parser (block/move/free/done/capture; weekday + time-range grammar), `ModelPort` + `RuleBasedAdapter` + `AnthropicAdapter` (claude-opus-4-8, strict tool use, streaming) + `OllamaAdapter`, fallback chain, MEW confirmations ("Done — Thursday 9–12 is held." + one observation). **Exit:** acceptance **#1** — "block thursday morning for the deck, keep friday afternoon free" produces tagged, protected blocks in rail + timeline (works with zero key via rule-based floor).

## Phase 4 — Mews & the companion *(this session)*
Complete-a-task path (checkbox → mew → memory event → celebration line, positive-only), mews-today derived, `pixie.ts` sustainability mapping, `CompanionSlot` with typed PixieMachine contract + SVG placeholder (breathing, mood filters, dev state chips). **Exit:** acceptance **#3** and **#7** (unit test: condition moves only via sustainability inputs, not task count).

## Phase 5 — Nudge engine & notifications *(this session)*
`nudges/library.ts` — all 8 nudges as data (trigger, phrasing(ctx) with the user's own numbers, tone, footnote, cooldown) from `mew-v4-research.jsx → NUDGES`. `engine.ts` — per-tick evaluation, cooldowns, quiet-hours queueing, outcome logging. Drift detector (in-app idle ≥ 10 min in focused block). Browser mirror (only when tab unfocused, Pixie toast per spec, click → focus + scroll to nudge; permission asked at first missed nudge, not on load). Week-rail teaser deep-links the highest-priority pending nudge. "Show the science" toggle. **Exit:** acceptance **#4**, **#8**; nudge #5 close-the-loop + graceful roll = acceptance **#5**.

## Phase 6 — Settings & routing matrix *(this session)*
Settings page per `SurfaceSettings`: calendars table (MEW row + per-calendar per-tag visibility chips, edit cycles details → busy only → hidden), privacy & model (local-first lock, BYO key field, Remote/Fully-local segment, consolidation toggle), your mew (rename, look), nudges & notifications (quiet hours, mirrors, locked principles with no storage field). `CalendarPort` + SimulatedCalendarAdapter + projection function + "what this calendar sees" preview. **Exit:** acceptance **#6** (busy-only projection demonstrable via preview), **#9**, **#10**.

## Phase 7 — Memory & the honest numbers *(this session)*
`memory.ts` aggregates: realistic best (trailing median of completed deep-work hours), carry-over ratio by week, estimate bias. Wire into right-size nudge (#1), kinder-plan trigger (#8, 4-week carry-over > 30 %), close-the-loop slot proposals, week-rail teaser copy. Persistence: Dexie schema + hydration + JSON export/import + `storage.persist()`. **Exit:** all 10 acceptance criteria pass; vitest green; `vite build` clean.

— MVP complete —

## Phase 8 — Real calendars *(Google: done · Outlook/CalDAV: next)*
**Done:** GoogleCalendarAdapter — GIS browser OAuth with the user's own client ID (no MEW server, BYO credentials), two-way sync over the `CalendarPort` seam. Pull: timed events this-week→+21d become external blocks tagged by the calendar's default tag (all-day events skipped); MEW-pushed events are marked (`extendedProperties.private.mewBlockId`) and never pulled back. Push: diff-based per routing matrix (details / "Busy" / hidden) against a persisted sync ledger (Dexie v2 `sync` table); matrix edits apply on next sync; pushed events carry no reminders (MEW is the notifier). External events are never pushed back, never auto-rolled by close-the-loop, and never moved by protect-the-rest (MEW says so honestly). Auto-sync every ~5 min + manual "sync now"; disconnect best-effort deletes MEW's pushed events. 12 sync tests cover the diff engine end to end.
**Next:** Outlook (Graph), CalDAV — same `CalendarAccount` interface, new files in `adapters/calendar/`. Multiple Google accounts (one per session today).

## Phase 9 — Desktop vehicle (Tauri) *(when triggered — see ARCHITECTURE §3)*
Swap adapters: SQLite storage, native notifications, tray + background timers (drift/end-of-day with window closed), keychain for BYO key. UI/domain untouched.

## Phase 10 — The brain (GBrain) & beyond
Overnight consolidation job, graph of tasks/people/projects, delegation candidates; avatar evolution; MEW-to-MEW (this is where Alternative C's sidecar shape returns, server-side).

---

## Acceptance criteria → where proven

| # | Criterion | Proven by |
|---|---|---|
| 1 | Speak → tagged protected blocks | Phase 3; `parse.test.ts` + manual |
| 2 | Now card live transitions | Phase 2; `liveNow.test.ts` |
| 3 | Mew: celebrate, count, no negative paths | Phase 4; `week.test.ts` (no failure states in types) |
| 4 | Drift ≥10 min → nudge, mirror, chips work | Phase 5; `engine.test.ts` + manual |
| 5 | Day end → close-the-loop → roll, Pixie rests | Phase 5; `engine.test.ts` |
| 6 | Busy-only projection per matrix | Phase 6; `project.test.ts` + preview UI |
| 7 | Pixie condition ⟵ sustainability only | Phase 4; `pixie.test.ts` |
| 8 | Quiet hours queue to morning | Phase 5; `engine.test.ts` |
| 9 | Locked toggles visible, non-interactive | Phase 6; no storage field exists |
| 10 | `prefers-reduced-motion` honored | Phase 0 global CSS |

## Design-iteration workflow (standing)

Each new design drop: replace `design_handoff_mew_mvp/` wholesale → `git diff` it → apply in order **tokens → primitives → layout** (ARCHITECTURE §7) → screenshot vs new canvas. Domain/state/adapters are off-limits to design drops by rule.

## Verification (standing)

`pnpm test` (domain), `pnpm build` (types + bundle), `pnpm dev` + manual pass of the 10 acceptance criteria, screenshot against the design canvases.
