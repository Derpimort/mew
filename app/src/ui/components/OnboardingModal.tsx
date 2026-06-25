/* First-run concept tour (#160) — three skippable steps that teach MEW's
   mental model before the week can frustrate: Focus shows the now, Week shows
   the shape, Talk changes either. Rendered post-hydration by MainPage only
   while Settings.hasSeenOnboarding is false; skip / complete / close all set
   the flag and persist, and it never returns (learn-in-context after).

   Illustrations are inline SVG in the live pet palette — no GIF, no remote
   asset, nothing for the CSP to block. Voice stays positive: this is an
   invitation, never a warning. */

import { useEffect, useId, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useMew } from '../../state/store'
import { Button } from '../primitives'

interface Step {
  key: string
  eyebrow: string
  title: string
  body: string
  art: () => ReactElement
}

/* the dial: two rings + a now-hand sweeping the current block — the Focus view
   distilled to its read (a block, a countdown, a center) */
function DialArt() {
  return (
    <svg
      viewBox="0 0 240 150"
      role="img"
      aria-label="A dial showing the current block and a minute countdown"
      className="ob-art-svg"
    >
      <defs>
        <linearGradient id="ob-dial-arc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--pa)" />
          <stop offset="1" stopColor="var(--pb)" />
        </linearGradient>
      </defs>
      <circle cx="120" cy="75" r="52" fill="none" stroke="var(--line)" strokeWidth="10" />
      {/* the live block, ~40% of the ring */}
      <circle
        cx="120"
        cy="75"
        r="52"
        fill="none"
        stroke="url(#ob-dial-arc)"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray="131 196"
        strokeDashoffset="33"
        transform="rotate(-90 120 75)"
      />
      <circle
        cx="120"
        cy="75"
        r="34"
        fill="none"
        stroke="var(--line)"
        strokeWidth="2"
        opacity="0.6"
      />
      {/* now-hand */}
      <line
        x1="120"
        y1="75"
        x2="120"
        y2="34"
        stroke="var(--pa)"
        strokeWidth="2.5"
        strokeLinecap="round"
        transform="rotate(54 120 75)"
      />
      <circle cx="120" cy="75" r="4" fill="var(--pa)" />
      <text x="120" y="71" textAnchor="middle" className="ob-art-num">
        47
      </text>
      <text x="120" y="86" textAnchor="middle" className="ob-art-cap">
        min left
      </text>
    </svg>
  )
}

/* the week: seven columns, fixed blocks pinned, flexible tasks flowing around */
function WeekArt() {
  const cols = [0, 1, 2, 3, 4, 5, 6]
  /* per-column [y, h, fixed] block stacks — fixed (calls/meetings) read solid */
  const stacks: { y: number; h: number; fixed: boolean }[][] = [
    [
      { y: 18, h: 22, fixed: false },
      { y: 46, h: 14, fixed: true },
    ],
    [
      { y: 18, h: 36, fixed: true },
      { y: 60, h: 18, fixed: false },
    ],
    [
      { y: 26, h: 16, fixed: false },
      { y: 48, h: 20, fixed: false },
    ],
    [{ y: 18, h: 30, fixed: true }],
    [
      { y: 22, h: 18, fixed: false },
      { y: 46, h: 22, fixed: true },
    ],
    [{ y: 30, h: 14, fixed: false }],
    [{ y: 24, h: 20, fixed: false }],
  ]
  return (
    <svg
      viewBox="0 0 240 150"
      role="img"
      aria-label="A week of seven day columns with fixed and flexible blocks"
      className="ob-art-svg"
    >
      {cols.map((c) => {
        const x = 10 + c * 32
        return (
          <g key={c}>
            <rect
              x={x}
              y={10}
              width={26}
              height={120}
              rx={5}
              fill="var(--panel2)"
              stroke="var(--line)"
            />
            {stacks[c].map((b, i) => (
              <rect
                key={i}
                x={x + 4}
                y={b.y}
                width={18}
                height={b.h}
                rx={3}
                fill={b.fixed ? 'var(--pa)' : 'var(--ice-soft)'}
                stroke={b.fixed ? 'var(--pa)' : 'var(--ice-bd)'}
                opacity={b.fixed ? 0.9 : 1}
              />
            ))}
          </g>
        )
      })}
    </svg>
  )
}

