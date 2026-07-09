/* The main page — left stage (Focus ⇄ Week) + the persistent right column
   (companion stage above the session). SurfaceMain in the handoff. */

import { useMew } from '../../state/store'
import { FocusOrbit } from '../components/FocusOrbit'
import { WeekColumns } from '../components/WeekColumns'
import { CompanionStage } from '../components/CompanionStage'
import { SessionLog } from '../components/SessionLog'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { CommandPalette } from '../components/CommandPalette'
import { OnboardingModal } from '../components/OnboardingModal'

export function MainPage() {
  const view = useMew((s) => s.view)
  const setView = useMew((s) => s.setView)
  const setPage = useMew((s) => s.setPage)
  /* post-hydration first-run tour — App renders MainPage only once hydrated, so
     this flag is already the persisted value, not the default. Its own error
     boundary so a tour render fault never blocks the week behind it. */
  const showOnboarding = useMew((s) => !s.settings.hasSeenOnboarding)

  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: '1fr 452px', height: '100%', minHeight: 0 }}
    >
      {showOnboarding && (
        <ErrorBoundary label="the tour">
          <OnboardingModal />
        </ErrorBoundary>
      )}
      <div className="left-stage">
        <div style={{ position: 'absolute', top: 20, left: 28, zIndex: 10 }}>
          {/* crisp wordmark — the GlitchText canvas mangled "MEW" at bold weight
              (autoFit + scatter in an 88px box); brand text renders clean */}
          <span className="disp brand" aria-label="MEW">
            MEW
          </span>
        </div>
        <div
          style={{
            position: 'absolute',
            top: 20,
            right: 24,
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 7,
          }}
        >
          <span className="seg2">
            <button
              type="button"
              className={view === 'focus' ? 'on' : ''}
              onClick={() => setView('focus')}
            >
              Focus
            </button>
            <button
              type="button"
              className={view === 'week' ? 'on' : ''}
              onClick={() => setView('week')}
            >
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
      {/* power-user surface (#169/#170/#171): one Cmd/Ctrl-K overlay hosting
          search + quick-capture. Mounted once, renders nothing until opened —
          it owns its own hotkeys and never touches the resting layout. */}
      <CommandPalette />
    </div>
  )
}
