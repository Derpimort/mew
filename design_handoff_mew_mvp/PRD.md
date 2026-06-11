# MEW — Product Requirements Document (MVP)
*Version: v4 design round · June 2026 · for implementation by a coding agent.*
*Companion docs: `README.md` (design handoff), `DESIGN_LANGUAGE.md` (tokens/components).*

---

## 0. North star
**A well-run week and a well-kept you, made the same thing.** MEW refuses the productivity/wellbeing trade-off: following through is what keeps you healthy, staying healthy is what keeps you following through. Every requirement below serves that.

### Product principles (hard constraints, not preferences)
1. **Wellbeing is the real metric.** A healthy mew beats a busy one.
2. **Care, not blame.** Strain is met with help, never judgment.
3. **Positive only.** Reward follow-through; never punish gaps. No broken-streak mechanics, no penalties, no guilt copy — anywhere.
4. **Suggest, don't seize.** MEW proposes; the user decides. No silent rescheduling.
5. **Latest and correct over convenient retrieval.** Memory serves the live truth, never replaces it.
6. **Private by design.** Local-first; user's data stays theirs; bring-your-own-key; model remote or fully local.

### Vocabulary (used verbatim in UI copy)
| Term | Meaning |
|---|---|
| your mew | the companion (default: Pixie, a golden British Shorthair) |
| a mew | one completed task |
| mewmentum / mewing away | the flow of working your plan |
| resting | day's items done; earned rest |
| healthy / run-down | the mew's condition — reflects how *sustainably* you work, never just how much |

---

## 1. Scope
**MVP = one person, extremely well.** Two pages only:
1. **Main page** — week rail + today focus + "right now" + companion + chat. (Design: `SurfaceWeek3`.)
2. **Settings** — calendars & tag visibility, your mew, nudges & notifications, privacy & model. (Design: `SurfaceSettings`.)

**Out of MVP** (do not build; do not block): avatar evolution/customization beyond name+look, MEW-to-MEW teams, deep analytics/reporting.

---

## 2. The week model
- **Block**: `{id, title, tag, start, end, protected, status, calendarRefs[], estimateSource}`. Tags: `work | private | health | rest` (user-extensible later; these four ship).
- **Day**: ordered blocks + unplaced captures. **Week**: Mon–Sun.
- **Capture**: any task mentioned in chat without a time gets captured and must end the day either *done* or *placed* (see Close-the-loop nudge). Nothing is ever dropped or floating.
- **Carry-over**: end-of-day unfinished blocks roll forward with MEW proposing a slot ("graceful roll"), never silently.
- **Load math**: a day's load = sum of block hours by tag; "realistic best" = trailing median of *actually completed* deep-work hours (from memory). These two numbers power the week rail bars and the right-size nudge.

## 3. Main page requirements
(FINAL visual system: see `DESIGN_LANGUAGE.md` (Carbon & Pet White) and `MEW Final.html`. The warm-cream v3 spec is superseded.)
- **Two views, one toggle (Focus ⇄ Week)** top-right; Carbon dark default, Pet White light.
- **Focus view**: the bezel dial — next 12h, now pinned at top, work outer ring / life inner, giant countdown + current task center. Minimal at rest; hover reveals hour marks, task labels, telemetry; hover/click a block opens its detail card with actions (Done — a mew / Move / Hold). Spec: DESIGN_LANGUAGE §3.
- **Week view**: seven time-true columns, today/selected 2.3× wider with full detail + now-line; solid ink-on-gold blocks (S1); summary line carries the pending nudge teaser, deep-linking to chat.
- **Right column (always)**: the **companion stage** (reserved animated-3D space) above the tty session — chat log, nudge cards with action chips, prompt. Chat is the only command surface and the only nudge surface.

### 3a. Companion stage (reserved animated-3D space)
- The right column's top ~330px is a dedicated **stage** for the companion. In MVP it shows the low-poly placeholder with a slow float; production drops the **animated 3D / vector slow-motion rig** (Rive or WebGL — see §6) into the same box. Build it as a fixed-size stage container so the rig has room to move (translate/scale/idle) without reflowing the session below.
- Stage anatomy: ambient accent glow, elliptical floor shadow, the companion centered, a mono `companion · 3D · animated` slot tag, a `live` pulse, and a bottom info strip (name · condition · pace meter). Condition is shown *through the companion*, never a metric.

