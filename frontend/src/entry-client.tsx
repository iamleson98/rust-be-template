/**
 * Client entry — hydrates the server-rendered HTML (production) or mounts
 * a fresh client-side render (dev mode, where no prerendered HTML exists).
 *
 * In production:
 *   - Registers the service worker (`/sw.js`) for offline support +
 *     app-shell caching.
 *   - Boots web-vitals RUM (LCP / INP / CLS / TTFB / FCP) → POST
 *     /api/vitals via `navigator.sendBeacon`.
 *
 * ## API base URL strategy
 *
 * The generated SDK (`client.gen.ts`) hardcodes `baseUrl: 'http://127.0.0.1:8080'`.
 * We OVERRIDE it here to use an EMPTY baseUrl, which makes all SDK
 * requests use RELATIVE URLs (e.g. `/api/auth/me` instead of
 * `http://127.0.0.1:8080/api/auth/me`).
 *
 * Why this matters:
 *   - In DEV: Vite proxies `/api` → `localhost:8080`. Relative URLs
 *     go through the proxy → same-origin → cookies work automatically.
 *     If we used the hardcoded `127.0.0.1:8080`, the browser would
 *     send requests cross-origin (from `localhost:3000` to `127.0.0.1:8080`),
 *     and SameSite=Lax cookies wouldn't be sent → 401 on every API call.
 *
 *   - In PRODUCTION: Rust serves the UI at the same origin as the API.
 *     Relative URLs resolve to the same origin → same-origin → cookies work.
 *     No CORS needed at all.
 *
 * The `VITE_API_BASE_URL` env var is ONLY for SSR/prerender where
 * `window.location` is unavailable.
 */
import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import App from './App'
import { QueryProvider } from './components/providers/query-provider'
import { ErrorBoundary } from './components/error-boundary'
import { client } from './lib/api/client.gen'
import { createAuthFetch } from './lib/auth-fetch'
import './styles.css'
import { bootstrapWebVitals } from './lib/web-vitals'
import { initConsoleProtection } from './lib/console-protection'

// Override the generated SDK's baseUrl with an empty string so all
// requests use RELATIVE URLs. This makes them go through the Vite proxy
// in dev (same-origin) and the Rust static-file server in production
// (same-origin). Cross-origin cookie issues are eliminated entirely.
//
// VITE_API_BASE_URL is only used for SSR/prerender (where window is
// undefined) — see lib/ws-client.ts + components/auth/social-buttons.tsx.
const apiBaseUrl =
  typeof window !== 'undefined'
    ? '' // Browser: relative URLs → same-origin via Vite proxy or Rust static server
    : (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://127.0.0.1:8080' // SSR/prerender: need absolute URL

client.setConfig({
  baseUrl: apiBaseUrl,
  credentials: 'include',
  fetch: createAuthFetch(),
})

const rootEl = document.getElementById('root')!

const app = (
  <StrictMode>
    <ErrorBoundary>
      <QueryProvider>
        <App />
      </QueryProvider>
    </ErrorBoundary>
  </StrictMode>
)

createRoot(rootEl).render(app)

// ── Production-only boot ──────────────────────────────────────
if (import.meta.env.PROD && typeof navigator !== 'undefined') {
  window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing
            if (!newWorker) return
            newWorker.addEventListener('statechange', () => {
              if (
                newWorker.state === 'activated' &&
                navigator.serviceWorker.controller
              ) {
                const isInteracting =
                  document.activeElement instanceof HTMLInputElement ||
                  document.activeElement instanceof HTMLTextAreaElement ||
                  document.activeElement instanceof HTMLSelectElement
                if (!isInteracting) window.location.reload()
              }
            })
          })
        })
        .catch((err) => console.warn('[sw] registration failed', err))
    }
    bootstrapWebVitals()
    initConsoleProtection()
  })
}
