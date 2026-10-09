import { describe, expect, it } from 'vitest'
import {
  percentChange,
  periodDays,
  previousPeriod,
  revenueBars,
} from '@/features/admin/dashboard/helpers'

describe('reporting periods', () => {
  it('lists every day and finds the period before', () => {
    const week = { dateFrom: '2026-10-03', dateTo: '2026-10-09' }
    expect(periodDays(week)).toHaveLength(7)
    expect(periodDays(week)[0]).toBe('2026-10-03')
    expect(previousPeriod(week)).toEqual({ dateFrom: '2026-09-26', dateTo: '2026-10-02' })
  })

  it('compares against the previous period only when it had revenue', () => {
    expect(percentChange(150, 100)).toBe(50)
    expect(percentChange(50, 100)).toBe(-50)
    expect(percentChange(100, 0)).toBeNull()
  })

  it('counts quiet days as zero and sums days per bar when they do not fit', () => {
    const days = periodDays({ dateFrom: '2026-10-01', dateTo: '2026-10-09' })
    const revenue = new Map([
      ['2026-10-02', 100],
      ['2026-10-04', 50],
    ])
    const daily = revenueBars(days, revenue, 10, (d) => d.slice(8))
    expect(daily).toHaveLength(9)
    expect(daily.map((b) => b.value)).toEqual([0, 100, 0, 50, 0, 0, 0, 0, 0])

    const grouped = revenueBars(days, revenue, 3, (d) => d.slice(8))
    expect(grouped.map((b) => [b.label, b.value])).toEqual([
      ['01', 100],
      ['04', 50],
      ['07', 0],
    ])
  })
})
