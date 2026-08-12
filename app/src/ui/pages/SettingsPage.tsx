/* Settings on Carbon (SurfaceSettings, mew-v22) — live pet picker re-themes
   the whole page; the routing matrix, connect flow, sync status, quiet hours
   and model settings keep their full behavior, re-skinned. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { activePrefsFrom, brainIsOn, mewBrain, useMew, type SidecarStatus } from '../../state/store'
import {
  DEFAULT_SETTINGS,
  type PetId,
  type ScaffoldMealId,
  type Settings,
  type VisibleTag,
} from '../../domain/types'
import { project } from '../../domain/project'
import { dayKey, fmtTime, minOfDay } from '../../domain/time'
import { aggregates } from '../../domain/memory'
import { computeInsights, insightsCard } from '../../domain/insights'
import { Button, Segc, Tgl } from '../primitives'
import { PETS, petById } from '../primitives/pets'
import { backupPath, isTauri, openBackupFolder } from '../../adapters/desktop'
import { usePetPalette } from '../components/petPalette'
import { NoticedCard } from '../components/NoticedCard'
import { MemoryConsole } from '../components/MemoryConsole'
import { memoryConsole } from '../../domain/console'
import { ApiKeySetupFlow } from '../components/ApiKeySetupFlow'
import { keySetupView } from '../components/apiKeySetup'
import SimpleGraph from '../react-bits/simple-graph'

const TAGS: VisibleTag[] = ['work', 'private', 'health']
const VIS_CLASS = { details: 'det', busy: 'busy', hidden: 'hid' } as const
const VIS_LABEL = { details: 'details', busy: 'busy', hidden: 'hidden' } as const

function SetRow({ t, s, children }: { t: string; s?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div style={{ minWidth: 0 }}>
        <div className="rt">{t}</div>
        {s && <div className="rs">{s}</div>}
      </div>
      <div className="rc">{children}</div>
    </div>
  )
}

/* Current models per provider (verified July 2026). Model ids change often, so
   the list is a convenience over a freeform field — never the only way in. */
const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 · cheap & capable' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 · most capable' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 · fast & cheap' },
  { id: 'claude-fable-5', label: 'Claude Fable 5 · frontier (less stable)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 · previous gen' },
]
const OPENAI_MODELS = [
  { id: 'gpt-5.6', label: 'GPT-5.6 · most capable' },
  { id: 'gpt-5.5', label: 'GPT-5.5 · balanced' },
  { id: 'gpt-5.4', label: 'GPT-5.4 · previous gen' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini · fast & cheap' },
]

/* Pick a known model or type any id. Selecting "Custom…" — or arriving with a
   stored id that isn't in the list — reveals a freeform field. */
function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
}) {
  const known = models.some((m) => m.id === value)
  const [custom, setCustom] = useState(!known)
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
      }}
    >
      <select
        className="modelsel"
        value={custom ? '__custom__' : value}
        onChange={(e) => {
          const v = e.target.value
          if (v === '__custom__') setCustom(true)
          else {
            setCustom(false)
            onChange(v)
          }
        }}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        <option value="__custom__">Custom…</option>
      </select>
      {custom && (
        <span className="keyfield">
          <input
            placeholder="exact model id"
            defaultValue={known ? '' : value}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v) onChange(v)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        </span>
      )}
    </span>
  )
}

export function SettingsPage() {
  const setPage = useMew((s) => s.setPage)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '18px 28px',
          borderBottom: '1px solid var(--line2)',
          position: 'relative',
          flex: 'none',
        }}
      >
        <span className="disp brand">MEW</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          settings
        </span>
        <button
          type="button"
          className="navlink gold"
          style={{ marginLeft: 'auto' }}
          onClick={() => setPage('week')}
        >
          ← back to your week
        </button>
      </div>

      <div className="set-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <CompanionCard />
          <PatternsCard />
          <CalendarsCard />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <AppearanceCard />
          <NudgesCard />
          <NoticedFromStore />
          <MemoryConsoleFromStore />
          <PrivacyModelCard />
        </div>
      </div>
    </div>
  )
}

/* Your patterns — trailing-4-week numbers computed on-device from local
   memory (domain/insights, no brain I/O): weekday load as an animated line,
   MEW's own insight lines underneath. Appears only once the memory has
   something honest to show. */
