import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { vnDate } from '@/lib/search-params'
import { SECTION_IDS, useDayLabel, useDaysLabel } from '../brand-format'

describe('useDayLabel', () => {
  const label = () => renderHook(() => useDayLabel()).result.current

  it('says today and tomorrow in words', () => {
    expect(label()(vnDate(0))).toBe('Hôm nay')
    expect(label()(vnDate(1))).toBe('Ngày mai')
  })

  it('shows any other day as weekday and day/month', () => {
    // 2026-11-04 is a Wednesday; the weekday's spelling depends on the ICU build.
    expect(label()('2026-11-04')).toMatch(/^\S.*, 04\/11$/)
    expect(label()('2026-11-04')).not.toBe(label()('2026-11-05'))
  })
})

describe('useDaysLabel', () => {
  const label = () => renderHook(() => useDaysLabel()).result.current

  it('is "daily" when it runs every day, or the schedule has no mask', () => {
    expect(label()(null)).toBe('Hàng ngày')
    expect(label()('1111111')).toBe('Hàng ngày')
  })

  it('lists the weekdays of a Monday-first mask', () => {
    const [mon, tue, wed, thu, fri, sat, sun] = [
      '1000000',
      '0100000',
      '0010000',
      '0001000',
      '0000100',
      '0000010',
      '0000001',
    ].map((m) => label()(m))
    expect(new Set([mon, tue, wed, thu, fri, sat, sun]).size).toBe(7)
    expect(label()('1010100')).toBe([mon, wed, fri].join(', '))
    expect(label()('0000011')).toBe([sat, sun].join(', '))
  })
})

describe('section ids', () => {
  it('are distinct anchors for the section nav', () => {
    const ids = Object.values(SECTION_IDS)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
