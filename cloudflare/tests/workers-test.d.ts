/// <reference types="@cloudflare/vitest-plugin/types" />
/// <reference types="vite/client" />

/** Bindings provisioned by vitest.config.mts (Miniflare) for tests. */
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    CACHE_KV: KVNamespace;
    UPLOADS: R2Bucket;
  }
}
