/* The block detail card — shared by both views (DESIGN_LANGUAGE §3).
   Actions resolve through the store; external (calendar) events get no
   move/hold — not ours to move. */

import type { CSSProperties } from 'react'
import { useMew } from '../../state/store'
import type { Block } from '../../domain/types'
import { fmtTime } from '../../domain/time'
import { duration } from '../../domain/week'

export function BlockCard({
  block,
  isNow,
  style,
  onClose,
}: {
  block: Block
  isNow: boolean
  style: CSSProperties
  onClose: () => void
}) {
  const toggleComplete = useMew((s) => s.toggleComplete)
  const startNow = useMew((s) => s.startNow)
  const moveToNextFree = useMew((s) => s.moveToNextFree)
  const toggleProtected = useMew((s) => s.toggleProtected)

  const done = block.status === 'done'
  const life = block.tag !== 'work'
  const act = (fn: () => void) => () => {
    fn()
    onClose()
  }

  return (
    <div className="nx-card" style={style} onClick={(e) => e.stopPropagation()}>
      <div className="ct">{block.title}</div>
      <div className="cm">
        {fmtTime(block.startMin)} – {fmtTime(block.endMin)} · {duration(block)} min
        {block.protected ? ' · held' : ''}
        {done ? ' · done' : ''}
      </div>
      <span className={'ctag' + (life ? ' life' : '')}>
        {block.external ? 'calendar' : block.tag === 'work' ? 'work' : block.tag === 'rest' ? 'rest · earned' : 'life'}
        {block.optional ? ' · optional' : ''}
      </span>
      {block.optional && (
        <div className="cm" style={{ marginTop: 6 }}>
          tentative / shows-as-free — doesn't hold the time
        </div>
      )}
      {!done && (
        <div className="cacts">
          {isNow ? (
            <button type="button" className="ca pri" onClick={act(() => toggleComplete(block.id))}>
              Done — a mew
            </button>
          ) : (
            !block.external && (
              <button type="button" className="ca pri" onClick={act(() => startNow(block.id))}>
                Start now
              </button>
            )
          )}
          {!block.external && (
            <>
              <button
                type="button"
                className="ca sec"
                title="re-place this block in the next free slot"
                onClick={act(() => moveToNextFree(block.id))}
              >
                Move
              </button>
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
            </>
          )}
        </div>
      )}
    </div>
  )
}
