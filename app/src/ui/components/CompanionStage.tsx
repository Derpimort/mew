/* The companion stage (PRD §3a) — a fixed-size box reserved for the animated
   3D/vector companion. The companion body is the React Bits AIBlob, driven
   live by pixie state: mood picks the colors, pace sets the speed, a waiting
   nudge raises the glow. The cat keeps her low-poly portrait and gains the
   blob as an aura; every other pet is the blob itself. Condition shows
   through the companion, never as a metric. */

import { Suspense, lazy, useEffect, useState } from 'react'
import { useMew, usePixie } from '../../state/store'
import { pixieCopy } from '../../domain/pixie'
import { petById } from '../primitives/pets'
import { usePetPalette } from './petPalette'

const AIBlob = lazy(() => import('../react-bits/ai-blob'))

export function CompanionStage() {
  const live = usePixie()
  const settings = useMew((s) => s.settings)
  const celebratePulse = useMew((s) => s.celebratePulse)
  const pal = usePetPalette()

  const [celebrating, setCelebrating] = useState(false)
  useEffect(() => {
    if (!celebratePulse) return
    // Intentional: a store pulse starts a transient 3.5s celebration that the
    // timer clears itself. The setState begins a self-contained animation, not a
    // render-derived value, so this stays in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- transient timed animation kicked off by an external store pulse
    setCelebrating(true)
    const t = setTimeout(() => setCelebrating(false), 3500)
    return () => clearTimeout(t)
  }, [celebratePulse])

  const pet = petById(settings.pet)
  const copy = pixieCopy(live, settings.mewName)
  const status = celebrating ? 'celebrating your mew' : copy.status

  /* condition → blob: pace drives motion, mood drives color, attention glows */
  const speed = celebrating ? 1.8 : live.resting ? 0.35 : 0.45 + live.pace * 0.85
  const glow = celebrating || live.attention ? 1 : 0.5 + live.pace * 0.35
  const colors =
    live.mood === 'healthy'
      ? [pal.pa, pal.pb, pal.pa]
      : live.mood === 'drowsy'
        ? [pal.pa, pal.muted, pal.pb]
        : [pal.muted, pal.pa, pal.muted]

  return (
    <div className="stage">
      <div className="stage-tag">companion · 3D / vector · animated</div>
      <div className="stage-live">live</div>
      <div className="stage-floor" />
      <div className="stage-pet">
        {settings.pet === 'cat' ? (
          <>
            <Suspense fallback={null}>
              <div
                style={{ position: 'absolute', inset: -34, opacity: 0.55, pointerEvents: 'none' }}
                aria-hidden
              >
                <AIBlob
                  size={256}
                  animationSpeed={speed}
                  glowIntensity={glow}
                  colors={colors}
                  resolution={0.75}
                />
              </div>
            </Suspense>
            <img
              src="/pixie-poly-face.svg"
              alt={settings.mewName}
              draggable="false"
              style={{ position: 'relative', zIndex: 1 }}
            />
          </>
        ) : (
          <Suspense
            fallback={
              <div className="pet-blank">
                {settings.mewName}
                <br />
                3D companion
                <br />
                <span style={{ color: 'var(--faint)' }}>
                  art per pet · {pet.name.toLowerCase()}
                </span>
              </div>
            }
          >
            <AIBlob size={188} animationSpeed={speed} glowIntensity={glow} colors={colors} />
          </Suspense>
        )}
      </div>
      <div className="stage-info">
        <div className="nm">{settings.mewName}</div>
        <div className="st">{status}</div>
        <div className="stage-pace">
          <span style={{ width: `${Math.round(live.pace * 100)}%` }} />
        </div>
      </div>
    </div>
  )
}
