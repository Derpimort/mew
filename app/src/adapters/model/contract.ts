/* The model-adapter contract — ONE source of truth for the per-provider request
   quirks that would otherwise drift as inlined literals. The unified aiAdapter
   READS from it (token ceiling, default model, required headers, reasoning
   budget) and the wire tests ASSERT against it: the class of bug where OpenAI
   shipped `max_tokens` on a model that only accepts a newer param name (a 400
   every turn → silent fall to the rules floor) stays a single edit here,
   guarded by contract.test.ts against the real outgoing request body.

   Pure data + types. No SDK, no fetch, no I/O — importable from a unit test. */

import type { Settings } from '../../domain/types'

/** The provider keys MEW can place a conversational model call through. The
    deterministic `rules` floor isn't a network provider, so it has no contract. */
export type ProviderKey = 'anthropic' | 'openai' | 'ollama'

export interface ProviderContract {
  /** The request field that caps generated tokens ON THE WIRE. The unified
      adapter never spells this name — it passes the SDK's normalized
      `maxOutputTokens` and the SDK maps it per provider — but the wire tests
      pin it so the mapping can't silently regress to the deprecated
      `max_tokens` (the quirk that bit us: platform.openai.com/docs deprecated
      it for newer models). Anthropic's Messages API takes `max_tokens`
      (docs.claude.com/en/api/messages — required field); the SDK's OpenAI
      provider speaks the Responses API, which takes `max_output_tokens`.
      Ollama's OpenAI-compatible surface would take `max_tokens`, but MEW sends
      no cap there — the server default governs — so this is null. */
  tokenLimitParam: 'max_tokens' | 'max_output_tokens' | null

  /** A safe ceiling for the token cap, chosen to sit WITHIN the default
      model's output cap so a request can never 400 on an over-limit value.
      null when MEW sends no cap (Ollama). */
  tokenCeiling: number | null

  /** Static headers MEW itself must put on the wire, beyond what the AI SDK
      already sends (auth, versioning, content type are the SDK's job). Only
      Anthropic needs one: the explicit opt-in that allows a browser-origin
      call with a BYO key. The keyless probe (validate.ts) reuses it, so the
      opt-in can't drift between the chat path and the Test button. */
  requiredHeaders: Readonly<Record<string, string>>

  /** The default model id when the user hasn't typed one. MUST equal the
      matching field in domain/types.ts DEFAULT_SETTINGS (asserted in
      contract.test.ts) so the picker default and the adapter fallback can't
      diverge. */
  defaultModel: string

  /** Pre-tool reasoning capture (#166). null ⇒ this provider's MEW path can't
      surface a thinking stream, so `showReasoning` is a no-op for it (OpenAI,
      Ollama). When set, the adapter asks the model to think before acting and
      streams that plan back.
        · budgetTokens — the model's internal thinking budget. Anthropic's
          extended thinking requires ≥ 1024; this is the room to plan, NOT what
          the user sees.
        · displayChars — the visible slice cap on the captured plan, so the note
          stays short (the AC's ≤300 tokens ≈ ~1200 chars; we sit well under). */
  reasoning: { budgetTokens: number; displayChars: number } | null
}

/* Anthropic — BYO key, browser-direct through the SDK provider. `max_tokens` is
   required by the Messages API; 32000 sits inside every current model's output
   cap (128K on claude-sonnet-5, 64K on the smallest, Haiku 4.5 — and the model
   field is freeform, so the ceiling must be safe whichever the user types). It
   is intentionally unreachable for a 1–3 sentence MEW turn — it exists as the
   runaway-cost guard on the user's own key, not a target. */
const ANTHROPIC: ProviderContract = {
  tokenLimitParam: 'max_tokens',
  tokenCeiling: 32000,
  // the SDK sets x-api-key + anthropic-version; the browser-direct opt-in is
  // the one header MEW must add itself (key stays on-device, sent only to
  // api.anthropic.com — the privacy law this header exists to serve).
  requiredHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
  defaultModel: 'claude-sonnet-5',
  /* extended thinking (#166): the AI SDK surfaces it as a reasoning stream.
     HOW to request it is model-dependent (see anthropicThinking below); the
     budget here only reaches pre-4.6 models. 1500 is just above Anthropic's
     1024 minimum — enough headroom to plan a multi-item placement without
     inviting a long, costly deliberation; the visible slice is capped tighter. */
  reasoning: { budgetTokens: 1500, displayChars: 600 },
}

/** How to ask a given Anthropic model to think (#166). The wire changed under
    us: 4.6+ models (and the whole 5 family) take `thinking: {type: 'adaptive'}`
    and REJECT the old `budget_tokens` with a 400 — the deprecated shape on 4.6
    became an error on Sonnet 5 / Opus 4.7+ / Fable 5. Pre-4.6 models are the
    inverse: they still require the explicit budget. Parsed from the model id
    (family-first, `claude-<family>-<major>[-<minor>]`) so the freeform Settings
    field keeps working for either generation; legacy version-first ids
    (`claude-3-5-sonnet-…`) don't match and correctly fall to the budget shape. */
export function anthropicThinking(
  model: string
): { type: 'adaptive' } | { type: 'enabled'; budgetTokens: number } {
  const m = /^claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/.exec(model)
  const major = m ? parseInt(m[1], 10) : 0
  const minor = m?.[2] ? parseInt(m[2], 10) : 0
  const adaptive = major > 4 || (major === 4 && minor >= 6)
  return adaptive
    ? { type: 'adaptive' }
    : { type: 'enabled', budgetTokens: ANTHROPIC.reasoning!.budgetTokens }
}

/* OpenAI — BYO key through the SDK provider, which speaks the Responses API
   (`/v1/responses`); its cap field is `max_output_tokens`, and the deprecated
   `max_tokens` the gpt-5.x family rejects can never reappear (wire-pinned).
   1024 is ample for MEW's voice and well within the model's output cap. */
const OPENAI: ProviderContract = {
  tokenLimitParam: 'max_output_tokens',
  tokenCeiling: 1024,
  requiredHeaders: {}, // SDK sets Authorization + Content-Type
  defaultModel: 'gpt-5.4-mini',
  /* MEW doesn't request reasoning summaries on the Responses path; leave it
     off rather than ship a half-feature (#166). */
  reasoning: null,
}

/* Ollama — fully local, through the SDK's openai-compatible provider against
   the user's server (`<ollamaUrl>/v1`). MEW sends no token cap (the server
   default governs, exactly as the retired hand-rolled adapter left it). */
const OLLAMA: ProviderContract = {
  tokenLimitParam: null,
  tokenCeiling: null,
  requiredHeaders: {}, // SDK sets Content-Type; a local server needs no auth
  defaultModel: 'llama3.2',
  reasoning: null, // local path: no reasoning stream wired (#166)
}

/** The single source of truth. The adapter READS from this; it never
    re-declares the ceiling, headers, or default model. */
export const PROVIDER_CONTRACT: Readonly<Record<ProviderKey, ProviderContract>> = {
  anthropic: ANTHROPIC,
  openai: OPENAI,
  ollama: OLLAMA,
}

/** The DEFAULT_SETTINGS field each provider's default model must match — the
    join contract.test.ts checks so the contract and the app defaults stay in
    lockstep. */
export const DEFAULT_MODEL_SETTING: Readonly<Record<ProviderKey, keyof Settings>> = {
  anthropic: 'anthropicModel',
  openai: 'openaiModel',
  ollama: 'ollamaModel',
}
