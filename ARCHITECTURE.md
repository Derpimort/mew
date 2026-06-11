# MEW — Architecture

*Companion to `design_handoff_mew_mvp/PRD.md` and the vision doc. This document chooses the technical shape of MEW: three platform alternatives, one recommendation, and the internal architecture that stays the same regardless of which platform wins.*

---

## 1. What the architecture must optimize for

Derived from the vision, PRD, and how this project will actually be run:

| Force | Consequence for architecture |
|---|---|
| **Design iterates continuously.** New design drops will keep arriving. | Visual layer must be a thin, replaceable skin: all values live in design tokens, all visuals in a 1:1 component kit mirroring `DESIGN_LANGUAGE.md`. A design change must never touch domain logic. |
| **Live week decides; brain informs.** (PRD §8) | Live state must be computed, never stored. `liveNow`, the now-headline, drift, and mew counts are *pure functions of (blocks, clock)* — impossible to go stale. Memory is a separate, append-only layer that only feeds *parameters* (e.g. "realistic best") into those functions. |
| **Private by design, BYO key, local or remote model.** (PRD §0.6, §9) | No MEW server. Data sits on the user's device. The model is reached directly from the client with the user's key, or via a localhost Ollama endpoint. Everything must degrade gracefully with *no* model at all. |
| **Positive-only, care-not-blame are product law.** | These are encoded in the domain layer (no failure states exist in the type system — a block is `open | done | rolled`, never "failed"), not enforced by UI discipline. |
| **Nudge library is a living research asset.** (PRD §5) | Nudges are *data*, not code: `{id, trigger(ctx), phrasing(ctx), tone, footnote, cooldown}`. Adding a research finding = adding an object to one file. |
| **Rive companion arrives later.** (PRD §6) | The companion is a *slot* with a typed input contract (`mood, resting, celebrate, drift, attention, pace`). Placeholder SVG and future `pixie.riv` are two implementations of the same contract. |
| **Calendars are an integration surface, not the core.** | Calendar sync sits behind a port. The week model is the source of truth; calendars are projections of it (filtered per the routing matrix) plus an inbound event feed. |

---

## 2. The shared core (identical in all three alternatives)

A hexagonal ("ports & adapters") TypeScript core. The platform alternatives below only swap the adapters and the shell — **the core never changes**, which is what makes the platform decision low-risk and reversible.

```
┌────────────────────────────────────────────────────────────────────┐
│  ui/            React components — pure skin                       │
│   ├─ tokens.css        ← DESIGN_LANGUAGE.md, verbatim (light+dark) │
│   ├─ primitives/       ← Check, chips, toggles, composer, …  1:1   │
│   ├─ components/       ← WeekRail, NowCard, Timeline, Companion-   │
│   │                      Slot, Chat, NudgeCard, RoutingMatrix …    │
│   └─ pages/            ← Main ("the week, focused"), Settings      │
├────────────────────────────────────────────────────────────────────┤
│  state/         one store (Zustand) + effects                      │
│   ├─ store.ts          actions: speak, complete, accept nudge, …   │
│   └─ effects/          minute ticker · drift detector · end-of-day │
│                        · notification mirror · persistence         │
├────────────────────────────────────────────────────────────────────┤
│  domain/        pure TypeScript, zero dependencies, fully tested   │
│   ├─ types.ts          Block, Capture, ChatMessage, Settings, …    │
│   ├─ time.ts           minutes-of-day, day keys, week math         │
│   ├─ week.ts           place/move/complete/roll blocks, load math  │
│   ├─ liveNow.ts        (blocks, now) → headline, minutes left, …   │
│   ├─ pixie.ts          sustainability inputs → PixieMachine inputs │
│   ├─ nudges/           library.ts (10 nudges as data, citations    │
│   │                    audited) + engine.ts (priority + adaptive   │
│   │                    cooldowns learned from accept/decline)      │
│   ├─ memory.ts         append-only events → realistic best, carry  │
│   │                    trend; overnight consolidation → weekly     │
│   │                    summaries (bounded growth)                  │
│   ├─ insights.ts       GBrain patterns: follow-through by band,    │
│   │                    weekday load, chronic rollers, lateness     │
│   │                    bias, drift clusters → insight lines +      │
│   │                    the concrete kinder-plan proposer           │
│   └─ parse.ts          deterministic talk-to-schedule parser       │
├────────────────────────────────────────────────────────────────────┤
│  ports (interfaces)        adapters (implementations)              │
│   StoragePort          ←   Dexie/IndexedDB   (Tauri: SQLite)       │
│   ModelPort            ←   Anthropic · Ollama · RuleBased(no key)  │
│   NotifierPort         ←   Notification API  (Tauri: native)       │
│   CalendarPort         ←   Simulated → Google/Outlook/CalDAV later │
│   ClockPort            ←   real clock (tests: fixed clock)         │
└────────────────────────────────────────────────────────────────────┘
```

