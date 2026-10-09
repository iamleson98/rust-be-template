import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dayBreak, messageTime } from '../format'

const t = (key: string) => key

describe('messageTime', () => {
  it('formats hours and minutes, 24h', () => {
    expect(messageTime(new Date(2026, 9, 9, 8, 5).toISOString())).toBe('08:05')
    expect(messageTime(new Date(2026, 9, 9, 21, 30).toISOString())).toBe('21:30')
  })

  it('is empty for an invalid date', () => {
    expect(messageTime('not a date')).toBe('')
  })
})

describe('dayBreak', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 9, 12))
  })
  afterEach(() => vi.useRealTimers())

  const at = (day: number, hour = 9) => new Date(2026, 9, day, hour).toISOString()

  it('marks the first message of the list', () => {
    expect(dayBreak(undefined, at(9), t)).toBe('adminChat.today')
  })

  it('names today, yesterday, then the date', () => {
    expect(dayBreak(at(7), at(9), t)).toBe('adminChat.today')
    expect(dayBreak(at(7), at(8), t)).toBe('adminChat.yesterday')
    expect(dayBreak(at(1), at(2), t)).toBe('02/10/2026')
  })

  it('is null between messages of the same day', () => {
    expect(dayBreak(at(9, 8), at(9, 11), t)).toBeNull()
  })

  it('is null for a message without a timestamp', () => {
    expect(dayBreak(at(8), '', t)).toBeNull()
  })
})
