/* The command palette — one keyboard-first surface (#169) that also hosts
   global search (#170) and quick-capture (#171). It is a UI-only overlay above
   the existing executors: command rows route the user INTO the conversational
   path (they pre-fill the composer and let MEW run the tool — tools stay the
   only way the week changes) or jump to a view; quick-capture uses the store's
   dedicated quickCapture action; search is read-only.

   Accessibility: role="dialog" + aria-modal, a focus trap, Esc closes and
   restores focus to wherever it was, ↑/↓ move the selection, Enter runs it.
   Mounted once (MainPage); renders nothing until opened, so it never touches
   the resting layout or the screenshot harness.

   Voice: positive, plain, lower-case tty — "jot it down", "find a slot",
   never "no results"/"failed". */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMew } from '../../state/store'
import { flatten, totalHits, type SearchHit } from '../../domain/search'
import { GlobalSearch } from './GlobalSearch'
import { QuickCapture } from './QuickCapture'

type Mode = 'command' | 'search' | 'capture'

/** A command row: a label, a mnemonic hint, and what it does. Commands that
    talk to MEW seed the composer (`prompt`) so the model runs the real tool;
    others switch mode or navigate. Keeping the registry as data makes the list
    fuzzy-searchable and easy to extend without touching the render. */
interface Command {
  id: string
  label: string
  hint: string
  /** keywords that also match this command in the fuzzy filter */
  keys: string
  run: (api: CommandApi) => void
}

interface CommandApi {
  seedComposer: (text: string) => void
  setMode: (m: Mode) => void
  setView: (v: 'focus' | 'week') => void
  setPage: (p: 'week' | 'settings') => void
  close: () => void
}

const COMMANDS: Command[] = [
  {
    id: 'plan',
    label: 'Plan a block',
    hint: 'p',
    keys: 'plan schedule place add new block deep work',
    run: (a) => a.seedComposer('block '),
  },
  {
    id: 'move',
    label: 'Move a block',
    hint: 'm',
    keys: 'move reschedule shift push',
    run: (a) => a.seedComposer('move '),
  },
  {
    id: 'complete',
    label: 'Mark something done',
    hint: 'd',
    keys: 'complete done finish mew check off',
    run: (a) => a.seedComposer('done with '),
  },
  {
    id: 'capture',
    label: 'Quick-capture',
    hint: 'c',
    keys: 'capture jot note todo remember later inbox',
    run: (a) => a.setMode('capture'),
  },
  {
    id: 'find',
    label: 'Find a free slot',
    hint: 'f',
    keys: 'find slot free window time gap when',
    run: (a) => a.seedComposer('find a 30 min slot '),
  },
  {
    id: 'analyze',
    label: 'Read my day',
    hint: 'a',
    keys: 'analyze day shape load review look',
    run: (a) => a.seedComposer('how does today look'),
  },
  {
    id: 'search',
    label: 'Search everything',
    hint: '/',
    keys: 'search find filter look up blocks captures chat',
    run: (a) => a.setMode('search'),
  },
  {
    id: 'week',
    label: 'Go to Week view',
    hint: 'w',
    keys: 'week grid columns view',
    run: (a) => {
      a.setView('week')
      a.close()
    },
  },
  {
    id: 'focus',
    label: 'Go to Focus view',
    hint: 'o',
    keys: 'focus dial now view',
    run: (a) => {
      a.setView('focus')
      a.close()
    },
  },
  {
    id: 'settings',
    label: 'Open Settings',
    hint: 's',
    keys: 'settings preferences pet theme model key',
    run: (a) => {
      a.setPage('settings')
      a.close()
    },
  },
]

/** Diacritic-insensitive, lower-cased — the same fold the domain search uses,
    inlined so a command filter has no domain import of its own. */
