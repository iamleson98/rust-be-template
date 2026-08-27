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

  // ── Header preservation regression tests ───────────────────────
  //
  // The openapi-ts generated client (`@hey-api/client-fetch`) sometimes
  // passes a `Request` object as `input` with `init = undefined` (the
  // path used after `beforeRequest` builds a `new Request(url, requestInit)`).
  // Earlier versions of `injectAcceptLanguage` constructed a fresh
  // `Headers` from `init?.headers` only — which silently dropped
  // `Content-Type: application/json` from the input `Request`, causing
  // axum's `Json<T>` extractor to return **415 Unsupported Media Type**
  // on every POST/PUT/PATCH in the app.
  //
  // These tests lock the current behavior: whatever headers the input
  // `Request` already has must survive the `Accept-Language` injection.

  it('preserves Content-Type when input is a Request and init is undefined', async () => {
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }))
    const authFetch = createAuthFetch(mockFetch as any)

    // Mirrors what the SDK sends for a POST with a JSON body:
    //   new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body })
    const request = new Request('https://example.com/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"tripId":"abc"}',
    })
    await authFetch(request)

    const sent = mockFetch.mock.calls[0][0] as Request
    expect(sent.headers.get('content-type')).toBe('application/json')
    // Accept-Language is always injected (defaults to vi-VN when no
    // bus_lang cookie / localStorage is set).
    expect(sent.headers.get('accept-language')).toMatch(/vi-VN|en-US/)
  })

  it('does not overwrite an explicitly set Accept-Language', async () => {
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }))
    const authFetch = createAuthFetch(mockFetch as any)

    const request = new Request('https://example.com/api/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      body: '{"x":1}',
    })
    await authFetch(request)

    const sent = mockFetch.mock.calls[0][0] as Request
    expect(sent.headers.get('content-type')).toBe('application/json')
    expect(sent.headers.get('accept-language')).toBe('zh-CN,zh;q=0.9')
  })

  it('preserves Content-Type + body through the 401 retry path', async () => {
    // First call: 401. Refresh: 200. Retry: 200.
    // The retried request must STILL carry Content-Type + the original
    // body bytes — otherwise the retried POST would also 415.
    mockFetch
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 })) // refresh
      .mockResolvedValueOnce(new Response('created', { status: 201 })) // retry

    const authFetch = createAuthFetch(mockFetch as any)

    const request = new Request('https://example.com/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"tripId":"abc"}',
    })
    const response = await authFetch(request)
    expect(response.status).toBe(201)

    // Original attempt
    const firstSent = mockFetch.mock.calls[0][0] as Request
    expect(firstSent.headers.get('content-type')).toBe('application/json')
    expect(await firstSent.clone().text()).toBe('{"tripId":"abc"}')

    // Retried attempt — must have the same Content-Type + body
    const retrySent = mockFetch.mock.calls[2][0] as Request
    expect(retrySent.headers.get('content-type')).toBe('application/json')
    expect(retrySent.headers.get('accept-language')).toMatch(/vi-VN|en-US/)
    expect(await retrySent.clone().text()).toBe('{"tripId":"abc"}')
  })
})
