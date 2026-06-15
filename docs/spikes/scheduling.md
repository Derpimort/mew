# Spike — proactive, overlap-free, rest-aware scheduling (a scored-slot oracle the LLM consults)

**Status:** proposed · spike for #79 · **supersedes the closed PR #83** (which proposed taking the LLM *out* of placement; the owner wants it *informed, not bypassed*). Implementation: #80.
**Decision in one line:** a **pure deterministic engine scores candidate time-slots** (hard-gated to never overlap/violate fixed blocks or due times, then ranked by time-of-day fit, rest spacing, and preferences); it's exposed as a **`suggest_slots` tool the model always consults before placing/moving**, and the LLM **picks** from the pre-vetted, scored candidates. The model keeps judgment and messy-intent handling; it physically can't choose a bad slot.

---

## Context — why

`execPlan` (`app/src/state/store.ts:658`) and `execMove` (`:785`) trust the model's proposed start minutes: they `week.place`/`week.move` (`app/src/domain/week.ts:255`/`:318`), **add the block, then** `week.conflictsWith` (`:108`) and report a clash *without fixing it* (`store.ts:707–713`/`:813–815`). The model must read the note and re-issue — the **overlap-then-inform loop**. Observed: adding a 3–4pm call + "move things around" took **six passes** and **never inserted rest**.

