/* The Focus dial's day picker (#23 slice 2) — the date header's calendar glyph
   opens it. The APG date-picker dialog, tokens-first in the command palette's
   popover dress:

   - role="dialog" + aria-modal, a Tab trap, and a role="grid" month whose one
     roving tab stop is the active day. ←/→ a day, ↑/↓ a week, PageUp/PageDown a
     month (Shift: a year), Home/End the week's edges, Enter/Space or a click
     picks (the pure grammar lives in dayPickerKeys.ts).
   - Escape closes WITHOUT reaching the dial: it's caught in the capture phase
     on document, ahead of React's root listener, so the arcs' Escape (demote)
     and every window listener never see it (the ApiKeySetupFlow precedent).
   - An explicit close (Escape, a pick) hands focus back to the trigger — the
     header owns that ref. A dismissal leaves focus where it went: a press
     outside, or focus moved away on purpose (⌘K's palette, say).
   - The range is Week's: unbounded. It only ever PICKS a day — focusedDayKey,
     the one key Week and the dial share — and never changes the week itself. */

import { useEffect, useId, useRef, useState } from 'react'
import { fmtDow, fmtDowLong } from '../../domain/time'
import {
  addMonthsKey,
  cellLabel,
  monthGrid,
  monthLabel,
  monthOf,
  pickerKeyIntent,
  stepActiveDay,
} from './dayPickerKeys'

export interface DayPickerProps {
  /** the day the dial shows — the picker opens on it (aria-selected) */
  viewDayKey: string
  /** today (aria-current="date") */
  todayKey: string
  onPick: (key: string) => void
  /** Escape: close and hand focus back to the trigger */
  onClose: () => void
  /** a press outside, or focus moved elsewhere: close and leave focus there */
  onDismiss: () => void
  /** the header button that opened it: a press on it toggles, not "outside" */
  triggerRef: React.RefObject<HTMLElement | null>
}

export function DayPicker({
  viewDayKey,
  todayKey,
  onPick,
  onClose,
  onDismiss,
  triggerRef,
}: DayPickerProps) {
  const [active, setActive] = useState(viewDayKey)
  const dialogRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef(new Map<string, HTMLTableCellElement | null>())
  /* focus follows the active day only when the grid moved it (and on open) —
     the month buttons change the month but keep their own focus (APG) */
  const focusActive = useRef(true)
  const monthId = useId()

  useEffect(() => {
    if (!focusActive.current) return
    focusActive.current = false
    cellRefs.current.get(active)?.focus()
  }, [active])

  /* Escape precedence + outside press, only while open (mounted) */
  useEffect(() => {
    const within = (t: EventTarget | null, el: HTMLElement | null) =>
      t instanceof Node && !!el?.contains(t)
    const onKey = (e: KeyboardEvent) => {
      if (!within(e.target, dialogRef.current)) return
      if (pickerKeyIntent(e.key)?.kind !== 'close') return
      e.preventDefault()
      e.stopPropagation() // capture phase: the dial's demote never hears it
      onClose()
    }
    const onDown = (e: PointerEvent) => {
      if (within(e.target, dialogRef.current) || within(e.target, triggerRef.current)) return
      onDismiss()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose, onDismiss, triggerRef])

  const moveTo = (key: string) => {
    if (key === active) return
    focusActive.current = true
    setActive(key)
  }

  const onGridKey = (e: React.KeyboardEvent) => {
    const intent = pickerKeyIntent(e.key, { shift: e.shiftKey })
    if (!intent || intent.kind === 'close') return
    e.preventDefault()
    if (intent.kind === 'pick') onPick(active)
    else moveTo(stepActiveDay(active, intent))
  }

  /* a basic trap: Tab / Shift+Tab cycle inside the dialog (the palette's) */
  const onTrapKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const stops = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [tabindex]:not([tabindex="-1"])'
    )
    if (!stops || !stops.length) return
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const weeks = monthGrid(active)
  const shown = monthOf(active)
  const prevMonth = addMonthsKey(active, -1)
  const nextMonth = addMonthsKey(active, 1)

  return (
    <div
      ref={dialogRef}
      className="dp"
      role="dialog"
      aria-modal="true"
      aria-label="pick a day for the focus dial"
      /* a press on the dialog's own text keeps focus in it, so Escape still
         has a target inside */
      tabIndex={-1}
      onKeyDown={onTrapKey}
      onBlur={(e) => {
        const to = e.relatedTarget
        if (!(to instanceof Node)) return // the window lost focus, or a re-render
        if (dialogRef.current?.contains(to) || triggerRef.current?.contains(to)) return
        onDismiss()
      }}
      /* the stage closes an open card on click; a press in here stays in here */
      onClick={(e) => e.stopPropagation()}
    >
      <div className="dp-head">
        <button
          type="button"
          className="dp-nav"
          aria-label={`previous month — ${monthLabel(prevMonth)}`}
          onClick={() => setActive(prevMonth)}
        >
          ‹
        </button>
        <h2 id={monthId} className="dp-month" aria-live="polite">
          {monthLabel(active)}
        </h2>
        <button
          type="button"
          className="dp-nav"
          aria-label={`next month — ${monthLabel(nextMonth)}`}
          onClick={() => setActive(nextMonth)}
        >
          ›
        </button>
      </div>
      <table className="dp-grid" role="grid" aria-labelledby={monthId} onKeyDown={onGridKey}>
        <thead>
          <tr>
            {weeks[0].map((k) => (
              <th key={fmtDow(k)} scope="col" abbr={fmtDowLong(k)}>
                {fmtDow(k).slice(0, 2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((k) => (
                <td
                  key={k}
                  ref={(el) => {
                    cellRefs.current.set(k, el)
                  }}
                  data-daykey={k}
                  className={monthOf(k) === shown ? undefined : 'out'}
                  tabIndex={k === active ? 0 : -1}
                  aria-label={cellLabel(k)}
                  aria-selected={k === viewDayKey}
                  aria-current={k === todayKey ? 'date' : undefined}
                  onClick={() => onPick(k)}
                >
                  {Number(k.slice(8))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dp-foot">
        <span className="dp-hint" aria-hidden="true">
          <span className="k">↵</span> pick · <span className="k">esc</span> close
        </span>
        <button type="button" className="dp-today" onClick={() => onPick(todayKey)}>
          today
        </button>
      </div>
    </div>
  )
}
