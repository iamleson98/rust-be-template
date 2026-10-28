import { describe, expect, it } from "vitest";
import { carriesSession, publicCacheControl, publicJson } from "@/lib/public-cache";

/** Port of the unit tests of `middleware/public_cache.rs`. */

const headers = (cookie?: string) => new Headers(cookie ? { cookie } : {});
const control = (cookie?: string) => publicCacheControl(headers(cookie));

describe("public Cache-Control", () => {
  it("gives anonymous callers the shared 60 s cache", () => {
    expect(control()).toBe("public, max-age=60");
  });

  it("does not count a preference cookie as a session", () => {
    expect(control("bus_lang=vi")).toBe("public, max-age=60");
  });

  it("answers no-store once a session cookie rides along", () => {
    for (const jar of [
      "access_token=eyJ...",
      "refresh_token=xyz",
      "bus_lang=vi; access_token=eyJ...; other=1",
      "x=1; refresh_token=xyz",
    ])
      expect(control(jar), jar).toBe("no-store");
  });

  it("does not take a longer cookie name for a session", () => {
    expect(carriesSession(headers("my_access_token=1"))).toBe(false);
    expect(carriesSession(headers("access_token_old=1"))).toBe(false);
  });

  it("stamps a JSON response", async () => {
    const res = publicJson(new Request("https://x.test/api/brands"), { items: [] });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(await res.json()).toEqual({ items: [] });
  });
});
