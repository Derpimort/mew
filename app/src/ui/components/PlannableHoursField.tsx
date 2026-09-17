/* The plannable-hours control (#22 slice B) — where auto-placement, find_slot
   and suggest_slots look. Two 24h clock fields in MEW's mono voice (a native
   time input would follow the browser locale into AM/PM). Each is a spinbutton:
   ↑/↓ step 5 minutes, Shift steps an hour, and a screen reader hears its name
   and value. Typing commits on Enter or blur; a step commits at once. A draft
   reaches onCommit only once checkPlannableDraft passes — otherwise it stays on
   screen with one positive hint in a live region, and the stored day keeps
   working. Quiet hours are a different fact: nothing here reads or writes them. */
import { useId, useState } from 'react'
import type { PlannableHours } from '../../domain/types'
import {
  PLANNABLE_LAST_END,
  checkPlannableDraft,
  clockOf,
  parseClock,
  stepClock,
} from '../../domain/plannable'

type Bound = 'start' | 'end'
interface Draft {
  start: string
  end: string
}
export interface PlannableHint {
  field: Bound
  text: string
}

const LABEL: Record<Bound, string> = {
  start: 'Plannable day starts',
  end: 'Plannable day ends',
}

/** The stateless skin: two spinbutton fields and the hint's live region. */
export function PlannableHoursView({
  start,
  end,
  hint,
  onType,
  onSettle,
  onStep,
}: {
  start: string
  end: string
  hint: PlannableHint | null
  onType: (field: Bound, value: string) => void
  onSettle: () => void
  onStep: (field: Bound, deltaMin: number) => void
}) {
  const hintId = `${useId()}-plannable-hint`
  const field = (which: Bound, value: string) => {
    const min = parseClock(value)
    const flagged = hint?.field === which
    return (
      <span className={`keyfield plannable-field${flagged ? ' plannable-flag' : ''}`}>
        <input
          role="spinbutton"
          inputMode="numeric"
          maxLength={5}
          value={value}
          aria-label={LABEL[which]}
          aria-valuemin={0}
          aria-valuemax={PLANNABLE_LAST_END}
          aria-valuenow={min ?? undefined}
          aria-valuetext={min != null ? value : undefined}
          aria-invalid={flagged || undefined}
          aria-describedby={flagged ? hintId : undefined}
          onChange={(e) => onType(which, e.target.value)}
          onBlur={onSettle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur() // settles through onBlur, once
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              onStep(which, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 60 : 5))
            }
          }}
        />
      </span>
    )
  }
  return (
    <span className="plannable" role="group" aria-label="Plannable hours">
      {field('start', start)}
      <span className="plannable-sep" aria-hidden="true">
        –
      </span>
      {field('end', end)}
      <span id={hintId} className="plannable-hint" role="status">
        {hint?.text ?? ''}
      </span>
    </span>
  )
}

/** The stateful control: holds the draft being typed (or a draft that didn't
    pass), commits a passing one that differs from what's stored. */
export function PlannableHoursField({
  hours,
  onCommit,
}: {
  hours: PlannableHours
  onCommit: (hours: PlannableHours) => void
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [hint, setHint] = useState<PlannableHint | null>(null)
  const shown = draft ?? { start: clockOf(hours.startMin), end: clockOf(hours.endMin) }

  const attempt = (next: Draft) => {
    const check = checkPlannableDraft(next.start, next.end)
    if (!check.ok) {
      setDraft(next)
      setHint({ field: check.field, text: check.hint })
      return
    }
    setDraft(null) // the stored hours drive the fields again
    setHint(null)
    if (check.hours.startMin !== hours.startMin || check.hours.endMin !== hours.endMin)
      onCommit(check.hours)
  }

  return (
    <PlannableHoursView
      start={shown.start}
      end={shown.end}
      hint={hint}
      onType={(field, value) => setDraft({ ...shown, [field]: value })}
      onSettle={() => attempt(shown)}
      onStep={(field, delta) =>
        attempt({
          ...shown,
          [field]: stepClock(
            shown[field],
            delta,
            field === 'start' ? hours.startMin : hours.endMin
          ),
        })
      }
    />
  )
}
