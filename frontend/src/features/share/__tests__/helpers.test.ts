import { describe, expect, it } from 'vitest'
import { buildShareUrl } from '../helpers'

describe('buildShareUrl', () => {
  it('links to the real trip route on this origin', () => {
    expect(buildShareUrl('abc-123').url).toBe(`${window.location.origin}/trips/abc-123`)
  })

  it('escapes the trip id in the path', () => {
    expect(buildShareUrl('a/b c').url.endsWith('/trips/a%2Fb%20c')).toBe(true)
  })

  it('derives a stable short display code that is never part of the URL', () => {
    const first = buildShareUrl('trip-1')
    expect(buildShareUrl('trip-1').code).toBe(first.code)
    expect(first.code).toMatch(/^PT-[A-HJ-NP-Z2-9]{6}$/)
    expect(first.url).not.toContain(first.code)
    expect(buildShareUrl('trip-2').code).not.toBe(first.code)
  })
})
