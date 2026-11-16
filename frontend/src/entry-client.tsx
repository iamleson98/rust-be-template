/**
 * Client entry: mounts the app over the page the server wrote (its first
 * screen: header, headline, links, a working search form and the data they
 * came from), or on an empty root (private pages). The page's boot script (see
 * `prerender.mjs`) has already kept the ad click ids and starts this at the
 * first touch. In production it also registers the service
 * worker (offline app shell) and reports web vitals through `/api/vitals`,
 * once the page has loaded and the browser is idle.
 *
 * API requests use relative URLs, so they stay same-origin (the Vite proxy in
 * dev, Axum in production) and SameSite cookies are sent; see `api/client.ts`.
 */
import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './app/app'
import { ErrorBoundary } from './components/error-boundary'
import { configureApiClient } from './api/client'
import { createQueryClient } from './api/query-client'
import { afterLoadWhenIdle } from './lib/idle'
import { loadLanguage } from './lib/i18n'
import { primeFromServer } from './lib/initial-data'
import { carryOverServerSearchForm } from './lib/server-search-form'
import { router } from './router'
import { usePrefs } from './stores/prefs'
import './styles.css'
import { captureClickIds } from './lib/analytics'

// Capture Google Ads click ids (gclid/wbraid/gbraid) from the landing
// URL NOW — before the SPA router rewrites history and drops them
// (see lib/analytics.ts). Must run before render, exactly once.
captureClickIds()

configureApiClient()

/**
 * Mounts the app. Written as a function the module starts rather than
 * top-level `await`: the page's chunks import from this module, and a module
 * that is still waiting on one of them would be waiting on itself.
 */
async function mount() {
  // A returning English visitor gets the English strings before the first paint.
  await loadLanguage(usePrefs.getState().lang)

  const rootEl = document.getElementById('root')!
  const queryClient = createQueryClient()
  primeFromServer(queryClient)
  carryOverServerSearchForm(rootEl)

  // The server's first screen stays on show until the app can draw the same page
  // (its chunk loaded, its data in the cache): one swap, no blank or skeleton in
  // between. A page with no server text has nothing to keep, so it mounts at once.
  if (rootEl.childElementCount > 0) {
    await router.load().catch(() => undefined)
  }

  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
}

void mount()

// ── Production-only boot ──────────────────────────────────────
if (import.meta.env.PROD && typeof navigator !== 'undefined') {
  afterLoadWhenIdle(() => {
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
    void import('./lib/web-vitals').then((m) => m.bootstrapWebVitals())
    void import('./lib/console-protection').then((m) => m.initConsoleProtection())
  })
}
