# Spike — pre-tool model-reasoning snapshot ("what did the model plan before it acted?")

**Status:** accepted · spike for #166 · **implemented** (minimal, opt-in) in the same PR.
**Decision in one line:** the Vercel AI SDK v6 already surfaces Anthropic extended thinking as a first-class `reasoning` stream, so a clean, low-risk capture exists — **built** as an opt-in `showReasoning` setting that streams the model's plan to the session log as a collapsible note **before any tool runs**, with zero change to a turn when it's off.

The ticket asked: _if a clean, low-risk implementation exists, build a minimal version; otherwise write findings + a PoC._ It exists. **This doc is the findings half; the code is the build half.** Both ship together.

---

## The feasibility question

> Can MEW's Vercel AI SDK layer surface the model's reasoning (extended thinking) and capture it _before_ a tool commits, so a user can see the plan ahead of the mutation?

**Yes — directly, no direct-SDK fallback needed.** Verified against the _installed_ packages (not docs, not memory): `ai@6.0.208` + `@ai-sdk/anthropic@3.0.85`.

### Evidence (from the installed `.d.ts`)

1. **Provider option** — `@ai-sdk/anthropic` exposes a `thinking` provider option mapping to Anthropic's extended-thinking block:
   ```ts
   // node_modules/@ai-sdk/anthropic/dist/index.d.ts — anthropicLanguageModelOptions
   thinking?: { type: 'enabled';  budgetTokens?: number }
            |  { type: 'adaptive'; display?: 'omitted' | 'summarized' }
            |  { type: 'disabled' }
   sendReasoning?: boolean
   ```
   Passed via `streamText({ providerOptions: { anthropic: { thinking: … } } })`.

2. **Streaming surface** — `streamText().fullStream` yields dedicated reasoning parts, _ahead of_ text and tool parts in the same step:
   ```ts
   // node_modules/ai/dist/index.d.ts — TextStreamPart
   | { type: 'reasoning-start'; id }
   | { type: 'reasoning-delta'; id; text }   // the thinking tokens
   | { type: 'reasoning-end';   id }
   | { type: 'text-delta';      id; text }
   | { type: 'tool-call';       … }
   ```

3. **Post-hoc surface** — `streamText().reasoningText: PromiseLike<string | undefined>` and `.reasoning: PromiseLike<ReasoningOutput[]>` if you'd rather read it after the turn.

So the SDK does all three things the ticket floated (extended-thinking, streamed reasoning tokens, post-hoc reasoning) on the path MEW already uses. **No need to defer to a future SDK version, and no need to hand-roll a direct Anthropic call** (the option the ticket named as the fallback).

### Provider reality

- **Anthropic** (`claude-sonnet-4-x`, our default `claude-sonnet-4-6`): full support. This is the path we built.
- **OpenAI** via the chat-completions route MEW uses (`gpt-5.4-mini`): the SDK does **not** surface a reasoning stream here. Left off rather than ship a half-feature.
- **Ollama** (local `/api/chat`): no reasoning stream wired. Off.

