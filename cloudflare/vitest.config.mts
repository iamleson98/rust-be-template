import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

/**
 * Tests run INSIDE workerd (the same runtime the app deploys to) with real
 * D1 + KV bindings from Miniflare. Bindings are exposed to test code via
 * the `env` export of `cloudflare:test`; production code reaches them
 * through `getCloudflareContext` — bridged in tests/helpers/context.ts.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./tests/hubs/worker.ts",
      miniflare: {
        durableObjects: { CHAT_HUB: "ChatHub", CALL_HUB: "CallHub" },
        // What the hubs read from their own env (the app's bindings in production).
        bindings: { JWT_SECRET: "test-jwt-secret-0123456789abcdef" },
        compatibilityDate: "2026-09-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        kvNamespaces: ["CACHE_KV"],
        r2Buckets: ["UPLOADS"],
      },
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@spa": fileURLToPath(new URL("./src/spa", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