function PatternsCard() {
  const memory = useMew((s) => s.memory)
  const nowMs = useMew((s) => s.nowMs)
  const pal = usePetPalette()
  const insights = useMemo(() => {
    const now = new Date(nowMs)
    return computeInsights(memory, aggregates(memory, now), now)
  }, [memory, nowMs])

  const load = insights.weekdayLoad.filter((w) => w.avgPlannedH > 0)
  if (load.length < 3) return null

  return (
    <div className="set-card">
      <h2>Your patterns</h2>
      <div className="sub">Planned hours by weekday — trailing four weeks, MEW's own numbers.</div>
      <div style={{ padding: '10px 4px 2px' }}>
        <SimpleGraph
          data={insights.weekdayLoad.map((w) => ({
            value: Math.round(w.avgPlannedH * 10) / 10,
            label: w.name.toLowerCase(),
          }))}
          lineColor={pal.pa}
          dotColor={pal.pb}
          width="100%"
          height={120}
        />
      </div>
      {insights.lines.slice(0, 3).map((l) => (
        <div
          key={l}
          className="sub"
          style={{ marginTop: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}
        >
          # {l.toLowerCase()}
        </div>
      ))}
    </div>
  )
}

/* store → presenter wiring for the read-only "what mew's noticed" card
   (#287), placed by the memory/brain section. The skin itself (NoticedCard)
   is pure and headless-testable; this only feeds it the presenter output. */
function NoticedFromStore() {
  const memory = useMew((s) => s.memory)
  const nowMs = useMew((s) => s.nowMs)
  const card = useMemo(() => {
    const now = new Date(nowMs)
    return insightsCard(computeInsights(memory, aggregates(memory, now), now))
  }, [memory, nowMs])
  return <NoticedCard card={card} />
}

/* store → presenter wiring for the memory console (#330): "what I've picked up
   about you." Reads LOCAL memory alone (activePrefsFrom over local, brain-off
   by law) into the pure domain presenter, and passes the tools-only edit/forget
   actions down. The console skin (MemoryConsole) stays headless-testable. */
function MemoryConsoleFromStore() {
  const memory = useMew((s) => s.memory)
  const nowMs = useMew((s) => s.nowMs)
  const confirmTaskRule = useMew((s) => s.confirmTaskRule)
  const forgetRule = useMew((s) => s.forgetRule)
  const reEnableRule = useMew((s) => s.reEnableRule)
  const saveStandingPref = useMew((s) => s.saveStandingPref)
  const forgetStandingPref = useMew((s) => s.forgetStandingPref)
  const data = useMemo(() => {
    const now = new Date(nowMs)
    const insights = computeInsights(memory, aggregates(memory, now), now)
    return memoryConsole({ events: memory, prefs: activePrefsFrom(memory, null), insights })
  }, [memory, nowMs])
  return (
    <MemoryConsole
      data={data}
      onConfirm={confirmTaskRule}
      onForget={forgetRule}
      onReEnable={reEnableRule}
      onSavePref={saveStandingPref}
      onForgetPref={forgetStandingPref}
    />
  )
}

function CompanionCard() {
  const settings = useMew((s) => s.settings)
  const updateSettings = useMew((s) => s.updateSettings)
  const [renaming, setRenaming] = useState(false)
  const pet = petById(settings.pet)

  const pickPet = (id: PetId) => {
    const defaults: Record<PetId, string> = {
      cat: 'Pixie',
      dog: 'Good Dog',
      fox: 'Fox',
      bunny: 'Bunny',
      bird: 'Bird',
    }
    const keepName = settings.mewName !== defaults[settings.pet]
    updateSettings({ pet: id, ...(keepName ? {} : { mewName: defaults[id] }) })
  }

  return (
    <div className="set-card">
      <h2>Your companion</h2>
      <div className="sub">Your pet sets the personality — and the theme follows it.</div>
      <div className="petpick" style={{ marginBottom: 6 }} role="radiogroup" aria-label="pet">
        {PETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={'petopt' + (p.id === settings.pet ? ' on' : '')}
            onClick={() => pickPet(p.id)}
            role="radio"
            aria-checked={p.id === settings.pet}
            aria-label={p.name}
            style={{ '--accpa': p.c1 } as React.CSSProperties}
          >
            <div className="petswatch">
              <i style={{ background: `linear-gradient(135deg, ${p.c1}, ${p.c2})` }} />
            </div>
            <span className="pn">{p.name}</span>
          </button>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginTop: 12,
          padding: 12,
          background: 'var(--bg)',
          border: '1px solid var(--line2)',
          borderRadius: 12,
        }}
      >
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: 14,
            overflow: 'hidden',
            flex: 'none',
            boxShadow: '0 0 0 1px rgba(var(--acc-rgb),.4), 0 0 20px rgba(var(--acc-rgb),.25)',
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(var(--acc-rgb),.12)',
          }}
        >
          {settings.pet === 'cat' ? (
            <img
              src="/pixie-poly-face.svg"
              alt=""
              style={{ width: 80, marginLeft: -11, marginTop: -8 }}
            />
          ) : (
            <span className="mono" style={{ fontSize: 16, color: 'var(--gold)' }}>
              {pet.name[0]}
            </span>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}
          >
            {renaming ? (
              <input
                autoFocus
                defaultValue={settings.mewName}
                style={{
                  font: 'inherit',
                  fontWeight: 700,
                  border: 0,
                  borderBottom: '1px solid var(--line)',
                  background: 'transparent',
                  outline: 'none',
                  width: 120,
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v) updateSettings({ mewName: v })
                  setRenaming(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
              />
            ) : (
              settings.mewName
            )}
            <button
              type="button"
              className="mono"
              style={{ fontSize: 10, color: 'var(--faint)' }}
              onClick={() => setRenaming(true)}
            >
              rename
            </button>
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>
            {pet.who}
          </div>
          <div
            className="mono"
            style={{ fontSize: 10, color: 'var(--gold)', marginTop: 4 }}
            title="post-MVP"
          >
            animated 3D companion · change look
          </div>
        </div>
      </div>
      <SetRow t="Condition mirrors sustainability" s="Not how much you do — how sustainably.">
        <Tgl
          on
          lock
          cap="always"
          title="Always on. MEW watches how sustainably you move, not how hard you grind. An off switch would miss the point."
        />
      </SetRow>
      <SetRow t="Care, not blame" s="Strain is met with help, never judgment.">
        <Tgl
          on
          lock
          cap="absolute"
          title="Always on. A rough week earns you help, never a lecture. This one is not up for debate."
        />
      </SetRow>
    </div>
  )
}

function CalendarsCard() {
  const settings = useMew((s) => s.settings)
  const blocks = useMew((s) => s.blocks)
  const nowMs = useMew((s) => s.nowMs)
  const cycleVisibility = useMew((s) => s.cycleVisibility)
  const cycleDefaultTag = useMew((s) => s.cycleDefaultTag)
  const importIcs = useMew((s) => s.importIcs)
  const setPage = useMew((s) => s.setPage)
  const fileRef = useRef<HTMLInputElement>(null)
  const setPageToWeek = () => setPage('week')
  const connectGoogle = useMew((s) => s.connectGoogle)
  const addGoogleCalendar = useMew((s) => s.addGoogleCalendar)
  const dismissPicker = useMew((s) => s.dismissPicker)
  const disconnectCalendar = useMew((s) => s.disconnectCalendar)
  const syncNow = useMew((s) => s.syncNow)
  const updateSettings = useMew((s) => s.updateSettings)
  const googlePicker = useMew((s) => s.googlePicker)
  const connecting = useMew((s) => s.connecting)
  const needsReconnect = useMew((s) => s.needsReconnect)
  const reconnectGoogle = useMew((s) => s.reconnectGoogle)
  const syncing = useMew((s) => s.syncing)
  const lastSyncAt = useMew((s) => s.lastSyncAt)
  const syncError = useMew((s) => s.syncError)
  const [editing, setEditing] = useState<string | null>(null)
  const [askClientId, setAskClientId] = useState(false)

  const todayKey = dayKey(new Date(nowMs))
  const hasLive = settings.calendars.some((c) => c.kind === 'live')
  const editingCal = settings.calendars.find((c) => c.id === editing)

  const colLabel: React.CSSProperties = {
    fontSize: 10,
    color: 'var(--muted)',
    textTransform: 'uppercase',
    letterSpacing: '.12em',
  }

  return (
    <div className="set-card">
      <h2>Calendars &amp; what they see</h2>
      <div className="sub">MEW sees the whole week; each calendar sees only what you allow.</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1.7fr) repeat(3,minmax(74px,auto)) auto',
          columnGap: 18,
          rowGap: 14,
          alignItems: 'center',
        }}
      >
        <span className="mono" style={colLabel}>
          calendar
        </span>
        {TAGS.map((t) => (
          <span key={t} className="mono" style={colLabel}>
            {t}
          </span>
        ))}
        <span />

        {/* hairline under the header, full width */}
        <span
          style={{ gridColumn: '1 / -1', height: 1, background: 'var(--line2)', margin: '-4px 0' }}
        />

        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)' }}>MEW</span>
        {TAGS.map((t) => (
          <span key={t} className="vis-chip all">
            all
          </span>
        ))}
        <span />

        {settings.calendars.map((c) => {
          const row = settings.matrix[c.id]
          return (
            <FragmentRow key={c.id}>
              <span
                style={{
                  gridColumn: '1 / -1',
                  height: 1,
                  background: 'var(--line2)',
                  opacity: 0.5,
                }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={c.name}
                >
                  {c.name}
                </span>
                {c.who && (
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--faint)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {c.who}
                  </span>
                )}
              </span>
              {TAGS.map((t) => {
                const v = row?.[t] ?? 'busy'
                return (
                  <button
                    key={t}
                    type="button"
                    className={'vis-chip ' + VIS_CLASS[v]}
                    onClick={() => cycleVisibility(c.id, t)}
                    title="click to cycle details → busy → hidden"
                  >
                    {VIS_LABEL[v]}
                  </button>
                )
              })}
              <button
                type="button"
                className="mono navlink"
                onClick={() => setEditing(editing === c.id ? null : c.id)}
              >
                {editing === c.id ? 'close' : 'edit'}
              </button>
            </FragmentRow>
          )
        })}
      </div>

      {settings.calendars.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: 12.5,
            lineHeight: 1.6,
            padding: '16px 8px 4px',
          }}
        >
          No calendars connected yet.
          <br />
          <span style={{ color: 'var(--faint)', fontSize: 11.5 }}>
            Connect one below to sync your week both ways.
          </span>
        </div>
      )}

      {editing && editingCal && (
        <div
          className="mono"
          style={{
            fontSize: 10.5,
            color: 'var(--muted)',
            background: 'var(--bg)',
            border: '1px dashed var(--line)',
            borderRadius: 10,
            padding: '9px 11px',
            marginTop: 10,
            lineHeight: 1.7,
          }}
        >
          <span style={{ color: 'var(--ink)' }}>what {editingCal.name} sees today</span>
          <br />
          {(() => {
            /* the preview IS the push plan: events that came IN from a calendar
               are never pushed back out (sync skips them), so listing them here
               read as "MEW will send this" when it never would — count them on
               a separate honest line instead. */
            const external = new Set(blocks.filter((b) => b.external).map((b) => b.id))
            const events = project(blocks, settings.matrix, editing).filter(
              (e) => e.dayKey === todayKey
            )
            const pushed = events.filter((e) => !external.has(e.blockId))
            const imported = events.length - pushed.length
            if (!events.length) return 'nothing — every tag is hidden or the day is clear'
            return (
              <>
                {pushed.map((e) => (
                  <span key={e.blockId}>
                    {fmtTime(e.startMin)}–{fmtTime(e.endMin)} {e.title}
                    <br />
                  </span>
                ))}
                {imported > 0 && (
                  <span style={{ color: 'var(--faint)' }}>
                    + {imported} event{imported === 1 ? '' : 's'} from your calendars stay where
                    they are — MEW never re-pushes what it pulled in
                  </span>
                )}
              </>
            )
          })()}
          {(editingCal.kind === 'live' || editingCal.kind === 'import') && (
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span>incoming →</span>
              <button
                type="button"
                className="vis-chip det"
                onClick={() => cycleDefaultTag(editing)}
              >
                {editingCal.defaultTag ?? 'work'}
              </button>
              {editingCal.kind === 'live' && (
                <button
                  type="button"
                  className="vis-chip busy"
                  onClick={() => void syncNow()}
                  disabled={syncing}
                >
                  {syncing ? 'syncing…' : 'sync now'}
                </button>
              )}
              {editingCal.kind === 'import' && (
                <span style={{ color: 'var(--faint)' }}>
                  snapshot — re-import the .ics to refresh
                </span>
              )}
              <button
                type="button"
                className="vis-chip hid"
                onClick={() => {
                  disconnectCalendar(editing)
                  setEditing(null)
                }}
              >
                {editingCal.kind === 'import' ? 'remove import' : 'disconnect'}
              </button>
            </div>
          )}
        </div>
      )}

      {askClientId && !settings.googleClientId && (
        <div
          className="mono"
          style={{
            fontSize: 10.5,
            color: 'var(--muted)',
            background: 'var(--bg)',
            border: '1px dashed var(--line)',
            borderRadius: 10,
            padding: '9px 11px',
            marginTop: 10,
            lineHeight: 1.7,
          }}
        >
          <span style={{ color: 'var(--ink)' }}>one-time setup — your own google oauth client</span>
          <br />
          mew has no server, so it talks to google as you. google cloud console → enable the
          calendar api → create an oauth client id (web) → add{' '}
          <span style={{ color: 'var(--gold)' }}>
            {typeof location !== 'undefined' ? location.origin : 'this origin'}
          </span>{' '}
          to authorized javascript origins. paste the client id:
          <div style={{ marginTop: 6 }}>
            <input
              autoFocus
              placeholder="xxxxxxxx.apps.googleusercontent.com"
              style={{
                font: 'inherit',
                width: '100%',
                border: 0,
                borderBottom: '1px solid var(--line)',
                background: 'transparent',
                outline: 'none',
                padding: '4px 0',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = (e.target as HTMLInputElement).value.trim()
                  if (v) {
                    updateSettings({ googleClientId: v })
                    setAskClientId(false)
                    void connectGoogle()
                  }
                }
              }}
            />
          </div>
        </div>
      )}

      {googlePicker && (
        <div
          style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink)' }}>
            {googlePicker.length ? 'pick calendars:' : 'all connected.'}
          </span>
          {googlePicker.map((c) => (
            <button
              key={c.id}
              type="button"
              className="vis-chip det"
              onClick={() => addGoogleCalendar(c)}
            >
              + {c.summary}
              {c.readOnly ? ' (ro)' : ''}
            </button>
          ))}
          <button type="button" className="vis-chip hid" onClick={dismissPicker}>
            done
          </button>
        </div>
      )}

      <div
        className="mono"
        style={{
          fontSize: 10.5,
          marginTop: 12,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <Button
          variant="ghost"
          size="md"
          disabled={connecting}
          onClick={() => {
            if (!settings.googleClientId) setAskClientId(true)
            else void connectGoogle()
          }}
        >
          {connecting ? 'opening google sign-in…' : '+ connect a calendar'}
        </Button>
        <Button variant="ghost" size="md" onClick={() => fileRef.current?.click()}>
          + import .ics
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".ics,text/calendar"
          multiple
          style={{ display: 'none' }}
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            for (const f of files) importIcs(f.name, await f.text())
            setPageToWeek()
          }}
        />
        <span style={{ color: 'var(--faint)' }}>
          · google (live) · .ics snapshot · outlook (soon)
        </span>
        {hasLive && (
          <span
            style={{
              marginLeft: 'auto',
              color: needsReconnect || syncError ? 'var(--ice)' : 'var(--faint)',
            }}
          >
            {syncing
              ? 'syncing…'
              : needsReconnect
                ? 'sync paused — google needs a fresh sign-in'
                : syncError
                  ? `sync hiccup: ${syncError.slice(0, 40)}`
                  : lastSyncAt
                    ? `synced ${fmtTime(minOfDay(new Date(lastSyncAt)))}`
                    : 'sync pending…'}
          </span>
        )}
        {hasLive && needsReconnect && !syncing && (
          <Button
            variant="ghost"
            size="md"
            disabled={connecting}
            onClick={() => void reconnectGoogle()}
          >
            {connecting ? 'opening google sign-in…' : 'reconnect'}
          </Button>
        )}
      </div>
    </div>
  )
}

