/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare bindings & environment for the datxevui Workers deployment.
 *
 * Bindings (wrangler.jsonc): DB (D1), UPLOADS (R2), ASSETS, WORKER_SELF_REFERENCE.
 * Secrets (wrangler secret put): JWT_SECRET, CRON_SERVICE_TOKEN, REALTIME_API_TOKEN,
 *   VNPAY_TMN_CODE, VNPAY_HASH_SECRET, VIETQR_*, MOMO_*, ZALOPAY_*, VPS_SERVICE_TOKEN
 */
declare interface CloudflareEnv {
  // ── Bindings ────────────────────────────────────────────────────────
  DB: D1Database;
  UPLOADS: R2Bucket;
  ASSETS: Fetcher;
  WORKER_SELF_REFERENCE: Fetcher;
  /** Cloudflare Images binding: route picture thumbnails (absent → originals only). */
  IMAGES?: ImagesBinding;
  CHAT_HUB?: DurableObjectNamespace;
  CALL_HUB?: DurableObjectNamespace;
  /** This deploy's version (wrangler `version_metadata`): keys the page HTML cache per deploy. */
  CF_VERSION_METADATA?: WorkerVersionMetadata;

  // ── Vars (wrangler.jsonc / .dev.vars) ──────────────────────────────
  APP_ENV?: string;
  JWT_SECRET: string;
  JWT_ACCESS_TTL_SECS?: string;
  JWT_REFRESH_TTL_SECS?: string;
  /** Refresh lifetime of `X-Client: mobile` sessions (default 90 days). */
  JWT_MOBILE_REFRESH_TTL_SECS?: string;
  /** `iss` claim of the access token (default "backend"). */
  JWT_ISSUER?: string;
  CRON_SERVICE_TOKEN?: string;
  /** Wall-clock offset of job schedules, minutes east of UTC (default 420, Vietnam). */
  SCHEDULER_TZ_OFFSET_MINUTES?: string;
  /** Workers Rate Limiting bindings (wrangler `ratelimits`); absent → limiting is off. */
  AUTH_LIMITER?: RateLimit;
  WRITE_LIMITER?: RateLimit;
  /** Per-IP edge buckets (custom-worker.ts → lib/edge-guard.ts): reads, and auth/upload/search/sockets. */
  IP_READ_LIMITER?: RateLimit;
  IP_STRICT_LIMITER?: RateLimit;
  /** "lax" (default, first-party production) | "strict" | "none" (cross-site-capable preview). */
  COOKIE_SAMESITE?: string;
  /** `true` / `false` forces the Secure attribute; unset → Secure on HTTPS requests. */
  COOKIE_SECURE?: string;
  /** Optional cookie Domain (cross-subdomain sessions); unset → host-only cookies. */
  COOKIE_DOMAIN?: string;
  /** Optional cross-isolate cache tier; absent → memory-only caching. */
  CACHE_KV?: KVNamespace;

  // Payments
  PAYMENT_PUBLIC_BASE_URL?: string;
  PAYMENT_COD_ENABLED?: string;
  VNPAY_ENABLED?: string;
  /** `production` → live gateway; anything else → sandbox. */
  VNPAY_ENV?: string;
  VNPAY_TMN_CODE?: string;
  VNPAY_HASH_SECRET?: string;
  VIETQR_ENABLED?: string;
  VIETQR_BANK_BIN?: string;
  VIETQR_BANK_NAME?: string;
  VIETQR_ACCOUNT_NO?: string;
  VIETQR_ACCOUNT_NAME?: string;
  MOMO_ENABLED?: string;
  MOMO_ENV?: string;
  MOMO_PARTNER_CODE?: string;
  MOMO_ACCESS_KEY?: string;
  MOMO_SECRET_KEY?: string;
  ZALOPAY_ENABLED?: string;
  ZALOPAY_ENV?: string;
  ZALOPAY_APP_ID?: string;
  ZALOPAY_KEY1?: string;
  ZALOPAY_KEY2?: string;

  // Realtime calls / chat
  /** Comma list; default "VN". `*` or empty disables the customer region gate. */
  CALL_ALLOWED_COUNTRIES?: string;
  AUDIO_CALL_RING_TIMEOUT_SECS?: string;
  AUDIO_CALL_MAX_SECS?: string;
  /** Extra origins allowed to open cookie-authenticated sockets. */
  WS_ALLOWED_ORIGINS?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  TURN_TTL_SECONDS?: string;

  // Device push for incoming calls (all optional; unset = push disabled)
  FCM_CREDENTIALS_JSON?: string;
  APNS_KEY_PEM?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_TOPIC?: string;
  APNS_SANDBOX?: string;

  // Cloudflare Realtime (RealtimeKit)
  REALTIME_ENABLED?: string;
  REALTIME_APP_ID?: string;
  REALTIME_ACCOUNT_ID?: string;
  REALTIME_API_TOKEN?: string;

  // OAuth (optional — unset ⇒ the SPA hides the social sign-in buttons)
  OAUTH_REDIRECT_BASE_URL?: string;
  OAUTH_FRONTEND_URL?: string;
  OAUTH_GOOGLE_ENABLED?: string;
  OAUTH_GOOGLE_CLIENT_ID?: string;
  OAUTH_GOOGLE_CLIENT_SECRET?: string;
  OAUTH_GOOGLE_SCOPES?: string;
  OAUTH_FACEBOOK_ENABLED?: string;
  OAUTH_FACEBOOK_CLIENT_ID?: string;
  OAUTH_FACEBOOK_CLIENT_SECRET?: string;
  OAUTH_FACEBOOK_SCOPES?: string;

  // Google Ads server-side conversion upload (all of the first five, else record-only)
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  GOOGLE_ADS_CUSTOMER_ID?: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
  GOOGLE_ADS_CLIENT_ID?: string;
  GOOGLE_ADS_CLIENT_SECRET?: string;
  GOOGLE_ADS_REFRESH_TOKEN?: string;
  /** Google Ads REST version, e.g. `v21` (default `v21`). */
  GOOGLE_ADS_API_VERSION?: string;
  /** JSON: event name → conversion action resource name. */
  GOOGLE_ADS_CONVERSION_ACTIONS?: string;

  /** VPS companion service (`vps/`): Workers VPC binding over Cloudflare Tunnel (no public hostname). */
  VPS?: Fetcher;
  /** Bearer token the VPS service also requires (same value as its VPS_SERVICE_TOKEN). */
  VPS_SERVICE_TOKEN?: string;
  /** Comma-separated addresses `POST /api/jobs/tick` is accepted from (the VPS); unset = any. */
  CRON_ALLOWED_IPS?: string;

  /** Valhalla routing server base URL for /api/routing/* (absent → routing answers "not configured"). */
  VALHALLA_URL?: string;

  // Chat-bot platform webhooks (a missing secret rejects that platform's calls)
  TELEGRAM_WEBHOOK_SECRET?: string;
  MESSENGER_APP_SECRET?: string;
  MESSENGER_VERIFY_TOKEN?: string;
  ZALO_OA_SECRET?: string;
  /** Hex Ed25519 public key of the Discord application. */
  DISCORD_PUBLIC_KEY?: string;

  // NullClaw AI chat assistant (optional)
  NULLCLAW_ENABLED?: string;
  NULLCLAW_PROVIDER?: string;
}
