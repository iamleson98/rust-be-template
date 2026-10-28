/**
 * Short shared `Cache-Control` on the public, unauthenticated read APIs —
 * port of `middleware/public_cache.rs`.
 *
 * Brands, routes, trips, search, recommendations, stats and places return
 * identical bytes for every caller and are keyed by their full URL, so a
 * 60 s TTL is safe: the browser reuses them on repeat visits, and the
 * booking flow re-validates availability at hold time, so a minute-old trip
 * list can never cause an invalid booking.
 *
 * A caller with a session gets `no-store` instead, so a list refetched
 * after their own mutation can never be answered from a cached copy.
 */
/** Shared TTL (seconds) for anonymous reads of public list/detail APIs. */
export const PUBLIC_CACHE_MAX_AGE_SECS = 60;

/** The auth-session cookies; preference cookies (`bus_lang`) do not count. */
const SESSION_COOKIES = ["access_token", "refresh_token"];

/** Whether the request's `Cookie` header carries a session token (whole cookie names only). */
export function carriesSession(headers: Headers): boolean {
  const jar = headers.get("cookie");
  if (!jar) return false;
  return jar.split(";").some((cookie) => {
    const name = cookie.trim().split("=")[0];
    return SESSION_COOKIES.includes(name);
  });
}

/** `Cache-Control` for a successful public read made with these request headers. */
export function publicCacheControl(headers: Headers): string {
  return carriesSession(headers) ? "no-store" : `public, max-age=${PUBLIC_CACHE_MAX_AGE_SECS}`;
}

/** A 200 JSON response with the public cache policy for `req`. */
export function publicJson(req: Request, body: unknown): Response {
  return Response.json(body, { headers: { "cache-control": publicCacheControl(req.headers) } });
}
