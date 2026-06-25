/* Guided in-app API-key setup (#161). A three-step modal — Why? → Get key →
   Paste & test — that turns the dense Privacy & model form into a path a
   first-time user can follow. It changes nothing on its own: the key it gathers
   is handed back via onDone and only the SettingsPage executor writes it; the
   Test step runs a HARMLESS listing probe (validate.ts), never a chat turn, so
   nothing is scheduled and no generation is spent. Close (Esc / backdrop / ✕)
   and the rules floor is exactly where it was — zero-key usability is untouched.

   Provider-aware: the card already offers Anthropic or OpenAI, so the flow
   reads the active provider and points Step 2 at the right keys page. Tokens +
   primitives only (Button, .keyfield, the same vars the cards use). */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../primitives'
import {
  consoleUrl,
  defaultModelFor,
  probeMessage,
  validateKey,
  type KeyProbe,
  type RemoteProvider,
} from '../../adapters/model'

type Step = 0 | 1 | 2
const STEPS = ['Why?', 'Get a key', 'Paste & test'] as const

type TestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'ok' }
  | { phase: 'error'; message: string }

export interface ApiKeySetupFlowProps {
  provider: RemoteProvider
  /** The model id to confirm during the probe (so a bad model id surfaces in
      setup, not on the first turn). Defaults to the provider's contract model. */
  model?: string
  /** Called with the validated key once the probe passes — the parent saves it
      (the only mutation path) and closes the flow. */
  onDone: (key: string) => void
  onClose: () => void
  /** Injected only by tests; production uses the global fetch. */
  validate?: typeof validateKey
  /** Which step to open on. Production always starts at the beginning (0); a
      test renders a later step directly (the headless env can't click through). */
  initialStep?: Step
}

const HOST_LABEL: Record<RemoteProvider, string> = { anthropic: 'Anthropic', openai: 'OpenAI' }

/** Terse, copy-pasteable instructions for the provider's console — handed to the
    clipboard so a user on another device (or reading to someone) has the steps. */
function instructionsFor(provider: RemoteProvider): string {
  return provider === 'openai'
    ? [
        '1. Open platform.openai.com/api-keys',
        '2. Sign in, then "Create new secret key"',
        '3. Copy the key (starts with sk-) and paste it into MEW',
      ].join('\n')
    : [
        '1. Open console.anthropic.com/keys',
        '2. Sign in, then "Create Key"',
        '3. Copy the key (starts with sk-ant-) and paste it into MEW',
      ].join('\n')
}

