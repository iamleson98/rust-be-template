import { describe, expect, it } from 'vitest'
import { dayLabel } from '@/lib/day-label'
import { parseIsoDate } from '@/lib/iso-date'

describe('dayLabel', () => {
  const monday = new Date(2026, 9, 12)
  it('writes the weekday and the day and month, as the calendar library did', () => {
    expect(dayLabel(monday, 'vi')).toBe('Thứ Hai, 12/10')
    expect(dayLabel(monday, 'en')).toBe('Monday, 12/10')
  })
  it('keeps two letters of the weekday when there is a time to show', () => {
    expect(dayLabel(monday, 'vi', true)).toBe('Th 2, 12/10')
    expect(dayLabel(new Date(2026, 9, 11), 'vi', true)).toBe('CN, 11/10')
    expect(dayLabel(new Date(2026, 9, 13), 'en', true)).toBe('Tu, 13/10')
  })
  it('pads the day and month', () => {
    expect(dayLabel(new Date(2026, 0, 5), 'en')).toBe('Monday, 05/01')
  })
})

describe('parseIsoDate', () => {
  it('reads a real day in local time, ignoring what follows the date', () => {
    const date = parseIsoDate('2026-12-01T08:30:00Z')
    expect([date?.getFullYear(), date?.getMonth(), date?.getDate()]).toEqual([2026, 11, 1])
  })
  it('refuses what is not a calendar day', () => {
    for (const bad of ['', null, undefined, 'tomorrow', '2026-02-30', '2026-13-01', '26-1-1']) {
      expect(parseIsoDate(bad), String(bad)).toBeNull()
    }
  })
})
