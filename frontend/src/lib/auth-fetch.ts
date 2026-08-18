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
 */
export const createAuthFetch = (fetchImpl: typeof fetch = globalThis.fetch): typeof fetch => {
  let refreshPromise: Promise<boolean> | undefined;

  const refresh = (request: Request): Promise<boolean> => {
    if (!refreshPromise) {
      refreshPromise = fetchImpl(new URL('/api/auth/refresh', request.url), {
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

    if (!(await refresh(request))) {
      return response;
    }

    return fetchImpl(retryRequest);
  }) as typeof fetch;
};