export function ApiKeySetupFlow({
  provider,
  model,
  onDone,
  onClose,
  validate = validateKey,
  initialStep = 0,
}: ApiKeySetupFlowProps) {
  const [step, setStep] = useState<Step>(initialStep)
  const [key, setKey] = useState('')
  const [test, setTest] = useState<TestState>({ phase: 'idle' })
  const [copied, setCopied] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const host = HOST_LABEL[provider]

  /* Esc closes; focus moves into the dialog on open (WCAG 2.1 — keyboard + focus
     management). Restore focus to whatever had it when we close. */
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      prev?.focus?.()
    }
  }, [onClose])

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
      onDone(trimmed)
    } else {
      setTest({ phase: 'error', message: probeMessage(result.reason, provider) })
    }
  }

  const copyInstructions = async () => {
    try {
      await navigator.clipboard?.writeText(instructionsFor(provider))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked (no permission / insecure context) — the visible link
         is the fallback; nothing to surface. */
    }
  }

  const body = (
    <div
      className={portalShell()}
      data-pet={portalAttr('data-pet')}
      data-uifont={portalAttr('data-uifont')}
    >
      <div
        className="aks-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          ref={dialogRef}
          className="aks-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="aks-title"
          tabIndex={-1}
        >
          <div className="aks-head">
            <div>
              <h2 id="aks-title" className="aks-title">
                Set up AI
              </h2>
              <div className="aks-sub">
                Your own {host} key unlocks natural language — and it never leaves this device.
              </div>
            </div>
            <button type="button" className="aks-x" aria-label="Close setup" onClick={onClose}>
              ✕
            </button>
          </div>

          <ol className="aks-steps" aria-hidden>
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={'aks-dot' + (i === step ? ' on' : '') + (i < step ? ' done' : '')}
              >
                <span className="aks-dot-n">{i + 1}</span>
                <span className="aks-dot-l">{label}</span>
              </li>
            ))}
          </ol>

          <div className="aks-panel">
            {step === 0 && (
              <div className="aks-step">
                <p className="aks-lead">Why connect a key?</p>
                <p className="aks-copy">
                  Without one, MEW already plans from plain phrases — "block 90m for the deck
                  tomorrow" just works. A key lets MEW understand looser, longer asks and hold a
                  real back-and-forth about your week.
                </p>
                <p className="aks-copy aks-floor">
                  You can skip this anytime. The keyless floor stays — nothing breaks without a key.
                </p>
              </div>
            )}

            {step === 1 && (
              <div className="aks-step">
                <p className="aks-lead">Get a key from {host}</p>
                <p className="aks-copy">
                  Keys are free to create and live in your {host} account. Open the keys page, make
                  one, and copy it.
                </p>
                <div className="aks-row">
                  <a
                    className="btn btn-primary btn-sm"
                    href={consoleUrl(provider)}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open {host} keys ↗
                  </a>
                  <Button variant="ghost" size="sm" onClick={() => void copyInstructions()}>
                    {copied ? 'copied ✓' : 'copy steps'}
                  </Button>
                </div>
                <p className="aks-copy aks-floor">
                  It opens in a new tab — come back here when you have the key.
                </p>
              </div>
            )}

            {step === 2 && (
              <div className="aks-step">
                <p className="aks-lead">Paste & test</p>
                <p className="aks-copy">
                  Paste the key below and test it. The test only checks that {host} accepts it — it
                  doesn't touch your week.
                </p>
                <span className="keyfield aks-key">
                  <input
                    autoFocus
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
              </div>
            )}
          </div>

          <div className="aks-foot">
            <button
              type="button"
              className="navlink"
              onClick={() => (step === 0 ? onClose() : setStep((s) => (s - 1) as Step))}
            >
              {step === 0 ? 'cancel' : '← back'}
            </button>
            {step < 2 ? (
              <Button variant="primary" size="sm" onClick={() => setStep((s) => (s + 1) as Step)}>
                next →
              </Button>
            ) : (
              <span className="aks-foot-hint">paste a key and test it to finish</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  // Portal to <body> so the dialog escapes the settings grid's stacking + overflow.
  return typeof document !== 'undefined' ? createPortal(body, document.body) : body
}

/* The app root carries the theme classes (`stl nx ns sys [sys--light]`) and the
   pet/font data-attrs that the tokens + `.stl`-scoped primitives resolve against.
   A body-level portal lands OUTSIDE that root, so we mirror them onto the portal
   shell — read live from the existing root so the modal always matches the
   current theme without re-subscribing to the store. */
function rootEl(): HTMLElement | null {
  return typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>('[data-pet].stl')
    : null
}
function portalShell(): string {
  const cls = rootEl()?.className
  // keep only the theme-bearing tokens; drop any layout/height classes a root might carry
  const keep = new Set(['stl', 'nx', 'ns', 'sys', 'sys--light'])
  const base = (cls ?? 'stl nx ns sys')
    .split(/\s+/)
    .filter((c) => keep.has(c))
    .join(' ')
  return `${base} aks-portal`
}
function portalAttr(name: 'data-pet' | 'data-uifont'): string | undefined {
  return rootEl()?.getAttribute(name) ?? (name === 'data-pet' ? 'cat' : undefined)
}
