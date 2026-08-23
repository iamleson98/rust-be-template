const AUTH_ENDPOINTS = new Set([
  '/api/auth/employee-login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/register',
]);

const isAuthEndpoint = (request: Request): boolean =>
  AUTH_ENDPOINTS.has(new URL(request.url).pathname);

/**
 * Refresh the cookie session once after an access-token 401, then retry the
 * original request. A shared promise prevents concurrent requests from
 * rotating the same refresh token at the same time.
 *
 * The refresh call uses a RELATIVE URL (`/api/auth/refresh`) so it goes
 * through the Vite proxy in dev (same-origin) or the Rust static server
 * in production (same-origin). Previously it used `new URL('/api/auth/refresh',
 * request.url)` which could produce an absolute URL like
 * `http://127.0.0.1:8080/api/auth/refresh` — cross-origin from the browser's
 * perspective, which caused the SameSite=Lax cookies to NOT be sent.
 */
export const createAuthFetch = (fetchImpl: typeof fetch = globalThis.fetch): typeof fetch => {
  let refreshPromise: Promise<boolean> | undefined;

  const refresh = (): Promise<boolean> => {
    if (!refreshPromise) {
      refreshPromise = fetchImpl('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'include',
      })
        .then((response) => response.ok)
        .catch(() => false)
        .finally(() => {
          refreshPromise = undefined;
        });
    }

    return refreshPromise;
  };

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const retryRequest = request.clone();
    const response = await fetchImpl(request);

    if (response.status !== 401 || isAuthEndpoint(request)) {
      return response;
    }

    if (!(await refresh())) {
      return response;
    }

    return fetchImpl(retryRequest);
  }) as typeof fetch;
};