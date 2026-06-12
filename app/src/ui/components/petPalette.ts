/* Pet palette → plain color strings. The React Bits canvas/WebGL components
   (AIBlob, AuroraBlur, GlitchText, SimpleGraph) can't read CSS custom
   properties, so this resolves the live token values off the themed root —
   re-read whenever the pet or theme changes, so the companion and ambience
   always wear the pet's colors. */

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
