/* The companion stage (PRD §3a) — a fixed-size box reserved for the vector
   companion. The companion body is a static orb whose color is driven by pixie
   state: mood picks the colors and a waiting nudge raises the glow (opacity).
   No motion loop — condition shows through the orb, never as a metric. The cat
   keeps her low-poly portrait and gains the orb as a fainter aura behind her
   face; every other pet is the orb itself. */

import { useEffect, useState, type CSSProperties } from 'react'
import { useMew, usePixie } from '../../state/store'
import { pixieCopy } from '../../domain/pixie'
import { usePetPalette } from './petPalette'

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

  const copy = pixieCopy(live, settings.mewName)
  const status = celebrating ? 'celebrating your mew' : copy.status

  /* condition → orb: mood drives color (fed to .stage-orb's gradient as the
     registered --orb-* stops so shifts ease, see components.css), attention
     drives glow (opacity), and resting dims the body — the visual rest channel
     the old blob carried as slow motion (ARCHITECTURE §2.4), kept here as
     stillness + dim. Celebration outranks the dim for its 3.5s. */
  const glow = celebrating || live.attention ? 1 : 0.5 + live.pace * 0.35
  const rest = live.resting && !celebrating ? 0.6 : 1
  /* two stops: [centre, edge] of the orb's radial gradient (the old blob took a
     third colour; the orb's gradient fades to transparent instead) */
  const colors =
    live.mood === 'healthy'
      ? [pal.pa, pal.pb]
      : live.mood === 'drowsy'
        ? [pal.pa, pal.muted]
        : [pal.muted, pal.pa]

  /* ONE orb element for both placements — the cat's fainter behind-the-face
     aura vs the full companion body — so the gradient + glow maths can't drift
     between the two render branches. */
  const orb = (variant: 'aura' | 'body') => {
    const stops = { '--orb-a': colors[0], '--orb-b': colors[1] } as CSSProperties
    const shape: CSSProperties =
      variant === 'aura'
        ? { position: 'absolute', inset: -34, pointerEvents: 'none' }
        : { width: 188, height: 188 }
    return (
      <div
        className="stage-orb"
        aria-hidden
        style={{
          ...stops,
          ...shape,
          borderRadius: '50%',
          opacity: (variant === 'aura' ? 0.4 : 1) * Math.min(1, 0.15 + 0.85 * glow) * rest,
        }}
      />
    )
  }

  return (
    <div className="stage">
      <div className="stage-tag">companion · vector</div>
      <div className="stage-live">live</div>
      <div className="stage-floor" />
      <div className="stage-pet">
        {settings.pet === 'cat' ? (
          <>
            {/* fainter static aura behind the face — same mood gradient, no motion */}
            {orb('aura')}
            <img
              src="/pixie-poly-face.svg"
              alt={settings.mewName}
              draggable="false"
              style={{ position: 'relative', zIndex: 1 }}
            />
          </>
        ) : (
          orb('body')
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