Capability lives in `PROVIDER_CONTRACT[provider].reasoning` (one source of truth, #149), `null` for the two that can't do it — so the feature is structurally Anthropic-only and can't silently misbehave on the others.

---

## What was built (minimal, faithful, low-risk)

A single user-facing switch, **`Settings.showReasoning` (default `false`)**, gates the whole feature end-to-end:

| Layer | Change |
|---|---|
| `domain/types.ts` | `Settings.showReasoning: boolean` (default **false**); `ChatMessage.reasoning?: string` (mirrors the existing `observation?` field). |
| `adapters/model/contract.ts` | `ProviderContract.reasoning: { budgetTokens; displayChars } \| null`. Anthropic `{ 1500, 600 }`; OpenAI/Ollama `null`. |
| `adapters/model/types.ts` | `ConverseChunk = string \| { reasoning: string }`; `ModelPort.converse` now yields `ConverseChunk`. A plain string is reply text (unchanged); a `{ reasoning }` chunk is the plan. |
| `adapters/model/aiAdapter.ts` | When `showReasoning` **and** the provider has a reasoning budget: request `thinking`, walk `fullStream`, accumulate `reasoning-delta`s, and emit **one** `{ reasoning }` chunk — flushed at `reasoning-end`, or at the first `text-delta`/`tool-call`, whichever comes first — so the snapshot is always on the record _before_ the first mutation. **Off ⇒ the original `textStream` path, byte-for-byte, no `thinking` requested.** |
| `adapters/model/index.ts` | `selectAdapters` threads `settings.showReasoning` into the factory. |
| `state/store.ts` | The `speak` consume loop routes a string to the reply `buffer` and a `{ reasoning }` chunk to `ChatMessage.reasoning` (persisted with the message). |
| `ui/components/SessionLog.tsx` + `components.css` | Renders `msg.reasoning` as a native `<details>` "planned before acting", collapsed, gated on `showReasoning`. |
| `ui/pages/SettingsPage.tsx` | A "Show the plan first" toggle, shown only on the remote-Anthropic path, with honest copy about the small extra latency/cost on the user's own key. |

### Ordering guarantee (the "before tool commit" part)

The capture is flushed on the earliest of: `reasoning-end`, the first `text-delta`, or the first `tool-call`. Anthropic streams the thinking block before it streams text or emits a tool call, so the `{ reasoning }` chunk always reaches the store — and the message — **before the executor runs**. A store-level test asserts the reasoning is pinned to the reply _inside the mid-turn hook, before `exec.complete` fires_.

---

## How it honours MEW's product laws

- **Keys never leave the device** — the call is the same in-browser BYO-key request; `thinking` is just another request param. Nothing new leaves the tab.
- **Tools are the only mutation path** — reasoning is read-only narration; it routes to a message field, never to the executor. The plan is _shown_, the tool still _acts_.
- **Graceful keyless/brainless degradation** — off by default; off for every provider that can't stream reasoning; off on the rules floor and local Ollama. A keyless turn is byte-identical to before.
- **Positive-only voice** — the note is labelled "planned before acting" and rendered muted/collapsed; it informs, it doesn't scold.
- **No performance regression** — the AC's load-bearing line. When the toggle is **off** (the default for everyone), no `thinking` is requested, so there is **no** extra latency or token cost. The cost is paid only by a user who explicitly opts in.

### Why a native `<details>`, not literal `<details>` markdown (the one deviation from the ticket)

The ticket says "collapsible `<details>` in chat". MEW's Markdown renderer (`markdownParser.ts` → `Markdown.tsx`) is a **deliberately HTML-free subset** — no `dangerouslySetInnerHTML`, all text React-escaped — so a literal `<details>` string in the reply body would render as **escaped text**, not a disclosure widget, and injecting raw HTML would breach the renderer's security posture. The faithful way to deliver "collapsible" is a **real React `<details>` element** on the message, which is exactly what we did: same UX the ticket wanted, no security regression, no markup smuggled through chat.

---

## Cost / sizing

- `budgetTokens: 1500` — just above Anthropic's 1024 minimum for extended thinking. Room to plan a multi-item placement; not room to ruminate.
- `displayChars: 600` (≈150–200 tokens) — the **visible** slice is whitespace-collapsed, trimmed, and clipped at a word boundary with an ellipsis, so the note stays inside the AC's "≤300 tokens, human-readable" bound regardless of how much the model actually thought.

---

## Alternatives considered

- **Direct `@anthropic-ai/sdk` thinking call** (the ticket's stated fallback) — **rejected, unnecessary.** The unified AI-SDK path already surfaces reasoning; bypassing it would re-introduce the hand-rolled request handling #150/#151 just removed.
- **Always-on reasoning** — **rejected.** Violates "no performance regression": every turn would pay thinking latency + cost. Opt-in is the honest default.
- **Stuff the plan into the reply body** behind a sentinel string — **rejected.** Pollutes persisted chat and the brain sense, and the constrained parser can't make it collapsible. A structured `ChatMessage.reasoning` field + native `<details>` is cleaner.
- **Widen the stream vs. a side channel** — chose to widen `converse`'s yield to a tiny `ConverseChunk` union. The blast radius is one store loop + widening the local `collect()` test helpers (which only ever see strings); every existing adapter keeps yielding plain strings, so the change is backward-compatible and type-checked.

---

## Tests (live with behavior)

- `adapters/model/__tests__/reasoning.test.ts` — drives a programmable fake `streamText`: off ⇒ no `thinking` + text only; on ⇒ one `{ reasoning }` chunk **leading** the reply; plan emitted **before** a `tool-call` even with no preceding text; long plan capped + ellipsised; thinking-only turn still surfaces; a stream error after reasoning still rethrows (honest failover preserved); OpenAI no-ops.
- `adapters/model/__tests__/model-select.test.ts` — `showReasoning` threads through `selectAdapters` to the factory as the 4th arg (`false` by default, `true` when set).
- `state/__tests__/scenarios.test.ts` — store-level: a reasoning chunk lands on `ChatMessage.reasoning` **before** the mid-turn executor mutates the week; no chunk ⇒ no field (the opt-out/keyless default).

## Gate results

`pnpm install --frozen-lockfile` ✓ · `npx tsc -b` ✓ · `npx vitest run` ✓ (560 passed, 3 skipped = key-gated live smoke) · `pnpm build` ✓.
`pnpm shoot` fails on a **pre-existing** onboarding-modal/harness interaction (`ob-scrim` intercepts pointer events) that reproduces identically on clean `main` and is out of scope here — `scripts/shoot.mjs`'s selector is fixed by a sibling PR (do-not-touch per repo guidance); none of this spike's files touch onboarding or the shoot harness.

## Sources

- Installed types: `node_modules/ai/dist/index.d.ts` (`TextStreamPart`, `StreamTextResult.reasoningText/reasoning`), `node_modules/@ai-sdk/anthropic/dist/index.d.ts` (`anthropicLanguageModelOptions.thinking` / `sendReasoning`).
- Anthropic extended thinking (Claude 3.7+ / 4.x; `thinking: { type: 'enabled', budget_tokens }`, 1024 minimum).
- MEW: `adapters/model/aiAdapter.ts` (#150/#151 unified adapter), `PROVIDER_CONTRACT` (#149), `Markdown.tsx` / `markdownParser.ts` (HTML-free render subset).
