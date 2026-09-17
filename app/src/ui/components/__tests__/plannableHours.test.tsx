/* The plannable-hours control (#22 slice B). Headless (no jsdom), the inbox /
   memory-console pattern: renderToStaticMarkup pins the accessible contract
   (a named group, two named spinbuttons with their values, the hint's live
   region, aria-invalid + describedby only on the field the hint is about), the
   stylesheet carries every class the markup paints, and Settings writes the
   control through the store's settings path — never through quiet hours. The
   gate itself (grid, one date, start before end) and the keyboard step are
   pure, so they're pinned exhaustively here; the look is proven by the shoot. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { PlannableHoursField, PlannableHoursView } from '../PlannableHoursField'
import {
  PLANNABLE_LAST_END,
  checkPlannableDraft,
  clockOf,
  parseClock,
  stepClock,
} from '../../../domain/plannable'
import { DEFAULT_PLANNABLE_HOURS } from '../../../domain/types'

const here = dirname(fileURLToPath(import.meta.url))
const componentsCss = readFileSync(resolve(here, '../components.css'), 'utf8')
const settingsSrc = readFileSync(resolve(here, '../../pages/SettingsPage.tsx'), 'utf8')

const noop = () => {}
const view = (start: string, end: string, hint: Parameters<typeof PlannableHoursView>[0]['hint']) =>
  renderToStaticMarkup(
    <PlannableHoursView
      start={start}
      end={end}
      hint={hint}
      onType={noop}
      onSettle={noop}
      onStep={noop}
    />
  )
/** the attributes of the input whose aria-label is `label` */
const inputOf = (html: string, label: string) =>
  html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? ''

describe('PlannableHoursField — the accessible contract', () => {
  it('renders the stored day as two named 24h spinbuttons in a named group', () => {
    const html = renderToStaticMarkup(
      <PlannableHoursField hours={DEFAULT_PLANNABLE_HOURS} onCommit={noop} />
    )
    expect(html).toContain('role="group" aria-label="Plannable hours"')
    const start = inputOf(html, 'Plannable day starts')
    const end = inputOf(html, 'Plannable day ends')
    for (const [el, value, min] of [
      [start, '08:00', 480],
      [end, '22:30', 1350],
    ] as const) {
      expect(el).toContain('role="spinbutton"')
      expect(el).toContain('inputMode="numeric"')
      expect(el).toContain(`value="${value}"`)
      expect(el).toContain(`aria-valuenow="${min}"`)
      expect(el).toContain(`aria-valuetext="${value}"`)
      expect(el).toContain('aria-valuemin="0"')
      expect(el).toContain(`aria-valuemax="${PLANNABLE_LAST_END}"`)
      expect(el).not.toContain('aria-invalid')
    }
    // the live region is always in the tree (so it announces), empty while all is well
    expect(html).toMatch(/<span id="[^"]+" class="plannable-hint" role="status"><\/span>/)
  })

  it('a hint flags only its own field, describes it, and speaks through the live region', () => {
    const html = view('08:00', '07:00', { field: 'end', text: 'pick an end after 08:00' })
    const hintId = html.match(/<span id="([^"]+)" class="plannable-hint" role="status">/)![1]
    const end = inputOf(html, 'Plannable day ends')
    expect(end).toContain('aria-invalid="true"')
    expect(end).toContain(`aria-describedby="${hintId}"`)
    expect(inputOf(html, 'Plannable day starts')).not.toContain('aria-invalid')
    expect(html).toContain('keyfield plannable-field plannable-flag')
    expect(html).toContain('role="status">pick an end after 08:00</span>')
  })

  it('an unreadable draft carries no valuenow (nothing false is announced)', () => {
    const el = inputOf(view('8', '22:30', null), 'Plannable day starts')
    expect(el).toContain('value="8"')
    expect(el).not.toContain('aria-valuenow')
    expect(el).not.toContain('aria-valuetext')
  })

  it('the stylesheet paints every class the markup uses, with tokens', () => {
    for (const cls of ['.plannable ', '.plannable-sep', '.plannable-flag', '.plannable-hint'])
      expect(componentsCss).toContain(cls)
    const block = componentsCss.slice(componentsCss.indexOf('plannable hours (#22 slice B)'))
    expect(block).not.toMatch(/#[0-9a-f]{3,6}\b/i) // tokens only, no raw colors
  })

  it('Settings writes the control through updateSettings({ plannableHours }) — beside, not inside, quiet hours', () => {
    expect(settingsSrc).toContain('<PlannableHoursField')
    expect(settingsSrc).toContain('onCommit={(hours) => updateSettings({ plannableHours: hours })}')
    expect(settingsSrc).toContain('t="Plannable hours"')
    expect(settingsSrc).toContain('Separate from quiet hours.')
    const quietRow = settingsSrc.slice(
      settingsSrc.indexOf('t="Quiet hours"'),
      settingsSrc.indexOf('t="Plannable hours"')
    )
    expect(quietRow).not.toContain('plannableHours')
  })
})

