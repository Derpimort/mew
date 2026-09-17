/* The dial's all-day badges on another day (#23 × #27), pinned in real markup
   (headless, the FocusOrbit.badges.a11y precedent). Everything a badge says is
   measured against the day the dial SHOWS, so a label reads on any day exactly
   as it would if that day were today: a Mon–Wed entry viewed on Monday runs
   "through wednesday", on its own last day it runs through nothing, and the
   group and "+N more" name the shown day instead of calling it today. On today
   (no dayName) the words are unchanged — FocusOrbit.badges.a11y pins those.
   The FocusOrbit wiring (the shown day, not today) is proven live by
   shoot-dayview.mjs. */

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

const MON = '2026-09-14'
const WED = '2026-09-16'

function label(id: string, title: string, over: Partial<Block> = {}): Block {
  return {
    id,
    title,
    tag: 'private',
    dayKey: MON,
    startMin: 0,
    endMin: 0,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    allDay: true,
    ...over,
  }
}

const offsite = label('offsite', 'Offsite', { endDayKey: WED })

const render = (badges: Block[], dayKey: string, dayName?: string, open = false) =>
  renderToStaticMarkup(
    <DialBadges
      view={badgeRow(badges, open)}
      dayKey={dayKey}
      dayName={dayName}
      rovingId={null}
      litId={null}
    />
  )

describe('DialBadges on another day', () => {
  it('a Mon–Wed entry viewed on Monday runs "through wednesday" — measured against the shown day', () => {
    const html = render([offsite], MON, 'Monday, September 14')
    expect(html).toContain('aria-label="Offsite · all day, through wednesday · day label"')
  })

  it('on the entry’s own last day it runs through nothing — as it would on that day as today', () => {
    const html = render([{ ...offsite, dayKey: WED }], WED, 'Wednesday, September 16')
    expect(html).toContain('aria-label="Offsite · all day · day label"')
  })

  it('the group and "+N more" name the shown day, never "today"', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => label(id, `Label ${id}`))
    const html = render(many, MON, 'Monday, September 14')
    expect(html).toContain('aria-label="all-day labels for Monday, September 14"')
    expect(html).toContain(
      'aria-label="3 more all-day labels for Monday, September 14 — show them all"'
    )
    expect(html).not.toMatch(/today/)
  })

  it('without a day name (today) the words are exactly today’s', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => label(id, `Label ${id}`))
    const html = render(many, MON)
    expect(html).toContain('aria-label="today&#x27;s all-day labels"')
    expect(html).toContain('aria-label="3 more all-day labels today — show them all"')
  })
})