**Dependency rule:** `ui → state → domain ← adapters`. Domain imports nothing. UI never touches adapters directly. This is what keeps design iteration cheap and the core testable.

### 2.1 The truth model, structurally

- **Live state is derived.** There is no `currentBlock` field anywhere in storage. `liveNow(blocks, clock.now())` recomputes on every minute tick and every mutation. Acceptance criterion #2 ("now card transitions at block boundaries without reload") falls out for free.
- **Memory is append-only events** (`block_completed {planned, actual}`, `block_rolled`, `drift_detected`, `nudge_outcome`, `rest_kept`). Aggregates ("realistic best" = trailing median of actually-completed deep-work hours) are recomputed from events, never hand-edited. The brain (GBrain-style consolidation) can later be swapped in behind the same read API — `memory.ts` *is* the MVP brain.
- **Nudge engine reads both**, in that order: triggers evaluate against `liveNow` first, then enrich phrasing with memory numbers. A nudge can never assert something about *now* from history.

### 2.2 The AI layer

`ModelPort` is one interface, three adapters, chosen by Settings (`Remote | Fully local`) plus automatic fallback:

```ts
interface ModelPort {
  // talk-to-schedule: NL → structured intent (place/move/free/complete/capture)
  parseCommand(text: string, ctx: WeekContext): Promise<ScheduleIntent>
  // conversational replies + the kinder-plan conversation
  chat(thread: ChatTurn[], ctx: WeekContext): AsyncIterable<string>
}
```

- **AnthropicAdapter** — `@anthropic-ai/sdk`, browser-direct with the user's key (`dangerouslyAllowBrowser`, key never leaves device except to `api.anthropic.com`). Model: `claude-opus-4-8`. `parseCommand` uses **strict tool use** (a `propose_schedule` tool whose schema *is* `ScheduleIntent`), so output is validated JSON, not parsed prose. `chat` streams.
- **OllamaAdapter** — same interface against `http://localhost:11434` (`/api/chat`, `format: "json"` for parsing). Weaker models still work because the schema is small and nudges never need the model.
- **RuleBasedAdapter** — deterministic parser (`parse.ts`) + templated replies. Zero-key, zero-network. This is the floor the PRD requires ("all features degrade gracefully"): only free-form parsing quality degrades; *nudges are fully templated and never need a model call*.

Fallback chain: configured adapter → rule-based (on error/missing key), with a one-line note in chat, never a blocking error.

### 2.3 Calendar routing (designed now, connected later)

```ts
interface CalendarPort {
  list(): Promise<ConnectedCalendar[]>
  pull(since: Date): Promise<ExternalEvent[]>            // inbound, tagged by source default
  push(projection: ProjectedEvent[]): Promise<void>      // outbound, per routing matrix
}
```

