/* The dial's keyboard + screen-reader contract is pure geometry: a key maps to a
   dial intent, an arc has a spoken name, the visible set has a deterministic focus
   order, and an arrow steps along one of the two clock axes. Testing those here
   (no DOM, the way the rest of the dial geometry is tested) pins the WCAG 2.2
   §2.1.1 / §1.1.1 / §4.1.2 behaviour the component only wires up. */

import { describe, expect, it } from 'vitest'
import type { Block } from '../../../domain/types'
import { dialKeyAction } from '../dialGeometry'
import { arcAriaLabel, dialFocusOrder, radiiFor, rovingFocusId, stepDialFocus } from '../orbitGeometry'

const D = '2026-06-09'
function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'X',
    tag: 'work',
    dayKey: D,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

describe('dialKeyAction — keys map to dial intents (APG Application pattern)', () => {
  it('arrows split into the two clock axes: ←/→ time, ↑/↓ lane', () => {
    expect(dialKeyAction('ArrowRight')).toEqual({ kind: 'step', axis: 'time', dir: 1 })
    expect(dialKeyAction('ArrowLeft')).toEqual({ kind: 'step', axis: 'time', dir: -1 })
    expect(dialKeyAction('ArrowUp')).toEqual({ kind: 'step', axis: 'lane', dir: -1 })
    expect(dialKeyAction('ArrowDown')).toEqual({ kind: 'step', axis: 'lane', dir: 1 })
  })

  it('Enter promotes, Space opens the card, Escape demotes (incl. legacy key names)', () => {
    expect(dialKeyAction('Enter')).toEqual({ kind: 'promote' })
    expect(dialKeyAction(' ')).toEqual({ kind: 'open' })
    expect(dialKeyAction('Spacebar')).toEqual({ kind: 'open' })
    expect(dialKeyAction('Escape')).toEqual({ kind: 'demote' })
    expect(dialKeyAction('Esc')).toEqual({ kind: 'demote' })
  })

  it('Tab is NOT claimed — native traversal over the roving tab stop avoids a keyboard trap (§2.1.2)', () => {
    expect(dialKeyAction('Tab')).toBeNull()
  })

  it('keys the dial does not claim return null so the event keeps bubbling', () => {
    expect(dialKeyAction('a')).toBeNull()
    expect(dialKeyAction('PageDown')).toBeNull()
    expect(dialKeyAction('Home')).toBeNull()
  })
})

describe('arcAriaLabel — a spoken name for each arc (§1.1.1, §4.1.2)', () => {
  it('reads title · start–end · tag', () => {
    expect(arcAriaLabel(mk({ title: 'Deep work', startMin: 9 * 60, endMin: 11 * 60, tag: 'work' }))).toBe('Deep work · 9:00–11:00 · work')
  })

  it('takes the title before a "— note" tail, matching the visible label', () => {
    expect(arcAriaLabel(mk({ title: 'Standup — with the pod', startMin: 10 * 60, endMin: 10 * 60 + 30 }))).toContain('Standup · ')
    expect(arcAriaLabel(mk({ title: 'Standup — with the pod' }))).not.toContain('with the pod')
  })

  it('a deadline-only background block reads its due time, not a span', () => {
    const dueBg = mk({ title: 'Ship', attention: 'background', due: 17 * 60, startMin: 9 * 60, endMin: 10 * 60 })
    expect(arcAriaLabel(dueBg)).toBe('Ship · due 17:00 · work')
  })

  it('a cross-midnight block names its real end + a positive carry phrase', () => {
    const overnight = mk({ title: 'Render', startMin: 22 * 60, endMin: 6 * 60, tag: 'work' }) // folded
    expect(arcAriaLabel(overnight)).toBe('Render · 22:00–6:00, continues tomorrow · work')
    const tail = mk({ title: 'Render', startMin: -60, endMin: 2 * 60, tag: 'work' }) // started yesterday
    expect(arcAriaLabel(tail)).toContain(', from yesterday')
  })

  it('external (calendar) blocks say so; tentative is named; done is announced — never a blame word', () => {
    expect(arcAriaLabel(mk({ title: 'Sync', external: { calId: 'c', eventId: 'e' } }))).toContain('· calendar')
    expect(arcAriaLabel(mk({ title: 'Maybe lunch', optional: true, tag: 'private' }))).toContain('· life, tentative')
    const done = arcAriaLabel(mk({ title: 'Inbox', status: 'done', startMin: 8 * 60, endMin: 8 * 60 + 30 }))
    expect(done).toBe('Inbox · 8:00–8:30 · work, done')
    expect(done).not.toMatch(/fail|overdue|missed|late/i)
  })
})

