import { describe, expect, it } from 'vitest'
import { holidayOn, toLunar, yearName } from '@/lib/lunar'

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day)

describe('Vietnamese lunar calendar', () => {
  it('puts Tết on the published dates', () => {
    // Mùng 1 Tết: 2024-02-10, 2025-01-29, 2026-02-17, 2027-02-06.
    for (const [y, m, day, lunarYear] of [
      [2024, 2, 10, 2024],
      [2025, 1, 29, 2025],
      [2026, 2, 17, 2026],
      [2027, 2, 6, 2027],
    ]) {
      expect(toLunar(d(y, m, day))).toEqual({ day: 1, month: 1, year: lunarYear, leap: false })
    }
    // The day before is still the old year.
    expect(toLunar(d(2026, 2, 16))).toMatchObject({ month: 12, year: 2025 })
  })

  it('knows the leap 6th month of 2025', () => {
    expect(toLunar(d(2025, 6, 25))).toEqual({ day: 1, month: 6, year: 2025, leap: false })
    expect(toLunar(d(2025, 7, 25))).toEqual({ day: 1, month: 6, year: 2025, leap: true })
    expect(toLunar(d(2025, 8, 23))).toEqual({ day: 1, month: 7, year: 2025, leap: false })
  })

  it('names lunar years', () => {
    expect(yearName(2025)).toBe('Ất Tỵ')
    expect(yearName(2026)).toBe('Bính Ngọ')
    expect(yearName(2027)).toBe('Đinh Mùi')
  })

  it('marks the holidays Vietnamese travel around', () => {
    expect(holidayOn(d(2026, 2, 17))).toBe('tet')
    expect(holidayOn(d(2026, 2, 16))).toBe('tetEve')
    // 2027: month 12 has 29 days, so Giao thừa is the 29th.
    expect(holidayOn(d(2027, 2, 5))).toBe('tetEve')
    expect(holidayOn(d(2026, 4, 30))).toBe('reunification')
    expect(holidayOn(d(2026, 9, 2))).toBe('nationalDay')
    expect(holidayOn(d(2026, 9, 25))).toBe('midAutumn') // 15/8 Bính Ngọ
    expect(holidayOn(d(2026, 4, 26))).toBe('hungKings') // 10/3 Bính Ngọ
    expect(holidayOn(d(2026, 10, 9))).toBeUndefined()
  })
})
