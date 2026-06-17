import { useEffect, useRef } from 'react'
import { useMew } from './state/store'
import { MainPage } from './ui/pages/MainPage'
import { SettingsPage } from './ui/pages/SettingsPage'
import { ErrorBoundary } from './ui/components/ErrorBoundary'
import Preloader from './ui/react-bits/preloader'

/* 5s keeps liveNow's current/next flips feeling immediate; the dial's own
   1s clock handles the countdown, and sync/nudges self-throttle by time. */
const TICK_MS = 5_000

export default function App() {
  const hydrated = useMew((s) => s.hydrated)
  const page = useMew((s) => s.page)
  const pet = useMew((s) => s.settings.pet)
  const themeMode = useMew((s) => s.settings.themeMode)
  const hydrate = useMew((s) => s.hydrate)
  const tick = useMew((s) => s.tick)
  const activity = useMew((s) => s.activity)
  const interruption = useMew((s) => s.interruption)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return // StrictMode double-mount guard
    started.current = true
    void hydrate()
  }, [hydrate])

  /* the clock — liveNow, drift, end-of-day and quiet-hour flushes all hang off this */
  useEffect(() => {
    const id = setInterval(tick, TICK_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
      else interruption() // leaving the tab mid-block counts as a self-interruption
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [tick, interruption])

  /* activity feeds drift detection (throttled) */
  useEffect(() => {
    let last = 0
    const onActive = () => {
      const now = Date.now()
      if (now - last > 5000) {
        last = now
        activity()
      }
    }
    window.addEventListener('pointermove', onActive)
    window.addEventListener('pointerdown', onActive)
    window.addEventListener('keydown', onActive)
    return () => {
      window.removeEventListener('pointermove', onActive)
      window.removeEventListener('pointerdown', onActive)
      window.removeEventListener('keydown', onActive)
    }
  }, [activity])

  const rootClass = 'stl nx ns sys' + (themeMode === 'white' ? ' sys--light' : '')

  /* boot: the slide preloader covers hydration and the canvas warm-up, then
     wipes away — the app lives inside it as children (kept invisible until
     the wipe), so layout is already settled when the curtain moves */
  return (
    <div className={rootClass} data-pet={pet} style={{ height: '100%' }}>
      <Preloader
        loading={!hydrated}
        variant="slide"
        position="fixed"
        duration={600}
        zIndex={300}
        bgColor="var(--bg)"
        loadingText="MEW"
        textClassName="!text-[var(--ink)] !font-mono !text-2xl !font-bold tracking-[0.28em]"
        respectReducedMotion
        ariaLabel="MEW loading"
      >
        {hydrated && (
          <>
            <div className="sys-wash" />
            {/* outermost last-resort catch: a render error nothing else caught
                still lands on a calm fallback, never a white screen */}
            <ErrorBoundary variant="full" label="mew">
              {page === 'week' ? <MainPage /> : <ErrorBoundary label="settings"><SettingsPage /></ErrorBoundary>}
            </ErrorBoundary>
          </>
        )}
      </Preloader>
    </div>
  )
}