### 3b. Per-pet theming (theme follows pet)
- The product ships **one structure, many pets**. The pet type is a user setting; choosing it swaps the **accent pair** (`--pa` primary = work/attention, `--pb` secondary = life/rest) across the entire UI. The carbon/steel (or pet-white) structure, layout, type, and motion never change.
- Implement accents as tokens derived from two source colors per mode: `--ice/--gold = var(--pa)`, softs/borders/glow via `rgba(var(--pa-rgb), a)`; same for `--pb`. A pet defines four values: dark pair + light (deep) pair. Reference registry (ext, not exhaustive): cat (gold/cream — Pixie, default), dog (amber/tan), fox (ember/clay), bunny (rose/lilac), bird (teal/sage). See `mew-v21-system.jsx` `PETS` + `[data-pet]` rules.
- **Pet White** is *accented* white: a faint accent wash tints the warm-white surface so light mode also reads as that pet's.
- Each pet also implies its own companion art/rig and condition vocabulary (cat = mew/mews/mewing; keep the mapping in a per-pet config). Copy vocabulary in this PRD uses the cat; generalize per pet.

## 4. Calendars & privacy routing (Settings §1)
- Connect Google / Outlook / CalDAV. Multiple accounts.
- **Routing matrix**: per calendar × per tag → `details | busy only | hidden`.
  - *details*: event title & time sync to that calendar.
  - *busy only*: an opaque "Busy" block syncs.
  - *hidden*: nothing syncs.
- **MEW always sees everything** — it is the only place the whole week is coherent. Surface this in copy: "your whole week, one coherent thing."
- Two-way: external events flow in tagged by source calendar's default tag; MEW-placed blocks flow out per the matrix.
- Default for a new calendar: work=busy only, private=busy only, health=busy only (user upgrades to details deliberately).

## 5. The nudge engine
**Architecture rule: every nudge is a chat message first.** Browser notifications are mirrors (see §7). All nudges use the user's *own numbers* from memory. All are positive-only and dismissible without cost. Cooldowns prevent nagging (one nudge of a given type per trigger window; "kinder plan" max once/week).

| # | Nudge | Trigger | Phrasing (canonical example) | Tone | Research basis |
|---|---|---|---|---|---|
| 1 | **Right-size** | planned deep work > 1.2× realistic best | "You've planned 9 hours of deep work; your realistic best has been about 5½. Want me to right-size it?" | honest, warm | Planning fallacy — Buehler, Griffin & Ross 1994; Kahneman & Tversky. Fix = connect own history. |
| 2 | **Drift check-in** | now-block open, activity drifted ≥ 10 min | "Still on the deck, or should I move it? You've been off it ~12 minutes." | gentle, no blame | ~23-min refocus cost; attention residue — Mark (UC Irvine); Leroy 2009. |
| 3 | **Guard the block** | ≥ 3 self-interruptions within the hour | "Each switch costs around 20 minutes of refocus — want me to guard the next block?" | protective | 47-sec screen attention; ~44% self-interruptions — Mark. |
| 4 | **Celebrate the mew** | any completion — always fires | "That's a mew — five today. The deck's nearly there." | celebratory, brief | Progress principle; losses hurt more than wins help → positive-only — Amabile & Kramer 2011. |
| 5 | **Close the loop** | open item at day end, no plan attached | "The deck isn't done — shall it live tomorrow at 9:00? Then let it go for tonight." | calming, end-of-day | Zeigarnik 1927; a concrete plan quiets intrusion — Masicampo & Baumeister 2011. |
| 6 | **When & where** | intention captured without time/place | "Got it — 'call the bank.' When should it live? Thursday morning has room." | practical | Implementation intentions, d=.65 over 94 studies — Gollwitzer & Sheeran 2006. |
| 7 | **Protect the rest** | event proposed over protected rest, or rest skipped 2 days | "That meeting lands on your walk. The walk is yours — keep it?" | firm but kind | Burnout = unmanaged chronic stress — WHO ICD-11; 55% workforce burnout — Eagle Hill 2025. |
| 8 | **The kinder plan** | carry-over > 30% for 4 consecutive weeks | "Fourth week of heavy carry-over. Can we look at the load together? I have a kinder shape for next week — proposed, not imposed." | a real conversation | ~3× turnover intent when burnt out — Eagle Hill 2025; Aflac 2025. |

- **Actions** resolve nudges (chips in the chat message); every outcome (accepted/declined/ignored) is logged to memory and tunes future frequency/phrasing.
- **"Show the science"** setting toggles the research footnote line in nudges.
- The library is a **living research asset**: implement as data (`{id, trigger, phrasing(ctx), tone, footnote, cooldown}`) so new findings add nudges without code changes. Content source of truth: `mew-v4-research.jsx → NUDGES`.

