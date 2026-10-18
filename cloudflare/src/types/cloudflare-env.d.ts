/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare bindings & environment for the datxevui Workers deployment.
 *
 * Bindings (wrangler.jsonc): DB (D1), UPLOADS (R2), ASSETS, WORKER_SELF_REFERENCE.
 * Secrets (wrangler secret put): JWT_SECRET, CRON_SERVICE_TOKEN, REALTIME_API_TOKEN,
 *   VNPAY_TMN_CODE, VNPAY_HASH_SECRET, VIETQR_*, MOMO_*, ZALOPAY_*
 */
declare interface CloudflareEnv {
  // ── Bindings ────────────────────────────────────────────────────────
  DB: D1Database;
  UPLOADS: R2Bucket;
  ASSETS: Fetcher;
  WORKER_SELF_REFERENCE: Fetcher;
  CHAT_HUB?: DurableObjectNamespace;
  CALL_HUB?: DurableObjectNamespace;
  CRON_CONTAINER?: DurableObjectNamespace;

  // ── Vars (wrangler.jsonc / .dev.vars) ──────────────────────────────
  APP_ENV?: string;
  JWT_SECRET: string;
  JWT_ACCESS_TTL_SECS?: string;
  JWT_REFRESH_TTL_SECS?: string;
  CRON_SERVICE_TOKEN?: string;
  /** "lax" (default, first-party production) | "none" (cross-site-capable preview). */
  COOKIE_SAMESITE?: string;
  /** Optional cross-isolate cache tier; absent → memory-only caching. */
  CACHE_KV?: KVNamespace;

  // Payments
  PAYMENT_PUBLIC_BASE_URL?: string;
  PAYMENT_COD_ENABLED?: string;
  VNPAY_ENABLED?: string;
  VNPAY_TMN_CODE?: string;
  VNPAY_HASH_SECRET?: string;
  VIETQR_ENABLED?: string;
  VIETQR_BANK_BIN?: string;
  VIETQR_BANK_NAME?: string;
  VIETQR_ACCOUNT_NO?: string;
  VIETQR_ACCOUNT_NAME?: string;
  MOMO_ENABLED?: string;
  MOMO_PARTNER_CODE?: string;
  MOMO_ACCESS_KEY?: string;
  MOMO_SECRET_KEY?: string;
  ZALOPAY_ENABLED?: string;
  ZALOPAY_APP_ID?: string;
  ZALOPAY_KEY1?: string;
  ZALOPAY_KEY2?: string;

  // Cloudflare Realtime (RealtimeKit)
  REALTIME_ENABLED?: string;
  REALTIME_APP_ID?: string;
  REALTIME_ACCOUNT_ID?: string;
  REALTIME_API_TOKEN?: string;

  // OAuth (optional — unset ⇒ the SPA hides the social sign-in buttons)
  OAUTH_GOOGLE_CLIENT_ID?: string;
  OAUTH_GOOGLE_CLIENT_SECRET?: string;
  OAUTH_FACEBOOK_CLIENT_ID?: string;
  OAUTH_FACEBOOK_CLIENT_SECRET?: string;
  OAUTH_APPLE_CLIENT_ID?: string;

  // NullClaw AI chat assistant (optional)
  NULLCLAW_ENABLED?: string;
  NULLCLAW_PROVIDER?: string;
}
