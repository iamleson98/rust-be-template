/**
 * Tests for the createAuthFetch utility.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAuthFetch } from '@/lib/auth-fetch'

describe('createAuthFetch', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn() as any
  })

  it('passes through non-401 responses', async () => {
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }))
    const authFetch = createAuthFetch(mockFetch as any)

    const request = new Request('https://example.com/api/test')
    const response = await authFetch(request)

    expect(response.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('returns the original response for auth endpoints (no retry)', async () => {
    mockFetch.mockResolvedValue(new Response('unauthorized', { status: 401 }))
    const authFetch = createAuthFetch(mockFetch as any)

    const request = new Request('https://example.com/api/auth/login', {
      method: 'POST',
    })
    const response = await authFetch(request)

    expect(response.status).toBe(401)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('attempts refresh + retry on 401 for non-auth endpoints', async () => {
    // First call returns 401, refresh returns 200, retry returns 200
    mockFetch
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 })) // refresh
      .mockResolvedValueOnce(new Response('ok', { status: 200 })) // retry

    const authFetch = createAuthFetch(mockFetch as any)

    const request = new Request('https://example.com/api/bookings')
    const response = await authFetch(request)

    expect(response.status).toBe(200)
    // 3 calls: original + refresh + retry
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('returns 401 if refresh fails', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('refresh failed', { status: 401 })) // refresh fails

    const authFetch = createAuthFetch(mockFetch as any)

    const request = new Request('https://example.com/api/bookings')
    const response = await authFetch(request)

    expect(response.status).toBe(401)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent refresh requests', async () => {
    // Two concurrent 401s should trigger only ONE refresh
    mockFetch
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 })) // single refresh
      .mockResolvedValueOnce(new Response('ok', { status: 200 })) // retry 1
      .mockResolvedValueOnce(new Response('ok', { status: 200 })) // retry 2

    const authFetch = createAuthFetch(mockFetch as any)

    const [r1, r2] = await Promise.all([
      authFetch(new Request('https://example.com/api/bookings')),
      authFetch(new Request('https://example.com/api/notifications')),
    ])

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    // 5 calls: 2 originals + 1 refresh + 2 retries
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })
})
