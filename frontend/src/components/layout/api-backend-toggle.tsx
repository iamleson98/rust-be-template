'use client'

/**
 * No-op in the Vite SPA build.
 *
 * In the previous Next.js setup, this component patched `window.fetch` to
 * route `/api/*` calls to the Rust backend via the Caddy gateway
 * (`XTransformPort=8080`). In the Vite SPA, the Rust backend serves the
 * static bundle AND the API on the same origin, so no fetch patching is
 * needed — relative `/api/...` calls resolve to the correct backend
 * automatically. The component is preserved as a no-op so any caller that
 * still mounts it keeps working.
 */
export function ApiBackendToggle() {
  return null
}
