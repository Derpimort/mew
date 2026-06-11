/* The main page — left stage (Focus ⇄ Week) + the persistent right column
   (companion stage above the session). SurfaceMain in the handoff. */

import { useMew } from '../../state/store'
import { fmtTime, dayKey, minOfDay } from '../../domain/time'
import { FocusDial } from '../components/FocusDial'
import { WeekColumns } from '../components/WeekColumns'
import { CompanionStage } from '../components/CompanionStage'
import { SessionLog } from '../components/SessionLog'

export function MainPage() {
  const view = useMew((s) => s.view)
  const setView = useMew((s) => s.setView)
  const setPage = useMew((s) => s.setPage)
  const quiet = useMew((s) => s.settings.quietHours)
  const guardDayKey = useMew((s) => s.guardDayKey)
  const guardUntilMin = useMew((s) => s.guardUntilMin)
  const nowMs = useMew((s) => s.nowMs)

  const now = new Date(nowMs)
  const guardOn =
    guardDayKey === dayKey(now) && guardUntilMin != null && minOfDay(now) < guardUntilMin

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 452px', height: '100%', minHeight: 0 }}>
      <div className="left-stage">
        <div style={{ position: 'absolute', top: 20, left: 28, zIndex: 10 }}>
          <span className="disp brand">MEW</span>
        </div>
        <div style={{ position: 'absolute', top: 22, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
          <span className="agent">
            watching · {guardOn ? 'guard on' : 'drift armed'} · quiet {fmtTime(quiet.startMin)}
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
        {view === 'focus' ? <FocusDial /> : <WeekColumns />}
      </div>
      <div className="right-col">
        <CompanionStage />
        <SessionLog />
      </div>
    </div>
  )
}
