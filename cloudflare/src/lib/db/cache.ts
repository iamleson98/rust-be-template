/**
 * Two-tier cache for store lookups — the Workers port of the Rust app's
 * in-process `moka` read cache.
 *
 * L1 — per-isolate `Map` (bounded, TTL): sub-millisecond, zero cost. Workers
 *      isolates stay warm across requests, so this absorbs nearly all hot
 *      traffic; it is lost when the runtime evicts the isolate (the "worker
 *      killed when idle" case).
 * L2 — Workers KV via the optional `CACHE_KV` binding: survives isolate
 *      eviction and is shared across isolates/colos. KV is eventually
 *      consistent (≤60s propagation, per Cloudflare's KV docs) and charges
 *      per op — exactly right for a warm-back tier, wrong for a source of
 *      truth. When the binding is absent everything degrades to L1 only.
 *
 * Correctness policy: only reference-style, read-heavy lookups belong here
 * (brand list, route list, vehicle types, popular places, provider list).
 * Anything transactional (seat availability, booking state, auth) must read
 * D1 directly — a stale seat map is a double-booking bug, not a cache miss.
 */
import { getEnv } from "./client";

interface Entry {
  value: unknown;
  /** Epoch ms after which the entry is stale. */
  expires: number;
}

const MAX_ENTRIES = 512;

/** Insertion-ordered Map = poor man's LRU (hits re-insert to stay fresh). */
const store = new Map<string, Entry>();

function l1Get(key: string): unknown | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  // refresh recency
  store.delete(key);
  store.set(key, hit);
  return hit.value;
}

function l1Set(key: string, value: unknown, ttlMs: number): void {
  if (store.size >= MAX_ENTRIES) {
    // evict the oldest (first-inserted) entry
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expires: Date.now() + ttlMs });
}

async function kv(): Promise<KVNamespace | undefined> {
  const env = await getEnv();
  return env.CACHE_KV;
}

export interface CacheOptions {
  /** L1 (per-isolate) freshness window in ms. Default 30_000. */
  ttlMs?: number;
  /**
   * L2 (KV) TTL in seconds. KV requires >= 60. Default 300 (5 min).
   * Ignored when no CACHE_KV binding exists.
   */
  kvTtlSecs?: number;
}

/**
 * Cache-first store lookup: L1 → L2 → `loader()` (which should hit D1),
 * populating both tiers on the way back. The loader runs inside the
 * caller's retry policy — compose with `withRetry` at the call site so
 * reads and cache misses stay resilient independently.
 */
export async function cacheFirst<T>(
  key: string,
  loader: () => Promise<T>,
  opts: CacheOptions = {},
): Promise<T> {
  const ttlMs = opts.ttlMs ?? 30_000;
  const kvTtl = Math.max(opts.kvTtlSecs ?? 300, 60);

  const l1 = l1Get(key);
  if (l1 !== undefined) return l1 as T;

  const ns = await kv();
  if (ns) {
    try {
      const l2 = (await ns.get(key, "json")) as T | null;
      if (l2 !== null) {
        l1Set(key, l2, ttlMs);
        return l2;
      }
    } catch {
      // KV hiccup must never break a request — fall through to the loader.
    }
  }

  const value = await loader();
  l1Set(key, value, ttlMs);
  if (ns) {
    try {
      await ns.put(key, JSON.stringify(value), { expirationTtl: kvTtl });
    } catch {
      // same: cache population is best-effort
    }
  }
  return value;
}

/** Drop a key from both tiers (call after the matching admin write). */
export async function cacheInvalidate(...keys: string[]): Promise<void> {
  for (const k of keys) store.delete(k);
  const ns = await kv();
  if (!ns) return;
  await Promise.allSettled(keys.map((k) => ns.delete(k)));
}

/** Drop every key sharing any of the prefixes from both tiers. */
export async function cacheInvalidatePrefix(...prefixes: string[]): Promise<void> {
  for (const k of [...store.keys()]) {
    if (prefixes.some((p) => k.startsWith(p))) store.delete(k);
  }
  const ns = await kv();
  if (!ns) return;
  await Promise.allSettled(
    prefixes.map(async (p) => {
      try {
        const listed = await ns.list({ prefix: p });
        await Promise.allSettled(listed.keys.map((k) => ns.delete(k.name)));
      } catch {
        // best-effort, same as above
      }
    }),
  );
}

/** Test hook: wipe L1 (L2 untouched — tests use their own keys). */
export function clearMemoryCache(): void {
  store.clear();
}
