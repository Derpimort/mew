/* The model-adapter contract — ONE source of truth for the per-provider request
   quirks that the three adapters (anthropic.ts / openai.ts / ollama.ts) would
   otherwise inline as bare literals. Centralised so a provider quirk can't drift
   across three files: the class of bug where OpenAI shipped `max_tokens` on a
   model that only accepts `max_completion_tokens` (a 400 every turn → silent
   fall to the rules floor) is now a single edit here, guarded by contract.test.ts.

   Pure data + types. No SDK, no fetch, no I/O — importable from a unit test. */

import type { Settings } from '../../domain/types'

/** The provider keys MEW can place a remote/local model call through. The
    deterministic `rules` floor isn't a network provider, so it has no contract. */
export type ProviderKey = 'anthropic' | 'openai' | 'ollama'

export interface ProviderContract {
  /** The request field that caps generated tokens. This is the quirk that bit
      us: OpenAI's newer models (the gpt-5.x family, incl. the default below)
      reject the legacy `max_tokens` and require `max_completion_tokens`
      (platform.openai.com/docs/api-reference/chat/create — `max_tokens` is
      deprecated, "not compatible with o-series and newer models"). Anthropic
      uses `max_tokens` (docs.claude.com/en/api/messages — required field).
      Ollama's /api/chat takes neither — it caps via `options.num_predict`, which
      MEW leaves at the server default, so this is null. */
  tokenLimitParam: 'max_tokens' | 'max_completion_tokens' | null

  /** A safe ceiling for `tokenLimitParam`, chosen to sit WITHIN the default
      model's output cap so a request can never 400 on an over-limit value.
      null when the provider has no token-limit param (Ollama). */
  tokenCeiling: number | null

  /** Headers the adapter must send on the wire. The Anthropic adapter goes
      through `@anthropic-ai/sdk`, which sets Authorization + anthropic-version
      itself, so its contract carries none. OpenAI/Ollama hit `fetch` directly
      and set these explicitly (the `Authorization: Bearer <key>` value is filled
      per-request from the on-device key — only the static headers live here). */
  requiredHeaders: Readonly<Record<string, string>>

  /** The default model id when the user hasn't typed one. MUST equal the
      matching field in domain/types.ts DEFAULT_SETTINGS (asserted in
      contract.test.ts) so the picker default and the adapter fallback can't
      diverge. */
  defaultModel: string
}

/* Anthropic — BYO key, browser-direct via the SDK. `max_tokens` is required by
   the Messages API; 32000 sits inside claude-sonnet-4-6's 64K output cap. It is
   intentionally unreachable for a 1–3 sentence MEW turn — it exists as the
   runaway-cost guard on the user's own key (see anthropic.ts), not a target. */
const ANTHROPIC: ProviderContract = {
  tokenLimitParam: 'max_tokens',
  tokenCeiling: 32000,
  requiredHeaders: {}, // SDK sets Authorization + anthropic-version
  defaultModel: 'claude-sonnet-4-6',
}

/* OpenAI — BYO key, plain REST (chat completions). The default gpt-5.4-mini
   rejects `max_tokens`; the param name MUST be `max_completion_tokens`. 1024 is
   ample for MEW's voice and well within the model's output cap. */
const OPENAI: ProviderContract = {
  tokenLimitParam: 'max_completion_tokens',
  tokenCeiling: 1024,
  requiredHeaders: { 'Content-Type': 'application/json' },
  defaultModel: 'gpt-5.4-mini',
}

/* Ollama — fully local, plain REST (/api/chat). No token-limit param on the
   request (the server default governs); the JSON-mode header is the only static
   one MEW sets. */
const OLLAMA: ProviderContract = {
  tokenLimitParam: null,
  tokenCeiling: null,
  requiredHeaders: { 'Content-Type': 'application/json' },
  defaultModel: 'llama3.2',
}

/** The single source of truth. Adapters READ from this; they never re-declare
    the param name, ceiling, headers, or default model. */
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
