import { beforeEach, describe, expect, it } from "vitest";
import { resetVpsBreaker, vpsConfigured, vpsGet, VpsUnavailable } from "@/lib/vps";
import { placeCacheControl } from "@/lib/services/place-search";

const env = { VPS_URL: "https://search.example.test/", VPS_SERVICE_TOKEN: "t0ken" };

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      auth: new Headers(init?.headers).get("authorization"),
    });
    return respond();
  }) as typeof fetch;
  return { impl, calls };
}

beforeEach(resetVpsBreaker);

describe("vpsGet", () => {
  it("calls the service with the bearer token and returns its JSON", async () => {
    const { impl, calls } = fakeFetch(() => Response.json({ items: [1] }));
    expect(await vpsGet(env, "/v1/places/search?q=x", { fetchImpl: impl })).toEqual({ items: [1] });
    expect(calls).toEqual([
      { url: "https://search.example.test/v1/places/search?q=x", auth: "Bearer t0ken" },
    ]);
  });

  it("is not configured without both the URL and the token", async () => {
    expect(vpsConfigured({ VPS_URL: env.VPS_URL })).toBe(false);
    await expect(vpsGet({}, "/x")).rejects.toBeInstanceOf(VpsUnavailable);
  });

  it("stops calling for a while after a failure, unless told to", async () => {
    let now = 1_000;
    const failing = fakeFetch(() => new Response("down", { status: 502 }));
    await expect(vpsGet(env, "/x", { fetchImpl: failing.impl, now: () => now })).rejects.toThrow(
      "HTTP 502",
    );

    const healthy = fakeFetch(() => Response.json({ ok: true }));
    await expect(vpsGet(env, "/x", { fetchImpl: healthy.impl, now: () => now })).rejects.toThrow(
      "recently unreachable",
    );
    expect(healthy.calls).toHaveLength(0);
    expect(
      await vpsGet(env, "/x", { fetchImpl: healthy.impl, now: () => now, ignoreBreaker: true }),
    ).toEqual({ ok: true });

    now += 31_000;
    expect(await vpsGet(env, "/x", { fetchImpl: healthy.impl, now: () => now })).toEqual({
      ok: true,
    });
  });
});

describe("placeCacheControl", () => {
  it("keeps a fallback answer briefly", () => {
    expect(placeCacheControl("vps", 300)).toBe("public, max-age=300");
    expect(placeCacheControl("static-shards", 300)).toBe("public, max-age=60");
  });
});