## 6. The companion (per-pet)
- **Production art = an animated 3D / vector slow-motion rig** per pet (Rive `*.riv`, or a lightweight WebGL/Three or Spline scene if richer 3D is wanted), embedded in the companion stage (§3a). Calm, slow idle motion is the brand — never frantic. The default cat ships as **Rive** (`pixie.riv`), state machine **`PixieMachine`**:

| Input | Type | Driven by |
|---|---|---|
| `mood` | enum `healthy / drowsy / rundown` | weekly sustainability (pace, carry-over, rest kept) |
| `resting` | bool | day's items done |
| `celebrate` | trigger | a task completed (a mew) |
| `drift` | trigger | drift detected |
| `attention` | bool | a nudge is waiting in chat |
| `pace` | number 0–1 | rolling sustainability score |

- **Until the rig exists**: mount `pixie-poly-face.svg` in the stage with the slow float; map `mood` to CSS filters (rundown: `saturate(.6) brightness(.95) grayscale(.08)`; resting: `brightness(.96) saturate(.88)`). Non-cat pets show a themed placeholder tile until their art lands.
- **Per-pet**: each pet type has its own rig + condition vocabulary; the same `PixieMachine` input contract applies. Selecting a pet (Settings) swaps art + accent together (see §3b).
- **Condition logic**: condition reflects *sustainability*, never volume. Inputs: planned-vs-realistic ratio, carry-over trend, protected rest kept, quiet hours respected. A run-down companion asks for a lighter tomorrow — copy is always an invitation, never a verdict. **It never guilts, never punishes, never dies.**

## 7. Notifications
- **Chat-first (locked)**: every notification-worthy event is a chat message. There is no separate notification center.
- **Browser mirror**: Notification API; permission requested in onboarding context (when the first nudge would have been missed, not on first load). Fires **only** when `document.visibilityState !== 'visible'`; shows Pixie avatar + "Pixie · MEW" + the nudge's first line; click → focus tab, scroll chat to the nudge.
- **Quiet hours** (default 18:30–08:30): nothing fires; pending nudges queue to morning.

## 8. Memory & truth ("How MEW stays true")
- **Live week decides**: "what should I do right now", open/done, drift — always computed from live state. Never answered from memory.
- **Brain informs** (GBrain): hybrid recall; self-building graph of work/people/projects; overnight consolidation; produces "realistic best", chronic-underestimate factors, delegation candidates (post-MVP surface).
- When a memory-derived answer touches the present, re-read live state first; flag anything unverifiable as possibly stale.
- Storage: local-first (IndexedDB/SQLite as fits stack). Sync is out of MVP.

## 9. Model & keys
- BYO API key, stored locally, never transmitted except to the model endpoint.
- Model location switch: **Remote** (user's key) | **Fully local** (e.g. Ollama-compatible endpoint). All MEW features must degrade gracefully on a weaker local model (nudges are templated — only talk-to-schedule parsing and the kinder-plan conversation need real model calls).

## 10. Acceptance criteria (MVP definition of done)
1. Speak "block Thursday morning for the deck, keep Friday afternoon free" → tagged, protected blocks appear in the week rail + today/Thursday timelines and sync per routing matrix.
2. The now card always names the current obligation; transitions at block boundaries without reload.
3. Checking a task fires `celebrate`, increments mews-today, posts a celebration line; nothing negative exists anywhere on failure paths.
4. Drift ≥10 min in a focused block produces nudge #2 in chat; if tab unfocused, a browser notification mirrors it; clicking it lands on the chat message; action chips do what they say.
5. Day end with an open item produces nudge #5; accepting rolls the item to the proposed slot; Pixie rests when the day is clear.
6. A connected work calendar shows "Busy" (no title) for private blocks; details for work blocks; matrix edits apply on next sync.
7. Pixie's condition changes only via sustainability inputs (§6) — demonstrably not via raw task count.
8. Quiet hours suppress all notifications; queued nudges appear in chat next morning.
9. Locked principle toggles (positive-only, chat-first, care-not-blame, condition-mirrors-sustainability, local-first) are visible in settings and non-interactive.
10. Full app honors `prefers-reduced-motion`.

## 11. Build order suggestion
1. Tokens + layout shells (main, settings) from `DESIGN_LANGUAGE.md`.
2. Week model + today timeline + now card (local data, no calendars yet).
3. Chat + talk-to-schedule parse → block placement.
4. Mews/completion + celebrate path; Pixie slot with placeholder + state mapping.
5. Nudge engine (data-driven library) + drift detection; browser mirror + quiet hours.
6. Calendar connect + routing matrix sync.
7. Memory layer ("realistic best") → right-size + kinder-plan nudges.
