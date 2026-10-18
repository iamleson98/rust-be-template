import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheFirst,
  cacheInvalidate,
  cacheInvalidatePrefix,
  clearMemoryCache,
} from "@/lib/db/cache";
import { setCloudflareContext } from "../helpers/context";

// Unique key prefix per run so the shared (real) KV namespace never
// collides with other runs.
const RUN = `t${Date.now().toString(36)}:`;

beforeEach(() => {
  // Default: real KV binding attached (both tiers active).
  setCloudflareContext();
});

afterAll(async () => {
  await cacheInvalidatePrefix(`cache-test:${RUN}`);
});

describe("cacheFirst (L1 memory + L2 KV)", () => {
  it("calls the loader once per key across repeated lookups", async () => {
    clearMemoryCache();
    const loader = vi.fn(async () => ({ v: 1 }));
    const first = await cacheFirst(`cache-test:${RUN}a`, loader, { ttlMs: 60_000 });
    const second = await cacheFirst(`cache-test:${RUN}a`, loader, { ttlMs: 60_000 });
    expect(first).toEqual({ v: 1 });
    expect(second).toEqual({ v: 1 });
    expect(loader).toHaveBeenCalledTimes(1); // L1 hit on the second call
  });

  it("falls back to the KV tier after the memory tier is wiped", async () => {
    clearMemoryCache();
    const loader = vi.fn(async () => ({ v: 2 }));
    await cacheFirst(`cache-test:${RUN}b`, loader, { ttlMs: 60_000, kvTtlSecs: 60 });
    clearMemoryCache(); // simulate isolate eviction — L1 gone, L2 warm
    const again = await cacheFirst(`cache-test:${RUN}b`, loader, { ttlMs: 60_000, kvTtlSecs: 60 });
    expect(again).toEqual({ v: 2 });
    expect(loader).toHaveBeenCalledTimes(1); // served from KV
  });

  it("serves the KV tier after L1 goes stale — the loader is NOT re-run", async () => {
    clearMemoryCache();
    const loader = vi.fn(async () => ({ v: 3 }));
    await cacheFirst(`cache-test:${RUN}c`, loader, { ttlMs: 10, kvTtlSecs: 60 });
    await new Promise((r) => setTimeout(r, 25)); // let L1 go stale
    const again = await cacheFirst(`cache-test:${RUN}c`, loader, { ttlMs: 10, kvTtlSecs: 60 });
    expect(again).toEqual({ v: 3 });
    expect(loader).toHaveBeenCalledTimes(1); // KV still warm
  });

  it("re-runs the loader after the L1 TTL expires when no KV tier exists", async () => {
    setCloudflareContext({ CACHE_KV: undefined }); // memory-only deployment
    clearMemoryCache();
    const loader = vi.fn(async () => ({ v: 3 }));
    await cacheFirst(`cache-test:${RUN}c-mem`, loader, { ttlMs: 10 });
    await new Promise((r) => setTimeout(r, 25));
    await cacheFirst(`cache-test:${RUN}c-mem`, loader, { ttlMs: 10 });
    expect(loader).toHaveBeenCalledTimes(2);
    setCloudflareContext();
  });

  it("cacheInvalidate drops the key from both tiers", async () => {
    clearMemoryCache();
    const loader = vi.fn(async () => ({ v: 4 }));
    const key = `cache-test:${RUN}d`;
    await cacheFirst(key, loader, { ttlMs: 60_000, kvTtlSecs: 60 });
    await cacheInvalidate(key);
    clearMemoryCache(); // force the read path through KV
    await cacheFirst(key, loader, { ttlMs: 60_000, kvTtlSecs: 60 });
    expect(loader).toHaveBeenCalledTimes(2); // both tiers were empty
  });

  it("cacheInvalidatePrefix clears a namespace, not everything", async () => {
    clearMemoryCache();
    const a = vi.fn(async () => "A");
    const b = vi.fn(async () => "B");
    await cacheFirst(`cache-test:${RUN}keep`, a, { ttlMs: 60_000 });
    await cacheFirst(`cache-test:${RUN}gone1`, b, { ttlMs: 60_000 });
    await cacheFirst(`cache-test:${RUN}gone2`, b, { ttlMs: 60_000 });
    await cacheInvalidatePrefix(`cache-test:${RUN}gone`);
    clearMemoryCache();
    await cacheFirst(`cache-test:${RUN}keep`, a, { ttlMs: 60_000 });
    await cacheFirst(`cache-test:${RUN}gone1`, b, { ttlMs: 60_000 });
    expect(a).toHaveBeenCalledTimes(1); // survived
    expect(b).toHaveBeenCalledTimes(3); // both dropped keys reloaded
  });
});
