/* "what I've picked up about you" — the memory console (#330, gbrain Pillar
   4). A pure skin over the domain presenter (domain/console.ts): the confirmed
   task rules, your rhythm, your standing rules, and what MEW is about to ask /
   told not to learn. Read-only over `data`; every change goes back through the
   store actions passed in (tools-only law). Each row carries a data-claim — the
   traceable source (a rule's support count, an insights fn, a stated rule) —
   the #287 discipline. Tokens only; positive voice; renders headless in tests.

   The store wiring lives in SettingsPage (MemoryConsoleFromStore); this
   component never reads the store, so it stays a pinnable skin. */

import { useState, type CSSProperties } from 'react'
import type { MemoryConsoleData, StandingRuleView, TaskRuleView } from '../../domain/console'
import type { LearnedRule } from '../../domain/prefs'
import type { PrefPayload, TimeWindow } from '../../domain/types'

const LABEL: CSSProperties = {
  fontSize: 10,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '.12em',
  marginTop: 14,
  marginBottom: 2,
}
const SRC: CSSProperties = { fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }
const BTN: CSSProperties = { fontSize: 10.5, color: 'var(--faint)' }
const PRIMARY: CSSProperties = { fontSize: 10.5, color: 'var(--gold)' }

const WINDOWS: (TimeWindow | 'any')[] = ['morning', 'afternoon', 'evening', 'any']

export interface MemoryConsoleProps {
  data: MemoryConsoleData
  onConfirm: (rule: LearnedRule) => void
  onForget: (match: string) => void
  onReEnable: (match: string) => void
  onSavePref: (pref: PrefPayload) => void
  onForgetPref: (pref: PrefPayload) => void
}

