import { describe, expect, it } from 'vitest'

import {
  barTone,
  formatBytes,
  formatUptime,
  usagePercent,
  usageTone,
} from '../metric-helpers'

describe('formatBytes (SI decimal, like pdf-tts)', () => {
  it('formats whole bytes without a fraction', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
  })

  it('scales with 1000-based steps', () => {
    expect(formatBytes(1000)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.1 GB')
    expect(formatBytes(1.5e12)).toBe('1.5 TB')
  })

  it('trims a trailing .0 on scaled units', () => {
    expect(formatBytes(2000)).toBe('2 KB')
  })

  it('returns an em-dash for invalid input', () => {
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('usagePercent', () => {
  it('returns 0 for zero or invalid totals', () => {
    expect(usagePercent(0, 0)).toBe(0)
    expect(usagePercent(512, 0)).toBe(0)
    expect(usagePercent(Number.NaN, 100)).toBe(0)
  })

  it('computes the ratio', () => {
    expect(usagePercent(512, 1024)).toBe(50)
    expect(usagePercent(256, 1024)).toBe(25)
  })

  it('clamps to [0, 100]', () => {
    expect(usagePercent(200, 100)).toBe(100)
    expect(usagePercent(-5, 100)).toBe(0)
  })
})

describe('formatUptime', () => {
  it('formats compact durations', () => {
    expect(formatUptime(0)).toBe('0s')
    expect(formatUptime(59)).toBe('59s')
    expect(formatUptime(61)).toBe('1m')
    expect(formatUptime(3665)).toBe('1h 1m')
    expect(formatUptime(90061)).toBe('1d 1h')
  })

  it('returns an em-dash for invalid input', () => {
    expect(formatUptime(Number.NaN)).toBe('—')
    expect(formatUptime(-3)).toBe('—')
  })
})

describe('tone thresholds (≥90 red, ≥70 amber, else green)', () => {
  it('usageTone maps ranges to text colors', () => {
    expect(usageTone(50)).toBe('text-green-600')
    expect(usageTone(69.9)).toBe('text-green-600')
    expect(usageTone(70)).toBe('text-amber-600')
    expect(usageTone(89.9)).toBe('text-amber-600')
    expect(usageTone(90)).toBe('text-red-600')
    expect(usageTone(99)).toBe('text-red-600')
  })

  it('barTone maps the same ranges to bar fills', () => {
    expect(barTone(10)).toBe('bg-green-500')
    expect(barTone(75)).toBe('bg-amber-500')
    expect(barTone(95)).toBe('bg-red-500')
  })
})
