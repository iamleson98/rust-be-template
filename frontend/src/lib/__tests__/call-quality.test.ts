import { describe, expect, it } from 'vitest'
import {
  classifyQuality,
  hangupReasonText,
  type QualityStats,
} from '../call-quality'

const base: QualityStats = { rttMs: null, jitterMs: null, lossPct: null, relayed: null }

describe('classifyQuality', () => {
  it('classifies a healthy call as good', () => {
    expect(classifyQuality({ ...base, rttMs: 90, jitterMs: 8, lossPct: 0.2 })).toBe('good')
  })

  it('classifies borderline latency/jitter/loss as fair', () => {
    expect(classifyQuality({ ...base, rttMs: 300, jitterMs: 40, lossPct: 4 })).toBe('fair')
  })

  it('classifies heavy loss as poor even with great rtt', () => {
    expect(classifyQuality({ ...base, rttMs: 60, jitterMs: 5, lossPct: 12 })).toBe('poor')
  })

  it('classifies high jitter as poor', () => {
    expect(classifyQuality({ ...base, jitterMs: 80 })).toBe('poor')
  })

  it('unknown metrics never penalize — all-null sample is good', () => {
    expect(classifyQuality({ ...base })).toBe('good')
  })

  it('mixed unknown + bad metric classifies by the known metric only', () => {
    expect(classifyQuality({ ...base, lossPct: 5 })).toBe('fair')
    expect(classifyQuality({ ...base, rttMs: 50 })).toBe('good')
  })

  it('relayed flag does not affect the level', () => {
    expect(classifyQuality({ ...base, relayed: true })).toBe('good')
  })

  it('exactly-at-threshold values stay in the better bucket (<=)', () => {
    expect(classifyQuality({ ...base, rttMs: 250, jitterMs: 30, lossPct: 2 })).toBe('good')
    expect(classifyQuality({ ...base, rttMs: 500, jitterMs: 60, lossPct: 8 })).toBe('fair')
  })

  it('just past thresholds drops a bucket', () => {
    expect(classifyQuality({ ...base, rttMs: 251, jitterMs: 10, lossPct: 0 })).toBe('fair')
    expect(classifyQuality({ ...base, lossPct: 8.1 })).toBe('poor')
  })
})

describe('hangupReasonText', () => {
  it('maps declined per perspective', () => {
    expect(hangupReasonText('declined', false)).toContain('Nhân viên')
    expect(hangupReasonText('declined', true)).toContain('Khách hàng')
  })

  it('maps busy per perspective', () => {
    expect(hangupReasonText('busy', false)).toContain('Nhân viên')
    expect(hangupReasonText('busy', true)).toContain('Khách hàng')
  })

  it('maps mic-denied per perspective', () => {
    expect(hangupReasonText('mic-denied', false)).toContain('nhân viên')
    expect(hangupReasonText('mic-denied', true)).toContain('Khách hàng')
  })

  it('maps timeout/peer-offline/answered-elsewhere neutrally', () => {
    expect(hangupReasonText('timeout', false)).toContain('Không nhấc máy')
    expect(hangupReasonText('peer-offline', true)).toContain('Mất kết nối')
    expect(hangupReasonText('answered-elsewhere', false)).toContain('nơi khác')
  })

  it('falls back to generic text for remote/unknown/null', () => {
    expect(hangupReasonText('remote', false)).toBe('Cuộc gọi đã kết thúc')
    expect(hangupReasonText(undefined, true)).toBe('Cuộc gọi đã kết thúc')
    expect(hangupReasonText('something-new', false)).toBe('Cuộc gọi đã kết thúc')
  })
})