The **routing matrix** (`calendarId × tag → details | busyOnly | hidden`) is a pure domain function: `project(blocks, matrix, calendarId) → ProjectedEvent[]` — a private block projects as `{title: "Busy"}` to a work calendar. The seeded demo rows stay simulated; **Google is live** (`adapters/calendar/google.ts` — GIS browser OAuth with the user's own client ID, plus a pure diff engine in `sync.ts`: pull/merge inbound with loop-prevention markers, push per matrix against a persisted ledger). Outlook (Graph) and CalDAV implement the same `CalendarAccount` interface later, without touching the matrix or week model.

### 2.4 The companion contract

```ts
interface PixieInputs {                     // == Rive "PixieMachine" inputs, PRD §6
  mood: 'healthy' | 'drowsy' | 'rundown'   // weekly sustainability
  resting: boolean                          // day's items done
  pace: number                              // 0–1 rolling sustainability score
  attention: boolean                        // a nudge waits in chat
}
interface PixieTriggers { celebrate(): void; drift(): void }
```

`<CompanionSlot inputs={…} ref={triggers}>` has two renderers: `PixiePlaceholder` (low-poly SVG, breathing keyframes, mood→CSS-filter mapping per design language §5) and `PixieRive` (lazy-loads `@rive-app/canvas` when `public/pixie.riv` exists). Swapping in the finished Rive file is a drop-in, as the handoff promises.

`pixie.ts` computes inputs **only from sustainability**: planned-vs-realistic ratio, carry-over trend, rest kept, quiet hours respected — demonstrably not from raw task count (acceptance #7 gets a unit test).

---

## 3. Platform alternatives

### Alternative A — Local-first web app (Vite + React SPA, IndexedDB)

The app is a static bundle; all data in IndexedDB (Dexie); model calls browser-direct (Anthropic CORS-enabled with BYO key) or to localhost Ollama; browser Notification API for the mirror.

| | |
|---|---|
| **Privacy story** | Excellent — static files, no server, data never leaves device. |
| **Design iteration** | Best of the three: Vite HMR, design drop → token/component diff → instant reload. |
| **Effort to first working product** | Lowest. One toolchain, one runtime, deploys anywhere (file://, localhost, static host). |
| **Notifications / background** | Good while a tab exists (PRD's mirror is explicitly tab-unfocused-only, so this *matches spec*). Nothing runs with the browser closed — end-of-day nudge fires on next open if missed. |
| **Calendar OAuth** | Workable (Google Identity Services supports SPA flows) but token storage in browser is the weakest link of this option. |
| **Risks** | IndexedDB eviction on storage pressure (mitigate: `navigator.storage.persist()` + export/import); no true background jobs. |

### Alternative B — Desktop app (Tauri 2: Rust shell + same React UI + SQLite)

Same UI and core; Tauri provides native windows, tray, OS notifications, SQLite file storage, OS keychain for the API key, and background timers while the app runs in the tray.

| | |
|---|---|
| **Privacy story** | Best — real file you can back up, key in OS keychain, no browser sandbox caveats. |
| **Design iteration** | Good (Tauri dev mode wraps Vite HMR) but adds Rust toolchain, slower CI, per-OS builds and signing. |
| **Effort** | Highest. Rust shell, updater, packaging ×3 OSes — none of it product logic. |
| **Notifications / background** | Best — drift check-ins and end-of-day nudges fire from the tray even with the window closed. This is the strongest *product* argument for B. |
| **Calendar OAuth** | Best (loopback redirect flow, tokens in keychain). |
| **Risks** | Platform overhead lands before any product value; design-iteration loop slightly heavier — wrong first vehicle for a design-led MVP. |

### Alternative C — Local sidecar (Node/Hono on localhost + SQLite) + browser UI

A small always-on local server owns storage, model calls, calendar sync, and scheduled jobs (drift, end-of-day, overnight consolidation); the browser renders.

| | |
|---|---|
| **Privacy story** | Good (localhost only), but "run this daemon" is a real install/ops burden for a personal app. |
| **Design iteration** | Same as A for the UI, plus a second process to keep running. |
| **Effort** | Medium-high: process supervision, port conflicts, API layer between UI and core that A and B don't need. |
| **Notifications / background** | Good (cron in sidecar), but the *mirror* still needs a tab; true OS notifications need… a desktop wrapper, i.e. B. |
| **Risks** | Permanent extra seam (HTTP API) through the middle of the product for benefits B delivers more cleanly. C is the architecture MEW-to-MEW (teams) will eventually want server-side — too early to pay for it now. |

### Recommendation — **A now, B as the planned second vehicle, C deferred to MEW-to-MEW**

Build **Alternative A** as the MVP, with the core/ports discipline of §2 so that **B is a packaging step, not a rewrite** (swap Dexie→SQLite adapter, Notification API→native notifier, add tray timers; UI and domain untouched). Reasons:

1. **The binding constraint is design iteration**, by the user's own statement — A has the tightest loop.
2. The PRD's notification spec (chat-first, browser mirror, fires only when tab unfocused) is *written for* A's capabilities; B's extra powers are a later upgrade, not an MVP requirement.
3. Every hard product problem (week model, nudge engine, pixie state, talk-to-schedule, routing matrix) is platform-independent — solving them in A loses nothing.
4. A's genuine weaknesses (background jobs with browser closed, keychain) are exactly what the Tauri wrap fixes, and the ports already isolate them.

**Trigger to start B:** when drift/end-of-day nudges missed while the browser is closed become a felt problem, or when real calendar OAuth tokens need keychain storage — whichever comes first.

---

## 4. Technology choices (Alternative A)

| Concern | Choice | Why (and what was rejected) |
|---|---|---|
| Build/runtime | **Vite + React 18 + TypeScript (strict)** | Handoff was authored in React; lowest-friction pixel-faithful port. (Svelte/Solid: needless translation risk.) |
| Styling | **Plain CSS: `tokens.css` custom properties + component classes copied from the handoff** | The design source already *is* CSS with custom properties; Tailwind would force a lossy re-encoding of a finished design language and make future design drops harder to diff. |
| State | **Zustand** | One store, selector-based subscriptions (minute tick re-renders only time-dependent components), no boilerplate. (Redux: ceremony; Context: re-render storms.) |
| Persistence | **Dexie (IndexedDB)** behind `StoragePort` | Schemaful, indexed, transactional; `persist()` + JSON export/import for safety. (localStorage: too small/stringy; SQLite-wasm: heavier with no MVP benefit.) |
| AI | **`@anthropic-ai/sdk`** (claude-opus-4-8, strict tool use, streaming) · **Ollama REST** · rule-based floor | Per PRD §9. Anthropic API is CORS-accessible for BYO-key browser apps; key stored locally, sent only to the model endpoint. |
| Dates/time | Hand-rolled `time.ts` (no library) | The domain needs minutes-of-day and day-keys, not a timezone library; zero deps keeps domain pure. |
| Tests | **Vitest** | Domain is pure functions — fast unit tests carry most of the acceptance criteria. |
| Companion | SVG placeholder now; `@rive-app/canvas` lazy-loaded when `pixie.riv` ships | Per PRD §6 slot contract. |

---

## 5. Data model (storage shapes)

```ts
Block    { id, title, tag: 'work'|'private'|'health'|'rest', dayKey: 'YYYY-MM-DD',
           startMin, endMin, protected: boolean, status: 'open'|'done'|'rolled',
           calendarRefs: string[], estimateSource: 'user'|'mew'|'history',
           rolledToId?: string, deep?: boolean }
Capture  { id, title, createdAt, status: 'open'|'placed'|'done', placedBlockId? }
ChatMsg  { id, role: 'user'|'mew'|'nudge', body, ts, nudge?: { type, actions[], footnote,
           resolved?: string } }
MemoryEvent { id, ts, kind: 'completed'|'rolled'|'drift'|'nudge_outcome'|'rest_kept'|…,
              payload }                                  // append-only
Settings { calendars: ConnectedCalendar[], matrix: Record<calId, Record<tag, Visibility>>,
           notifications: { browserMirror, quietHours: {start, end}, showScience },
           model: { location: 'remote'|'local', anthropicKey?, ollamaUrl? },
           mew: { name, look } }                          // locked principles are NOT settings
```

Note: locked principles (positive-only, chat-first, care-not-blame, condition-mirrors-sustainability, local-first) are rendered in Settings but deliberately have **no storage field** — there is nothing to toggle (acceptance #9).

---

## 6. Key runtime flows

**Talk-to-schedule** — composer submit → `ModelPort.parseCommand` → `ScheduleIntent` → `week.apply(intent)` (pure) → store commits blocks + MEW confirmation in chat (short factual reply + one contextual observation from memory) → projection pushed per routing matrix → if a capture lacks time, nudge #6 ("when & where") queues.

**A mew** — checkbox → `week.complete` → memory event `{planned, actual}` → `celebrate()` trigger on companion → mews-today (derived) increments → nudge #4 posts one celebration line. There is no other path: no penalties, no failure branch exists.

**Drift** — activity listener (pointer/keys/visibility) feeds `lastActivityAt`; minute tick evaluates: focused deep block + idle ≥ 10 min → nudge #2 in chat; if `document.visibilityState !== 'visible'`, NotifierPort mirrors it (Pixie avatar, first line, click → focus + scroll to nudge). Actions: *Still on it* (dismiss, remembered), *Move it* (re-place), *Guard block* (suppress non-urgent until block end).

**End of day** — first tick past day end with open items → nudge #5 proposes a concrete tomorrow slot (from free-slot search + realistic-best); accept → `week.roll` (block keeps history, new block tomorrow); when the day is clear → `resting = true`, Pixie rests.

**Quiet hours** — engine gate: inside quiet hours nothing posts or mirrors; triggers queue and flush next morning (acceptance #8).

---

## 7. Design-iteration contract (how future design drops land)

1. **Tokens first.** Any changed value in `DESIGN_LANGUAGE.md` → `ui/tokens.css` only. Colors, radii, shadows, type scale never appear hard-coded in components (enforced by review; the one exception is the handoff's literal one-offs, kept as tokens too, e.g. `--rest-seg`).
2. **Primitives second.** Component spec changes (chip padding, toggle size) → `ui/primitives/*`. Each primitive maps 1:1 to a row of the design language §4 table and carries the same class name as the handoff (`.tag`, `.tgl`, `.nudge`, `.statechip`…), so diffing a new drop against the codebase is mechanical.
3. **Layout last.** New surfaces or rearrangements → `ui/pages/*` composition only.
4. **Never** does a design drop touch `domain/`, `state/`, or adapters. If a design change appears to need domain changes, that's a product change — it goes through the PRD, not the skin.
5. The original handoff stays in-repo (`design_handoff_mew_mvp/`) as the reference; each drop replaces it wholesale so `git diff` shows exactly what design changed.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Browser key storage (XSS would expose BYO key) | No third-party scripts at all; key in localStorage on a static-origin app; Tauri keychain on vehicle B. Documented honestly in Settings copy. |
| IndexedDB eviction | `navigator.storage.persist()` on first run; one-click JSON export/import. |
| Anthropic browser CORS requires explicit opt-in | SDK `dangerouslyAllowBrowser: true` — correct for a BYO-key personal app where user == key owner. |
| Drift detection ≠ real activity (only sees this tab) | MVP heuristic is in-app idleness + tab visibility, stated in copy ("~12 min"); vehicle B can add OS-level idle later. |
| Local model quality | Only `parseCommand`/kinder-plan use the model; strict small schema; rule-based floor always available. |
| Rive asset doesn't exist yet | Slot contract + placeholder shipped; `pixie.riv` is a drop-in. |

---

## 9. Decision log

| # | Decision | Status |
|---|---|---|
| D1 | Hexagonal core, platform as adapter set | Accepted |
| D2 | MVP vehicle = local-first SPA (Alt A); Tauri planned second | Accepted |
| D3 | Plain CSS tokens over Tailwind | Accepted |
| D4 | Zustand + Dexie | Accepted |
| D5 | Anthropic default `claude-opus-4-8`; strict tool use for parsing; rule-based floor | Accepted |
| D6 | Calendars behind port; simulated adapter in MVP, Google first real adapter | Accepted |
| D7 | Locked principles have no storage representation | Accepted |
| D8 | Memory = append-only events, aggregates derived | Accepted |
| D9 | One neutral tool registry (`adapters/model/tools.ts`) + executor; Anthropic/OpenAI/Ollama/rules are four `ModelPort.converse` impls of the same contract | Accepted |
| D10 | Nudge research footnotes are audited claims, not vibes — corrections (no "23 minutes"; Aflac ≠ turnover) applied 2026-06-10; new entries require a validated citation | Accepted |
