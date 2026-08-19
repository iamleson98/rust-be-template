/**
 * Google Analytics 4 (GA4) integration for the SPA.
 *
 * - The GA4 script (`gtag.js`) is injected into `index.html` via the
 *   `VITE_GA4_ID` env var (handled by the prerender script).
 * - This module provides typed helpers for SPA page-view tracking +
 *   custom event tracking (search, booking funnel, etc.).
 * - All calls are no-ops if GA4 is not configured (no `window.gtag`).
 *
 * ## SPA page views
 *
 * TanStack Router handles navigation client-side. GA4 doesn't auto-detect
 * these — we fire `page_view` events manually on each route change.
 * The call is made from `RouteMeta` in `router.tsx`.
 *
 * ## Custom events
 *
 * The booking funnel events follow Google's recommended event names:
 *   `search` → `view_item` → `begin_checkout` → `add_payment_info` → `purchase`
 * These show up in GA4's "Engagement → Events" + can be used for
 * conversion tracking + Google Ads import (if you ever run paid ads).
 */

// Augment the Window type so TypeScript knows about `gtag`.
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

const GA4_ID = (import.meta.env.VITE_GA4_ID as string | undefined)?.trim()

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

/**
 * Track a custom event. Follows GA4's event naming conventions.
 *
 * Common events for a bus booking app:
 *   - `search` — user submits a trip search
 *   - `view_item` — trip detail dialog opens
 *   - `begin_checkout` — booking dialog step 1 (passengers)
 *   - `add_payment_info` — payment dialog opens
 *   - `purchase` — booking confirmed + payment completed
 */
export function trackEvent(
  name: string,
  params: Record<string, unknown> = {},
): void {
  if (typeof window === 'undefined' || !window.gtag) return
  window.gtag('event', name, params)
}

// ── Pre-typed event helpers for the booking funnel ──────────────

/** `search` — user submits a trip search. */
export function trackSearch(params: {
  from: string
  to: string
  date: string
  adults: number
  children: number
}): void {
  trackEvent('search', {
    search_term: `${params.from} → ${params.to} ${params.date}`,
    ...params,
  })
}

/** `view_item` — trip detail dialog opens. */
export function trackViewItem(params: {
  itemId: string
  itemName: string
  price: number
  currency: string
  brand: string
}): void {
  trackEvent('view_item', {
    currency: params.currency,
    value: params.price,
    items: [
      {
        item_id: params.itemId,
        item_name: params.itemName,
        item_brand: params.brand,
        price: params.price,
        quantity: 1,
      },
    ],
  })
}

/** `begin_checkout` — booking dialog step 1. */
export function trackBeginCheckout(params: {
  itemId: string
  value: number
  currency: string
  seatCount: number
}): void {
  trackEvent('begin_checkout', {
    currency: params.currency,
    value: params.value,
    items: [
      {
        item_id: params.itemId,
        price: params.value / Math.max(params.seatCount, 1),
        quantity: params.seatCount,
      },
    ],
  })
}

/** `purchase` — booking confirmed + payment completed. */
export function trackPurchase(params: {
  transactionId: string
  value: number
  currency: string
  itemId: string
  itemName: string
  paymentMethod: string
}): void {
  trackEvent('purchase', {
    transaction_id: params.transactionId,
    currency: params.currency,
    value: params.value,
    payment_type: params.paymentMethod,
    items: [
      {
        item_id: params.itemId,
        item_name: params.itemName,
        price: params.value,
        quantity: 1,
      },
    ],
  })
}

/** Whether GA4 is configured (env var set). */
export const isAnalyticsEnabled = (): boolean => !!GA4_ID
