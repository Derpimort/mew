/* Markup pin for the weekly-review surface (#346). Headless (no jsdom), the
   noticedCard/memoryConsole pattern: renderToStaticMarkup + assert the contract
   — the dialog a11y, the mews celebrated, the carried multi-select (one checkbox
   per candidate), the roll/leave affordances (roll disabled until a pick), the
   per-tag tally, and the kind empty state. Voice is pinned positive. The
   interactive roll is the store's rollForward path (store tests) + the shoot;
   here we pin the skin renders the right affordances. The skin is fed hand-built
   data so this never depends on the presenter's math. */

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Block } from '../../../domain/types'
import type { WeeklyReview as WeeklyReviewData } from '../../../domain/review'

/* the file's FromStore wrapper imports the store — mock it so importing the pure
   skin never touches IndexedDB (the blockCard.test.tsx pattern). */
vi.mock('../../../state/store', () => ({
  useMew: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      weeklyReviewOpen: false,
      blocks: [],
      memory: [],
      nowMs: 0,
      rollForward: () => {},
      closeWeeklyReview: () => {},
    }),
  activePrefsFrom: () => [],
}))

const { WeeklyReview } = await import('../WeeklyReview')

const noop = () => {}

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'X',
    tag: 'work',
    dayKey: '2026-06-10',
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

const DATA: WeeklyReviewData = {
  weekKey: '2026-06-08',
  mews: [
    mk({
      id: 'm1',
      title: 'Q3 deck — deep work',
      tag: 'work',
      dayKey: '2026-06-08',
      status: 'done',
    }),
    mk({ id: 'm2', title: 'Walk', tag: 'private', dayKey: '2026-06-09', status: 'done' }),
  ],
  carried: [
    mk({ id: 'c1', title: 'Roadmap draft', tag: 'work', dayKey: '2026-06-10' }),
    mk({ id: 'c2', title: 'Gym', tag: 'private', dayKey: '2026-06-11' }),
  ],
  byTag: { work: { mews: 1, carried: 1 }, private: { mews: 1, carried: 1 } },
  empty: false,
}

describe('WeeklyReview skin', () => {
  const html = renderToStaticMarkup(
    <WeeklyReview data={DATA} targetWeekKey="2026-06-15" onRoll={noop} onDismiss={noop} />
  )

  it('is an accessible dialog titled for the ritual', () => {
    expect(html).toMatch(/role="dialog"/)
    expect(html).toMatch(/aria-modal="true"/)
    expect(html).toContain('your week in review')
  })

  it('celebrates the mews', () => {
    expect(html).toContain('mews to celebrate')
    expect(html).toContain('Q3 deck')
    expect(html).toContain('Walk')
  })

  it('offers the carried blocks as a multi-select — one checkbox each', () => {
    const boxes = html.match(/type="checkbox"/g) ?? []
    expect(boxes).toHaveLength(DATA.carried.length)
    expect(html).toContain('Roadmap draft')
    expect(html).toContain('Gym')
    expect(html).toMatch(/carry into next week/)
  })

  it('shows the per-tag tally', () => {
    expect(html).toContain('work')
    expect(html).toMatch(/to carry/)
  })

  it('offers roll + leave, with roll disabled until something is picked', () => {
    expect(html).toContain('roll selected to next week')
    expect(html).toContain('leave them')
    // the roll button renders disabled at zero selections (nothing rolls unasked)
    expect(html).toMatch(/roll selected to next week/)
    expect(html).toMatch(/disabled/)
  })

  it('never uses shame / streak vocabulary', () => {
    expect(html).not.toMatch(/\b(missed|failed|behind|overdue|streak|broke|broken|fell short)\b/i)
  })

  it('shows a kind line and no carry list under the empty floor', () => {
    const empty = renderToStaticMarkup(
      <WeeklyReview
        data={{ weekKey: '2026-06-08', mews: [], carried: [], byTag: {}, empty: true }}
        targetWeekKey="2026-06-15"
        onRoll={noop}
        onDismiss={noop}
      />
    )
    expect(empty).toMatch(/rest is earned/)
    expect(empty).not.toMatch(/type="checkbox"/)
  })
})
