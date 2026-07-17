/* The three guided first-run steps (#306) that follow the #160 concept tour —
   the release's own demo of itself. Each is a panel inside the OnboardingModal
   shell (scrim + card + "Skip all"), and each has a "later" that advances the
   cursor WITHOUT writing a setting, so skipping any step leaves clean defaults:
   the keyless rules floor, a local-only calendar, an empty but tour-done week.

   Laws in play: keys never leave the device (the key step reuses the local
   probe via KeyProbeField); positive voice (every "later" is a working state,
   never a warning); chat-first (the plan step's suggestion becomes a REAL
   speak() turn — the same door typing it would use — not a wizard mutation).
   Tokens + primitives only. */

import { useState } from 'react'
import { useMew } from '../../state/store'
import { Button } from '../primitives'
import { KeyProbeField } from './KeyProbeField'
import { consoleUrl } from '../../adapters/model'
import { OAUTH_PORTS } from '../../adapters/desktop'

/** Google's own credentials console — where the user makes the OAuth client
    MEW signs in with (MEW has no server, so the client ID is theirs, like the
    model key). The loopback redirect URIs below are added to that client. */
const GOOGLE_CONSOLE_URL = 'https://console.cloud.google.com/apis/credentials'

/** Props every guided step takes: the dialog's title/body ids, so its heading
    is what `aria-labelledby`/`aria-describedby` on the shared scrim resolve to
    in this step (the label tracks the visible panel). */
export interface OnboardingStepProps {
  titleId: string
  bodyId: string
}

/** The step's shared header — an eyebrow, a title, and one body line. Keeps the
    three panels visually identical to the tour's own typography, and carries
    the dialog's labelling ids. */
function StepHead({
  eyebrow,
  title,
  body,
  titleId,
  bodyId,
}: { eyebrow: string; title: string; body: string } & OnboardingStepProps) {
  return (
    <>
      <div className="ob-eyebrow mono">{eyebrow}</div>
      <h2 id={titleId} className="ob-title disp">
        {title}
      </h2>
      <p id={bodyId} className="ob-body">
        {body}
      </p>
    </>
  )
}

/** The step's shared footer — a "later" that never breaks anything on the left,
    the forward action on the right. `laterHint` states the working state the
    user lands on, in positive voice. */
function StepFoot({
  laterLabel,
  laterHint,
  onLater,
  children,
}: {
  laterLabel: string
  laterHint: string
  onLater: () => void
  children: React.ReactNode
}) {
  return (
    <div className="ob-foot">
      <button type="button" className="ob-later" onClick={onLater} title={laterHint}>
        {laterLabel}
      </button>
      {children}
    </div>
  )
}

/* ── Step 1 · Keys ───────────────────────────────────────────────────────── */

export function OnboardingKeysStep({ titleId, bodyId }: OnboardingStepProps) {
  const provider = useMew((s) => s.settings.remoteProvider)
  const anthropicModel = useMew((s) => s.settings.anthropicModel)
  const openaiModel = useMew((s) => s.settings.openaiModel)
  const updateSettings = useMew((s) => s.updateSettings)
  const advance = useMew((s) => s.advanceOnboarding)
  const host = provider === 'openai' ? 'OpenAI' : 'Anthropic'
  // empty ⇒ let the probe fall back to the contract default (an empty id would
  // 404 as "unknown model"); a real chosen id is confirmed as part of the probe.
  const model = (provider === 'openai' ? openaiModel : anthropicModel).trim() || undefined

  const save = (key: string) => {
    updateSettings(provider === 'openai' ? { openaiKey: key } : { anthropicKey: key })
    advance()
  }

  return (
    <div className="ob-guide">
      <StepHead
        titleId={titleId}
        bodyId={bodyId}
        eyebrow="Step 1 of 3 · your key"
        title="Understand looser asks"
        body={`MEW already plans from plain phrases. Your own ${host} key lets it hold a real back-and-forth — and it never leaves this device.`}
      />
      <p className="ob-mini mono">
        Need one?{' '}
        <a href={consoleUrl(provider)} target="_blank" rel="noreferrer noopener">
          open {host} keys ↗
        </a>{' '}
        — free to create, then paste it here.
      </p>
      <KeyProbeField provider={provider} model={model} onValidated={save} />
      <StepFoot
        laterLabel="later — stay keyless"
        laterHint="The keyless floor stays: plain phrases like “block 90m for the deck” already work."
        onLater={advance}
      >
        <span className="ob-count mono" aria-hidden="true">
          test a key to continue
        </span>
      </StepFoot>
    </div>
  )
}

