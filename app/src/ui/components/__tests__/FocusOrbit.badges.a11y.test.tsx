/* #27 — the dial's all-day badges, pinned in real markup (headless, no jsdom —
   the SessionLog/WeekColumns a11y precedent). DialBadges is props in, markup
   out: a named group inside the dial application, each badge a named button
   holding the dial's roving tab stop only when it's the anchor, the lit badge
   marked, "+N more" a real toggle, and the row stepping back while a card owns
   the centre. The live walk (hover lighting the whole ring, arrows, Space, the
   card) is the shoot-allday.mjs gate. */

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Block } from '../../../domain/types'
import { badgeRow } from '../orbitGeometry'

vi.mock('../../../state/store', () => ({
  useMew: (sel: (s: Record<string, unknown>) => unknown) => sel({ blocks: [], captures: [] }),
  useLive: () => ({ meta: [], headline: '' }),
  clockNow: () => Date.now(),
}))

const { DialBadges } = await import('../FocusOrbit')

const TODAY = '2026-09-24'

function label(id: string, title: string, over: Partial<Block> = {}): Block {
  return {
    id,
    title,
    tag: 'private',
    dayKey: TODAY,
    startMin: 0,
    endMin: 0,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    allDay: true,
    external: { calId: 'work@acme', eventId: id },
    ...over,
  }
}

const two = [
  label('ooo', 'OOO — offsite', { dayKey: '2026-09-23', endDayKey: '2026-09-25' }),
  label('civic', 'Civic Holiday'),
]

const render = (
  badges: Block[],
  opts: { rovingId?: string | null; litId?: string | null; hidden?: boolean; open?: boolean } = {}
) =>
  renderToStaticMarkup(
    <DialBadges
      view={badgeRow(badges, opts.open ?? false)}
      todayKey={TODAY}
      rovingId={opts.rovingId ?? null}
      litId={opts.litId ?? null}
      hidden={opts.hidden}
    />
  )

describe('#27 — dial badges are named, keyboard-reachable buttons', () => {
  it('a named group of badge buttons, each speaking its day', () => {
    const html = render(two)
    expect(html).toMatch(
      /class="dial-badges" role="group" aria-label="today&#x27;s all-day labels"/
    )
    expect(html.match(/role="button"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="OOO · all day, through friday · calendar"')
    expect(html).toContain('aria-label="Civic Holiday · all day · calendar"')
    // the visible text is the title before any "— note" tail
    expect(html).toContain('<span class="t">OOO</span>')
  })

  it('a badge holds the roving tab stop only when it is the anchor', () => {
    const none = render(two, { rovingId: 'some-arc' })
    expect(none.match(/tabindex="0"/g)).toBeNull()
    expect(none.match(/tabindex="-1"/g)).toHaveLength(2)
    const civic = render(two, { rovingId: 'civic' })
    expect(civic).toMatch(/tabindex="0" aria-label="Civic Holiday · all day · calendar"/)
    expect(civic.match(/tabindex="0"/g)).toHaveLength(1)
  })

  it('the lit badge wears .on; a done label is struck', () => {
    expect(render(two, { litId: 'civic' })).toMatch(
      /class="dial-badge on"[^>]*aria-label="Civic Holiday/
    )
    expect(render([label('b', 'Birthday', { status: 'done' })])).toContain(
      'class="dial-badge done"'
    )
  })

  it('a crowded day: two badges and a real "+N more" toggle; opened, all four', () => {
    const four = [...two, label('pay', 'Payday'), label('bday', "Sam's birthday")]
    const folded = render(four)
    expect(folded.match(/role="button"/g)).toHaveLength(2)
    expect(folded).toMatch(
      /<button type="button" class="dial-badge more" aria-expanded="false" aria-label="2 more all-day labels today — show them all">\+2 more<\/button>/
    )
    const open = render(four, { open: true })
    expect(open.match(/role="button"/g)).toHaveLength(4)
    expect(open).not.toContain('dial-badge more')
  })

  it('while a card owns the centre the row steps back, out of reach', () => {
    expect(render(two, { hidden: true })).toMatch(
      /class="dial-badges"[^>]*style="opacity:0;pointer-events:none"/
    )
    expect(render(two)).not.toContain('pointer-events:none')
  })
})
