/* The dial's inverse (#24 slice 1) — pointer → angle → minutes, and the drop a
   dial drag will commit — pinned as pure geometry, in MINUTES (never float hours
   compared with ===): every minute of the day round-trips through clockDeg and
   through rPolar's points, both halves; the edges (0°/360°, the noon boundary);
   the half lock (crossing 12 o'clock wraps within the half); and the shared
   snap — a dial drop lands exactly where a Week drop of the same minute lands.

   dialGeometry is imported FIRST on purpose: it now reaches dragGeometry (for
   Week's snapMin), which reaches orbitGeometry, which reaches back into
   dialGeometry. The cycle is inert (every use on it runs inside a function);
   this file enters it from dialGeometry, orbitGeometry.test and
   dragGeometry.test from the other two. */

import { describe, expect, it } from 'vitest'
import {
  clockDeg,
  degFromPoint,
  dialDropTarget,
  dialGrab,
  halfOf,
  minFromDeg,
  normDeg,
  rPolar,
} from '../dialGeometry'
import { type ColRect, SNAP_MIN, dropTarget, isMoved, snapMin, startDrag } from '../dragGeometry'
import { OG } from '../orbitGeometry'
import type { Block } from '../../../domain/types'

const DAY = '2026-09-16'

function block(over: Partial<Block> = {}): Block {
  return {
    id: 'b1',
    title: 'Deep work',
    tag: 'work',
    dayKey: DAY,
    startMin: 540,
    endMin: 690,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/** the on-face point of a minute of the day, on a ring (the outer lane by default) */
const pointAt = (min: number, r: number = OG.ro) => rPolar(OG.cx, OG.cy, r, clockDeg(min / 60))

/** circular distance between two angles, in degrees */
const circ = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

describe('minFromDeg — an angle names a minute within a half', () => {
  it('every minute of the day round-trips through clockDeg, in its own half', () => {
    const misses: number[] = []
    for (let m = 0; m < 1440; m++) {
      if (minFromDeg(clockDeg(m / 60), halfOf(m)) !== m) misses.push(m)
    }
    expect(misses).toEqual([])
  })

  it('one angle names both halves, exactly 720 minutes apart', () => {
    const misses: number[] = []
    for (let m = 0; m < 720; m++) {
      const deg = clockDeg(m / 60)
      if (minFromDeg(deg, 'am') !== m || minFromDeg(deg, 'pm') !== m + 720) misses.push(m)
      // the afternoon twin rides the same angle (compared as a minute, not a float)
      if (minFromDeg(clockDeg((m + 720) / 60), 'am') !== m) misses.push(-m)
    }
    expect(misses).toEqual([])
  })

  it('0° and 360° are the top of the SAME half; a hair shy of the top rounds onto it', () => {
    for (const deg of [0, 360, 720, -360]) {
      expect(minFromDeg(deg, 'am')).toBe(0)
      expect(minFromDeg(deg, 'pm')).toBe(720)
    }
    expect(minFromDeg(359.9, 'am')).toBe(0) // never 720 — the morning stays the morning
    expect(minFromDeg(359.9, 'pm')).toBe(720) // never 1440
    expect(minFromDeg(359.5, 'am')).toBe(719) // 11:59, the last minute of the half
    expect(minFromDeg(359.5, 'pm')).toBe(1439) // 23:59
  })

  it('the quarter hours, negative angles, and rounding to the nearest minute', () => {
    expect([90, 180, 270].map((d) => minFromDeg(d, 'am'))).toEqual([180, 360, 540])
    expect([90, 180, 270].map((d) => minFromDeg(d, 'pm'))).toEqual([900, 1080, 1260])
    expect(minFromDeg(-90, 'pm')).toBe(1260) // 21:00
    expect(minFromDeg(0.24, 'am')).toBe(0) // a minute is half a degree
    expect(minFromDeg(0.26, 'am')).toBe(1)
    expect(minFromDeg(45.2, 'am')).toBe(90)
    expect(minFromDeg(45.3, 'am')).toBe(91)
  })

  it('the half boundary is noon, and minutes wrap by the day', () => {
    expect([0, 719, 720, 1439, 1440, -1].map(halfOf)).toEqual(['am', 'am', 'pm', 'pm', 'am', 'pm'])
    expect([-30, 725, 360, 0].map(normDeg)).toEqual([330, 5, 0, 0])
  })
})

describe('degFromPoint — the exact inverse of rPolar', () => {
  it('12, 3, 6 and 9 o’clock', () => {
    const { cx, cy } = OG
    const r = OG.ro
    expect(circ(degFromPoint(cx, cy, cx, cy - r)!, 0)).toBeLessThan(1e-9)
    expect(circ(degFromPoint(cx, cy, cx + r, cy)!, 90)).toBeLessThan(1e-9)
    expect(circ(degFromPoint(cx, cy, cx, cy + r)!, 180)).toBeLessThan(1e-9)
    expect(circ(degFromPoint(cx, cy, cx - r, cy)!, 270)).toBeLessThan(1e-9)
  })

  it('undoes rPolar at every quarter degree, on every ring, and stays on [0, 360)', () => {
    let worst = 0
    let outOfRange = 0
    for (const r of [1, OG.disk, OG.ri, OG.ro, OG.pm]) {
      for (let deg = -720; deg <= 720; deg += 0.25) {
        const [x, y] = rPolar(OG.cx, OG.cy, r, deg)
        const back = degFromPoint(OG.cx, OG.cy, x, y)!
        worst = Math.max(worst, circ(back, normDeg(deg)))
        if (!(back >= 0 && back < 360)) outOfRange++
      }
    }
    expect(worst).toBeLessThan(1e-9)
    expect(outOfRange).toBe(0)
  })

  it('the centre has no angle', () => {
    expect(degFromPoint(OG.cx, OG.cy, OG.cx, OG.cy)).toBeNull()
  })

  it('pointer → angle → minute: all 1440 minutes, in both halves, on any ring', () => {
    const misses: number[] = []
    for (let m = 0; m < 1440; m++) {
      for (const r of [OG.ri, OG.pm]) {
        const [x, y] = pointAt(m, r)
        if (minFromDeg(degFromPoint(OG.cx, OG.cy, x, y)!, halfOf(m)) !== m) misses.push(m)
      }
    }
    expect(misses).toEqual([])
  })
})

describe('dialGrab — where along its arc a press landed', () => {
  it('measures forward from the start, within the block’s half', () => {
    expect(dialGrab(540, clockDeg(9))).toEqual({ half: 'am', offsetMin: 0 })
    expect(dialGrab(540, clockDeg(10))).toEqual({ half: 'am', offsetMin: 60 })
    expect(dialGrab(1380, clockDeg(23.5))).toEqual({ half: 'pm', offsetMin: 30 })
  })

  it('a press past 12 o’clock on a block crossing the top still counts from its start', () => {
    // 11:30–12:30 pressed at 12:15 → 45 minutes in, not −675
    expect(dialGrab(690, clockDeg(12.25))).toEqual({ half: 'am', offsetMin: 45 })
  })
})

describe('dialDropTarget — the drop a dial drag commits', () => {
  const drop = (b: Block, pressMin: number, pointerMin: number, r: number = OG.ro) => {
    const [x, y] = pointAt(pointerMin, r)
    return dialDropTarget(
      startDrag(b, 0),
      dialGrab(b.startMin, clockDeg(pressMin / 60)),
      OG.cx,
      OG.cy,
      x,
      y
    )
  }

  it('the start follows the pointer less the grab, on the dial’s own day', () => {
    // 9:00–11:30 grabbed at 10:00, pointer to 11:00 → starts 10:00
    expect(drop(block(), 600, 660)).toEqual({ dayKey: DAY, startMin: 600 })
  })

  it('radius never matters — the drag is tangential', () => {
    const at = [OG.disk + 4, OG.ri, OG.ro, OG.pm + 30].map(
      (r) => drop(block(), 600, 700, r).startMin
    )
    expect(new Set(at).size).toBe(1)
    expect(at[0]).toBe(640)
  })

  it('crossing 12 o’clock wraps within the half — never twelve hours', () => {
    // a morning block dragged clockwise past the top lands early in the MORNING
    expect(drop(block({ startMin: 690, endMin: 720 }), 690, 10).startMin).toBe(10)
    // an evening block dragged past the top lands at 12:20, never 00:20 tomorrow
    expect(drop(block({ startMin: 1380, endMin: 1410 }), 1380, 740).startMin).toBe(740)
    // backwards over the top: grabbed 30 minutes in, pointer to 0:15 → 11:45 the same morning
    expect(drop(block({ startMin: 540, endMin: 600 }), 570, 15).startMin).toBe(705)
  })

  it('a pointer on the centre keeps the block home, unsnapped', () => {
    const b = block({ startMin: 543, endMin: 603 })
    const grab = dialGrab(543, clockDeg(9.05))
    expect(dialDropTarget(startDrag(b, 0), grab, OG.cx, OG.cy, OG.cx, OG.cy)).toEqual({
      dayKey: DAY,
      startMin: 543,
    })
  })

  it('releasing where it was pressed is no move, for every on-grid start that fits the day', () => {
    const moved: number[] = []
    for (let start = 0; start + 30 <= 1440; start += SNAP_MIN) {
      const b = block({ startMin: start, endMin: start + 30 })
      const press = start + 12 // grabbed somewhere inside the arc
      const to = drop(b, press, press)
      // Week's own click-vs-move rule decides
      if (isMoved({ ...startDrag(b, 0), toDayKey: to.dayKey, toStartMin: to.startMin }))
        moved.push(start)
    }
    expect(moved).toEqual([])
  })

  it('ONE snap rule: a dial drop lands exactly where a Week drop of the same minute lands', () => {
    const H = 560
    const cols: ColRect[] = [{ dayKey: DAY, left: 0, right: 100 }]
    const diverged: string[] = []
    for (const dur of [5, 30, 90, 240]) {
      for (let m = 0; m < 1440; m++) {
        const b = block({ startMin: 0, endMin: dur })
        const [x, y] = pointAt(m)
        const dial = dialDropTarget(
          startDrag(b, 0),
          { half: halfOf(m), offsetMin: 0 },
          OG.cx,
          OG.cy,
          x,
          y
        )
        const week = dropTarget(startDrag(b, 0), 50, 0, (m / 1440) * H, H, cols)
        if (dial.startMin !== week.startMin || dial.startMin !== snapMin(m, dur))
          diverged.push(`${dur}@${m}: dial ${dial.startMin} week ${week.startMin}`)
      }
    }
    expect(diverged).toEqual([])
  })

  it('the shared rule at its edges: 11:58 lands on noon, and a late block keeps its length before midnight', () => {
    expect(drop(block({ startMin: 600, endMin: 630 }), 600, 718).startMin).toBe(720)
    expect(drop(block({ startMin: 1260, endMin: 1350 }), 1260, 1430).startMin).toBe(1350)
    expect(drop(block({ startMin: 60, endMin: 90 }), 60, 2).startMin).toBe(0)
  })
})
