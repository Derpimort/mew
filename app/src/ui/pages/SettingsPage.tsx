/* Settings on Carbon (SurfaceSettings, mew-v22) — live pet picker re-themes
   the whole page; the routing matrix, connect flow, sync status, quiet hours
   and model settings keep their full behavior, re-skinned. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { mewBrain, useMew } from '../../state/store'
import type { PetId, Settings, VisibleTag } from '../../domain/types'
import { project } from '../../domain/project'
import { dayKey, fmtTime, minOfDay } from '../../domain/time'
import { aggregates } from '../../domain/memory'
import { computeInsights } from '../../domain/insights'
import { Button, Segc, Tgl } from '../primitives'
import { PETS, petById } from '../primitives/pets'
import { backupPath, isTauri, openBackupFolder } from '../../adapters/desktop'
import { usePetPalette } from '../components/petPalette'
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

/* Current models per provider (verified June 2026). Model ids change often, so
   the list is a convenience over a freeform field — never the only way in. */
const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 · balanced' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 · most capable' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 · fast & cheap' },
  { id: 'claude-fable-5', label: 'Claude Fable 5 · frontier (less stable)' },
]
const OPENAI_MODELS = [
  { id: 'gpt-5.5', label: 'GPT-5.5 · most capable' },
  { id: 'gpt-5.4', label: 'GPT-5.4 · balanced' },
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
          <PrivacyModelCard />
        </div>
      </div>
    </div>
  )
}

/* Your patterns — the brain's trailing-4-week numbers made visible: weekday
   load as an animated line, MEW's own insight lines underneath. Appears only
   once the memory has something honest to show. */
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
        <Tgl on lock cap="always" />
      </SetRow>
      <SetRow t="Care, not blame" s="Strain is met with help, never judgment.">
        <Tgl on lock cap="absolute" />
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
  const syncing = useMew((s) => s.syncing)
  const lastSyncAt = useMew((s) => s.lastSyncAt)
  const syncError = useMew((s) => s.syncError)
  const [editing, setEditing] = useState<string | null>(null)
  const [askClientId, setAskClientId] = useState(false)

  const todayKey = dayKey(new Date(nowMs))
  const hasLive = settings.calendars.some((c) => c.kind === 'live')
  const editingCal = settings.calendars.find((c) => c.id === editing)

  const mono9: React.CSSProperties = {
    fontSize: 9,
    color: 'var(--faint)',
    textTransform: 'uppercase',
    letterSpacing: '.1em',
  }

  return (
    <div className="set-card">
      <h2>Calendars &amp; what they see</h2>
      <div className="sub">MEW sees the whole week; each calendar sees only what you allow.</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.3fr repeat(3,auto) auto',
          gap: '8px 10px',
          alignItems: 'center',
        }}
      >
        <span className="mono" style={mono9}>
          calendar
        </span>
        {TAGS.map((t) => (
          <span key={t} className="mono" style={mono9}>
            {t}
          </span>
        ))}
        <span />

        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--gold)' }}>MEW</span>
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
                  fontSize: 12.5,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={c.who}
              >
                {c.name}
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
            const events = project(blocks, settings.matrix, editing).filter(
              (e) => e.dayKey === todayKey
            )
            if (!events.length) return 'nothing — every tag is hidden or the day is clear'
            return events.map((e) => (
              <span key={e.blockId}>
                {fmtTime(e.startMin)}–{fmtTime(e.endMin)} {e.title}
                <br />
              </span>
            ))
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
          size="sm"
          disabled={connecting}
          onClick={() => {
            if (!settings.googleClientId) setAskClientId(true)
            else void connectGoogle()
          }}
        >
          {connecting ? 'opening google sign-in…' : '+ connect a calendar'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
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
          <span style={{ marginLeft: 'auto', color: syncError ? 'var(--ice)' : 'var(--faint)' }}>
            {syncing
              ? 'syncing…'
              : syncError
                ? `sync hiccup: ${syncError.slice(0, 40)}`
                : lastSyncAt
                  ? `synced ${fmtTime(minOfDay(new Date(lastSyncAt)))}`
                  : 'sync pending…'}
          </span>
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
        <Tgl on lock cap="chat-first" />
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
      <SetRow t="Positive only" s="Reward follow-through; never punish gaps.">
        <Tgl on lock cap="principle" />
      </SetRow>
    </div>
  )
}

function PrivacyModelCard() {
  const settings = useMew((s) => s.settings)
  const updateSettings = useMew((s) => s.updateSettings)
  const exportData = useMew((s) => s.exportData)
  const importData = useMew((s) => s.importData)
  const [editingKey, setEditingKey] = useState(false)
  const [editingBrainToken, setEditingBrainToken] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /* brain health: probed when the row is live, re-probed on edits */
  const [brainUp, setBrainUp] = useState<boolean | null>(null)
  useEffect(() => {
    if (!settings.brainEnabled) {
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
  }, [settings.brainEnabled, settings.brainUrl, settings.brainToken])

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
        <Tgl on lock cap="by design" />
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
          settings.brainEnabled
            ? `Writes what happens, recalls what matters — gbrain at ${settings.brainUrl}.`
            : 'Optional gbrain endpoint: MEW writes what happens and recalls what matters. Off = nothing leaves this tab.'
        }
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {settings.brainEnabled && (
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
          s="The desktop app manages a private brain for you — no setup. (Arrives with the desktop sidecar; until then this behaves like My gbrain.)"
        >
          <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>
            desktop-managed
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