/* ── Step 2 · Calendar ───────────────────────────────────────────────────── */

/** One copyable redirect URI. The token comes back to this device on the
    loopback, so these are exactly the URIs the user's OAuth client must allow. */
function RedirectUri({ uri }: { uri: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(uri)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked (no permission / insecure context) — the URI is
         visible to copy by hand; nothing to surface. */
    }
  }
  return (
    <li className="ob-uri">
      <code className="mono">{uri}</code>
      <button type="button" className="ob-copy mono" onClick={() => void copy()}>
        {copied ? 'copied ✓' : 'copy'}
      </button>
    </li>
  )
}

export function OnboardingCalendarStep({ titleId, bodyId }: OnboardingStepProps) {
  const clientId = useMew((s) => s.settings.googleClientId)
  const updateSettings = useMew((s) => s.updateSettings)
  const advance = useMew((s) => s.advanceOnboarding)
  const [draft, setDraft] = useState(clientId)

  const save = () => {
    const v = draft.trim()
    if (v) updateSettings({ googleClientId: v })
    advance()
  }

  return (
    <div className="ob-guide">
      <StepHead
        titleId={titleId}
        bodyId={bodyId}
        eyebrow="Step 2 of 3 · your calendar"
        title="Sync it, both ways"
        body="MEW has no server — it signs in as you and the token comes straight back to this device through a local redirect, never through anyone else."
      />
      <p className="ob-mini mono">
        In{' '}
        <a href={GOOGLE_CONSOLE_URL} target="_blank" rel="noreferrer noopener">
          Google Cloud console ↗
        </a>
        , make an OAuth client (Web) and add these three redirect URIs:
      </p>
      <ul className="ob-uris">
        {OAUTH_PORTS.map((port) => (
          <RedirectUri key={port} uri={`http://localhost:${port}`} />
        ))}
      </ul>
      <label className="ob-mini mono" htmlFor="ob-client-id">
        then paste the client ID:
      </label>
      <span className="keyfield ob-clientid">
        <input
          id="ob-client-id"
          type="text"
          aria-label="Google OAuth client ID"
          placeholder="xxxxxxxx.apps.googleusercontent.com"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
          }}
        />
      </span>
      <StepFoot
        laterLabel="later — stay local-only"
        laterHint="Your week stays on this device. Connect a calendar anytime from Settings."
        onLater={advance}
      >
        <Button variant="primary" size="sm" disabled={!draft.trim()} onClick={save}>
          save client ID
        </Button>
      </StepFoot>
    </div>
  )
}

/* ── Step 3 · Plan today ─────────────────────────────────────────────────── */

/** A first braindump the user edits, then sends. Every clause names its own
    "block …" so the keyless grammar parses one place per clause (≥3 un-pinned
    items route to the scenario picker, #293); a keyed model reads it just as
    naturally. Titles avoid the seeded week so the placed blocks are provably
    from THIS plan. */
const CANNED_BRAINDUMP =
  'block the launch plan, block quarterly goals, block a coffee chat, block personal errands'

export function OnboardingPlanStep({ titleId, bodyId }: OnboardingStepProps) {
  const speak = useMew((s) => s.speak)
  const advance = useMew((s) => s.advanceOnboarding)
  const [text, setText] = useState(CANNED_BRAINDUMP)

  const planIt = () => {
    const dump = text.trim()
    // complete onboarding FIRST so the modal clears and the picker + reply are
    // what the user sees; then send it as an ordinary turn (chat-first law).
    advance()
    if (dump) void speak(dump)
  }

  return (
    <div className="ob-guide">
      <StepHead
        titleId={titleId}
        bodyId={bodyId}
        eyebrow="Step 3 of 3 · plan today"
        title="Say it, watch it land"
        body="Here's a first braindump — edit it to your real day. MEW lays out a few ways the week could hold it; you pick the one that fits."
      />
      <textarea
        autoFocus
        className="ob-dump"
        aria-label="your first braindump"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <StepFoot
        laterLabel="later — an empty week"
        laterHint="The week stays open. Talk to MEW whenever you're ready."
        onLater={advance}
      >
        <Button variant="primary" size="sm" disabled={!text.trim()} onClick={planIt}>
          plan my day →
        </Button>
      </StepFoot>
    </div>
  )
}