/* grid rows are flat children; this is just a keyed fragment */
function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>
}

/* The sans/prose face is self-hosted (issue #120); mono/numerals never change.
   Preview text renders in the candidate font so the choice reads before applying. */
const UI_FONTS: { id: Settings['uiFont']; label: string; stack: string }[] = [
  { id: 'hanken', label: 'Hanken', stack: "'Hanken Grotesk', ui-sans-serif, sans-serif" },
  { id: 'open-sans', label: 'Open Sans', stack: "'Open Sans', ui-sans-serif, sans-serif" },
  { id: 'system', label: 'System', stack: 'ui-sans-serif, system-ui, sans-serif' },
]

function AppearanceCard() {
  const settings = useMew((s) => s.settings)
  const updateSettings = useMew((s) => s.updateSettings)
  const pet = petById(settings.pet)
  const fontStack = (UI_FONTS.find((f) => f.id === settings.uiFont) ?? UI_FONTS[0]).stack
  return (
    <div className="set-card">
      <h2>Appearance</h2>
      <div className="sub">Two modes; the accent is your pet's. Carbon by default.</div>
      <SetRow t="Mode">
        <Segc
          options={[
            { id: 'carbon', label: 'Carbon' },
            { id: 'white', label: 'Pet white' },
          ]}
          value={settings.themeMode}
          onChange={(id) => updateSettings({ themeMode: id as 'carbon' | 'white' })}
        />
      </SetRow>
      <SetRow
        t="Accent"
        s={`Follows ${settings.mewName} — ${pet.name.toLowerCase()} primary for work, soft for life.`}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--ice)' }} />
          <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--teal)' }} />
        </div>
      </SetRow>
      <SetRow
        t="Interface font"
        s="Sets the prose font everywhere — self-hosted, no fetch. Numerals and code stay monospaced."
      >
        <Segc
          options={UI_FONTS.map((f) => ({ id: f.id, label: f.label }))}
          value={settings.uiFont}
          onChange={(id) => updateSettings({ uiFont: id as Settings['uiFont'] })}
        />
      </SetRow>
      <div
        style={{
          marginTop: 2,
          padding: '9px 12px',
          background: 'var(--bg)',
          border: '1px solid var(--line2)',
          borderRadius: 10,
          fontFamily: fontStack,
          fontSize: 14,
          lineHeight: 1.5,
          color: 'var(--ink)',
        }}
      >
        Your week, in your words.{' '}
        <span style={{ color: 'var(--muted)' }}>Tuesday at 9:00 — deep work, 90 minutes.</span>
      </div>
    </div>
  )
}