describe('checkPlannableDraft — a draft commits only as a real plannable day', () => {
  it('passes a same-date span on the 5-minute grid', () => {
    expect(checkPlannableDraft('08:00', '22:30')).toEqual({
      ok: true,
      hours: { startMin: 480, endMin: 1350 },
    })
    expect(checkPlannableDraft('00:00', '23:55')).toEqual({
      ok: true,
      hours: { startMin: 0, endMin: PLANNABLE_LAST_END },
    })
    expect(checkPlannableDraft(' 07:05 ', '07:10')).toMatchObject({ ok: true })
  })

  it('asks for a readable time, naming the field', () => {
    expect(checkPlannableDraft('', '22:30')).toEqual({
      ok: false,
      field: 'start',
      hint: 'pick a start time, like 08:00',
    })
    for (const bad of ['8:00', '24:00', '12:60', '12.30', '1230', 'noon'])
      expect(checkPlannableDraft('08:00', bad)).toEqual({
        ok: false,
        field: 'end',
        hint: 'pick an end time, like 22:30',
      })
  })

  it('keeps both bounds on the 5-minute grid, offering the neighbouring marks', () => {
    expect(checkPlannableDraft('08:03', '22:30')).toEqual({
      ok: false,
      field: 'start',
      hint: 'start on a 5-minute mark — 08:00 or 08:05',
    })
    expect(checkPlannableDraft('08:00', '23:58')).toEqual({
      ok: false,
      field: 'end',
      hint: 'end on a 5-minute mark — 23:55',
    })
  })

  it('keeps the day on one date and the end after the start', () => {
    expect(checkPlannableDraft('08:00', '00:00')).toEqual({
      ok: false,
      field: 'end',
      hint: 'the day ends on the same date — 23:55 is the latest end',
    })
    expect(checkPlannableDraft('22:00', '21:00')).toEqual({
      ok: false,
      field: 'end',
      hint: 'pick an end after 22:00',
    })
    expect(checkPlannableDraft('09:00', '09:00')).toMatchObject({ ok: false, field: 'end' })
  })

  it('speaks in the positive voice', () => {
    const hints = [
      checkPlannableDraft('', ''),
      checkPlannableDraft('08:00', 'x'),
      checkPlannableDraft('08:02', '22:30'),
      checkPlannableDraft('08:00', '00:00'),
      checkPlannableDraft('10:00', '09:00'),
    ].map((c) => (c.ok ? '' : c.hint))
    for (const h of hints) expect(h).not.toMatch(/invalid|error|wrong|can't|cannot|must|not /i)
  })
})

describe('clock helpers', () => {
  it('parseClock and clockOf round-trip every 5-minute mark of the day', () => {
    for (let m = 0; m <= PLANNABLE_LAST_END; m += 5) expect(parseClock(clockOf(m))).toBe(m)
    expect(parseClock('7:30')).toBeNull()
  })

  it('stepClock moves on-grid times by the step and clamps to 00:00–23:55', () => {
    expect(stepClock('08:00', 5, 0)).toBe('08:05')
    expect(stepClock('08:00', -5, 0)).toBe('07:55')
    expect(stepClock('08:00', 60, 0)).toBe('09:00')
    expect(stepClock('23:30', 60, 0)).toBe('23:55')
    expect(stepClock('00:30', -60, 0)).toBe('00:00')
  })

  it('stepClock lands an off-grid time on the neighbouring mark first', () => {
    expect(stepClock('08:03', 5, 0)).toBe('08:05')
    expect(stepClock('08:03', 60, 0)).toBe('08:05')
    expect(stepClock('08:03', -5, 0)).toBe('08:00')
  })

  it('stepClock steps an unreadable draft from the stored bound', () => {
    expect(stepClock('8', 5, 22 * 60 + 30)).toBe('22:35')
  })
})
