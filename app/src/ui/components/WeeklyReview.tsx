/* "your week in review" (#346) — the calm end-of-week ritual. A pure skin over
   the domain presenter (domain/review.weeklyReview): celebrate the week's mews,
   then offer the owner's OWN flexible unfinished blocks as a multi-select to roll
   forward. Human-in-the-loop by construction: the surface only offers; nothing
   moves until the owner picks and taps "roll". Positive voice throughout —
   unfinished work is "carried", never a failure or a broken streak. Tokens only;
   the skin reads no store, so it renders headless in tests. The store wiring is
   WeeklyReviewFromStore below (the MemoryConsoleFromStore pattern). */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useMew, activePrefsFrom } from '../../state/store'
import { weeklyReview, type WeeklyReview as WeeklyReviewData } from '../../domain/review'
import type { Block, Tag } from '../../domain/types'
import { addDaysKey, fmtDowLong, fmtShortDate, fmtTime, weekKey } from '../../domain/time'
import { Button } from '../primitives'

const TAG_LABEL: Record<Tag, string> = {
  work: 'work',
  private: 'life',
  health: 'health',
  rest: 'rest',
}

const LABEL: CSSProperties = {
  fontSize: 10,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '.12em',
  marginTop: 16,
  marginBottom: 6,
}

/** "Tuesday 9:00" — the block's home this week, spoken plainly. */
function whenLabel(b: Block): string {
  return `${fmtDowLong(b.dayKey)} ${fmtTime(b.startMin)}`
}

export interface WeeklyReviewProps {
  data: WeeklyReviewData
  /** the Monday key of the week a roll targets — for the "next week" label. */
  targetWeekKey: string
  /** Roll the selected carried blocks forward; the owner's explicit act. */
  onRoll: (blockIds: string[]) => void
  onDismiss: () => void
}

export function WeeklyReview({ data, targetWeekKey, onRoll, onDismiss }: WeeklyReviewProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const dialogRef = useRef<HTMLDivElement>(null)

  /* focus the surface on open (a11y: the dialog takes focus so Esc + Tab live
     inside it), and restore nothing special on close — the offer chip/command
     that opened it already owns the return. */
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const roll = () => {
    if (!selected.size) return
    onRoll([...selected]) // the owner's pick, verbatim — the store re-checks the gate
    onDismiss()
  }

  const nextWeekLabel = `next week (of ${fmtShortDate(targetWeekKey)})`
  const titleId = 'wkr-title'

  return (
    <div className="wkr-scrim" onMouseDown={(e) => e.target === e.currentTarget && onDismiss()}>
      <div
        ref={dialogRef}
        className="wkr"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onDismiss()
          }
        }}
      >
        <h2 id={titleId} className="wkr-h">
          your week in review
        </h2>
        <div className="wkr-sub">
          celebrate what you finished, carry forward what you'd like — nothing moves unless you pick
          it.
        </div>

        {data.empty ? (
          <div className="wkr-empty">a calm week — nothing to review yet. rest is earned.</div>
        ) : (
          <>
            <div className="mono" style={LABEL}>
              mews to celebrate
            </div>
            {data.mews.length ? (
              <ul className="wkr-list" aria-label="mews this week">
                {data.mews.map((b) => (
                  <li key={b.id} className="wkr-mew">
                    <span className="wkr-star" aria-hidden>
                      ★
                    </span>
                    <span className="wkr-mew-title">{b.title.split('—')[0].trim()}</span>
                    <span className="wkr-when">{whenLabel(b)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="wkr-none">a fresh week — carry a few things forward and begin.</div>
            )}

            {Object.keys(data.byTag).length > 0 && (
              <div className="wkr-tally" aria-label="the week by tag">
                {(Object.entries(data.byTag) as [Tag, { mews: number; carried: number }][]).map(
                  ([tag, t]) => (
                    <span key={tag} className="wkr-chip" data-tag={tag}>
                      <b>{TAG_LABEL[tag]}</b> {t.mews} mew{t.mews === 1 ? '' : 's'}
                      {t.carried > 0 ? ` · ${t.carried} to carry` : ''}
                    </span>
                  )
                )}
              </div>
            )}

            {data.carried.length > 0 && (
              <>
                <div className="mono" style={LABEL}>
                  carry into {nextWeekLabel}?
                </div>
                <ul className="wkr-list" aria-label="blocks you can carry forward">
                  {data.carried.map((b) => {
                    const on = selected.has(b.id)
                    return (
                      <li key={b.id} className={'wkr-carry' + (on ? ' on' : '')}>
                        <label className="wkr-carry-row">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(b.id)}
                            aria-label={`carry ${b.title.split('—')[0].trim()} (${whenLabel(b)}) into next week`}
                          />
                          <span className="wkr-carry-title">{b.title.split('—')[0].trim()}</span>
                          <span className="wkr-when">{whenLabel(b)}</span>
                          <span className="wkr-tagdot" data-tag={b.tag} aria-hidden />
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}

            <div className="wkr-acts">
              {data.carried.length > 0 && (
                <Button
                  variant="primary"
                  className="wkr-roll"
                  disabled={selected.size === 0}
                  onClick={roll}
                >
                  {selected.size > 0
                    ? `roll ${selected.size} to next week`
                    : 'roll selected to next week'}
                </Button>
              )}
              <Button variant="ghost" onClick={onDismiss}>
                {data.carried.length > 0 ? 'leave them' : 'close'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* store → presenter wiring (#346), the MemoryConsoleFromStore pattern: read the
   LOCAL week + memory into the pure presenter (brain-off prefs, like the memory
   console), and pass the read-only roll/dismiss actions down. The review reads
   live, so a roll (which re-places through the executor) re-renders the surface.
   Mounted once in MainPage; renders nothing until openWeeklyReview flips it on. */
export function WeeklyReviewFromStore() {
  const open = useMew((s) => s.weeklyReviewOpen)
  const blocks = useMew((s) => s.blocks)
  const memory = useMew((s) => s.memory)
  const nowMs = useMew((s) => s.nowMs)
  const rollForward = useMew((s) => s.rollForward)
  const close = useMew((s) => s.closeWeeklyReview)

  const wk = weekKey(new Date(nowMs))
  const targetWeekKey = addDaysKey(wk, 7)
  const data = useMemo(
    () => weeklyReview(blocks, memory, wk, activePrefsFrom(memory, null)),
    [blocks, memory, wk]
  )

  if (!open) return null
  return (
    <WeeklyReview
      data={data}
      targetWeekKey={targetWeekKey}
      onRoll={(ids) => rollForward(ids, targetWeekKey)}
      onDismiss={close}
    />
  )
}
