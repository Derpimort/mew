import { describe, expect, it } from 'vitest'
import type { Block } from '../../../domain/types'
import {
  type ColRect,
  type DragState,
  SNAP_MIN,
  dayFromX,
  dropTarget,
  ghostConflicts,
  isMoved,
  minFromY,
  snapMin,
  startDrag,
} from '../dragGeometry'

const H = 560
const DAY = 1440

function block(over: Partial<Block> = {}): Block {
  return {
    id: 'b1',
    title: 'Deep work',
    tag: 'work',
    dayKey: '2026-06-08',
    startMin: 600, // 10:00
    endMin: 720, // 12:00
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

const cols: ColRect[] = [
  { dayKey: 'mon', left: 0, right: 100 },
  { dayKey: 'tue', left: 100, right: 200 },
  { dayKey: 'wed', left: 200, right: 430 }, // selected day — 2.3× wide
  { dayKey: 'thu', left: 430, right: 530 },
]

describe('snapMin — 5-minute grid, clamped into a placeable day', () => {
  it('rounds to the nearest 5 minutes', () => {
    expect(snapMin(602, 60)).toBe(600)
    expect(snapMin(608, 60)).toBe(610)
    expect(SNAP_MIN).toBe(5)
  })
  it('never lands before midnight', () => {
    expect(snapMin(-30, 60)).toBe(0)
  })
  it("reserves the block's own length so its end never runs past midnight", () => {
    // a 90-min block can start no later than 1440 − 90 = 1350
    expect(snapMin(DAY, 90)).toBe(DAY - 90)
    expect(snapMin(1430, 90)).toBe(1350)
  })
})

describe('minFromY — inverse of nxwY (y = min/1440 · H)', () => {
  it('top of grid is midnight, bottom is end-of-day', () => {
    expect(minFromY(0, H)).toBe(0)
    expect(minFromY(H, H)).toBe(DAY)
  })
  it('half-way down is noon', () => {
    expect(minFromY(H / 2, H)).toBe(720)
  })
})

describe('dayFromX — hit-test variable-width columns', () => {
  it('finds the column whose box contains the x', () => {
    expect(dayFromX(50, cols)).toBe('mon')
    expect(dayFromX(150, cols)).toBe('tue')
    expect(dayFromX(300, cols)).toBe('wed') // inside the wide selected column
  })
  it('a left edge is inclusive, a right edge belongs to the next column', () => {
    expect(dayFromX(100, cols)).toBe('tue') // boundary → next col
    expect(dayFromX(200, cols)).toBe('wed')
  })
  it('off the left/right of the grid clamps to the nearest edge column', () => {
    expect(dayFromX(-40, cols)).toBe('mon')
    expect(dayFromX(900, cols)).toBe('thu')
  })
  it('no columns → null', () => {
    expect(dayFromX(50, [])).toBeNull()
  })
})

describe('startDrag — a fresh drag sits exactly where the block lives', () => {
  it('captures the block and starts the candidate drop at its current slot', () => {
    const d = startDrag(block(), 12)
    expect(d).toMatchObject({
      id: 'b1',
      fromDayKey: '2026-06-08',
      fromStartMin: 600,
      durationMin: 120,
      grabOffsetPx: 12,
      toDayKey: '2026-06-08',
      toStartMin: 600,
    })
  })
  it('an immediate release is a no-op move (isMoved=false)', () => {
    expect(isMoved(startDrag(block(), 0))).toBe(false)
  })
})

describe('dropTarget — pointer → snapped {dayKey, startMin}', () => {
  const drag = startDrag(block(), 0) // grabbed at the very top edge

  it('drops onto the day the cursor is over, at the snapped minute', () => {
    // gridTop=0; clientY at noon (H/2) → 720, grabbed at top so no offset
    const t = dropTarget(drag, 300 /*wed*/, 0, H / 2, H, cols)
    expect(t.dayKey).toBe('wed')
    expect(t.startMin).toBe(720)
  })

  it('honors where inside the block the user grabbed (no head-snap)', () => {
    const grabbed = startDrag(block(), 40) // grabbed 40px below the block's top
    // cursor 40px below noon should keep the block TOP at noon
    const t = dropTarget(grabbed, 50 /*mon*/, 0, H / 2 + 40, H, cols)
    expect(t.startMin).toBe(720)
    expect(t.dayKey).toBe('mon')
  })

  it('off-grid with no columns falls back to the origin day', () => {
    const t = dropTarget(drag, 50, 0, H / 2, H, [])
    expect(t.dayKey).toBe(drag.fromDayKey)
  })
})

describe('ghostConflicts — live overlap set at the candidate drop', () => {
  const day = 'tue'
  const meeting = block({ id: 'm', title: 'Meeting', dayKey: day, startMin: 660, endMin: 720 }) // 11:00–12:00
  const open: Block[] = [block({ id: 'b1', dayKey: day, startMin: 540, endMin: 600 }), meeting]

  const transparent = (b: Block): boolean => !!b.optional

  function dragInto(startMin: number, dur = 60, over: Partial<DragState> = {}): DragState {
    return {
      ...startDrag(block({ id: 'b1' }), 0),
      toDayKey: day,
      toStartMin: startMin,
      durationMin: dur,
      ...over,
    }
  }

  it('flags a drop that overlaps a time-holding block', () => {
    const clash = ghostConflicts(open, dragInto(690 /*11:30*/), transparent)
    expect(clash.map((b) => b.id)).toEqual(['m'])
  })
  it('a clear drop has no conflicts', () => {
    expect(ghostConflicts(open, dragInto(780 /*13:00*/), transparent)).toHaveLength(0)
  })
  it('never reports the dragged block against itself', () => {
    // place the drag right where its own original sits → must not self-conflict
    const clash = ghostConflicts(open, dragInto(540, 60), transparent)
    expect(clash.map((b) => b.id)).not.toContain('b1')
  })
  it('a transparent (optional, non-fixed) block does not block the drop', () => {
    const withOptional = [
      ...open,
      block({ id: 'opt', dayKey: day, startMin: 690, endMin: 750, optional: true }),
    ]
    const clash = ghostConflicts(withOptional, dragInto(700, 30), transparent)
    expect(clash.map((b) => b.id)).not.toContain('opt')
  })
  it('a done block is never a conflict (only open blocks hold the slot)', () => {
    const withDone = [
      ...open,
      block({ id: 'done', dayKey: day, startMin: 690, endMin: 750, status: 'done' }),
    ]
    const clash = ghostConflicts(withDone, dragInto(700, 30), transparent)
    expect(clash.map((b) => b.id)).not.toContain('done')
  })
  it('only the target day counts — a same-time block on another day is clear', () => {
    const otherDay = [block({ id: 'x', dayKey: 'mon', startMin: 690, endMin: 750 })]
    expect(ghostConflicts(otherDay, dragInto(700, 30), transparent)).toHaveLength(0)
  })
})
