/**
 * Edge guard: the checks that run in `custom-worker.ts` BEFORE Next.js, so a
 * rejected request never pays for a render, a D1 read or a KV operation.
 *
 *  - per-IP rate limiting (Workers Rate Limiting bindings, two classes)
 *  - Origin/Referer check on mutations (Rust `middleware/anti_scraping.rs`)
 *  - security headers on dynamic responses (Rust `routes/router.rs`)
 *  - Cache API for the public JSON reads
 *
 * Everything here is a pure function of the request/env so it can be tested in
 * workerd without the generated OpenNext bundle. Limiting fails open: with no
 * binding (tests, `next dev`) or no `CF-Connecting-IP` nothing is limited.
 */
import { errorResponse } from "@/lib/error-envelope";
import { originAllowed } from "@/lib/realtime/ws-auth";
import { carriesSession } from "@/lib/public-cache";

export type LimitClass = "read" | "strict";

export interface GuardEnv {
  /** Generous per-IP bucket (Rust parity: 600 requests/min). */
  IP_READ_LIMITER?: RateLimit;
  /** Strict per-IP bucket: auth, uploads, search fan-out, socket upgrades. */
  IP_STRICT_LIMITER?: RateLimit;
  WS_ALLOWED_ORIGINS?: string;
}

/** Window the bindings are configured with (wrangler.jsonc `period`). */
export const LIMIT_PERIOD_SECS = 60;

/** Paths no limiter or origin check ever blocks (uptime probes, crawlers, gateways). */
export function isExempt(pathname: string): boolean {
  return (
    pathname === "/health" ||
    pathname === "/ready" ||
    pathname === "/api/health" ||
    pathname === "/sitemap.xml" ||
    pathname === "/robots.txt" ||
    pathname.startsWith("/api/payments/ipn/") ||
    // Chat-bot platforms call with a signature, not a browser Origin.
    pathname.startsWith("/api/webhooks/")
  );
}

/** Anonymous or expensive endpoints: guessing, uploads, D1 fan-out. */
const STRICT_PREFIXES = [
  "/api/auth/",
  "/api/uploads/",
  "/api/search",
  "/api/recommendations",
  "/api/vitals",
  "/api/ads/",
];

/**
 * Which bucket a request counts against, or `null` when it is not limited.
 * Only `/api/*` and the two socket upgrades are limited; page views and static
 * assets are not (assets never reach the Worker at all).
 */
export function classify(pathname: string, isUpgrade: boolean): LimitClass | null {
  if (isExempt(pathname)) return null;
  if (isUpgrade && (pathname === "/ws" || pathname === "/ws-call")) return "strict";
  if (!pathname.startsWith("/api/")) return null;
  return STRICT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p)) ? "strict" : "read";
}

/** Expand an IPv6 literal to its eight 16-bit groups; `null` when malformed. */
function ipv6Groups(ip: string): number[] | null {
  const addr = ip.split("%")[0]; // zone id
  let head = addr;
  let tail = "";
  const gap = addr.indexOf("::");
  if (gap !== -1) {
    head = addr.slice(0, gap);
    tail = addr.slice(gap + 2);
    if (tail.includes("::")) return null;
  }
  const parse = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    const parts = s.split(":");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1 && part.includes(".")) {
        const v4 = part.split(".").map(Number);
        if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
          return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else if (/^[0-9a-f]{1,4}$/i.test(part)) {
        out.push(parseInt(part, 16));
      } else {
        return null;
      }
    }
    return out;
  };
  const h = parse(head);
  const t = parse(tail);
  if (!h || !t) return null;
  if (gap === -1) return h.length === 8 ? h : null;
  const fill = 8 - h.length - t.length;
  if (fill < 1) return null;
  return [...h, ...new Array<number>(fill).fill(0), ...t];
}

/**
 * The identity a client is limited as. IPv4 is itself; IPv6 collapses to its
 * /64 (one subscriber owns a whole /64, so per-address keys are trivially
 * bypassed); IPv4-mapped IPv6 is the IPv4 address. Unparseable input is
 * returned as-is rather than dropped, so it still gets a (single) bucket.
 */
