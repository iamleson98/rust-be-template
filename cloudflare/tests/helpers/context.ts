/**
 * Bridge between the test runtime and production code.
 *
 * `@opennextjs/cloudflare`'s `getCloudflareContext` reads a well-known
 * symbol from globalThis — the same mechanism the production worker and
 * `initOpenNextCloudflareForDev` use. Tests run inside workerd with REAL
 * D1/KV bindings (from `cloudflare:test`), so installing them on the
 * global makes every `getDb()/getEnv()/getR2()` call in src/ just work —
 * no module mocking, no reimplementation.
 */
import { env } from "cloudflare:test";

export const BASE_TEST_ENV: Record<string, unknown> = {
  DB: env.DB,
  CACHE_KV: env.CACHE_KV,
  JWT_SECRET: "test-jwt-secret-0123456789abcdef",
  JWT_ACCESS_TTL_SECS: "900",
  JWT_REFRESH_TTL_SECS: "604800",
  APP_ENV: "test",
};

/** Install (or replace) the Cloudflare context; per-test overrides win. */
export function setCloudflareContext(overrides: Record<string, unknown> = {}): void {
  (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")] = {
    env: { ...BASE_TEST_ENV, ...overrides },
    cf: {},
    ctx: { waitUntil: () => {}, props: {} },
  };
}
