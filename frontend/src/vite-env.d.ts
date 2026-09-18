/// <reference types="vite/client" />

interface ImportMetaEnv {
  // ── API base URL ─────────────────────────────────────────────
  /** Backend API base URL for SSR/prerender. In browser, window.location.origin is used. */
  readonly VITE_API_BASE_URL?: string

  // ── Google integrations ──────────────────────────────────────
  /** Google Search Console verification token (from GSC → Settings → HTML tag). */
  readonly VITE_GSC_VERIFICATION?: string
  /** Google Analytics 4 measurement ID (G-XXXXXXXXXX). */
  readonly VITE_GA4_ID?: string

  // ── Google AdSense (only if monetizing — NOT for SEO) ────────
  readonly VITE_GOOGLE_ADSENSE_CLIENT?: string
  readonly VITE_GOOGLE_ADSENSE_SLOT_HOME?: string
  readonly VITE_GOOGLE_ADSENSE_SLOT_SEARCH?: string
  readonly VITE_AD_DISMISSIBLE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * Global window augmentations for third-party scripts and app-internal
 * debug channels. Centralized here so call sites use `window.gtag` etc.
 * directly instead of `(window as any)` casts.
 */
interface Window {
  /** Google Analytics 4 gtag() — injected by the GA4 bootstrap script. */
  gtag?: (...args: unknown[]) => void
  /** Firebug presence probe (console-protection). */
  firebug?: { isEnabled: boolean }
  /** Safari's legacy prefixed AudioContext (sound-effects). */
  webkitAudioContext?: typeof AudioContext
  /** Debug channel: last trip-search results (search-results ↔ trip-compare). */
  __lastSearchResults?: unknown[]
}
