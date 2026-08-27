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
 *
 * ## Accept-Language injection
 *
 * Every request gets an `Accept-Language` header derived from the
 * `bus_lang` cookie (or localStorage fallback). This lets the backend
 * localize error messages in the future. The backend currently
 * ignores this header, but adding it now is forward-compatible.
 */

const AUTH_ENDPOINTS = new Set([
  '/api/auth/employee-login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/register',
]);

const isAuthEndpoint = (request: Request): boolean =>
  AUTH_ENDPOINTS.has(new URL(request.url).pathname);

export const createAuthFetch = (fetchImpl: typeof fetch = globalThis.fetch): typeof fetch => {
  let refreshPromise: Promise<boolean> | undefined;

  /** Read the user's language preference from cookie or localStorage. */
  const getLang = (): string => {
    if (typeof window === 'undefined') return 'vi';
    const cookieMatch = document.cookie.match(/bus_lang=(vi|en)/);
    if (cookieMatch) return cookieMatch[1];
    return localStorage.getItem('bus_lang') === 'en' ? 'en' : 'vi';
  };

  /**
   * Inject `Accept-Language` into the request headers WITHOUT losing
   * existing headers.
   *
   * CRITICAL: the SDK (@hey-api/client) passes a `Request` object as
   * `input` (with `init = undefined`). If we do `new Request(input, { headers: ... })`,
   * the second argument's `headers` REPLACES all headers from `input` —
   * including `Content-Type: application/json`. This caused 415 Unsupported
   * Media Type on all POST endpoints.
   *
   * The fix: when `input` is a Request, copy its existing headers into the
   * new Headers object BEFORE adding Accept-Language. This preserves
   * Content-Type, Authorization, etc.
   */
  const injectAcceptLanguage = (input: RequestInfo | URL, init?: RequestInit): RequestInit => {
    const lang = getLang();
    // Extract existing headers from either:
    // 1. The Request object (when the SDK passes one as `input`)
    // 2. The init.headers (for direct fetch calls)
    const baseHeaders = input instanceof Request ? input.headers : init?.headers;
    const headers = new Headers(baseHeaders);
    // Don't override an explicitly-set Accept-Language.
    if (!headers.has('Accept-Language')) {
      headers.set('Accept-Language', lang === 'en' ? 'en-US,en;q=0.9' : 'vi-VN,vi;q=0.9');
    }
    return { ...init, headers };
  };

  const refresh = (): Promise<boolean> => {
    if (!refreshPromise) {
      refreshPromise = fetchImpl('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': getLang() === 'en' ? 'en-US,en;q=0.9' : 'vi-VN,vi;q=0.9' },
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
    // Build the request with Accept-Language injected, preserving existing headers.
    const request = new Request(input, injectAcceptLanguage(input, init));
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