const QUIET_PRESETS = [
  { startMin: 18.5 * 60, endMin: 8.5 * 60, label: '18:30 – 08:30' },
  { startMin: 20 * 60, endMin: 7 * 60, label: '20:00 – 07:00' },
  { startMin: 22 * 60, endMin: 6 * 60, label: '22:00 – 06:00' },
]

/* The daily rituals (#285) share quiet hours' time primitive: one preset-
   cycling button. Defaults sit in each list (08:30 / 17:30); a brief inside
   quiet hours simply parks and rides the morning flush — the once-per-day
   key never double-posts it. */
const BRIEF_PRESETS = [7.5 * 60, 8 * 60, 8.5 * 60, 9 * 60, 9.5 * 60]
const WRAP_PRESETS = [16.5 * 60, 17 * 60, 17.5 * 60, 18 * 60]
/* the weekly ritual (#304) shares the same primitive — Sunday, default 17:00 */
const RITUAL_PRESETS = [15 * 60, 16 * 60, 17 * 60, 18 * 60, 19 * 60]

function fmtPreset(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

/** The quiet-hours time control, reused: a segc button cycling fixed times. */
function TimeCycle({
  value,
  presets,
  onChange,
}: {
  value: number
  presets: number[]
  onChange: (min: number) => void
}) {
  const idx = presets.indexOf(value)
  return (
    <span className="segc">
      <button
        type="button"
        className="on"
        title="click to cycle times"
        onClick={() => onChange(presets[(idx + 1) % presets.length])}
      >
        {fmtPreset(value)}
      </button>
    </span>
  )
}

/* The sustenance scaffold's per-meal knobs (#299) ride the same preset-
   cycling grammar: a window pair (quiet-hours' pattern) + a duration. The
   defaults sit in each list — lunch 12:00–14:00/45m, dinner 18:30–20:30/60m,
   the circadian anchors. A remembered pref ("lunch at 13:00") recenters the
   window at placement time; these govern otherwise. */
const MEAL_WINDOW_PRESETS: Record<ScaffoldMealId, { startMin: number; endMin: number }[]> = {
  lunch: [
    { startMin: 11.5 * 60, endMin: 13.5 * 60 },
    { startMin: 12 * 60, endMin: 14 * 60 },
    { startMin: 12.5 * 60, endMin: 14.5 * 60 },
    { startMin: 13 * 60, endMin: 15 * 60 },
  ],
  dinner: [
    { startMin: 18 * 60, endMin: 20 * 60 },
    { startMin: 18.5 * 60, endMin: 20.5 * 60 },
    { startMin: 19 * 60, endMin: 21 * 60 },
  ],
}
const MEAL_DURATION_PRESETS: Record<ScaffoldMealId, number[]> = {
  lunch: [30, 45, 60],
  dinner: [45, 60, 90],
}

/** One meal's scaffold row: window cycles its preset pairs, duration its
    minutes. Unlisted stored values (a future migration, a hand-edited
    backup) cycle back into the list at the first click — index -1 + 1 = 0. */
function MealCycle({ meal }: { meal: ScaffoldMealId }) {
  const settings = useMew((s) => s.settings)
  const updateSettings = useMew((s) => s.updateSettings)
  const plan = settings.sustenanceMeals[meal]
  const wins = MEAL_WINDOW_PRESETS[meal]
  const durs = MEAL_DURATION_PRESETS[meal]
  const wIdx = wins.findIndex((w) => w.startMin === plan.startMin && w.endMin === plan.endMin)
  const dIdx = durs.indexOf(plan.durationMin)
  const patch = (next: Partial<typeof plan>) =>
    updateSettings({
      sustenanceMeals: { ...settings.sustenanceMeals, [meal]: { ...plan, ...next } },
    })
  return (
    <>
      <span className="segc">
        <button
          type="button"
          className="on"
          title="click to cycle the window"
          onClick={() => {
            const next = wins[(wIdx + 1) % wins.length]
            patch({ startMin: next.startMin, endMin: next.endMin })
          }}
        >
          {fmtPreset(plan.startMin)} – {fmtPreset(plan.endMin)}
        </button>
      </span>
      <span className="segc">
        <button
          type="button"
          className="on"
          title="click to cycle the duration"
          onClick={() => patch({ durationMin: durs[(dIdx + 1) % durs.length] })}
        >
          {plan.durationMin} min
        </button>
      </span>
    </>
  )
}

/* #302 (v0.5 item 13): the meeting buffer's preset-cycle button — quiet hours'
   segc grammar over minute presets. 0 reads "Off" (today's placements, byte for
   byte); the rest name the margin MEW keeps around synced meetings. Unlisted
   stored values cycle back in on the first click (index -1 + 1 = 0). */
const BUFFER_PRESETS = [0, 5, 10, 15]

function BufferCycle() {
  const settings = useMew((s) => s.settings)
  const updateSettings = useMew((s) => s.updateSettings)
  const value = settings.meetingBufferMin ?? 0
  const idx = BUFFER_PRESETS.indexOf(value)
  return (
    <span className="segc">
      <button
        type="button"
        className="on"
        title="click to cycle the buffer"
        onClick={() =>
          updateSettings({ meetingBufferMin: BUFFER_PRESETS[(idx + 1) % BUFFER_PRESETS.length] })
        }
      >
        {value === 0 ? 'Off' : `${value} min`}
      </button>
    </span>
  )
}

function NudgesCard() {
  const settings = useMew((s) => s.settings)
  const updateSettings = useMew((s) => s.updateSettings)
  const quietIdx = QUIET_PRESETS.findIndex(
    (p) => p.startMin === settings.quietHours.startMin && p.endMin === settings.quietHours.endMin
  )
  const quietLabel = QUIET_PRESETS[quietIdx]?.label ?? '18:30 – 08:30'
  return (
    <div className="set-card">
      <h2>Nudges &amp; notifications</h2>
      <div className="sub">Everything arrives in chat. Browser only mirrors when you're away.</div>
      <SetRow t="Nudges in chat" s="The one channel — never a separate inbox.">
        <Tgl
          on
          lock
          cap="chat-first"
          title="Always on. One channel, and it is chat. The last thing you need is another inbox."
        />
      </SetRow>
      <SetRow t="Browser notifications" s="Mirror the chat nudge when the tab is unfocused.">
        <Tgl
          on={settings.browserMirror}
          onToggle={() => updateSettings({ browserMirror: !settings.browserMirror })}
        />
      </SetRow>
      <SetRow t="Quiet hours" s="Queued nudges wait for morning.">
        <span className="segc">
          <button
            type="button"
            className="on"
            title="click to cycle presets"
            onClick={() => {
              const next = QUIET_PRESETS[(quietIdx + 1) % QUIET_PRESETS.length]
              updateSettings({ quietHours: { startMin: next.startMin, endMin: next.endMin } })
            }}
          >
            {quietLabel}
          </button>
        </span>
      </SetRow>
      <SetRow
        t="Morning brief"
        s="Three lines to open the day — its shape, the first block, the one thing."
      >
        <TimeCycle
          value={settings.briefMin}
          presets={BRIEF_PRESETS}
          onChange={(min) => updateSettings({ briefMin: min })}
        />
      </SetRow>
      <SetRow t="Evening wrap" s="What landed, what waits for tomorrow — kindly, once a day.">
        <TimeCycle
          value={settings.wrapMin}
          presets={WRAP_PRESETS}
          onChange={(min) => updateSettings({ wrapMin: min })}
        />
      </SetRow>
      <SetRow
        t="Weekly ritual"
        s="Sunday's invite to plan the coming week — you pick the shape, once per week."
      >
        <TimeCycle
          value={settings.weeklyRitualMin}
          presets={RITUAL_PRESETS}
          onChange={(min) => updateSettings({ weeklyRitualMin: min })}
        />
      </SetRow>
      <SetRow
        t="Fed and paced"
        s="Each morning the day gains its missing meals and a breather, placed around what's there."
      >
        <Tgl
          on={settings.sustenance !== 'off'}
          onToggle={() =>
            updateSettings({ sustenance: settings.sustenance === 'off' ? 'on' : 'off' })
          }
        />
      </SetRow>
      {settings.sustenance !== 'off' && (
        <>
          <SetRow t="Lunch" s="The window it may land in, and how long it holds.">
            <MealCycle meal="lunch" />
          </SetRow>
          <SetRow
            t="Dinner"
            s="Same knobs — a time you say once (“dinner at 19:00”) outranks them."
          >
            <MealCycle meal="dinner" />
          </SetRow>
        </>
      )}
      <SetRow
        t="Meeting buffers"
        s="Breathing room around synced meetings — your own blocks land shy of a meeting's edges. Meetings never move; Off keeps today's placements."
      >
        <BufferCycle />
      </SetRow>
      <SetRow t="Show the science" s="Each nudge cites the research behind it.">
        <Tgl
          on={settings.showScience}
          onToggle={() => updateSettings({ showScience: !settings.showScience })}
        />
      </SetRow>
      <SetRow
        t="Quick-capture"
        s="⌘/Ctrl+Shift+C. Keep open waits in the rail; Place now drops it in today's first free 30 min."
      >
        <Segc
          options={[
            { id: 'open', label: 'Keep open' },
            { id: 'auto-place', label: 'Place now' },
          ]}
          value={settings.quickCaptureMode}
          onChange={(id) => updateSettings({ quickCaptureMode: id as 'open' | 'auto-place' })}
        />
      </SetRow>
      <HotkeyRow />
      <SetRow
        t="Plan mode"
        s="Big asks get named scenario cards to pick from — you choose the shape that lands. Auto offers them at 3+ items; Always at 2; Off keeps the one-pass place."
      >
        <Segc
          options={[
            { id: 'auto', label: 'Auto' },
            { id: 'always', label: 'Always' },
            { id: 'off', label: 'Off' },
          ]}
          value={settings.planMode}
          onChange={(id) => updateSettings({ planMode: id as Settings['planMode'] })}
        />
      </SetRow>
      <SetRow
        t="Energy-fit planning"
        s="Deep work lands where you actually finish it, admin gets batched — learned from what you complete, never a fixed curve. A fresh week behaves exactly as today."
      >
        <Tgl
          on={settings.energyFit !== 'off'}
          onToggle={() =>
            updateSettings({ energyFit: settings.energyFit === 'off' ? 'on' : 'off' })
          }
        />
      </SetRow>
      <SetRow
        t="Auto-size to demonstrated durations"
        s="MEW notices which kinds of work run long — deep work usually does, batched admin usually doesn't. Ask offers to give them room after a plan; Always pre-sizes the picker. A length you state is always kept. Off is exactly today."
      >
        <Segc
          options={[
            { id: 'off', label: 'Off' },
            { id: 'ask', label: 'Ask' },
            { id: 'always', label: 'Always' },
          ]}
          value={settings.estimateAutosize}
          onChange={(id) =>
            updateSettings({ estimateAutosize: id as Settings['estimateAutosize'] })
          }
        />
      </SetRow>
      <SetRow t="Positive only" s="Reward follow-through; never punish gaps.">
        <Tgl
          on
          lock
          cap="principle"
          title="Always on. We cheer the follow-through and shrug at the gaps. This dial is welded down."
        />
      </SetRow>
    </div>
  )
}

/* OS-global capture hotkey (#284) — desktop shell only (null off it). The
   shell is the validator: a rebind persists only once the OS accepted it; a
   refusal keeps the old binding working and swaps the subtitle for the kind
   collision note (positive-only). The field is keyed by the persisted
   binding, so a successful rebind remounts to the new value while a refusal
   keeps the attempt on screen to edit. */
function HotkeyRow() {
  const accel = useMew((s) => s.settings.globalCaptureHotkey)
  const collision = useMew((s) => s.hotkeyCollision)
  const applyCaptureHotkey = useMew((s) => s.applyCaptureHotkey)
  if (!isTauri()) return null
  return (
    <SetRow
      t="Global quick-capture"
      s={
        collision
          ? "that key's taken elsewhere — pick another and it's yours"
          : 'The same key, system-wide — even while MEW rests in the tray. In-app it always works.'
      }
    >
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {accel !== null && (
          <span className="keyfield">
            <input
              key={accel}
              defaultValue={accel}
              aria-label="Global quick-capture hotkey"
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (!next || next === accel) {
                  e.target.value = accel // nothing to bind — show what holds
                  return
                }
                void applyCaptureHotkey(next)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          </span>
        )}
        <Tgl
          on={accel !== null}
          title={accel !== null ? 'Release the OS-wide key' : 'Bind the OS-wide key'}
          onToggle={() =>
            void applyCaptureHotkey(accel !== null ? null : DEFAULT_SETTINGS.globalCaptureHotkey)
          }
        />
      </span>
    </SetRow>
  )
}

/* The built-in (sidecar) brain's lifecycle, in Settings copy — the user must
   always be able to answer "is my brain on?", dead or alive (#249). Tones
   reuse the health-dot palette: teal = live, gold = needs a glance, faint =
   in-between. 'off' renders nothing (no shell, or no beat yet). */
const SIDECAR_STATE: Record<
  Exclude<SidecarStatus, 'off'>,
  { label: string; tone: string; copy: string }
> = {
  starting: {
    label: 'starting…',
    tone: 'var(--faint)',
    copy: 'The desktop app is bringing your private brain up — memory comes online in a moment.',
  },
  connected: {
    label: 'connected',
    tone: 'var(--teal)',
    copy: 'A private gbrain runs on this machine, managed by the desktop app. It remembers your week; nothing leaves your device.',
  },
  retrying: {
    label: 'restarting…',
    tone: 'var(--gold)',
    copy: 'The brain hit a snag and the desktop app is bringing it back. The week keeps moving meanwhile.',
  },
  unavailable: {
    label: 'on device only',
    tone: 'var(--gold)',
    copy: "The built-in brain isn't running this session — MEW is on your on-device memory, learning and applying as ever. Cross-session recall returns on the next launch.",
  },
}

function PrivacyModelCard() {
  const settings = useMew((s) => s.settings)
  const updateSettings = useMew((s) => s.updateSettings)
  const exportData = useMew((s) => s.exportData)
  const importData = useMew((s) => s.importData)
  const brainSidecar = useMew((s) => s.brainSidecar)
  /* the EFFECTIVE brain (Settings opt-in OR live sidecar) drives the health
     row — the bare toggle lies on desktop, where a sidecar runs with it off */
  const effectiveOn = useMew((s) => brainIsOn(s.settings))
  const [editingKey, setEditingKey] = useState(false)
  const [editingBrainToken, setEditingBrainToken] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /* brain health: probed while ANY brain is live (sidecar included), re-probed
     on edits and on each sidecar beat — a reconnect means a new port */
  const [brainUp, setBrainUp] = useState<boolean | null>(null)
  useEffect(() => {
    if (!effectiveOn) {
      // Clearing the probe result when the row goes inert syncs UI state with an
      // external system (the brain service); the rest of the effect awaits an
      // async health check, so this whole block belongs in an effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets async health-probe state when the brain row is disabled
      setBrainUp(null)
      return
    }
    let alive = true
    void mewBrain.health().then((ok) => {
      if (alive) setBrainUp(ok)
    })
    return () => {
      alive = false
    }
  }, [effectiveOn, settings.brainUrl, settings.brainToken, brainSidecar])

  const downloadBackup = async () => {
    const json = await exportData()
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `mew-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const provider = settings.remoteProvider
  const activeKey = provider === 'openai' ? settings.openaiKey : settings.anthropicKey
  const masked = activeKey ? `sk-••••••••••${activeKey.slice(-4)}` : 'no key yet'
  const activeModel = provider === 'openai' ? settings.openaiModel : settings.anthropicModel

  return (
    <div className="set-card">
      <h2>Privacy &amp; model</h2>
      <div className="sub">Local-first. Your week is yours.</div>
      <SetRow t="Local-first storage" s="Your data lives on your device.">
        <Tgl
          on
          lock
          cap="by design"
          title="Always on. Your week stays on this device. Nothing to switch off, nothing to leak."
        />
      </SetRow>
      <SetRow t="Where the model runs" s="Fully local keeps every word on your machine (Ollama).">
        <Segc
          options={[
            { id: 'remote', label: 'Remote' },
            { id: 'local', label: 'Fully local' },
          ]}
          value={settings.modelLocation}
          onChange={(id) => updateSettings({ modelLocation: id as 'remote' | 'local' })}
        />
      </SetRow>
      {settings.modelLocation === 'remote' && (
        <SetRow t="Remote brain" s="Either way the key is yours and stays on-device.">
          <Segc
            options={[
              { id: 'anthropic', label: 'Anthropic' },
              { id: 'openai', label: 'OpenAI' },
            ]}
            value={provider}
            onChange={(id) => {
              updateSettings({ remoteProvider: id as 'anthropic' | 'openai' })
              setEditingKey(false)
            }}
          />
        </SetRow>
      )}
      {settings.modelLocation === 'remote' && (
        <SetRow
          t="Model"
          s={
            provider === 'openai'
              ? 'Pick a current OpenAI model, or type any model id.'
              : 'Pick a current Claude model, or type any id. Fable is the frontier model — capable but less stable.'
          }
        >
          <ModelPicker
            key={provider}
            models={provider === 'openai' ? OPENAI_MODELS : ANTHROPIC_MODELS}
            value={provider === 'openai' ? settings.openaiModel : settings.anthropicModel}
            onChange={(id) =>
              updateSettings(provider === 'openai' ? { openaiModel: id } : { anthropicModel: id })
            }
          />
        </SetRow>
      )}
      {/* pre-tool reasoning snapshot (#166) — Anthropic-only, where the SDK
          surfaces a thinking stream. Off keeps every turn exactly as before. */}
      {settings.modelLocation === 'remote' && provider === 'anthropic' && (
        <SetRow
          t="Show the plan first"
          s="Claude thinks before it acts; see that plan, collapsed under each reply. A little slower, costs a touch more on your key."
        >
          <Tgl
            on={settings.showReasoning}
            onToggle={() => updateSettings({ showReasoning: !settings.showReasoning })}
          />
        </SetRow>
      )}
      <SetRow
        t="Bring your own key"
        s={`Sent only to ${provider === 'openai' ? 'api.openai.com' : 'api.anthropic.com'}.`}
      >
        {keySetupView(activeKey, editingKey) === 'edit' ? (
          <span className="keyfield">
            <input
              autoFocus
              type="password"
              placeholder={provider === 'openai' ? 'sk-…' : 'sk-ant-…'}
              defaultValue={activeKey}
              onBlur={(e) => {
                const v = e.target.value.trim()
                updateSettings(provider === 'openai' ? { openaiKey: v } : { anthropicKey: v })
                setEditingKey(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          </span>
        ) : keySetupView(activeKey, editingKey) === 'masked' ? (
          /* key already set — the normal masked field to edit/swap it */
          <button type="button" className="keyfield" onClick={() => setEditingKey(true)}>
            {masked}
          </button>
        ) : (
          /* first run: the guided flow replaces the dense field (#161). A small
             escape hatch keeps the raw paste for power users — the dense form is
             one click away, never lost. */
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
          >
            <Button variant="primary" size="sm" onClick={() => setSetupOpen(true)}>
              Set up AI
            </Button>
            <button
              type="button"
              className="navlink mono"
              style={{ fontSize: 10 }}
              onClick={() => setEditingKey(true)}
            >
              paste a key
            </button>
          </span>
        )}
      </SetRow>
      <SetRow
        t="Brain"
        s={
          /* honest, always-positive: an ON brain that isn't answering reads as
             on-device (still helpful), never broken; an OFF brain says the
             on-device floor still learns and applies (#329) */
          effectiveOn && brainUp === false
            ? 'Not answering right now — MEW is running on your on-device memory; nothing is lost.'
            : settings.brainEnabled
              ? `Enriching your on-device memory with cross-session recall — gbrain at ${settings.brainUrl}.`
              : brainSidecar !== 'off'
                ? 'A built-in brain runs on this machine (status below), enriching your on-device memory. Toggle on to point MEW at your own gbrain instead.'
                : 'MEW learns and applies on this device. A gbrain adds cross-session recall on top — off means nothing leaves this tab.'
        }
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* the dot + word follow the EFFECTIVE brain — a live sidecar shows
              health here even with the toggle off; a dead one honestly shows
              nothing. The word states the mode so it's seen, not only hovered:
              enriching (answering) vs on-device (present but silent) — #329 */}
          {effectiveOn && (
            <>
              <span
                title={brainUp == null ? 'checking…' : brainUp ? 'reachable' : 'unreachable'}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    brainUp == null ? 'var(--faint)' : brainUp ? 'var(--teal)' : 'var(--gold)',
                }}
              />
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: brainUp == null ? 'var(--faint)' : brainUp ? 'var(--teal)' : 'var(--gold)',
                }}
              >
                {brainUp == null ? 'checking…' : brainUp ? 'enriching' : 'on device'}
              </span>
            </>
          )}
          {settings.brainEnabled && (
            <>
              <Segc
                options={[
                  { id: 'sidecar', label: 'Built-in' },
                  { id: 'endpoint', label: 'My gbrain' },
                  { id: 'supabase', label: 'Supabase' },
                ]}
                value={settings.brainMode}
                onChange={(id) =>
                  updateSettings({ brainMode: id as 'sidecar' | 'endpoint' | 'supabase' })
                }
              />
              {settings.brainMode !== 'sidecar' && (
                <span className="keyfield">
                  <input
                    defaultValue={settings.brainUrl}
                    placeholder={
                      settings.brainMode === 'supabase'
                        ? 'https://brain.yourdomain.dev (serve over Supabase)'
                        : 'http://localhost:3131'
                    }
                    onBlur={(e) =>
                      updateSettings({ brainUrl: e.target.value.trim() || 'http://localhost:3131' })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                  />
                </span>
              )}
            </>
          )}
          <Tgl
            on={settings.brainEnabled}
            onToggle={() => updateSettings({ brainEnabled: !settings.brainEnabled })}
            title="brain on/off"
          />
        </span>
      </SetRow>
      {/* the built-in brain's live state — connected / starting / restarting /
          unavailable ("on device only"). Rendered whenever the shell has
          reported a beat and the user hasn't opted into their own endpoint, so
          a dead sidecar is visibly dead instead of masquerading as "Off". */}
      {!settings.brainEnabled && brainSidecar !== 'off' && (
        <SetRow t="Built-in brain" s={SIDECAR_STATE[brainSidecar].copy}>
          <span className="mono" style={{ fontSize: 10, color: SIDECAR_STATE[brainSidecar].tone }}>
            {SIDECAR_STATE[brainSidecar].label}
          </span>
        </SetRow>
      )}
      {settings.brainEnabled && (
        <SetRow
          t="Recall scope"
          s="MEW only = recall reads just the pages MEW writes. Whole brain = your other agents' notes can inform the week (their lines arrive marked '· via <page>'). Opt-in, default narrow."
        >
          <Segc
            options={[
              { id: 'mew', label: 'MEW only' },
              { id: 'all', label: 'Whole brain' },
            ]}
            value={settings.brainScope}
            onChange={(id) => updateSettings({ brainScope: id as 'mew' | 'all' })}
          />
        </SetRow>
      )}
      {settings.brainEnabled && settings.brainMode !== 'sidecar' && (
        <SetRow
          t="Serve key"
          s="Sent only to your gbrain serve (Authorization: Bearer). Stays on this device — backups never carry it. Blank is fine for a local, unauthed serve."
        >
          {editingBrainToken ? (
            <span className="keyfield">
              <input
                autoFocus
                type="password"
                placeholder="serve API key"
                defaultValue={settings.brainToken}
                onBlur={(e) => {
                  updateSettings({ brainToken: e.target.value.trim() })
                  setEditingBrainToken(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
              />
            </span>
          ) : (
            <button type="button" className="keyfield" onClick={() => setEditingBrainToken(true)}>
              {settings.brainToken
                ? `••••••••${settings.brainToken.slice(-4)}`
                : 'no key (local serve)'}
            </button>
          )}
        </SetRow>
      )}
      {settings.brainEnabled && settings.brainMode === 'supabase' && (
        <SetRow
          t="Your brain, your Supabase"
          s="Opt-in: MEW talks only to YOUR gbrain serve; the serve talks to YOUR Supabase (RLS keeps it yours). One brain across web, desktop, and every agent that fills it. Recipe in the README."
        >
          <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>
            docs → README · One brain
          </span>
        </SetRow>
      )}
      {settings.brainEnabled && settings.brainMode === 'sidecar' && (
        <SetRow
          t="Built-in brain"
          s="The desktop app manages a private brain and engages it automatically while this toggle is off. Toggled on, this mode still reads the My gbrain URL — on the web there is no sidecar."
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: brainSidecar !== 'off' ? SIDECAR_STATE[brainSidecar].tone : 'var(--faint)',
            }}
          >
            {brainSidecar !== 'off' ? SIDECAR_STATE[brainSidecar].label : 'desktop-managed'}
          </span>
        </SetRow>
      )}
      <SetRow
        t="Backup &amp; restore"
        s="One .json with your week, memory, and chat. Keys never travel — each device keeps its own."
      >
        <span style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={() => void downloadBackup()}>
            download
          </Button>
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            restore…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) await importData(await f.text())
            }}
          />
        </span>
      </SetRow>
      {isTauri() && (
        <SetRow
          t="Desktop auto-backup"
          s={`Every change lands in ${backupPath()} within a minute — 14 daily rotations kept.`}
        >
          <Button variant="ghost" size="sm" onClick={() => void openBackupFolder()}>
            open folder
          </Button>
        </SetRow>
      )}
      {setupOpen && (
        <ApiKeySetupFlow
          provider={provider}
          model={activeModel}
          onClose={() => setSetupOpen(false)}
          onDone={(key) => {
            updateSettings(provider === 'openai' ? { openaiKey: key } : { anthropicKey: key })
            setSetupOpen(false)
          }}
        />
      )}
    </div>
  )
}