/* talk: a composer bubble with a typed line and a send affordance */
function TalkArt() {
  return (
    <svg
      viewBox="0 0 240 150"
      role="img"
      aria-label="A message composer turning a sentence into scheduled blocks"
      className="ob-art-svg"
    >
      {/* the mew reply line */}
      <rect
        x="20"
        y="22"
        width="150"
        height="14"
        rx="7"
        fill="var(--ice-soft)"
        stroke="var(--ice-bd)"
      />
      <rect x="20" y="44" width="110" height="10" rx="5" fill="var(--line)" />
      {/* the composer */}
      <rect
        x="20"
        y="98"
        width="200"
        height="34"
        rx="11"
        fill="var(--panel2)"
        stroke="var(--ice-bd)"
      />
      <rect x="32" y="110" width="120" height="9" rx="4.5" fill="var(--muted)" opacity="0.55" />
      <circle cx="202" cy="115" r="11" fill="var(--ice)" />
      <path
        d="M197 115 h10 M203 111 l4 4 -4 4"
        fill="none"
        stroke="var(--on-acc)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const STEPS: Step[] = [
  {
    key: 'focus',
    eyebrow: 'Focus dial',
    title: 'See your now, minute by minute',
    body: 'The dial shows the block you’re in and counts it down. Start it now, mark it done, or move it — whatever the moment needs.',
    art: DialArt,
  },
  {
    key: 'week',
    eyebrow: 'Week grid',
    title: 'All seven days in one place',
    body: 'Fixed blocks — calls, meetings — stay put. Your tasks flow around them, so the week always holds a shape you can keep.',
    art: WeekArt,
  },
  {
    key: 'talk',
    eyebrow: 'Talk to schedule',
    title: 'Say it, and the week moves',
    body: 'Tell MEW “block Thursday morning for the deck” and the blocks move to match. It works the way you already think.',
    art: TalkArt,
  },
]

export function OnboardingModal() {
  const dismiss = useMew((s) => s.dismissOnboarding)
  const [i, setI] = useState(0)
  const titleId = useId()
  const bodyId = useId()
  const primaryRef = useRef<HTMLButtonElement>(null)

  const step = STEPS[i]
  const first = i === 0
  const last = i === STEPS.length - 1

  const back = () => setI((n) => Math.max(0, n - 1))
  const next = () => (last ? dismiss() : setI((n) => Math.min(STEPS.length - 1, n + 1)))

  /* Esc skips the whole tour (it's always skippable). Focus lands on the
     forward action so keyboard users can step or finish straight away. */
  useEffect(() => {
    primaryRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        dismiss()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dismiss])

  const Art = step.art

  return (
    <div
      className="ob-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <div className="ob-card">
        <button type="button" className="ob-skip" onClick={dismiss}>
          Skip all
        </button>

        <div className="ob-art" key={step.key} aria-hidden="true">
          <Art />
        </div>

        <div className="ob-eyebrow mono">{step.eyebrow}</div>
        <h2 id={titleId} className="ob-title disp">
          {step.title}
        </h2>
        <p id={bodyId} className="ob-body">
          {step.body}
        </p>

        <div className="ob-dots" aria-hidden="true">
          {STEPS.map((s, n) => (
            <span key={s.key} className={'ob-dot' + (n === i ? ' on' : '')} />
          ))}
        </div>

        <div className="ob-nav">
          <Button
            variant="ghost"
            size="sm"
            onClick={back}
            disabled={first}
            aria-label="Previous step"
          >
            Back
          </Button>
          <span className="ob-count mono" aria-hidden="true">
            {i + 1} / {STEPS.length}
          </span>
          <Button ref={primaryRef} variant="primary" size="sm" onClick={next}>
            {last ? 'Start' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
