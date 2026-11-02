/**
 * Payment service (`index.ts` is its surface) — port of `payment_service.rs` and the `payment/*`
 * providers.
 *
 * ## State machine
 *
 * ```text
 *                  createPayment()
 * pending ──────────────────────────────► [provider gateway]
 *   │                                          │
 *   │  cancel()                                │  IPN webhook
 *   ▼                                          ▼
 * cancelled ◄──────────────────────────── completed
 *   │                                          │
 *   │                                          │  admin updateStatus
 *   ▼                                          ▼
 *   └──────────────────────────────────► refunded
 * ```
 *
 * A `pending` payment has exactly one path to `completed`: the provider's
 * IPN callback (online providers) or `markCodCollected` (cash). The admin
 * `updateStatus` can move a payment to any status for manual overrides.
 *
 * Providers: cod (no gateway), vietqr (EMVCo QR built locally, manual
 * reconcile), vnpay (gateway URL + HMAC-SHA512), momo and zalopay (create
 * order over HTTPS + HMAC-SHA256). One active payment per booking: a new
 * payment cancels the previous pending one.
 */

import { getEnv } from "@/lib/db/client";
import { payments } from "@/lib/db/schema";

export type PaymentRow = typeof payments.$inferSelect;

/** All providers, in the order checkout lists them. */
export const PROVIDERS = ["momo", "vnpay", "zalopay", "cod", "vietqr"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const STATUSES = ["pending", "completed", "failed", "cancelled", "refunded"] as const;
export const isTerminal = (status: string) => status !== "pending";

// ── Config (Rust `PaymentConfig`) ────────────────────────────────

export interface PaymentConfig {
  publicBaseUrl: string;
  codEnabled: boolean;
  vnpay: { active: boolean; production: boolean; tmnCode: string; hashSecret: string };
  momo: {
    active: boolean;
    production: boolean;
    partnerCode: string;
    accessKey: string;
    secretKey: string;
  };
  zalopay: {
    active: boolean;
    production: boolean;
    appId: string;
    key1: string;
    key2: string;
  };
  vietqr: {
    active: boolean;
    bankBin: string;
    accountNo: string;
    accountName: string;
    bankName: string;
  };
}

export async function paymentConfig(): Promise<PaymentConfig> {
  const env = await getEnv();
  const flag = (v: string | undefined, fallback: boolean) =>
    v === undefined || v.trim() === "" ? fallback : v.trim() === "true";
  const s = (v: string | undefined) => v?.trim() ?? "";
  const vnpay = {
    tmnCode: s(env.VNPAY_TMN_CODE),
    hashSecret: s(env.VNPAY_HASH_SECRET),
    production: s(env.VNPAY_ENV) === "production",
  };
  const momo = {
    partnerCode: s(env.MOMO_PARTNER_CODE),
    accessKey: s(env.MOMO_ACCESS_KEY),
    secretKey: s(env.MOMO_SECRET_KEY),
    production: s(env.MOMO_ENV) === "production",
  };
  const zalopay = {
    appId: s(env.ZALOPAY_APP_ID),
    key1: s(env.ZALOPAY_KEY1),
    key2: s(env.ZALOPAY_KEY2),
    production: s(env.ZALOPAY_ENV) === "production",
  };
  const vietqr = {
    bankBin: s(env.VIETQR_BANK_BIN),
    accountNo: s(env.VIETQR_ACCOUNT_NO),
    accountName: s(env.VIETQR_ACCOUNT_NAME),
    bankName: s(env.VIETQR_BANK_NAME),
  };
  return {
    publicBaseUrl: s(env.PAYMENT_PUBLIC_BASE_URL) || "http://127.0.0.1:8080",
    codEnabled: flag(env.PAYMENT_COD_ENABLED, true),
    vnpay: {
      ...vnpay,
      active: flag(env.VNPAY_ENABLED, false) && !!vnpay.tmnCode && !!vnpay.hashSecret,
    },
    momo: {
      ...momo,
      active:
        flag(env.MOMO_ENABLED, false) && !!momo.partnerCode && !!momo.accessKey && !!momo.secretKey,
    },
    zalopay: {
      ...zalopay,
      active:
        flag(env.ZALOPAY_ENABLED, false) && !!zalopay.appId && !!zalopay.key1 && !!zalopay.key2,
    },
    vietqr: {
      ...vietqr,
      active:
        flag(env.VIETQR_ENABLED, false) &&
        !!vietqr.bankBin &&
        !!vietqr.accountNo &&
        !!vietqr.accountName,
    },
  };
}

export function isActive(cfg: PaymentConfig, provider: string): boolean {
  switch (provider) {
    case "vnpay":
      return cfg.vnpay.active;
    case "momo":
      return cfg.momo.active;
    case "zalopay":
      return cfg.zalopay.active;
    case "vietqr":
      return cfg.vietqr.active;
    case "cod":
      return cfg.codEnabled;
    default:
      return false;
  }
}

/** The providers checkout can offer: exactly those `createPayment` accepts. */
export async function enabledProviders(): Promise<{ providers: Provider[] }> {
  const cfg = await paymentConfig();
  return { providers: PROVIDERS.filter((p) => isActive(cfg, p)) };
}
