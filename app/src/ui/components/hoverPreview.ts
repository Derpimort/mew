/* Pure placement for the week-view hover preview. A floating card sits BESIDE
   the hovered block, on whichever side of it has more free horizontal room
   within the stage — so the card never has to cover the block it describes.
   Numbers in, coords out: no DOM, fully unit-testable (mirrors lanes.ts). */

export type Side = 'left' | 'right'

/** A rectangle in the stage's own coordinate space (relative to wrapRef). */
export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface Placement {
  x: number
  y: number
  side: Side
}

/** Gap between the block edge and the card, so the two never touch/overlap. */
export const PREVIEW_GAP = 10
/** Keep the card off the stage's own edges by this much when clamping. */
const EDGE_PAD = 6

/**
 * Place a `size`-sized card beside `anchor`, inside `bounds`.
 * - Side: the block splits the stage into a left gap (anchor.left) and a right
 *   gap (bounds.width − anchor.right). The card opens toward the larger gap, so
 *   a right-edge block opens left and a left-edge block opens right.
 * - X: card sits `PREVIEW_GAP` outside the chosen edge; if it would spill past
 *   the stage it's pulled back to the padded edge (a card wider than its gap
 *   still stays in view rather than disappearing off-stage).
 * - Y: top-aligned to the block, then clamped so a tall block still yields a
 *   fully visible card (top never negative, bottom never past the stage).
 */
export function sidePlacement(anchor: Rect, size: { width: number; height: number }, bounds: { width: number; height: number }): Placement {
  const anchorRight = anchor.left + anchor.width
  const leftRoom = anchor.left
  const rightRoom = bounds.width - anchorRight
  const side: Side = rightRoom >= leftRoom ? 'right' : 'left'

  let x = side === 'right' ? anchorRight + PREVIEW_GAP : anchor.left - PREVIEW_GAP - size.width
  // never spill off-stage: clamp into [EDGE_PAD, bounds.width − size.width − EDGE_PAD]
  const maxX = Math.max(EDGE_PAD, bounds.width - size.width - EDGE_PAD)
  x = Math.min(Math.max(x, EDGE_PAD), maxX)

  // top-align to the block, then keep the whole card on-stage
  const maxY = Math.max(EDGE_PAD, bounds.height - size.height - EDGE_PAD)
  const y = Math.min(Math.max(anchor.top, EDGE_PAD), maxY)

  return { x, y, side }
}
