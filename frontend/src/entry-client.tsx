/**
 * Client entry: hydrates the prerendered HTML (production) or mounts a fresh
 * render (dev). In production it also registers the service worker (offline
 * app shell) and reports web vitals through `/api/vitals`.
 *
 * API requests use relative URLs, so they stay same-origin (the Vite proxy in
 * dev, Axum in production) and SameSite cookies are sent; see `api/client.ts`.
 */
import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import App from './app/app'
import { QueryProvider } from './app/providers'
import { ErrorBoundary } from './components/error-boundary'
import { configureApiClient } from './api/client'
import { loadLanguage } from './lib/i18n'
import { usePrefs } from './stores/prefs'
import './styles.css'
import { bootstrapWebVitals } from './lib/web-vitals'
import { initConsoleProtection } from './lib/console-protection'
import { captureClickIds } from './lib/analytics'

// Capture Google Ads click ids (gclid/wbraid/gbraid) from the landing
// URL NOW — before the SPA router rewrites history and drops them
// (see lib/analytics.ts). Must run before render, exactly once.
captureClickIds()

configureApiClient()

// A returning English visitor gets the English strings before the first paint.
await loadLanguage(usePrefs.getState().lang)

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
              if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
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