export function MemoryConsole({
  data,
  onConfirm,
  onForget,
  onReEnable,
  onSavePref,
  onForgetPref,
}: MemoryConsoleProps) {
  return (
    <div className="set-card" data-card="memory">
      <h2>{data.title}</h2>
      <div className="sub">
        Everything here is learned on this device from what you do and say — see it, correct it, or
        tell me to forget it. Nothing is sent anywhere.
      </div>

      {data.empty ? (
        <div className="sub" style={{ marginTop: 8 }}>
          still getting to know you — I'll pick things up as we go.
        </div>
      ) : (
        <>
          {data.taskRules.length > 0 && (
            <>
              <div className="mono" style={LABEL}>
                task rules
              </div>
              {data.taskRules.map((r) => (
                <TaskRuleRow key={r.match} r={r} onConfirm={onConfirm} onForget={onForget} />
              ))}
            </>
          )}

          {data.rhythm.length > 0 && (
            <>
              <div className="mono" style={LABEL}>
                your rhythm
              </div>
              {data.rhythm.map((r) => (
                <div key={r.claim} data-claim={r.claim} className="set-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="rt">{r.label}</div>
                    <div className="rs">{r.value}</div>
                  </div>
                </div>
              ))}
              <div style={SRC}>
                more of your rhythm — deep work vs admin by energy — arrives with energy-aware
                scheduling.
              </div>
            </>
          )}

          {data.standingRules.length > 0 && (
            <>
              <div className="mono" style={LABEL}>
                rules you've told me
              </div>
              {data.standingRules.map((r) => (
                <StandingRuleRow
                  key={`${r.pref.kind}:${r.match}`}
                  r={r}
                  onSave={onSavePref}
                  onForget={onForgetPref}
                />
              ))}
            </>
          )}

          {data.pending.length > 0 && (
            <>
              <div className="mono" style={LABEL}>
                about to ask
              </div>
              {data.pending.map((p) => (
                <div key={p.match} data-claim="support" className="set-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="rt" style={{ fontWeight: 500 }}>
                      {p.offer}
                    </div>
                    <div className="rs">seen {p.support} times</div>
                  </div>
                  <div className="rc" style={{ gap: 10 }}>
                    <button
                      type="button"
                      className="mono"
                      style={PRIMARY}
                      onClick={() => onConfirm(p.rule)}
                    >
                      yes, always
                    </button>
                    <button
                      type="button"
                      className="mono"
                      style={BTN}
                      onClick={() => onForget(p.match)}
                    >
                      not a rule
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {data.dismissed.length > 0 && (
            <>
              <div className="mono" style={LABEL}>
                not learning (your call)
              </div>
              {data.dismissed.map((m) => (
                <div key={m} data-claim="declined" className="set-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="rt" style={{ fontWeight: 500 }}>
                      {m}
                    </div>
                    <div className="rs">you told me not to learn this</div>
                  </div>
                  <div className="rc">
                    <button
                      type="button"
                      className="mono"
                      style={BTN}
                      onClick={() => onReEnable(m)}
                    >
                      let me learn it
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}

function TaskRuleRow({
  r,
  onConfirm,
  onForget,
}: {
  r: TaskRuleView
  onConfirm: (rule: LearnedRule) => void
  onForget: (match: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [dur, setDur] = useState(r.rule.durationMin != null ? String(r.rule.durationMin) : '')
  const [win, setWin] = useState<TimeWindow | 'any'>(r.rule.window ?? 'any')

  const save = () => {
    const durationMin = dur.trim() ? Math.max(5, Math.round(Number(dur))) : undefined
    const next: LearnedRule = { ...r.rule }
    if (durationMin != null && Number.isFinite(durationMin)) next.durationMin = durationMin
    else delete next.durationMin
    if (win === 'any') delete next.window
    else next.window = win
    onConfirm(next)
    setEditing(false)
  }

  return (
    <div data-claim="support" className="set-row" style={{ alignItems: 'flex-start' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="rt">{r.title}</div>
        <div className="rs">{r.label}</div>
        <div style={SRC}>{r.claim}</div>
        {editing && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 8,
              flexWrap: 'wrap',
            }}
          >
            <label
              className="mono"
              style={{
                fontSize: 10.5,
                color: 'var(--muted)',
                display: 'flex',
                gap: 4,
                alignItems: 'center',
              }}
            >
              min
              <input
                type="number"
                min={5}
                step={5}
                value={dur}
                onChange={(e) => setDur(e.target.value)}
                style={{
                  width: 56,
                  font: 'inherit',
                  fontSize: 11,
                  border: '1px solid var(--line)',
                  background: 'var(--bg)',
                  borderRadius: 6,
                  padding: '2px 6px',
                  color: 'var(--ink)',
                }}
              />
            </label>
            <select
              value={win}
              onChange={(e) => setWin(e.target.value as TimeWindow | 'any')}
              className="mono"
              style={{
                fontSize: 11,
                border: '1px solid var(--line)',
                background: 'var(--bg)',
                borderRadius: 6,
                padding: '2px 6px',
                color: 'var(--ink)',
              }}
            >
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {w === 'any' ? 'any time' : w}
                </option>
              ))}
            </select>
            <button type="button" className="mono" style={PRIMARY} onClick={save}>
              save
            </button>
            <button type="button" className="mono" style={BTN} onClick={() => setEditing(false)}>
              cancel
            </button>
          </div>
        )}
      </div>
      {!editing && (
        <div className="rc" style={{ gap: 10 }}>
          <button type="button" className="mono" style={BTN} onClick={() => setEditing(true)}>
            edit
          </button>
          <button type="button" className="mono" style={BTN} onClick={() => onForget(r.match)}>
            forget
          </button>
        </div>
      )}
    </div>
  )
}

function StandingRuleRow({
  r,
  onSave,
  onForget,
}: {
  r: StandingRuleView
  onSave: (pref: PrefPayload) => void
  onForget: (pref: PrefPayload) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(r.value)

  const save = () => {
    const v = value.trim()
    if (v && v !== r.value) onSave({ ...r.pref, value: v, stated: `${r.match} ${v}` })
    setEditing(false)
  }

  return (
    <div data-claim="stated" className="set-row" style={{ alignItems: 'flex-start' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="rt">{r.match}</div>
        {editing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
              }}
              style={{
                font: 'inherit',
                fontSize: 12,
                border: '1px solid var(--line)',
                background: 'var(--bg)',
                borderRadius: 6,
                padding: '2px 8px',
                color: 'var(--ink)',
                minWidth: 120,
              }}
            />
            <button type="button" className="mono" style={PRIMARY} onClick={save}>
              save
            </button>
            <button type="button" className="mono" style={BTN} onClick={() => setEditing(false)}>
              cancel
            </button>
          </div>
        ) : (
          <>
            <div className="rs">{r.value}</div>
            <div style={SRC}>you told me: "{r.stated}"</div>
          </>
        )}
      </div>
      {!editing && (
        <div className="rc" style={{ gap: 10 }}>
          <button type="button" className="mono" style={BTN} onClick={() => setEditing(true)}>
            edit
          </button>
          <button type="button" className="mono" style={BTN} onClick={() => onForget(r.pref)}>
            forget
          </button>
        </div>
      )}
    </div>
  )
}
