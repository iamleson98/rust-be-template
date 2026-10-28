import { describe, expect, it } from "vitest";
import headersFile from "../../public/_headers?raw";
import robots from "../../public/robots.txt?raw";
import {
  cachedPublicRead,
  classify,
  enforceIpLimit,
  enforceOrigin,
  ipKey,
  isCacheablePublicRead,
  withSecurityHeaders,
} from "@/lib/edge-guard";

/** A limiter that records its keys and refuses once `limit` calls were made. */
function fakeLimiter(limit: number) {
  const seen: string[] = [];
  const binding = {
    async limit({ key }: { key: string }) {
      seen.push(key);
      return { success: seen.filter((k) => k === key).length <= limit };
    },
  } as RateLimit;
  return { binding, seen };
}

const req = (path: string, init: RequestInit = {}) =>
  new Request(`https://datxevui.com${path}`, init);
const fromIp = (path: string, ip: string, init: RequestInit = {}) =>
  req(path, { ...init, headers: { "cf-connecting-ip": ip, ...(init.headers as object) } });

describe("ipKey", () => {
  it("leaves IPv4 alone", () => expect(ipKey("203.0.113.9")).toBe("203.0.113.9"));

  it("collapses every address in a /64 to one key", () => {
    const a = ipKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(a).toBe("2001:db8:1:2::/64");
    expect(ipKey("2001:db8:1:2::1")).toBe(a);
    expect(ipKey("2001:0DB8:0001:0002:ffff:ffff:ffff:ffff")).toBe(a);
    expect(ipKey("2001:db8:1:3::1")).not.toBe(a);
  });

  it("expands :: inside the network half", () => {
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipKey("::1")).toBe("0:0:0:0::/64");
  });

  it("maps IPv4-mapped IPv6 back to the IPv4 address", () => {
    expect(ipKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ipKey("::ffff:cb00:7109")).toBe("203.0.113.9");
  });

  it("keeps unparseable input as its own key and ignores zone ids", () => {
    expect(ipKey("not:an:ip:::x")).toBe("not:an:ip:::x");
    expect(ipKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });
});

describe("classify", () => {
  it("exempts probes, crawlers and payment webhooks", () => {
    for (const p of [
      "/health",
      "/ready",
      "/api/health",
      "/sitemap.xml",
      "/robots.txt",
      "/api/payments/ipn/vnpay",
      "/api/payments/ipn/momo",
    ]) {
      expect(classify(p, false)).toBeNull();
    }
  });

  it("puts auth, upload and search fan-out in the strict class", () => {
    for (const p of [
      "/api/auth/login",
      "/api/uploads/brand-logo",
      "/api/search",
      "/api/search/geo",
      "/api/vitals",
    ]) {
      expect(classify(p, false)).toBe("strict");
    }
  });

  it("counts other API paths as reads and ignores pages", () => {
    expect(classify("/api/brands", false)).toBe("read");
    expect(classify("/api/bookings/abc", false)).toBe("read");
    expect(classify("/privacy", false)).toBeNull();
  });

  it("counts socket upgrades as strict, but plain GETs of /ws not at all", () => {
    expect(classify("/ws", true)).toBe("strict");
    expect(classify("/ws-call", true)).toBe("strict");
    expect(classify("/ws", false)).toBeNull();
  });
});

