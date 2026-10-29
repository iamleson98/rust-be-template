import { describe, expect, it } from "vitest";
import { cachedPage, isCacheablePage, pageCacheKey } from "@/lib/page-cache";

const page = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://datxevui.com${path}`, {
    headers: { accept: "text/html,application/xhtml+xml", ...headers },
  });

const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, {
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...init.headers },
  });

function waitingCtx() {
  return {
    pending: [] as Promise<unknown>[],
    waitUntil(p: Promise<unknown>) {
      this.pending.push(p);
    },
  };
}

describe("page cache", () => {
  it("only takes browser page requests", () => {
    expect(isCacheablePage(page("/"))).toBe(true);
    expect(isCacheablePage(page("/brands/phuong-trang"))).toBe(true);
    expect(isCacheablePage(page("/search?from=a&to=b"))).toBe(true);
    for (const path of ["/api/brands", "/_next/static/x.js", "/sitemap.xml", "/logo.svg", "/ws"]) {
      expect(isCacheablePage(page(path))).toBe(false);
    }
    expect(isCacheablePage(page("/", { rsc: "1" }))).toBe(false);
    expect(isCacheablePage(page("/", { accept: "application/json" }))).toBe(false);
    expect(isCacheablePage(new Request("https://datxevui.com/", { method: "POST" }))).toBe(false);
  });

  it("keys a page by path, canonical parameters and deploy", () => {
    const key = (path: string, version = "v1") => pageCacheKey(page(path), version);
    expect(key("/search?from=A&to=B&date=2026-10-30&sort=price")).toBe(
      key("/search?to=B&from=A&date=2026-11-02"),
    );
    expect(key("/search?from=A&to=B")).not.toBe(key("/search?from=A&to=C"));
    expect(key("/brands/x?utm_source=zalo")).toBe(key("/brands/x"));
    expect(key("/")).not.toBe(key("/", "v2"));
  });

  it("serves the second visit from the cache, revalidated by the browser", async () => {
    const ctx = waitingCtx();
    const version = crypto.randomUUID();
    let renders = 0;
    const render = async () => html(`<p>${++renders}</p>`, { headers: { vary: "rsc" } });

    const first = await cachedPage(page("/search?from=A&to=B&date=1"), version, ctx, render);
    expect(first.headers.get("x-page-cache")).toBe("MISS");
    expect(first.headers.get("cache-control")).toBe("no-cache");
    await Promise.all(ctx.pending);

    const second = await cachedPage(page("/search?from=A&to=B&date=2"), version, ctx, render);
    expect(second.headers.get("x-page-cache")).toBe("HIT");
    expect(await second.text()).toBe("<p>1</p>");
    expect(renders).toBe(1);
  });

  it("keeps 404 pages, never errors, cookies or non-HTML answers", async () => {
    const ctx = waitingCtx();
    const version = crypto.randomUUID();
    let renders = 0;
    const answers: Array<() => Response> = [
      () => html("boom", { status: 500 }),
      () => html("<p>hi</p>", { headers: { "set-cookie": "a=b" } }),
      () => Response.json({ status: "ok" }),
    ];
    for (const answer of answers) {
      const path = `/p-${crypto.randomUUID()}`;
      const fill = async () => {
        renders++;
        return answer();
      };
      await cachedPage(page(path), version, ctx, fill);
      await Promise.all(ctx.pending);
      await cachedPage(page(path), version, ctx, fill);
    }
    expect(renders).toBe(6);

    const missing = `/nope-${crypto.randomUUID()}`;
    let notFound = 0;
    const gone = async () => {
      notFound++;
      return html("<p>404</p>", { status: 404 });
    };
    await cachedPage(page(missing), version, ctx, gone);
    await Promise.all(ctx.pending);
    const again = await cachedPage(page(missing), version, ctx, gone);
    expect(again.status).toBe(404);
    expect(notFound).toBe(1);
  });
});
