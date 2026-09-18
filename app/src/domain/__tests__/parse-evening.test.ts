/* #117: the keyless grammar reads "tonight", "this evening" and "after dinner"
   with no clock time as the evening window, and none of those words stay in
   the title. A clock time still wins, and the other parts of the day ("this
   afternoon", "thursday evening") read as before. Pure. */

import { describe, expect, it } from 'vitest'
import { parseCommand } from '../parse'

const NOW = new Date(2026, 5, 9, 14, 0) // Tuesday 14:00
const place = (text: string) => parseCommand(text, NOW).places?.[0]

describe('the evening, said the way people say it', () => {
  it.each([
    ['block 2h for writing tonight', { title: 'writing', window: 'evening', durationMin: 120 }],
    ['block 1h for reading this evening', { title: 'reading', window: 'evening', durationMin: 60 }],
    [
      'block 30 min for a walk after dinner',
      { title: 'walk', window: 'evening', afterDinner: true },
    ],
    ['block tonight for the budget review', { title: 'budget review', window: 'evening' }],
    ["block 1h for tonight's reading", { title: 'reading', window: 'evening', durationMin: 60 }],
    ['block 30 min for this evening’s walk', { title: 'walk', window: 'evening', durationMin: 30 }],
  ])('"%s" is the evening window, and the title keeps only the task', (text, want) => {
    const p = place(text)!
    expect(p).toMatchObject(want)
    expect(p.startMin).toBeUndefined()
    expect(p.endMin).toBeUndefined()
  })

  it('a clock time wins: "tonight at 9pm" is 21:00, no window', () => {
    const p = place('block 1h for reading tonight at 9pm')!
    expect(p).toMatchObject({ title: 'reading', startMin: 21 * 60 })
    expect(p.window).toBeUndefined()
  })

  it.each([
    ['block 1h for email this afternoon', 13 * 60],
    ['block 1h for the deck thursday evening', 18 * 60],
  ])('the other parts of the day read as before: "%s"', (text, startMin) => {
    const p = place(text)!
    expect(p.startMin).toBe(startMin)
    expect(p.window).toBeUndefined()
  })

  it('"dinner" alone is a title word, not the evening', () => {
    const p = place('block 1h for dinner prep')!
    expect(p.title).toBe('dinner prep')
    expect(p.window).toBeUndefined()
  })
})
