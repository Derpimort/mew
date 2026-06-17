/* The main page — left stage (Focus ⇄ Week) + the persistent right column
   (companion stage above the session). SurfaceMain in the handoff.
   The left stage breathes: a React Bits aurora in the pet's colors drifts
   behind the dial, and the brand mark is a cursor-reactive glitch canvas. */

import { Suspense, lazy } from 'react'
import { useMew } from '../../state/store'
import { FocusOrbit } from '../components/FocusOrbit'
import { WeekColumns } from '../components/WeekColumns'
import { CompanionStage } from '../components/CompanionStage'
import { SessionLog } from '../components/SessionLog'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { usePetPalette } from '../components/petPalette'

const AuroraBlur = lazy(() => import('../react-bits/aurora-blur'))

export function MainPage() {
  const view = useMew((s) => s.view)
  const setView = useMew((s) => s.setView)
  const setPage = useMew((s) => s.setPage)
  const pal = usePetPalette()

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 452px', height: '100%', minHeight: 0 }}>
      <div className="left-stage">
        {/* ambient aurora in the pet's palette, melting into the app bg */}
        <Suspense fallback={null}>
          <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }} aria-hidden>
            <AuroraBlur
              width="100%"
              height="100%"
              speed={0.45}
              opacity={0.38}
              brightness={0.7}
              bloomIntensity={1.5}
              verticalFade={1.1}
              layers={[
                { color: pal.pa, speed: 0.16, intensity: 0.42 },
                { color: pal.pb, speed: 0.09, intensity: 0.3 },
                { color: pal.pa, speed: 0.05, intensity: 0.12 },
              ]}
              skyLayers={[
                { color: pal.bg, blend: 0.85 },
                { color: pal.bg, blend: 0.6 },
              ]}
            />
          </div>
        </Suspense>
        <div style={{ position: 'absolute', top: 20, left: 28, zIndex: 10 }}>
          {/* crisp wordmark — the GlitchText canvas mangled "MEW" at bold weight
              (autoFit + scatter in an 88px box); brand text renders clean */}
          <span className="disp brand" aria-label="MEW">
            MEW
          </span>
        </div>
        <div style={{ position: 'absolute', top: 20, right: 24, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7 }}>
          <span className="seg2">
            <button type="button" className={view === 'focus' ? 'on' : ''} onClick={() => setView('focus')}>
              Focus
            </button>
            <button type="button" className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>
              Week
            </button>
          </span>
          <button type="button" className="navlink" onClick={() => setPage('settings')}>
            settings
          </button>
        </div>
        {/* the stage (Focus dial / Week grid) is the heaviest render — canvas,
            geometry, motion. Contain a crash here so the session stays usable. */}
        <ErrorBoundary label="the stage">
          {view === 'focus' ? <FocusOrbit /> : <WeekColumns />}
        </ErrorBoundary>
      </div>
      <div className="right-col">
        <CompanionStage />
        {/* the chat is the other independent panel — its own boundary so a bad
            message render never takes the stage down with it */}
        <ErrorBoundary label="the session">
          <SessionLog />
        </ErrorBoundary>
      </div>
    </div>
  )
}
