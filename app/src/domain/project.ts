/* Calendar projection — what each connected calendar is allowed to see,
   per the routing matrix (PRD §4). MEW alone sees everything; everyone
   else gets details, an opaque "Busy", or nothing. */

import type { Block, RoutingMatrix, Visibility, VisibleTag } from './types'

export interface ProjectedEvent {
  blockId: string
  dayKey: string
  startMin: number
  endMin: number
  title: string // real title or "Busy"
  visibility: Exclude<Visibility, 'hidden'>
}

function tagFor(block: Block): VisibleTag {
  return block.tag === 'rest' ? 'private' : block.tag // rest projects under the private column
}

export function project(
  blocks: Block[],
  matrix: RoutingMatrix,
  calendarId: string,
): ProjectedEvent[] {
  const row = matrix[calendarId]
  if (!row) return []
  const out: ProjectedEvent[] = []
  for (const b of blocks) {
    if (b.status === 'rolled') continue
    const vis = row[tagFor(b)]
    if (vis === 'hidden' || vis == null) continue
    out.push({
      blockId: b.id,
      dayKey: b.dayKey,
      startMin: b.startMin,
      endMin: b.endMin,
      title: vis === 'details' ? b.title : 'Busy',
      visibility: vis,
    })
  }
  return out.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.startMin - b.startMin)
}

/** PRD §4 default for a newly connected calendar: everything busy-only. */
export const NEW_CALENDAR_DEFAULTS: Record<VisibleTag, Visibility> = {
  work: 'busy',
  private: 'busy',
  health: 'busy',
}