function foldLite(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function filterCommands(query: string): Command[] {
  const q = foldLite(query)
  if (!q) return COMMANDS
  return COMMANDS.filter((c) => foldLite(`${c.label} ${c.keys}`).includes(q))
}

export function CommandPalette() {
  const open = useMew((s) => s.commandPaletteOpen)
  const openPalette = useMew((s) => s.openCommandPalette)
  const closePalette = useMew((s) => s.closeCommandPalette)
  const setPromptDraft = useMew((s) => s.setPromptDraft)
  const setView = useMew((s) => s.setView)
  const setPage = useMew((s) => s.setPage)

  /* which pane the next open lands on (Cmd+K → command, Cmd+Shift+F → search,
     Cmd+Shift+C → capture). State, not a ref, so the render reads it safely;
     the hotkey sets it just before opening, batched with the open flag. */
  const [requestedMode, setRequestedMode] = useState<Mode>('command')

  /* ── global hotkeys (always listening, even while closed) ─────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 'k' && !e.shiftKey) {
        e.preventDefault()
        setRequestedMode('command')
        if (useMew.getState().commandPaletteOpen) closePalette()
        else openPalette()
      } else if (k === 'f' && e.shiftKey) {
        e.preventDefault()
        setRequestedMode('search')
        openPalette()
      } else if (k === 'c' && e.shiftKey) {
        e.preventDefault()
        setRequestedMode('capture')
        openPalette()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPalette, closePalette])

  if (!open) return null
  return (
    <PaletteSurface
      initialMode={requestedMode}
      onClose={closePalette}
      api={{ setPromptDraft, setView, setPage }}
    />
  )
}

/* The mounted surface — split out so all the focus/keyboard state lives behind
   the `open` gate (no hooks run while the palette is closed). */
function PaletteSurface({
  initialMode,
  onClose,
  api,
}: {
  initialMode: Mode
  onClose: () => void
  api: {
    setPromptDraft: (t: string) => void
    setView: (v: 'focus' | 'week') => void
    setPage: (p: 'week' | 'settings') => void
  }
}) {
  const searchAll = useMew((s) => s.searchAll)
  const quickCapture = useMew((s) => s.quickCapture)
  const revealBlock = useMew((s) => s.revealBlock)
  const revealChat = useMew((s) => s.revealChatMessage)
  const captureMode = useMew((s) => s.settings.quickCaptureMode)

  const [mode, setMode] = useState<Mode>(initialMode)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [toast, setToast] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  /* where focus was before we opened — restored on close (acceptance: Esc
     returns focus to where the user was). Captured once, on mount. */
  const returnTo = useRef<Element | null>(
    typeof document !== 'undefined' ? document.activeElement : null
  )

  /* close + restore focus in one place so every exit path (Esc, outside click,
     a chosen command) behaves the same. */
  const close = useCallback(() => {
    onClose()
    const el = returnTo.current
    if (el instanceof HTMLElement) el.focus()
  }, [onClose])

  /* switch panes: clear the query and reset the selection together, so every
     mode change (tab click, a command that jumps panes) starts a fresh list at
     the top — done in the event, never in an effect (no cascading renders). */
  const switchMode = useCallback((m: Mode) => {
    setMode(m)
    setQuery('')
    setSel(0)
  }, [])

  /* focus the input on open and whenever the mode flips (a fresh pane wants the
     cursor) — a focus side-effect only; selection is reset in switchMode. */
  useEffect(() => {
    inputRef.current?.focus()
  }, [mode])

  /* auto-dismiss the inline toast after 3s (acceptance: toast for 3s then
     fades; early dismiss is Esc/next command, handled below). */
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  /* ── derived lists ────────────────────────────────────────────────── */
  const commands = useMemo(() => (mode === 'command' ? filterCommands(query) : []), [mode, query])
  const groups = useMemo(
    () => (mode === 'search' ? searchAll(query) : { block: [], capture: [], chat: [] }),
    [mode, query, searchAll]
  )
  const searchFlat = useMemo(() => flatten(groups), [groups])

  /* the flat, navigable list for the active mode (capture mode has no list) */
  const navCount = mode === 'command' ? commands.length : mode === 'search' ? searchFlat.length : 0
  const clampedSel = navCount ? Math.min(sel, navCount - 1) : 0

  const commandApi: CommandApi = useMemo(
    () => ({
      seedComposer: (text: string) => {
        api.setPromptDraft(text)
        close()
        /* hand the cursor to the composer so the user keeps typing the ask */
        setTimeout(() => {
          const ta = document.querySelector<HTMLTextAreaElement>('.prompt-row textarea')
          ta?.focus()
          const len = ta?.value.length ?? 0
          ta?.setSelectionRange(len, len)
        }, 0)
      },
      setMode: switchMode,
      setView: api.setView,
      setPage: api.setPage,
      close,
    }),
    [api, close, switchMode]
  )

  const runCommand = useCallback((c: Command) => c.run(commandApi), [commandApi])

  const openHit = useCallback(
    (hit: SearchHit) => {
      if (hit.kind === 'chat') revealChat(hit.id)
      else revealBlock(hit.id) // blocks and (placed) captures both land on a block
      close()
    },
    [revealBlock, revealChat, close]
  )

  const submitCapture = useCallback(
    (autoPlace: boolean) => {
      const res = quickCapture(query, autoPlace)
      if (res.kind === 'empty') {
        setToast(res.message)
        return
      }
      /* keep the palette open for rapid captures (acceptance: 3× in a row),
         clear the input, show the result chip, return focus to the field */
      setQuery('')
      setToast(res.message)
      inputRef.current?.focus()
    },
    [quickCapture, query]
  )

  /* ── the dialog's own keyboard map ────────────────────────────────── */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (toast) {
        setToast(null) // first Esc clears a lingering chip…
        return
      }
      close() // …then closes
      return
    }
    if (e.key === 'ArrowDown' && navCount) {
      e.preventDefault()
      setSel((s) => (s + 1) % navCount)
      return
    }
    if (e.key === 'ArrowUp' && navCount) {
      e.preventDefault()
      setSel((s) => (s - 1 + navCount) % navCount)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (mode === 'capture') {
        // Enter uses the user's default; Shift+Enter forces place-now
        submitCapture(e.shiftKey ? true : captureMode === 'auto-place')
        return
      }
      if (mode === 'command' && commands[clampedSel]) runCommand(commands[clampedSel])
      else if (mode === 'search' && searchFlat[clampedSel]) openHit(searchFlat[clampedSel])
    }
  }

  /* a basic focus trap: Tab/Shift+Tab cycle within the dialog (acceptance:
     focus stays in the palette; Tab does not escape to the page behind). */
  const onTrapKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (!focusables || !focusables.length) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const placeholder =
    mode === 'search'
      ? 'search blocks, captures, chat…'
      : mode === 'capture'
        ? 'jot a quick capture…'
        : 'type a command, or search…'

  const titleId = 'cmdk-title'
  return (
    <div className="cmdk-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={dialogRef}
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          onTrapKey(e)
          onKeyDown(e)
        }}
      >
        <h2 id={titleId} className="sr-only">
          Command palette
        </h2>
        {/* mode tabs — one surface, three jobs; keyboard or click */}
        <div className="cmdk-tabs" role="tablist" aria-label="palette mode">
          {(['command', 'search', 'capture'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'on' : ''}
              onClick={() => switchMode(m)}
            >
              {m === 'command' ? 'commands' : m === 'search' ? 'search' : 'capture'}
            </button>
          ))}
          <span className="cmdk-spacer" />
          <span className="cmdk-esc">
            <span className="k">esc</span> close
          </span>
        </div>

        <div className="cmdk-input-row">
          <span className="p-arr" aria-hidden>
            ❯
          </span>
          <input
            ref={inputRef}
            className="cmdk-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSel(0)
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* live region announces the result count / capture toast to AT */}
        <div className="sr-only" aria-live="polite">
          {toast ??
            (mode === 'search'
              ? `${totalHits(groups)} found`
              : mode === 'command'
                ? `${commands.length} commands`
                : '')}
        </div>

        <div
          className="cmdk-body"
          role={mode === 'capture' ? undefined : 'listbox'}
          aria-label={
            mode === 'search' ? 'search results' : mode === 'command' ? 'commands' : undefined
          }
        >
          {mode === 'command' && (
            <CommandList
              commands={commands}
              sel={clampedSel}
              onPick={runCommand}
              onHover={setSel}
            />
          )}
          {mode === 'search' && (
            <GlobalSearch
              groups={groups}
              flat={searchFlat}
              sel={clampedSel}
              onPick={openHit}
              onHover={setSel}
            />
          )}
          {mode === 'capture' && (
            <QuickCapture mode={captureMode} onSubmit={submitCapture} hasText={!!query.trim()} />
          )}
        </div>

        {toast && (
          <div className="cmdk-toast" role="status">
            <span className="mw">★</span> {toast}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── panes ──────────────────────────────────────────────────────────── */

function CommandList({
  commands,
  sel,
  onPick,
  onHover,
}: {
  commands: Command[]
  sel: number
  onPick: (c: Command) => void
  onHover: (i: number) => void
}) {
  if (!commands.length) {
    return (
      <div className="cmdk-empty">
        Nothing matches that yet — try fewer letters, or switch to search.
      </div>
    )
  }
  return (
    <>
      {commands.map((c, i) => (
        <button
          key={c.id}
          type="button"
          role="option"
          aria-selected={i === sel}
          className={'cmdk-row' + (i === sel ? ' sel' : '')}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(c)}
        >
          <span className="cmdk-row-label">{c.label}</span>
          <span className="cmdk-row-hint k">{c.hint}</span>
        </button>
      ))}
    </>
  )
}
