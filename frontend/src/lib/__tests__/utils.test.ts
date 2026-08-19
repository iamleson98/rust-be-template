/**
 * Tests for utility functions — currency, formatting, phone normalization.
 */
import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  convertToUSD,
  convertToVND,
  EXCHANGE_RATE,
  EXCHANGE_RATE_NOTE,
} from '@/lib/currency'
import {
  formatVND,
  formatNum,
  formatDuration,
  normalizePhone,
  noTones,
  SEAT_CLASS_LABELS,
  SEAT_CLASS_COLORS,
  VEHICLE_TYPE_LABELS,
} from '@/lib/types'
import { cn } from '@/lib/utils'

// ── Currency ──────────────────────────────────────────────────

describe('formatCurrency', () => {
  it('formats VND with Vietnamese locale', () => {
    const result = formatCurrency(150000, 'VND')
    expect(result).toMatch(/150/)
    expect(result).toContain('₫')
  })

  it('formats USD with 2 decimal places', () => {
    const result = formatCurrency(245000, 'USD')
    expect(result).toMatch(/\$\d+\.\d{2}/)
  })

  it('handles zero amount', () => {
    expect(formatCurrency(0, 'VND')).toContain('0')
    expect(formatCurrency(0, 'USD')).toContain('0.00')
  })

  it('handles large amounts', () => {
    const result = formatCurrency(1500000, 'VND')
    expect(result).toContain('1.500.000')
  })
})

describe('convertToUSD / convertToVND', () => {
  it('converts VND to USD using the static rate', () => {
    expect(convertToUSD(EXCHANGE_RATE)).toBeCloseTo(1, 2)
    expect(convertToUSD(49000)).toBeCloseTo(2, 2)
  })

  it('converts USD to VND', () => {
    expect(convertToVND(1)).toBe(EXCHANGE_RATE)
    expect(convertToVND(10)).toBe(245000)
  })

  it('EXCHANGE_RATE_NOTE contains the rate', () => {
    expect(EXCHANGE_RATE_NOTE).toContain('24.500')
    expect(EXCHANGE_RATE_NOTE).toContain('USD')
  })
})

// ── Number / date formatting ─────────────────────────────────

describe('formatVND', () => {
  it('formats with Vietnamese thousand separators', () => {
    expect(formatVND(150000)).toContain('150.000')
  })

  it('handles zero', () => {
    expect(formatVND(0)).toContain('0')
  })
})

describe('formatNum', () => {
  it('formats numbers with thousands separators', () => {
    const result = formatNum(1234567)
    expect(result).toContain('1.234.567')
  })
})

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    const result = formatDuration(150) // 2h 30min
    expect(result).toContain('2')
    expect(result).toContain('30')
  })

  it('handles less than an hour', () => {
    const result = formatDuration(45)
    expect(result).toContain('45')
  })
})

// ── normalizePhone — converts to +84 format ──────────────────

describe('normalizePhone', () => {
  it('converts 0xxx to +84xxx', () => {
    expect(normalizePhone('0901234567')).toBe('+84901234567')
  })

  it('removes spaces', () => {
    expect(normalizePhone('090 123 4567')).toBe('+84901234567')
  })

  it('converts 84xxx to +84xxx', () => {
    expect(normalizePhone('84901234567')).toBe('+84901234567')
  })
})

// ── noTones — removes Vietnamese diacritics + lowercases ─────

describe('noTones', () => {
  it('removes Vietnamese diacritics and lowercases', () => {
    expect(noTones('Hà Nội')).toBe('ha noi')
    expect(noTones('Đà Nẵng')).toBe('da nang')
    expect(noTones('Tp. Hồ Chí Minh')).toBe('tp. ho chi minh')
  })

  it('preserves ASCII text (lowercased)', () => {
    expect(noTones('Hello World')).toBe('hello world')
  })
})

// ── Lookup maps ──────────────────────────────────────────────

describe('SEAT_CLASS_LABELS', () => {
  it('has labels for known seat classes', () => {
    expect(SEAT_CLASS_LABELS['standard']).toBeDefined()
    expect(typeof SEAT_CLASS_LABELS['standard']).toBe('string')
  })
})

describe('SEAT_CLASS_COLORS', () => {
  it('has colors for known seat classes', () => {
    expect(SEAT_CLASS_COLORS['standard']).toBeDefined()
    expect(SEAT_CLASS_COLORS['standard']).toMatch(/^#/)
  })
})

describe('VEHICLE_TYPE_LABELS', () => {
  it('has labels for common vehicle types', () => {
    expect(VEHICLE_TYPE_LABELS['limousine']).toBeDefined()
  })
})

// ── cn() utility ─────────────────────────────────────────────

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    expect(cn('base', false && 'no', true && 'yes')).toBe('base yes')
  })

  it('deduplicates conflicting Tailwind classes', () => {
    const result = cn('p-2', 'p-4')
    expect(result).toBe('p-4')
  })
})
