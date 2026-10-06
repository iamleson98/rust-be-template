/**
 * Google Analytics 4 (GA4) integration for the SPA.
 *
 * - The GA4 script (`gtag.js`) is injected into `index.html` via the
 *   `VITE_GA4_ID` env var (handled by the prerender script).
 * - This module provides the typed page-view helper for SPA navigation.
 * - All calls are no-ops if GA4 is not configured (no `window.gtag`).
 *
 * ## SPA page views
 *
 * TanStack Router handles navigation client-side. GA4 doesn't auto-detect
 * these — we fire `page_view` events manually on each route change.
 * The call is made from `RouteMeta` in `router/route-meta.tsx`.
 */

// Augment the Window type so TypeScript knows about `gtag`.
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

/**
 * Track a page view. Called on every TanStack Router navigation.
 *
 * GA4's `page_view` event includes:
 *   - `page_path`: the path portion of the URL (e.g. `/search`)
 *   - `page_title`: the document title (set by `RouteMeta`)
 *   - `page_location`: the full URL (including query params)
 */
export function trackPageView(path: string, title: string): void {
  if (typeof window === 'undefined' || !window.gtag) return
  window.gtag('event', 'page_view', {
    page_path: path,
    page_title: title,
    page_location: typeof location !== 'undefined' ? location.href : undefined,
  })
}
