/* #27 — the all-day lane's keyboard/screen-reader contract, pinned in real
   markup (headless, no jsdom — the WeekColumns.a11y precedent). AllDayLane is
   props in, markup out, so the lane renders here with a crowded week: an
   application surface that points at the grid's grammar hint, chips as named
   buttons sharing ONE roving tab stop, a span placed across its columns, and
   "+N more" / "less" as real toggle buttons. The dock card for an all-day
   entry (BlockCard) is pinned alongside: all day, never a clock span, never
   Done/Start/Move/Hold. The live walk (focus, Enter, the dock) is the
   shoot-allday.mjs gate. */

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Block } from '../../../domain/types'
import { layoutAllDay, viewAllDay } from '../allDayLane'

vi.mock('../../../state/store', () => ({
  useMew: (sel: (s: Record<string, () => void>) => unknown) =>
    sel({
      toggleComplete: () => {},
      startNow: () => {},
      interruptBlock: () => {},
      moveToNextFree: () => {},
      toggleProtected: () => {},
      removeBlock: () => {},
    }),
  useLive: () => ({}),
}))

const { AllDayLane } = await import('../WeekColumns')
const { BlockCard } = await import('../BlockCard')

const WEEK = [
  '2026-09-21',
  '2026-09-22',
  '2026-09-23',
  '2026-09-24',
  '2026-09-25',
  '2026-09-26',
  '2026-09-27',
]
const COLS = '34px 1fr 1fr 1fr 2.3fr 1fr 1fr 1fr'

function label(
  id: string,
  title: string,
  day: number,
  lastDay?: number,
  over: Partial<Block> = {}
): Block {
  return {
    id,
    title,
    tag: 'private',
    dayKey: WEEK[day],
    startMin: 0,
    endMin: 0,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    allDay: true,
    external: { calId: 'work@acme', eventId: id },
    ...(lastDay != null ? { endDayKey: WEEK[lastDay] } : {}),
    ...over,
  }
}

const blocks = [
  label('ooo', 'OOO', 0, 2),
  label('hol', 'Civic Holiday', 3),
  label('a', 'Payday', 4),
  label('b', "Sam's birthday", 4),
  label('c', 'School closed', 4),
  label('d', 'Recycling day', 4),
]

const render = (open: boolean, rovingId: string | null) =>
  renderToStaticMarkup(
    <AllDayLane
      cols={COLS}
      weekDayKeys={WEEK}
      todayKey="2026-09-24"
      lane={viewAllDay(layoutAllDay(blocks, WEEK), open)}
      open={open}
      rovingId={rovingId}
    />
  )

describe('#27 — the all-day lane is a keyboard application surface', () => {
  const html = render(false, 'hol')

  it('an application named for what it holds, taught by the grid hint', () => {
    expect(html).toMatch(/class="wk-allday"[^>]*role="application"/)
    expect(html).toMatch(/class="wk-allday"[^>]*aria-label="all-day: [^"]+"/)
    expect(html).toMatch(/class="wk-allday"[^>]*aria-describedby="wk-hint"/)
  })

  it('chips are named buttons; exactly one holds the roving tab stop', () => {
    const chips = html.match(/<div[^>]*class="wk-allday-chip[^"]*"[^>]*>/g) ?? []
    expect(chips.length).toBe(4) // OOO, holiday, and Friday's first two — the rest are folded
    expect(chips.every((c) => /role="button"/.test(c))).toBe(true)
    expect(chips.filter((c) => /tabindex="0"/.test(c))).toHaveLength(1)
    expect(chips.filter((c) => /tabindex="-1"/.test(c))).toHaveLength(3)
    expect(html).toContain('aria-label="Civic Holiday, all day, from your calendar"')
    expect(html).toContain('aria-label="OOO, all day, monday to wednesday, from your calendar"')
  })

  it('a span is ONE chip placed across its columns (the hour gutter is column 1)', () => {
    expect(html).toMatch(/grid-column:2 \/ span 3;grid-row:1"[^>]*aria-label="OOO, all day/)
    expect(html.match(/>OOO</g)).toHaveLength(1)
  })

  it('a folded column offers "+N more" as a real, labelled toggle button', () => {
    expect(html).toMatch(
      /<button type="button" class="wk-allday-more"[^>]*aria-expanded="false" aria-label="2 more all-day on friday — show them all"[^>]*>\+2 more<\/button>/
    )
    expect(html).not.toContain('wk-allday-less')
  })

  it('opened, every chip shows and "less" folds it back (aria-expanded=true)', () => {
    const open = render(true, 'ooo')
    expect(open.match(/class="wk-allday-chip/g)).toHaveLength(6)
    expect(open).not.toContain('wk-allday-more')
    expect(open).toMatch(
      /<button type="button" class="wk-allday-less"[^>]*aria-expanded="true" aria-label="show fewer all-day labels"[^>]*>less<\/button>/
    )
  })

  it('a span entirely in the past dims like its columns; a clipped span squares off', () => {
    const past = render(false, null)
    expect(past).toMatch(/class="wk-allday-chip past"[^>]*grid-column:2 \/ span 3/)
    const clipped = renderToStaticMarkup(
      <AllDayLane
        cols={COLS}
        weekDayKeys={WEEK}
        todayKey="2026-09-21"
        lane={viewAllDay(
          layoutAllDay(
            [
              label('trip', 'Trip', 0, 1, { dayKey: '2026-09-18' }),
              label('conf', 'Conf', 6, undefined, { endDayKey: '2026-09-29' }),
            ],
            WEEK
          ),
          false
        )}
        open={false}
        rovingId={null}
      />
    )
    expect(clipped).toMatch(/class="wk-allday-chip cont-l"/)
    expect(clipped).toMatch(/class="wk-allday-chip cont-r"/)
  })
})

describe('#27 — the dock card for an all-day entry', () => {
  const card = (b: Block) =>
    renderToStaticMarkup(<BlockCard block={b} isNow={false} variant="dock" onClose={() => {}} />)

  it('reads all day (with its days), never a clock span or a duration', () => {
    const html = card(label('ooo', 'OOO', 0, 2))
    expect(html).toContain('all day · Mon – Wed')
    expect(html).not.toMatch(/0:00|min</)
    expect(html).toContain('calendar · all day')
  })

  it('a calendar all-day entry offers no action at all — not Done, Start, Move or Hold', () => {
    const html = card(label('hol', 'Civic Holiday', 3, undefined, { protected: true }))
    expect(html).not.toMatch(
      /Done — a mew|Start now|Interrupt|>Move<|Hold \(protect\)|Release hold|Remove/
    )
    expect(html).not.toContain('· held')
  })

  it('a label MEW owns (its calendar gone) can only be removed', () => {
    const html = card(label('bday', 'Birthday', 4, undefined, { external: undefined }))
    expect(html).toContain('Remove')
    expect(html).not.toMatch(/Done — a mew|Start now|>Move<|Hold \(protect\)/)
    expect(html).toContain('>all day<')
  })
})
