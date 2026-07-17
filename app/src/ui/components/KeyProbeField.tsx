/* The "paste a key and test it" interaction, extracted so the guided setup
   (#161, ApiKeySetupFlow) and the first-run onboarding (#306) share ONE probe
   surface instead of two that must be kept in visual + behavioural lockstep.
   The force is real: both places ask the same question ("will this key be
   accepted?"), in the same positive voice, against the same on-device probe
   (validate.ts) — a change to that interaction changes both, so it lives once.

   It changes nothing on its own: the key it gathers is handed up via
   onValidated only AFTER the harmless listing probe passes (validateKey — a GET
   to /v1/models, no chat turn, no tokens, no week mutation). The key still
   leaves the device solely to its own provider host (privacy law). Tokens +
   primitives only; the class names mirror the ApiKeySetupFlow markup so the
   card styling is unchanged. */

import { useState } from 'react'
import { Button } from '../primitives'
import {
  defaultModelFor,
  probeMessage,
  validateKey,
  type KeyProbe,
  type RemoteProvider,
} from '../../adapters/model'

const HOST_LABEL: Record<RemoteProvider, string> = { anthropic: 'Anthropic', openai: 'OpenAI' }

type TestState =
  { phase: 'idle' } | { phase: 'testing' } | { phase: 'ok' } | { phase: 'error'; message: string }

export interface KeyProbeFieldProps {
  provider: RemoteProvider
  /** The model id to confirm during the probe (so a bad model id surfaces in
      setup, not on the first turn). Defaults to the provider's contract model. */
  model?: string
  /** Called with the validated key once the probe passes — the caller saves it
      (the only mutation path) and moves on. */
  onValidated: (key: string) => void
  /** Injected only by tests; production uses the global fetch via validateKey. */
  validate?: typeof validateKey
  autoFocus?: boolean
}

export function KeyProbeField({
  provider,
  model,
  onValidated,
  validate = validateKey,
  autoFocus = true,
}: KeyProbeFieldProps) {
  const [key, setKey] = useState('')
  const [test, setTest] = useState<TestState>({ phase: 'idle' })
  const host = HOST_LABEL[provider]

  const runTest = async () => {
    const trimmed = key.trim()
    if (!trimmed) {
      setTest({ phase: 'error', message: `Paste your ${host} key first.` })
      return
    }
    setTest({ phase: 'testing' })
    let result: KeyProbe
    try {
      result = await validate(provider, trimmed, model ?? defaultModelFor(provider))
    } catch {
      // validateKey never throws, but never trust that from the UI.
      result = { ok: false, reason: 'unknown' }
    }
    if (result.ok) {
      setTest({ phase: 'ok' })
      // brief beat so the "✓ connected" reads, then hand the key up to be saved
      onValidated(trimmed)
    } else {
      setTest({ phase: 'error', message: probeMessage(result.reason, provider) })
    }
  }

  return (
    <>
      <span className="keyfield aks-key">
        <input
          autoFocus={autoFocus}
          type="password"
          aria-label={`${host} API key`}
          placeholder={provider === 'openai' ? 'sk-…' : 'sk-ant-…'}
          value={key}
          onChange={(e) => {
            setKey(e.target.value)
            if (test.phase !== 'idle') setTest({ phase: 'idle' })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runTest()
          }}
        />
      </span>
      <div className="aks-row">
        <Button
          variant="primary"
          size="sm"
          onClick={() => void runTest()}
          disabled={test.phase === 'testing'}
        >
          {test.phase === 'testing'
            ? 'testing…'
            : test.phase === 'error'
              ? 'try again'
              : 'test key'}
        </Button>
        {test.phase === 'ok' && <span className="aks-ok">✓ connected — saving…</span>}
      </div>
      {test.phase === 'error' && (
        <p className="aks-err" role="alert">
          {test.message}
        </p>
      )}
    </>
  )
}
