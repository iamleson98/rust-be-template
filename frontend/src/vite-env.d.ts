/// <reference types="vite/client" />

interface ImportMetaEnv {
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
