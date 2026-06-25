/* Global search results pane (#170) — the read-only listing the command
   palette shows in 'search' mode. Pure presentation over domain/search hits:
   blocks, then captures, then chat, each as a labelled section. Selection and
   keyboard navigation are owned by the palette (it passes the flat selection
   index + hover/pick handlers); this component only draws the rows.

   Voice: a no-match state is an invitation, never an error. */

import { fmtDowLong } from '../../domain/time'
import type { SearchHit, SearchKind } from '../../domain/search'

export interface SearchGroups {
  block: SearchHit[]
  capture: SearchHit[]
  chat: SearchHit[]
}

export function GlobalSearch({
  groups,
  flat,
  sel,
  onPick,
  onHover,
}: {
  groups: SearchGroups
  /** the flattened hit order the palette navigates with ↑/↓ */
  flat: SearchHit[]
  /** index into `flat` of the highlighted row */
  sel: number
  onPick: (h: SearchHit) => void
  onHover: (i: number) => void
}) {
  if (!flat.length) {
    return (
      <div className="cmdk-empty">
        Nothing here by that name yet — every block, capture, and message you have is fair game.
      </div>
    )
  }
  const sections: { key: SearchKind; label: string }[] = [
    { key: 'block', label: 'blocks' },
    { key: 'capture', label: 'captures' },
    { key: 'chat', label: 'chat' },
  ]
  /* the flat index is the row's position in [blocks, captures, chat]; carry a
     running offset so each rendered row's index lines up with the palette's
     single selection cursor. */
  let offset = 0
  return (
    <>
      {sections.map(({ key, label }) => {
        const hits = groups[key]
        if (!hits.length) return null
        const base = offset
        offset += hits.length
        return (
          <div key={key} className="cmdk-group">
            <div className="cmdk-group-h">{label}</div>
            {hits.map((h, j) => {
              const i = base + j
              return (
                <button
                  key={h.id}
                  type="button"
                  role="option"
                  aria-selected={i === sel}
                  className={'cmdk-row' + (i === sel ? ' sel' : '')}
                  onMouseEnter={() => onHover(i)}
                  onClick={() => onPick(h)}
                >
                  <span className="cmdk-row-label">{h.title}</span>
                  <span className="cmdk-row-meta">
                    {h.dayKey ? `${fmtDowLong(h.dayKey)} · ` : ''}
                    {h.detail}
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </>
  )
}