**The seam (revised from #83):** #83 concluded "the LLM should stop choosing start minutes; a deterministic planner decides placement." The owner's correction: **keep the LLM choosing** — its flexibility, natural-language reasoning, and ability to honour "after lunch but before the call" are the point — but make every choice **well-informed**, so even a small/dumb model stays consistent. So the deterministic part becomes an **advisor (a scoring oracle)**, not the decider.

---

## Decision — a scoring oracle, consulted as a tool

### 1. Deterministic slot-scoring engine (`domain/`, pure + fully tested)

Given an item (title, `durationMin`, tag, hard constraints) + the live week + active prefs + optional gbrain context, **enumerate candidate slots and score each in [0,1]**:

- **Hard gate (collide ⇒ score 0, excluded):** must fit a real free gap (`week.freeWindows`, `:198`), never overlap an open block, never sit over a fixed/external block (`week.isFixedTime` `:95`, `block.external`), and end by `due`. The gate is what makes a bad pick *impossible* — everything below only ranks the survivors.
- **Time-of-day fit:** deep/work items score higher in the user's peak window, admin/short items in troughs (defaults keyless; personalised by gbrain when on).
- **Rest / spacing:** penalise back-to-back placement (adjacent to another work block); reward a slot that preserves a break after a continuous-work run. *The spike's rest rule becomes a scoring factor, not an afterthought* (see "Rest" below).
- **Preference alignment + proximity:** honour stored prefs ("gym → 07:00"); reward proximity to related work (prep next to the meeting it preps for; `after:` dependencies land in order).

Returns a **ranked list with a reason string** for transparency and for the model to reason over:

```ts
interface SlotCandidate { dayKey: string; startMin: number; endMin: number; score: number; why: string }
// e.g. { dayKey:'2026-06-16', startMin:660, endMin:750, score:0.86, why:'morning peak; 30m break after standup; before the 3pm call' }
```

### 2. Exposed as a tool the model ALWAYS consults

A new read-only tool in `MEW_TOOLS` (`app/src/adapters/model/tools.ts`), mirroring the `query_brain` shape (`:203`) — suggests, never mutates:

```jsonc
{ "name": "suggest_slots",
  "description": "BEFORE you place or move a timed block, call this to get RANKED, conflict-free slots for it. Candidates already respect fixed blocks, calendar events, due times, rest spacing, and the user's patterns — pick the one that best fits the user's intent. Never invent a start minute yourself.",
  "parameters": { "title": "string", "durationMin": "number", "tag?": "...", "due?": "number", "after?": "string[]" } }
```

Dispatched (`runTool` `:281`) to a new `ToolExecutor.suggestSlots(q): Promise<string>` (`adapters/model/types.ts:48`) — async because it may pull gbrain. The store implements it: assemble week + prefs + brain lines → `scoreSlots` → format the ranked candidates (+ `why`) as the tool result. **Always consulted:** `MEW_VOICE` instructs the model to call `suggest_slots` before any place/move and choose from its candidates; a place/move with a self-invented start time is the anti-pattern (and the executor can *snap* an un-vetted start to the nearest scored candidate as a safety net — see impl).

### 3. gbrain-supported scoring (optional, layered above a keyless floor)

When the brain is connected, the scorer enriches with `BrainPort.recall` (`adapters/brain/types.ts:39`): the user's energy/peak patterns, project clustering ("Kite London work clusters Tuesdays"), recent context. **Keyless floor:** with no brain, the engine still scores deterministically (time-of-day defaults + rest + stored prefs) — graceful degradation, the law holds.

### 4. The LLM chooses (informed, not bypassed)

The model calls `suggest_slots`, receives pre-vetted ranked candidates, and **picks** the one matching the user's nuanced intent — then calls the existing `plan_blocks`/`move` with that vetted slot. Because the candidates are hard-gated, it *can't* pick an overlapping or past-due slot. A small/dumb model simply takes the top score and is still correct. The LLM keeps explanations and messy-intent handling; the oracle guarantees no-overlap / good-time / rest-aware.

---

## Rest — the rule (now a scoring factor)

Same evidence as the #83 research, re-cast as scoring weights + a soft suggestion:

- **Primary (Pomodoro):** reward a break after ~25 min continuous work; a longer 15–30 min break after ~4 cycles (~100 min).
- **Deep-work cap:** penalise scheduling work that pushes a continuous run past ~90 min (measured evidence centres ~80 min — Ericsson 1993; "90" is the popularised round number, **not** a physiological clock).
- **Rationale, not a cadence:** WHO ICD-11 burn-out (QD85) is *why* MEW protects rest; it prescribes no interval. **Do not** cite Kleitman/BRAC as proof of a 90-min work clock (contested for waking performance).

MEW already holds rest as `tag:'rest'` blocks + the `protect-rest` nudge + `realisticBestH` (daily cap); this adds the *continuous-run* spacing the scorer rewards, and the engine can emit a rest candidate when a long run would otherwise form.

---

## Edge cases (product laws)

External calendar events **never moved** (`block.external`); fixed-time **scheduled around, never over** (`isFixedTime`); `due` is a hard upper bound (must *end* by); optional/no-time blocks transparent to the gap search; `protected` blocks aren't displaced; multi-day overflow → candidates roll to the next day's feasible gaps (`nextSlotAfter`); keyless floor scores deterministically; dependency cycles (`after:`) rejected (Kahn) before scoring.

---

## Follow-up implementation plan (#80)

New pure module **`app/src/domain/scheduler.ts`** (tested in `domain/__tests__/scheduler.test.ts`):

```ts
interface SlotQuery { title: string; tag: Tag; durationMin: number; due?: number; after?: string[]; window?: 'morning'|'afternoon'|'evening' }
interface ScoreWeights { timeOfDay: number; rest: number; preference: number; proximity: number }   // tunable, summing ~1
function candidateSlots(week: Block[], q: SlotQuery, prefs, horizonDays: number): { dayKey: string; startMin: number; endMin: number }[]  // freeWindows-backed, HARD-GATED (no overlap / fixed / past-due)
function scoreSlots(week: Block[], q: SlotQuery, prefs, brainLines?: string[], w?: ScoreWeights): SlotCandidate[]  // pure; ranked desc; gated-out slots absent
function restPenalty(week: Block[], cand: { dayKey: string; startMin: number; endMin: number }): number  // the continuous-run factor
```

- **Reuse** `week.freeWindows` (candidate source), `isFixedTime` + `external` (gate), `overlaps`/`conflictsWith` (gate + post-assert), `nextSlotAfter` (overflow), the stored-prefs path (`domain/prefs.ts`). The #83 greedy/free-windows gap-finder is the candidate backend; the prior-art + rest research carry over.
- **Tool wiring:** add `suggest_slots` to `MEW_TOOLS` + a `runTool` case → `ToolExecutor.suggestSlots`; implement in `store.ts` (week + prefs + `BrainPort.recall` → `scoreSlots` → formatted text). Update `MEW_VOICE` (`adapters/model/types.ts`) to mandate consulting it.
- **Executor safety net (optional):** `execPlan`/`execMove` snap a model-supplied start that isn't a vetted candidate to the nearest scored one (so even a tool-skipping model can't overlap). The reactive `clashNote` path is retired.
- **Tests:** hard gate (overlap/past-due/fixed ⇒ scored 0/absent), ranking order, the rest factor, keyless determinism, gbrain-on enrichment changes ranking, the worked 6-pass session below.

