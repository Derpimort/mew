/* The day picker's markup (#23 slice 2), headless (the blockCard.test.tsx
   pattern): the APG date-picker dialog's semantics on first paint — a modal
   dialog with a name, a month grid labelled by its live heading, Monday-first
   column headers with full names, ONE roving tab stop on the day it opened
   on, aria-selected on the dial's day and aria-current on today, neighbour
   months' days marked, and month buttons that say where they go. Keys, focus
   return and Escape precedence run live in e2e/day-picker.spec.ts. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DayPicker } from '../DayPicker'
import { cellLabel, monthLabel } from '../dayPickerKeys'

const render = (viewDayKey: string, todayKey = '2026-09-16') =>
  renderToStaticMarkup(
    <DayPicker
      viewDayKey={viewDayKey}
      todayKey={todayKey}
      onPick={() => {}}
      onClose={() => {}}
      onDismiss={() => {}}
      triggerRef={{ current: null }}
    />
  )

const cells = (html: string) =>
  [...html.matchAll(/<td([^>]*)>(\d+)<\/td>/g)].map((m) => ({
    attrs: m[1],
    key: m[1].match(/data-daykey="([^"]+)"/)?.[1] ?? '',
    text: m[2],
  }))

describe('DayPicker markup', () => {
  it('is a named modal dialog holding a grid labelled by the live month heading', () => {
    const html = render('2026-09-15')
    expect(html).toMatch(/role="dialog"/)
    expect(html).toMatch(/aria-modal="true"/)
    expect(html).toMatch(/aria-label="pick a day for the focus dial"/)
    const headingId = html.match(/<h2 id="([^"]+)" class="dp-month" aria-live="polite">/)?.[1]
    expect(headingId).toBeTruthy()
    expect(html).toContain(`role="grid" aria-labelledby="${headingId}"`)
    expect(html).toContain(`${monthLabel('2026-09-15')}</h2>`)
  })

  it('columns run Monday → Sunday with their full names', () => {
    const abbr = [...render('2026-09-15').matchAll(/<th scope="col" abbr="([^"]+)">(\w+)</g)]
    expect(abbr.map((m) => m[1])).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ])
    expect(abbr.map((m) => m[2])).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'])
  })

  it('one roving tab stop on the dial’s day; selected ≠ today, each marked once', () => {
    const all = cells(render('2026-09-15'))
    expect(all).toHaveLength(35)
    expect(all.filter((c) => /tabindex="0"/.test(c.attrs)).map((c) => c.key)).toEqual([
      '2026-09-15',
    ])
    expect(all.filter((c) => /tabindex="-1"/.test(c.attrs))).toHaveLength(34)
    expect(all.filter((c) => /aria-selected="true"/.test(c.attrs)).map((c) => c.key)).toEqual([
      '2026-09-15',
    ])
    expect(all.filter((c) => /aria-current="date"/.test(c.attrs)).map((c) => c.key)).toEqual([
      '2026-09-16',
    ])
  })

  it('every day speaks its full date; neighbour months are marked, never dropped', () => {
    const all = cells(render('2026-09-15'))
    const first = all[0]
    expect(first.key).toBe('2026-08-31')
    expect(first.text).toBe('31')
    expect(first.attrs).toMatch(/class="out"/)
    expect(first.attrs).toContain(`aria-label="${cellLabel('2026-08-31')}"`)
    expect(all.filter((c) => /class="out"/.test(c.attrs)).map((c) => c.key)).toEqual([
      '2026-08-31',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ])
  })

  it('the month buttons say where they go; a day far from today still opens on it', () => {
    const html = render('2027-01-31')
    // Jan 31 ± a month clamps inside the month it lands in
    expect(html).toContain(`aria-label="previous month — ${monthLabel('2026-12-31')}"`)
    expect(html).toContain(`aria-label="next month — ${monthLabel('2027-02-28')}"`)
    expect(html).toContain(`${monthLabel('2027-01-31')}</h2>`)
    expect(cells(html).filter((c) => /aria-current="date"/.test(c.attrs))).toHaveLength(0)
  })
})
