/**
 * Client entry — hydrates the server-rendered HTML (production) or mounts
 * a fresh client-side render (dev mode, where no prerendered HTML exists).
 *
 * In production:
 *   - Registers the service worker (`/sw.js`) for offline support +
 *     app-shell caching.
 *   - Boots web-vitals RUM (LCP / INP / CLS / TTFB / FCP) → POST
 *     /api/vitals via `navigator.sendBeacon`.
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

client.setConfig({ credentials: 'include', fetch: createAuthFetch() })

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