---

## Worked example — the six-pass session, in one pass

Day holds: architecture meeting (fixed 10:00–11:00), lunch (12:30–13:00), demo (fixed 14:00–14:30); flexible dev-work (90m) + sprint follow-up (45m, after demo). User: "add a 3–4pm call, move things around."

The model places the **call** (a meeting → fixed 15:00–16:00). Then for **dev-work** it calls `suggest_slots({title:'dev work', durationMin:90})` → candidates gated to the real gaps (09:00–10:00 too short alone, 11:00–12:30 fits=90m, 16:00–18:00 fits) ranked: **11:00–12:30 (0.84, "morning-ish, before lunch, no back-to-back")** > 16:00–17:30 (0.6). For **sprint follow-up** → `suggest_slots({…, after:['demo']})` → 16:00–16:45 (0.8, "right after the demo it depends on"). The model picks the top of each → **zero overlaps, rest-aware, one pass** — and it still got to honour intent ("before lunch") by choosing among vetted options.

---

## Why this over PR #83

#83 removed the LLM from slot choice entirely (deterministic auto-place). This **keeps the LLM choosing** — flexibility, explanations, messy human intent — while the oracle guarantees no-overlap / good-time / rest. It also degrades better across model sizes: a strong model reasons over the `why`s; a weak model takes the top score; both are correct. The deterministic gap-finder isn't wasted — it's the scorer's backend.

## Alternatives considered

- **Deterministic auto-place (#83)** — rejected by the owner: bypasses the LLM's judgment; "after lunch but before the call" is hard to express as pure constraints.
- **Keep reactive + better prompting** — rejected: doesn't fix the root (the model inventing minutes blind).
- **CP-SAT now** — overkill at N≈10–30; reserved as escalation if scoring ever needs true constraint optimisation. The scorer's hard gate already guarantees feasibility.

## Sources

Carried from the #79 research (full set in PR #83 history): commercial schedulers separate WHAT/WHERE in their data model but disclose no solver (Motion/Reclaim/SkedPal/Sunsama/TimeHero — usemotion.com, help.reclaim.ai, docs.skedpal.com, help.sunsama.com, help.timehero.com); greedy first/best-fit into free gaps (en.wikipedia.org/wiki/Bin_packing_problem, en.wikipedia.org/wiki/First-fit-decreasing_bin_packing) is the candidate-enumeration backend, topological sort for `after:` (en.wikipedia.org/wiki/Topological_sorting); rest — Pomodoro (en.wikipedia.org/wiki/Pomodoro_Technique), Ericsson 1993 (gwern.net/doc/psychology/writing/1993-ericsson.pdf), WHO ICD-11 burn-out (who.int/news/item/28-05-2019-burn-out-an-occupational-phenomenon-international-classification-of-diseases), BRAC caveat (en.wikipedia.org/wiki/Basic_rest%E2%80%93activity_cycle).