describe("enforceIpLimit", () => {
  it("blocks the 3rd request of a bucket of 2 with an honest 429", async () => {
    const { binding } = fakeLimiter(2);
    const env = { IP_READ_LIMITER: binding };
    expect(await enforceIpLimit(fromIp("/api/brands", "198.51.100.1"), env)).toBeNull();
    expect(await enforceIpLimit(fromIp("/api/brands", "198.51.100.1"), env)).toBeNull();
    const res = await enforceIpLimit(fromIp("/api/brands", "198.51.100.1"), env);
    expect(res?.status).toBe(429);
    expect(res?.headers.get("retry-after")).toBe("60");
    expect(res?.headers.get("cache-control")).toBe("no-store");
    expect(await res?.json()).toMatchObject({ error: { code: "rate-limited" } });
  });

  it("keys IPv6 clients on their /64 and uses separate buckets per class", async () => {
    const read = fakeLimiter(100);
    const strict = fakeLimiter(100);
    const env = { IP_READ_LIMITER: read.binding, IP_STRICT_LIMITER: strict.binding };
    await enforceIpLimit(fromIp("/api/brands", "2001:db8:1:2::aaaa"), env);
    await enforceIpLimit(fromIp("/api/brands", "2001:db8:1:2::bbbb"), env);
    await enforceIpLimit(fromIp("/api/auth/login", "2001:db8:1:2::cccc", { method: "POST" }), env);
    expect(read.seen).toEqual(["read:2001:db8:1:2::/64", "read:2001:db8:1:2::/64"]);
    expect(strict.seen).toEqual(["strict:2001:db8:1:2::/64"]);
  });

  it("counts websocket upgrades under their own key", async () => {
    const strict = fakeLimiter(100);
    const env = { IP_STRICT_LIMITER: strict.binding };
    await enforceIpLimit(fromIp("/ws", "198.51.100.7", { headers: { upgrade: "websocket" } }), env);
    expect(strict.seen).toEqual(["ws:198.51.100.7"]);
  });

  it("never consults the limiter for exempt paths", async () => {
    const { binding, seen } = fakeLimiter(0);
    const env = { IP_READ_LIMITER: binding, IP_STRICT_LIMITER: binding };
    for (const p of ["/api/health", "/sitemap.xml", "/api/payments/ipn/zalopay"]) {
      expect(await enforceIpLimit(fromIp(p, "198.51.100.1", { method: "POST" }), env)).toBeNull();
    }
    expect(seen).toEqual([]);
  });

  it("fails open without a binding or without a client IP", async () => {
    expect(await enforceIpLimit(fromIp("/api/brands", "198.51.100.1"), {})).toBeNull();
    const { binding, seen } = fakeLimiter(0);
    expect(await enforceIpLimit(req("/api/brands"), { IP_READ_LIMITER: binding })).toBeNull();
    expect(seen).toEqual([]);
  });
});

describe("enforceOrigin", () => {
  const post = (path: string, headers: Record<string, string> = {}) =>
    req(path, { method: "POST", headers });

  it("rejects a mutation with no or a foreign Origin/Referer", () => {
    expect(enforceOrigin(post("/api/bookings"), {})?.status).toBe(403);
    expect(
      enforceOrigin(post("/api/bookings", { origin: "https://evil.example" }), {})?.status,
    ).toBe(403);
    expect(
      enforceOrigin(post("/api/bookings", { referer: "https://evil.example/x" }), {})?.status,
    ).toBe(403);
  });

  it("accepts a same-site Origin or Referer, and WS_ALLOWED_ORIGINS", () => {
    expect(enforceOrigin(post("/api/bookings", { origin: "https://datxevui.com" }), {})).toBeNull();
    expect(
      enforceOrigin(post("/api/bookings", { referer: "https://datxevui.com/search?x=1" }), {}),
    ).toBeNull();
    const env = { WS_ALLOWED_ORIGINS: "https://app.example.com" };
    expect(
      enforceOrigin(post("/api/bookings", { origin: "https://app.example.com" }), env),
    ).toBeNull();
  });

  it("exempts IPN webhooks, vitals, the cron tick and X-Client: mobile", () => {
    expect(enforceOrigin(post("/api/payments/ipn/vnpay"), {})).toBeNull();
    expect(enforceOrigin(post("/api/vitals"), {})).toBeNull();
    expect(enforceOrigin(post("/api/jobs/tick"), {})).toBeNull();
    expect(enforceOrigin(post("/api/bookings", { "x-client": "Mobile" }), {})).toBeNull();
  });

  it("ignores reads and non-API paths", () => {
    expect(enforceOrigin(req("/api/bookings"), {})).toBeNull();
    expect(enforceOrigin(post("/something"), {})).toBeNull();
  });
});

