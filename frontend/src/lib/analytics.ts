/**
 * Google measurement for the SPA — GA4 page views + Google Ads
 * conversions & click-id capture.
 *
 * - The `gtag.js` script and the Google Ads conversion labels are
 *   injected into `index.html` by the prerender script from env vars
 *   (`VITE_GA4_ID`, `VITE_GOOGLE_ADS_ID`,
 *   `VITE_GOOGLE_ADS_CONVERSIONS`) — see `prerender.mjs` and
 *   `docs/GOOGLE_ADS.md`.
 * - This module provides the typed runtime helpers: page-view on SPA
 *   navigation, conversion dispatch at the money moments, and Google
 *   Ads click-id (`gclid`/`wbraid`/`gbraid`) capture for attribution.
 * - All calls are no-ops if tags are not configured (no `window.gtag`).
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
    /**
     * Google Ads conversion labels per event, injected at prerender
     * time from `VITE_GOOGLE_ADS_CONVERSIONS` (JSON), e.g.
     * `{ booking: 'AW-123/AbC-123', purchase: 'AW-123/DeF-456' }`.
     * Absent in dev / when Ads is not configured — conversions no-op.
     */
    __GOOGLE_ADS_CONVERSIONS__?: Record<string, string>
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

// ────────────────────────────────────────────────────────────────
//  Google Ads — conversion tracking
// ────────────────────────────────────────────────────────────────

/** The conversion events this app fires (one per business moment). */
export type ConversionEvent = 'booking' | 'purchase'

export interface ConversionPayload {
  /** Revenue in minor-free units (e.g. VND integer). */
  value?: number
  /** ISO-4217 code matching the value (e.g. 'VND'). */
  currency?: string
  /**
   * Stable id Google Ads dedupes on — the booking code, so a repeat
   * fire of the same booking/purchase collapses to one conversion.
   */
  transactionId?: string
}

/**
 * Track a conversion. Two independent paths, both fire-and-forget:
 *
 * 1. **gtag dispatch** (browser tag) — no-op unless the gtag runtime
 *    and this event's label are configured; safe to call
 *    unconditionally from feature code.
 * 2. **Server-side beacon** — `POST /api/ads/conversions` with the
 *    stored click ids, where the record lands in the first-party
 *    `ad_conversion` table (deduped by transaction id) and is uploaded
 *    to the Google Ads API server-side when credentials are live.
 *    This path survives cookie blocking / ITP and is recorded even
 *    when neither gtag nor Ads is configured yet — enabling Ads later
 *    backfills everything recorded meanwhile.
 *
 * @example
 *   trackConversion('purchase', { value: 250000, currency: 'VND', transactionId: code })
 */
export function trackConversion(event: ConversionEvent, payload: ConversionPayload = {}): void {
  beaconConversionServerSide(event, payload)

  const sendTo =
    typeof window !== 'undefined' ? window.__GOOGLE_ADS_CONVERSIONS__?.[event] : undefined
  if (typeof window === 'undefined' || !window.gtag || !sendTo) {
    if (import.meta.env.DEV) {
      console.debug('[ads] conversion not sent (gtag/label unconfigured):', event, payload)
    }
    return
  }
  window.gtag('event', 'conversion', {
    send_to: sendTo,
    ...(payload.value !== undefined && { value: payload.value }),
    ...(payload.currency && { currency: payload.currency }),
    ...(payload.transactionId && { transaction_id: payload.transactionId }),
  })
}

/**
 * Fire-and-forget server-side record via `navigator.sendBeacon` —
 * survives page unload mid-redirect (the money moment often
 * navigates), never blocks the UI, and never throws.
 */
function beaconConversionServerSide(event: ConversionEvent, payload: ConversionPayload): void {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return
  try {
    const body = JSON.stringify({
      event,
      ...(payload.transactionId && { transactionId: payload.transactionId }),
      ...(payload.value !== undefined && { value: String(payload.value) }),
      ...(payload.currency && { currency: payload.currency }),
      clickIds: getClickIds(),
    })
    navigator.sendBeacon('/api/ads/conversions', new Blob([body], { type: 'application/json' }))
  } catch {
    // Beacon is best-effort on top of the gtag path — never let it
    // disturb the conversion UX (e.g. quota errors on exotic browsers).
  }
}

// ────────────────────────────────────────────────────────────────
//  Google Ads — click-id capture (gclid / wbraid / gbraid)
// ────────────────────────────────────────────────────────────────

/** Query params Google Ads auto-tagging appends to the landing URL. */
const CLICK_ID_PARAMS = ['gclid', 'wbraid', 'gbraid'] as const

export type ClickIdName = (typeof CLICK_ID_PARAMS)[number]

/** localStorage key for the captured click ids. */
const CLICK_IDS_KEY = 'datxevui:ads-click-ids'

/**
 * Google's maximum click-conversion attribution window — 90 days.
 * Captured ids older than this are treated as absent.
 */
const CLICK_IDS_TTL_MS = 90 * 24 * 60 * 60 * 1000

interface StoredClickIds {
  /** Epoch ms of the landing that carried the ids. */
  capturedAt: number
  values: Partial<Record<ClickIdName, string>>
}

/**
 * Capture Google Ads click ids from the landing URL and persist them.
 *
 * Called once at client boot (see `entry-client.tsx`) — BEFORE the SPA
 * router rewrites the URL, which would drop `?gclid=…`. A later landing
 * with fresh ids overwrites the stored ones (most-recent-click wins,
 * matching gtag's own attribution model); internal navigations without
 * ids leave the previous capture intact.
 *
 * Persisting enables (a) conversions fired days later on a return visit
 * and (b) a future server-side conversion upload via the Google Ads API
 * (see `getClickIds`).
 */
export function captureClickIds(): void {
  if (typeof window === 'undefined') return
  const params = new URL(window.location.href).searchParams
  const values: Partial<Record<ClickIdName, string>> = {}
  for (const name of CLICK_ID_PARAMS) {
    const v = params.get(name)
    if (v) values[name] = v
  }
  if (Object.keys(values).length === 0) return
  try {
    localStorage.setItem(CLICK_IDS_KEY, JSON.stringify({ capturedAt: Date.now(), values }))
  } catch {
    // Storage full / disabled — attribution degrades, nothing else breaks.
  }
}

/**
 * The persistently captured click ids (within the 90-day window), for
 * forwarding to a server-side conversion upload. `{}` when none are
 * stored or they expired.
 */
export function getClickIds(): Partial<Record<ClickIdName, string>> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(CLICK_IDS_KEY)
    if (!raw) return {}
    const stored = JSON.parse(raw) as StoredClickIds
    if (Date.now() - stored.capturedAt > CLICK_IDS_TTL_MS) {
      localStorage.removeItem(CLICK_IDS_KEY)
      return {}
    }
    return stored.values ?? {}
  } catch {
    return {}
  }
}
