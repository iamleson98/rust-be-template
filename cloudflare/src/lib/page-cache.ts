/**
 * Page HTML from the colo's Cache API. A page's HTML is the same for every
 * visitor: the SPA renders their own view in the browser, and the head
 * depends only on the path and the page's canonical parameters
 * (`@spa/lib/seo`). So a page costs one Next.js render per colo every
 * `PAGE_CACHE_SECS`, not one per visit (each render is 250–750 ms before
 * the first byte, and CPU time the Free plan counts).
 *
 * Each deploy has its own entries: a page's HTML names the script files of
 * the build that rendered it, and an older build's files are gone.
 */
import { CANONICAL_PARAMS } from "@spa/lib/seo";

export const PAGE_CACHE_SECS = 600;

/** A browser's request for a page (not an API, a file, a socket or a Next.js data fetch). */
export function isCacheablePage(request: Request): boolean {
  if (request.method !== "GET") return false;
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/")) return false;
  if (pathname === "/ws" || pathname === "/ws-call") return false;
  // Files, including generated ones (sitemap.xml, robots.txt).
  if (/\.[a-z0-9]+$/i.test(pathname)) return false;
  const h = request.headers;
  // Next.js's own client fetches (RSC payloads, server actions) vary by these.
  if (h.has("rsc") || h.has("next-router-prefetch") || h.has("next-action")) return false;
  return (h.get("accept") ?? "").includes("text/html");
}

/** The entry of `request`'s page in deploy `version`: the path and its canonical parameters. */
export function pageCacheKey(request: Request, version: string): string {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  for (const name of CANONICAL_PARAMS[url.pathname] ?? []) {
    const value = url.searchParams.get(name);
    if (value !== null) params.set(name, value);
  }
  params.set("__v", version);
  return `${url.origin}${url.pathname}?${params}`;
}

/**
 * Serves the page from the cache, filling it on a miss. Only HTML answers
 * (200, or the 404 of a path no page has) are stored, never one that sets a
 * cookie. Browsers revalidate every visit (`no-cache`, which unlike
 * `no-store` keeps the back/forward cache working), so a deploy reaches
 * them at once.
 */
export async function cachedPage(
  request: Request,
  version: string,
  ctx: Pick<ExecutionContext, "waitUntil">,
  origin: () => Promise<Response>,
): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(pageCacheKey(request, version), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return forBrowser(hit, "HIT");
  const res = await origin();
  const html = (res.headers.get("content-type") ?? "").startsWith("text/html");
  if ((res.status !== 200 && res.status !== 404) || !html || res.headers.has("set-cookie")) {
    return res;
  }
  const stored = new Response(res.body, res);
  stored.headers.set("cache-control", `public, max-age=${PAGE_CACHE_SECS}`);
  // The key already separates what varies; Next.js's `Vary` would only split it further.
  stored.headers.delete("vary");
  ctx.waitUntil(cache.put(key, stored.clone()));
  return forBrowser(stored, "MISS");
}

function forBrowser(res: Response, state: "HIT" | "MISS"): Response {
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "no-cache");
  out.headers.set("x-page-cache", state);
  return out;
}
