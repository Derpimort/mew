/* The block detail card — shared by both views (DESIGN_LANGUAGE §3).
   Actions resolve through the store; external (calendar) events get no
   move/hold — not ours to move. An all-day entry (#27) is a label on the day:
   no clock line, no Done (a holiday isn't a mew), nothing that starts, moves
   or holds it — only Remove, when the label is MEW's own. */

import { useState, type CSSProperties } from 'react'
import { useMew } from '../../state/store'
import type { Block } from '../../domain/types'
import { fmtDow, fmtTime } from '../../domain/time'
import { duration, isAllDay } from '../../domain/week'

export function BlockCard({
  block,
  isNow,
  style,
  onClose,
  variant,
  pinned,
  offDay,
}: {
  block: Block
  isNow: boolean
  style?: CSSProperties
  onClose: () => void
  /** 'center' = docked in the dial face; 'dock' = the week view's footer strip.
      Docked cards live in reserved space, so they never cover other blocks. */
  variant?: 'center' | 'dock'
  /** Clicked-and-held selection: hover stops mattering, the × explains why. */
  pinned?: boolean
  /** The dial is showing another day (#23): time-relative actions (Start now,
      Interrupt, Move — which re-places into today/tomorrow) mean nothing there;
      Done, Hold and Remove stay. */
  offDay?: boolean
}) {
  const toggleComplete = useMew((s) => s.toggleComplete)
  const startNow = useMew((s) => s.startNow)
  const interruptBlock = useMew((s) => s.interruptBlock)
  const moveToNextFree = useMew((s) => s.moveToNextFree)
  const toggleProtected = useMew((s) => s.toggleProtected)
  const removeBlock = useMew((s) => s.removeBlock)

  const done = block.status === 'done'
  const allDay = isAllDay(block)
  const life = block.tag !== 'work'
  const act = (fn: () => void) => () => {
    fn()
    onClose()
  }

  /* the remove affordance (#334): a one-line confirm, then delete. On a done
     block this deletes the block AND its mew (undoable) — the same confirm path
     the chat proposal's "remove it" chip runs (store.removeBlock). External
     (calendar) events aren't ours to delete, so they never show it. */
  const [confirming, setConfirming] = useState(false)
  const removeControl = block.external ? null : confirming ? (
    <>
      <button type="button" className="ca pri" onClick={act(() => removeBlock(block.id))}>
        {done ? 'Remove the mew?' : 'Remove?'}
      </button>
      <button type="button" className="ca sec" onClick={() => setConfirming(false)}>
        cancel
      </button>
    </>
  ) : (
    <button
      type="button"
      className="ca sec"
      title={
        done
          ? 'delete this completed block and its mew — undoable'
          : 'delete this block from the week — undoable'
      }
      onClick={() => setConfirming(true)}
    >
      Remove
    </button>
  )

  return (
    <div
      className={'nx-card' + (variant ? ` ${variant}` : '')}
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {pinned && (
        <button type="button" className="cx" aria-label="close" title="deselect" onClick={onClose}>
          ×
        </button>
      )}
      <div className="cbody">
        <div className="ct">{block.title}</div>
        <div className="cm">
          {allDay ? (
            <>
              all day
              {block.endDayKey ? ` · ${fmtDow(block.dayKey)} – ${fmtDow(block.endDayKey)}` : ''}
            </>
          ) : (
            <>
              {fmtTime(block.startMin)} – {fmtTime(block.endMin)} · {duration(block)} min
            </>
          )}
          {block.protected && !allDay ? ' · held' : ''}
          {done ? ' · done' : ''}
          {block.optional ? " · tentative — doesn't hold the time" : ''}
        </div>
        <span className={'ctag' + (life ? ' life' : '')}>
          {block.external
            ? allDay
              ? 'calendar · all day'
              : 'calendar'
            : allDay
              ? 'all day'
              : block.tag === 'work'
                ? 'work'
                : block.tag === 'rest'
                  ? 'rest · earned'
                  : 'life'}
          {block.optional ? ' · optional' : ''}
        </span>
      </div>
      {/* an all-day label holds no clock: its only action is Remove, when it's MEW's own */}
      {allDay && !done && !block.external && <div className="cacts">{removeControl}</div>}
      {!done && !allDay && (
        <div className="cacts">
          {offDay ? (
            <button type="button" className="ca pri" onClick={act(() => toggleComplete(block.id))}>
              Done — a mew
            </button>
          ) : isNow || block.startedAt != null ? (
            <>
              <button
                type="button"
                className="ca pri"
                onClick={act(() => toggleComplete(block.id))}
              >
                Done — a mew
              </button>
              {!block.external && (
                <button
                  type="button"
                  className="ca sec"
                  title="stop here; the remaining minutes roll to the next free slot"
                  onClick={act(() => interruptBlock(block.id))}
                >
                  Interrupt — finish later
                </button>
              )}
            </>
          ) : (
            !block.external && (
              <button type="button" className="ca pri" onClick={act(() => startNow(block.id))}>
                Start now
              </button>
            )
          )}
          {!block.external && (
            <>
              {!offDay && (
                <button
                  type="button"
                  className="ca sec"
                  title="re-place this block in the next free slot"
                  onClick={act(() => moveToNextFree(block.id))}
                >
                  Move
                </button>
              )}
              <button
                type="button"
                className="ca sec"
                title={
                  block.protected
                    ? 'held = protected. Release lets MEW move it when right-sizing, and frees the slot.'
                    : 'Hold protects this block: MEW never moves it, and calendars show you as busy.'
                }
                onClick={act(() => toggleProtected(block.id))}
              >
                {block.protected ? 'Release hold' : 'Hold (protect)'}
              </button>
              {removeControl}
            </>
          )}
        </div>
      )}
      {/* a done block keeps its ✓ but is no longer walled off (#334): the same
          remove control, one-line confirm, deletes the block and its mew. */}
      {done && !block.external && <div className="cacts">{removeControl}</div>}
    </div>
  )
}
