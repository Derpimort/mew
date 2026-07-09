/* Pet palette → plain color strings. Canvas consumers (SimpleGraph) can't read
   CSS custom properties at draw time, and the companion orb's registered
   gradient stops (--orb-a/--orb-b, see components.css) want concrete color
   values to interpolate — so this resolves the live token values off the
   themed root, re-read whenever the pet or theme changes, so the companion
   always wears the pet's colors. */

import { useEffect, useState } from 'react'
import { useMew } from '../../state/store'

export interface PetPalette {
  pa: string
  pb: string
  ink: string
  bg: string
  muted: string
}

const FALLBACK: PetPalette = {
  pa: '#7fb4ff',
  pb: '#67e8c8',
  ink: '#ecedef',
  bg: '#060708',
  muted: '#8f97a3',
}

export function usePetPalette(): PetPalette {
  const pet = useMew((s) => s.settings.pet)
  const themeMode = useMew((s) => s.settings.themeMode)
  const [pal, setPal] = useState<PetPalette>(FALLBACK)
  useEffect(() => {
    const el = document.querySelector('[data-pet]') ?? document.documentElement
    const cs = getComputedStyle(el)
    const read = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb
    // Reading resolved CSS custom properties needs the mounted, themed DOM, so
    // this can only run in an effect — it syncs React state from an external
    // system (the document's computed styles), exactly what effects are for.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs state from computed CSS vars, only readable after mount
    setPal({
      pa: read('--pa', FALLBACK.pa),
      pb: read('--pb', FALLBACK.pb),
      ink: read('--ink', FALLBACK.ink),
      bg: read('--bg', FALLBACK.bg),
      muted: read('--muted', FALLBACK.muted),
    })
  }, [pet, themeMode])
  return pal
}
