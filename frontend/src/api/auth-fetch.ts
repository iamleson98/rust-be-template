const AUTH_ENDPOINTS = new Set([
  '/api/auth/employee-login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/register',
])

const isAuthEndpoint = (request: Request) => AUTH_ENDPOINTS.has(new URL(request.url).pathname)

function acceptLanguage() {
  const lang =
    typeof window === 'undefined'
      ? 'vi'
      : (document.cookie.match(/bus_lang=(vi|en)/)?.[1] ?? localStorage.getItem('bus_lang'))
  return lang === 'en' ? 'en-US,en;q=0.9' : 'vi-VN,vi;q=0.9'
}

/**
 * `fetch` for the SDK: adds `Accept-Language`, and on a 401 refreshes the
 * cookie session once (shared across concurrent requests) and retries.
 * The refresh URL is relative so it stays same-origin and SameSite cookies
 * are sent.
 */
export const createAuthFetch = (fetchImpl: typeof fetch = globalThis.fetch): typeof fetch => {
  let refreshing: Promise<boolean> | undefined

  const refresh = () =>
    (refreshing ??= fetchImpl('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': acceptLanguage() },
      body: '{}',
      credentials: 'include',
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = undefined
      }))

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    // The SDK passes a Request as `input`: copy its headers, because a
    // `headers` entry in `init` would replace them (dropping Content-Type → 415).
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
    if (!headers.has('Accept-Language')) headers.set('Accept-Language', acceptLanguage())

    const request = new Request(input, { ...init, headers })
    const retry = request.clone()
    const response = await fetchImpl(request)

    if (response.status !== 401 || isAuthEndpoint(request) || !(await refresh())) return response
    return fetchImpl(retry)
  }) as typeof fetch
}
