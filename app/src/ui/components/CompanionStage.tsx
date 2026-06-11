/* The companion stage (PRD §3a) — a fixed-size box reserved for the animated
   3D/vector companion. Placeholder: the low-poly portrait on a slow float.
   Condition shows through the companion, never as a metric. */

import { useEffect, useState } from 'react'
import { useMew, usePixie } from '../../state/store'
import { pixieCopy } from '../../domain/pixie'
import { petById } from '../primitives'

export function CompanionStage() {
  const live = usePixie()
  const settings = useMew((s) => s.settings)
  const celebratePulse = useMew((s) => s.celebratePulse)

  const [celebrating, setCelebrating] = useState(false)
  useEffect(() => {
    if (!celebratePulse) return
    setCelebrating(true)
    const t = setTimeout(() => setCelebrating(false), 3500)
    return () => clearTimeout(t)
  }, [celebratePulse])

  const pet = petById(settings.pet)
  const copy = pixieCopy(live, settings.mewName)
  const status = celebrating ? 'celebrating your mew' : copy.status

  return (
    <div className="stage">
      <div className="stage-tag">companion · 3D / vector · animated</div>
      <div className="stage-live">live</div>
      <div className="stage-floor" />
      <div className="stage-pet">
        {settings.pet === 'cat' ? (
          <img src="/pixie-poly-face.svg" alt={settings.mewName} draggable="false" />
        ) : (
          <div className="pet-blank">
            {settings.mewName}
            <br />
            3D companion
            <br />
            <span style={{ color: 'var(--faint)' }}>art per pet · {pet.name.toLowerCase()}</span>
          </div>
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
