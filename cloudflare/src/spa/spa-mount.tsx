'use client'

/**
 * Bootstraps the original DatXeVui SPA (TanStack Router + Query) inside the
 * Next.js App Router. Mirrors `entry-client.tsx` from the Vite build:
 * captures ad click ids before the router rewrites history, configures the
 * API client, pre-loads the visitor's language (no first-paint flash), then
 * renders the app.
 *
 * The component is only ever rendered on the client (dynamic import with
 * `ssr: false` in `app/[[...slug]]/page.tsx`), so browser-only APIs are safe.
 */
import { useEffect, useState } from 'react'
import { captureClickIds } from '@spa/lib/analytics'
import { loadLanguage } from '@spa/lib/i18n'
import { usePrefs } from '@spa/stores/prefs'
import { configureApiClient } from '@spa/api/client'
import { bootstrapWebVitals } from '@spa/lib/web-vitals'
import { initConsoleProtection } from '@spa/lib/console-protection'
import App from '@spa/app/app'
import { QueryProvider } from '@spa/app/providers'
import { ErrorBoundary } from '@spa/components/error-boundary'
import '@spa/styles.css'

export function SpaMount() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Capture Google Ads click ids (gclid/wbraid/gbraid) from the landing
    // URL before the SPA router rewrites history (see lib/analytics.ts).
    captureClickIds()
    configureApiClient()
    // A returning English visitor gets the English strings before first paint.
    loadLanguage(usePrefs.getState().lang).finally(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Production-only boot: PWA service worker, web-vitals reporting and
  // console protection (same as entry-client.tsx in the Vite build).
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    const onLoad = () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker
          .register('/sw.js', { scope: '/' })
          .catch((err) => console.warn('[sw] registration failed', err))
      }
      bootstrapWebVitals()
      initConsoleProtection()
    }
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad, { once: true })
  }, [])

  if (!ready) return null

  return (
    <ErrorBoundary>
      <QueryProvider>
        <App />
      </QueryProvider>
    </ErrorBoundary>
  )
}