export function ipKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const g = ipv6Groups(ip.trim());
  if (!g) return ip;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  }
  return `${g
    .slice(0, 4)
    .map((n) => n.toString(16))
    .join(":")}::/64`;
}

/** 429 for a limited client, in the app's standard error envelope. */
export function tooManyRequests(): Response {
  return errorResponse(429, "too_many_requests", "please slow down and try again shortly", {
    retryAfter: LIMIT_PERIOD_SECS,
    headers: { "cache-control": "no-store" },
  });
}

/** Applies the per-IP limit; returns a 429 to send, or `null` to carry on. */
export async function enforceIpLimit(request: Request, env: GuardEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const isUpgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";
  const cls = classify(url.pathname, isUpgrade);
  if (!cls) return null;
  const binding = cls === "strict" ? env.IP_STRICT_LIMITER : env.IP_READ_LIMITER;
  const ip = request.headers.get("cf-connecting-ip");
  if (!binding || !ip) return null;
  // Socket upgrades keep their own key so a long-lived session does not eat
  // the HTTP allowance of the same address (and vice versa).
  const key = `${isUpgrade ? "ws" : cls}:${ipKey(ip)}`;
  const { success } = await binding.limit({ key });
  return success ? null : tooManyRequests();
}

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Cross-site request defence for cookie-authenticated API mutations (Rust
 * `anti_scraping.rs`): a browser always sends Origin or Referer, a cross-site
 * form or a script does not match this deployment. Exempt: payment gateway
 * webhooks, the vitals beacon, the token-authenticated cron tick and native
 * clients that identify themselves with `X-Client: mobile`.
 */
export function enforceOrigin(request: Request, env: GuardEnv): Response | null {
  if (!MUTATIONS.has(request.method)) return null;
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/")) return null;
  if (isExempt(path) || path === "/api/vitals" || path === "/api/jobs/tick") return null;
  if (request.headers.get("x-client")?.trim().toLowerCase() === "mobile") return null;

  const source = request.headers.get("origin") ?? request.headers.get("referer");
  if (source && originAllowed(source, url, env.WS_ALLOWED_ORIGINS)) return null;
  return errorResponse(403, "forbidden", "Access denied: invalid request origin.", {
    headers: { "cache-control": "no-store" },
  });
}

/** Same values as the Rust build (`routes/router.rs`), also in `public/_headers`. */
const SECURITY_HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=15552000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

/** Adds the security headers a response does not already set itself. */
export function withSecurityHeaders(response: Response): Response {
  // A socket handshake carries its webSocket on the Response; rebuilding it would drop it.
  if (response.status === 101 || (response as Response & { webSocket?: unknown }).webSocket) {
    return response;
  }
  const missing = Object.keys(SECURITY_HEADERS).filter((h) => !response.headers.has(h));
  if (missing.length === 0) return response;
  const out = new Response(response.body, response);
  for (const h of missing) out.headers.set(h, SECURITY_HEADERS[h]);
  return out;
}

/** Public, user-independent JSON reads served from the colo's Cache API. */
const CACHEABLE_PATHS = new Set([
  "/api/brands",
  "/api/stats",
  "/api/routes",
  "/api/recommendations",
  "/api/reviews/tags",
]);
export const PUBLIC_JSON_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=120";

export function isCacheablePublicRead(request: Request): boolean {
  return (
    request.method === "GET" &&
    CACHEABLE_PATHS.has(new URL(request.url).pathname) &&
    // A signed-in caller always reads fresh: their own writes must show on the next fetch.
    !carriesSession(request.headers)
  );
}

/**
 * Serves a public JSON GET from the Cache API, filling it on a miss. A hit
 * costs no D1 read and no KV operation. Only clean 200s are stored; anything
 * that sets a cookie is never shared.
 */
export async function cachedPublicRead(
  request: Request,
  ctx: Pick<ExecutionContext, "waitUntil">,
  origin: () => Promise<Response>,
): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(request.url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await origin();
  if (res.status !== 200 || res.headers.has("set-cookie")) return res;
  const out = new Response(res.body, res);
  if (!out.headers.has("cache-control"))
    out.headers.set("cache-control", PUBLIC_JSON_CACHE_CONTROL);
  ctx.waitUntil(cache.put(key, out.clone()));
  return out;
}