describe("withSecurityHeaders", () => {
  it("adds the four headers and keeps the body", async () => {
    const res = withSecurityHeaders(Response.json({ ok: true }));
    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=15552000; includeSubDomains",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("does not override a header the route set, and works on immutable responses", () => {
    const res = withSecurityHeaders(
      new Response("x", { headers: { "x-frame-options": "SAMEORIGIN" } }),
    );
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("also covers the limiter's own 429", async () => {
    const { binding } = fakeLimiter(0);
    const blocked = await enforceIpLimit(fromIp("/api/brands", "198.51.100.1"), {
      IP_READ_LIMITER: binding,
    });
    expect(withSecurityHeaders(blocked!).headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("public JSON cache", () => {
  it("only matches GETs of the public lookups", () => {
    expect(isCacheablePublicRead(req("/api/brands"))).toBe(true);
    expect(isCacheablePublicRead(req("/api/stats"))).toBe(true);
    expect(isCacheablePublicRead(req("/api/routes?limit=5"))).toBe(true);
    expect(isCacheablePublicRead(req("/api/reviews/tags"))).toBe(true);
    expect(isCacheablePublicRead(req("/api/recommendations"))).toBe(true);
    expect(isCacheablePublicRead(req("/api/brands", { method: "POST" }))).toBe(false);
    for (const p of [
      "/api/campaigns",
      "/api/auth/me",
      "/api/bookings",
      "/api/trips/abc",
      "/api/brands/x",
    ]) {
      expect(isCacheablePublicRead(req(p))).toBe(false);
    }
  });

  it("never serves or stores a read made with a session (their own writes must show)", () => {
    const withCookie = (cookie: string) =>
      new Request("https://datxevui.com/api/brands", { headers: { cookie } });
    expect(isCacheablePublicRead(withCookie("access_token=abc"))).toBe(false);
    expect(isCacheablePublicRead(withCookie("bus_lang=vi; refresh_token=abc"))).toBe(false);
    expect(isCacheablePublicRead(withCookie("bus_lang=vi"))).toBe(true);
  });

  it("serves the second read from the cache and tags it with Cache-Control", async () => {
    const ctx = {
      pending: [] as Promise<unknown>[],
      waitUntil(p: Promise<unknown>) {
        this.pending.push(p);
      },
    };
    let origin = 0;
    const fill = async () => Response.json({ n: ++origin });
    const request = req(`/api/stats?t=${crypto.randomUUID()}`);

    const first = await cachedPublicRead(request, ctx, fill);
    expect(first.headers.get("cache-control")).toBe(
      "public, s-maxage=30, stale-while-revalidate=120",
    );
    await Promise.all(ctx.pending);

    const second = await cachedPublicRead(request, ctx, fill);
    expect(await second.json()).toEqual({ n: 1 });
    expect(origin).toBe(1);
  });

  it("does not store errors or cookie-setting responses", async () => {
    const ctx = {
      pending: [] as Promise<unknown>[],
      waitUntil(p: Promise<unknown>) {
        this.pending.push(p);
      },
    };
    let origin = 0;
    const request = req(`/api/brands?t=${crypto.randomUUID()}`);
    const failing = async () => {
      origin++;
      return new Response("boom", { status: 500 });
    };
    const cookie = async () => {
      origin++;
      return new Response("{}", { headers: { "set-cookie": "a=b" } });
    };
    await cachedPublicRead(request, ctx, failing);
    await cachedPublicRead(request, ctx, cookie);
    await Promise.all(ctx.pending);
    await cachedPublicRead(request, ctx, failing);
    expect(origin).toBe(3);
  });
});

describe("static files", () => {
  it("_headers carries the security headers, asset caching and a no-cache sw.js", () => {
    expect(headersFile).toMatch(/\/\*\n(?:[ \t]+[^\n]+\n)*[ \t]+X-Frame-Options: DENY/);
    expect(headersFile).toContain("Strict-Transport-Security");
    expect(headersFile).toContain("X-Content-Type-Options: nosniff");
    expect(headersFile).toContain("Referrer-Policy: strict-origin-when-cross-origin");
    expect(headersFile).toMatch(
      /\/fonts\/\*\n\s+Cache-Control: public,max-age=86400,stale-while-revalidate=604800/,
    );
    expect(headersFile).toMatch(/\/sw\.js\n\s+Cache-Control: no-cache/);
    expect(headersFile).toMatch(
      /\/_next\/static\/\*\n\s+Cache-Control: public,max-age=31536000,immutable/,
    );
  });

  it("robots.txt hides private areas and points at the sitemap", () => {
    for (const d of ["/api/", "/admin/", "/bookings/", "/payments/"]) {
      expect(robots).toContain(`Disallow: ${d}`);
    }
    expect(robots).toContain("Sitemap: https://datxevui.com/sitemap.xml");
  });
});