describe('dialFocusOrder — Tab walks the face the way the eye reads it', () => {
  it('orders by start time, ties broken by the DRAWN end', () => {
    const a = mk({ id: 'a', startMin: 8 * 60, endMin: 9 * 60 })
    const b = mk({ id: 'b', startMin: 10 * 60, endMin: 11 * 60 })
    const c = mk({ id: 'c', startMin: 9 * 60, endMin: 10 * 60 })
    expect(dialFocusOrder([b, a, c])).toEqual(['a', 'c', 'b'])
  })

  it('a folded overnight sorts by its painted arc, not its wrapped raw end', () => {
    const overnight = mk({ id: 'over', startMin: 22 * 60, endMin: 6 * 60 }) // paints to midnight
    const short = mk({ id: 'short', startMin: 22 * 60, endMin: 22 * 60 + 30 })
    expect(dialFocusOrder([overnight, short])).toEqual(['short', 'over'])
  })
})

describe('rovingFocusId — exactly one arc holds the tab stop (APG roving tabindex)', () => {
  const order = ['a', 'b', 'c']

  it('the live focus item holds the stop, so Tab lands on "now" first', () => {
    expect(rovingFocusId(order, null, 'b')).toBe('b')
  })

  it('the arc the keyboard last landed on wins over the live focus item', () => {
    expect(rovingFocusId(order, 'c', 'b')).toBe('c')
  })

  it('with neither, the first arc in reading order holds the stop', () => {
    expect(rovingFocusId(order, null, null)).toBe('a')
  })

  it('a stale anchor (no longer visible) falls back, never stranding the stop', () => {
    expect(rovingFocusId(order, 'gone', null)).toBe('a') // stale kbFocus → first
    expect(rovingFocusId(order, 'gone', 'b')).toBe('b') // stale kbFocus → live focus
  })

  it('an empty face has no tab stop', () => {
    expect(rovingFocusId([], null, null)).toBeNull()
  })
})

describe('stepDialFocus — arrows advance focus along the two clock axes (§2.1.1)', () => {
  // three disjoint same-band arcs across the morning → a clean time axis
  const t1 = mk({ id: 't1', startMin: 8 * 60, endMin: 9 * 60, tag: 'work' })
  const t2 = mk({ id: 't2', startMin: 10 * 60, endMin: 11 * 60, tag: 'work' })
  const t3 = mk({ id: 't3', startMin: 11 * 60 + 30, endMin: 12 * 60, tag: 'work' })
  const timeVis = [t1, t2, t3]
  const timeRadii = radiiFor(timeVis, null, 10)

  it('left/right step to the previous/next arc by time', () => {
    expect(stepDialFocus(timeVis, timeRadii, 't1', 'time', 1)).toBe('t2')
    expect(stepDialFocus(timeVis, timeRadii, 't2', 'time', 1)).toBe('t3')
    expect(stepDialFocus(timeVis, timeRadii, 't2', 'time', -1)).toBe('t1')
  })

  it('time stepping wraps so a keyboard user never dead-ends', () => {
    expect(stepDialFocus(timeVis, timeRadii, 't3', 'time', 1)).toBe('t1')
    expect(stepDialFocus(timeVis, timeRadii, 't1', 'time', -1)).toBe('t3')
  })

  it('with no anchor yet, the first arrow lands on the first/last arc in reading order', () => {
    expect(stepDialFocus(timeVis, timeRadii, null, 'time', 1)).toBe('t1')
    expect(stepDialFocus(timeVis, timeRadii, null, 'time', -1)).toBe('t3')
  })

  it('up/down step by lane among arcs at the same clock angle (commitment band)', () => {
    // a confirmed work block (inner band) and a background block (outer band) at
    // the SAME 9-o'clock angle → ↑ goes outward (background), ↓ goes inward.
    const confirmed = mk({ id: 'conf', startMin: 9 * 60, endMin: 10 * 60, tag: 'work' })
    const background = mk({ id: 'bg', startMin: 9 * 60, endMin: 10 * 60, attention: 'background' })
    const vis = [confirmed, background]
    const radii = radiiFor(vis, null, 9)
    expect(radii.get('bg')!).toBeGreaterThan(radii.get('conf')!) // background rides outward
    expect(stepDialFocus(vis, radii, 'conf', 'lane', -1)).toBe('bg') // ↑ outward
    expect(stepDialFocus(vis, radii, 'bg', 'lane', 1)).toBe('conf') // ↓ inward
  })

  it('a lane step with no same-angle neighbour falls back to a time step (never inert)', () => {
    // t1/t2/t3 are at different angles, so ↓ from t1 has no lane neighbour and
    // must still move — it steps in time rather than swallowing the key.
    const next = stepDialFocus(timeVis, timeRadii, 't1', 'lane', 1)
    expect(next).not.toBe('t1')
    expect(timeVis.map((b) => b.id)).toContain(next)
  })

  it('a single visible arc keeps focus on itself; an empty face returns the current id', () => {
    expect(stepDialFocus([t1], radiiFor([t1], null, 8), 't1', 'time', 1)).toBe('t1')
    expect(stepDialFocus([], new Map(), null, 'time', 1)).toBeNull()
  })
})
