/* The day picker's key model (#23 slice 2), pinned the way weekKeys and
   dialNav pin theirs: what a key means (the APG date-picker grammar), where
   the active day lands (days, weeks, months clamped to their length, Monday →
   Sunday week edges), and the month grid (whole Monday-first weeks). */

import { describe, expect, it } from 'vitest'
import {
  addMonthsKey,
  cellLabel,
  monthGrid,
  monthLabel,
  monthOf,
  pickerKeyIntent,
  stepActiveDay,
} from '../dayPickerKeys'

describe('pickerKeyIntent — the APG date-picker grammar', () => {
  it('arrows move a day or a week', () => {
    expect(pickerKeyIntent('ArrowLeft')).toEqual({ kind: 'move', days: -1 })
    expect(pickerKeyIntent('ArrowRight')).toEqual({ kind: 'move', days: 1 })
    expect(pickerKeyIntent('ArrowUp')).toEqual({ kind: 'move', days: -7 })
    expect(pickerKeyIntent('ArrowDown')).toEqual({ kind: 'move', days: 7 })
  })

  it('PageUp/PageDown move a month, with Shift a year; Home/End reach the week’s edges', () => {
    expect(pickerKeyIntent('PageUp')).toEqual({ kind: 'month', months: -1 })
    expect(pickerKeyIntent('PageDown')).toEqual({ kind: 'month', months: 1 })
    expect(pickerKeyIntent('PageUp', { shift: true })).toEqual({ kind: 'month', months: -12 })
    expect(pickerKeyIntent('PageDown', { shift: true })).toEqual({ kind: 'month', months: 12 })
    expect(pickerKeyIntent('Home')).toEqual({ kind: 'weekEdge', edge: 'start' })
    expect(pickerKeyIntent('End')).toEqual({ kind: 'weekEdge', edge: 'end' })
  })

  it('Enter/Space pick, Escape closes (legacy names too); everything else bubbles', () => {
    for (const k of ['Enter', ' ', 'Spacebar']) expect(pickerKeyIntent(k)).toEqual({ kind: 'pick' })
    for (const k of ['Escape', 'Esc']) expect(pickerKeyIntent(k)).toEqual({ kind: 'close' })
    for (const k of ['Tab', 'a', 'Shift', 'F5']) expect(pickerKeyIntent(k)).toBeNull()
  })
})

describe('stepActiveDay — where the active day lands', () => {
  it('days and weeks cross month and year edges by the calendar', () => {
    expect(stepActiveDay('2026-09-30', { kind: 'move', days: 1 })).toBe('2026-10-01')
    expect(stepActiveDay('2026-01-02', { kind: 'move', days: -7 })).toBe('2025-12-26')
  })

  it('a month keeps the day, clamped to the shorter month (leap years too)', () => {
    expect(addMonthsKey('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsKey('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonthsKey('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonthsKey('2026-09-16', 12)).toBe('2027-09-16')
    expect(stepActiveDay('2026-12-15', { kind: 'month', months: 1 })).toBe('2027-01-15')
  })

  it('Home/End land on the week’s Monday and Sunday — MEW’s weeks', () => {
    // Wednesday Sep 16 2026
    expect(stepActiveDay('2026-09-16', { kind: 'weekEdge', edge: 'start' })).toBe('2026-09-14')
    expect(stepActiveDay('2026-09-16', { kind: 'weekEdge', edge: 'end' })).toBe('2026-09-20')
    // already on the edge: stays
    expect(stepActiveDay('2026-09-14', { kind: 'weekEdge', edge: 'start' })).toBe('2026-09-14')
    expect(stepActiveDay('2026-09-20', { kind: 'weekEdge', edge: 'end' })).toBe('2026-09-20')
  })
})

describe('monthGrid — whole Monday-first weeks', () => {
  it('September 2026 (starts on a Tuesday): 5 weeks from Mon Aug 31 to Sun Oct 4', () => {
    const g = monthGrid('2026-09-16')
    expect(g).toHaveLength(5)
    expect(g.every((w) => w.length === 7)).toBe(true)
    expect(g[0][0]).toBe('2026-08-31')
    expect(g[0][1]).toBe('2026-09-01')
    expect(g[4][6]).toBe('2026-10-04')
    expect(g.flat().filter((k) => monthOf(k) === '2026-09')).toHaveLength(30)
  })

  it('a month starting on Monday begins its first row on the 1st; February 2027 is exactly 4 weeks', () => {
    expect(monthGrid('2026-06-10')[0][0]).toBe('2026-06-01')
    const feb = monthGrid('2027-02-14')
    expect(feb).toHaveLength(4)
    expect(feb[0][0]).toBe('2027-02-01')
    expect(feb[3][6]).toBe('2027-02-28')
  })

  it('names read the month and the full day', () => {
    expect(monthLabel('2026-09-16')).toMatch(/2026/)
    expect(cellLabel('2026-09-16')).toMatch(/Wednesday/)
    expect(cellLabel('2026-09-16')).toMatch(/16/)
  })
})
