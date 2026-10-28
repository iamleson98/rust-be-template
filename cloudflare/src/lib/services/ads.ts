/**
 * Ads hub — port of `src/ads/mod.rs` and `routes/ads.rs`: durable, deduped
 * first-party conversion records plus an upload to the Google Ads API
 * (`uploadClickConversions`) when the `GOOGLE_ADS_*` group is complete.
 * Measurement never blocks the money moment: the upload runs in
 * `waitUntil`, after the beacon has been answered.
 *
 * Statuses: `pending` → `uploaded` | `error` (upload attempted),
 * `unconfigured` (no credentials), `skipped` (no click id behind it).
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { adConversions } from "@/lib/db/schema";
import { badRequest } from "@/lib/services/http-errors";

type ConversionRow = typeof adConversions.$inferSelect;

/** Rust talks to API v17; kept as is (see the audit's questions). */
const ADS_API = "https://googleads.googleapis.com/v17";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface ReportConversionBody {
  event?: string;
  transactionId?: string | null;
  value?: string | null;
  currency?: string | null;
  clickIds?: { gclid?: string | null; wbraid?: string | null; gbraid?: string | null } | null;
}

/** Trim; blank or over-long becomes absent (Rust `filter(!is_empty && len <= max)`). */
function bounded(value: string | null | undefined, max: number): string | null {
  const v = value?.trim();
  return v && new TextEncoder().encode(v).length <= max ? v : null;
}

// ── Google Ads API ──────────────────────────────────────────────

interface AdsConfig {
  developerToken: string;
  customerId: string;
  loginCustomerId: string | null;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  conversionActions: Record<string, string>;
}

/** Rust `GoogleAdsConfig::from_env` + `is_active`: null unless the whole credential group is set. */
export function adsConfig(env: CloudflareEnv): AdsConfig | null {
  const get = (v: string | undefined) => (v?.trim() ? v.trim() : "");
  let conversionActions: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(env.GOOGLE_ADS_CONVERSION_ACTIONS ?? "{}");
    if (parsed && typeof parsed === "object") conversionActions = parsed as Record<string, string>;
  } catch {
    // malformed map: no event is mapped, uploads report it per row
  }
  const cfg = {
    developerToken: get(env.GOOGLE_ADS_DEVELOPER_TOKEN),
    customerId: get(env.GOOGLE_ADS_CUSTOMER_ID),
    loginCustomerId: get(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) || null,
    clientId: get(env.GOOGLE_ADS_CLIENT_ID),
    clientSecret: get(env.GOOGLE_ADS_CLIENT_SECRET),
    refreshToken: get(env.GOOGLE_ADS_REFRESH_TOKEN),
    conversionActions,
  };
  const active =
    cfg.developerToken && cfg.customerId && cfg.clientId && cfg.clientSecret && cfg.refreshToken;
  return active ? cfg : null;
}

let cachedToken: { token: string; expires: number } | null = null;

async function accessToken(cfg: AdsConfig): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires) return cachedToken.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`oauth status ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("oauth: no access_token");
  cachedToken = {
    token: json.access_token,
    expires: Date.now() + Math.max(json.expires_in ?? 3600, 60) * 1000,
  };
  return json.access_token;
}

/** Google wants `YYYY-MM-DD HH:MM:SS±HH:MM` (the offset is mandatory). */
export function conversionDateTime(rfc3339: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.exec(
    rfc3339,
  );
  if (!m) throw new Error(`bad created_at '${rfc3339}'`);
  return `${m[1]} ${m[2]}${m[3]!.toUpperCase() === "Z" ? "+00:00" : m[3]}`;
}

async function upload(cfg: AdsConfig, m: ConversionRow): Promise<void> {
  const action = cfg.conversionActions[m.event];
  if (!action) throw new Error(`no conversion action mapped for event '${m.event}'`);
  const token = await accessToken(cfg);
  // At most one click id per conversion (Google's rule): gclid, then wbraid, then gbraid.
  const clickId = m.gclid
    ? { gclid: m.gclid }
    : m.wbraid
      ? { wbraid: m.wbraid }
      : m.gbraid
        ? { gbraid: m.gbraid }
        : {};
  const res = await fetch(`${ADS_API}/customers/${cfg.customerId}:uploadClickConversions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "developer-token": cfg.developerToken,
      "content-type": "application/json",
      ...(cfg.loginCustomerId && { "login-customer-id": cfg.loginCustomerId }),
    },
    body: JSON.stringify({
      conversions: [
        {
          conversionAction: action,
          conversionDateTime: conversionDateTime(m.createdAt),
          orderId: m.transactionId,
          ...(m.conversionValue && { conversionValue: m.conversionValue }),
          ...(m.currency && { currencyCode: m.currency }),
          ...clickId,
        },
      ],
      partialFailure: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`upload rejected: ${(await res.text()).slice(0, 500)}`);
}

// ── Store ───────────────────────────────────────────────────────

async function markStatus(id: string, status: string): Promise<void> {
  const db = await getDb();
  await db
    .update(adConversions)
    .set({ status, ...(status === "uploaded" && { uploadedAt: new Date().toISOString() }) })
    .where(eq(adConversions.id, id));
}

/** Rust `insert_deduped`: `(event, transaction_id)` is unique, so a repeat beacon collapses. */
async function insertDeduped(
  c: Omit<typeof adConversions.$inferInsert, "id" | "status" | "createdAt">,
): Promise<{ row: ConversionRow; stored: boolean }> {
  const db = await getDb();
  const find = async () =>
    (
      await db
        .select()
        .from(adConversions)
        .where(
          and(eq(adConversions.event, c.event), eq(adConversions.transactionId, c.transactionId)),
        )
        .limit(1)
    )[0];
  const existing = await find();
  if (existing) return { row: existing, stored: false };
  const row: ConversionRow = {
    id: crypto.randomUUID(),
    event: c.event,
    transactionId: c.transactionId,
    conversionValue: c.conversionValue ?? null,
    currency: c.currency ?? null,
    gclid: c.gclid ?? null,
    wbraid: c.wbraid ?? null,
    gbraid: c.gbraid ?? null,
    status: "pending",
    createdAt: new Date().toISOString(),
    uploadedAt: null,
  };
  try {
    await db.insert(adConversions).values(row);
    return { row, stored: true };
  } catch (e) {
    // Lost the race to an identical beacon.
    const raced = await find();
    if (raced && /unique/i.test(String(e))) return { row: raced, stored: false };
    throw e;
  }
}

/** `POST /api/ads/conversions`. */
export async function reportConversion(body: ReportConversionBody) {
  const event = (body.event ?? "").trim().toLowerCase();
  if (typeof body.event !== "string" || !event || new TextEncoder().encode(event).length > 32)
    throw badRequest("event must be 1..=32 chars");
  // No transaction id → mint one: an id-less conversion cannot be deduped.
  const transactionId = body.transactionId?.trim() || crypto.randomUUID();
  if (new TextEncoder().encode(transactionId).length > 128)
    throw badRequest("transactionId must be 1..=128 chars");

  const clickIds = body.clickIds ?? {};
  const { env, ctx } = await getCloudflareContext({ async: true });
  const cfg = adsConfig(env);

  const { row, stored } = await insertDeduped({
    event,
    transactionId,
    conversionValue: bounded(body.value, 32),
    currency: bounded(body.currency, 8)?.toUpperCase() ?? null,
    gclid: bounded(clickIds.gclid, 1024),
    wbraid: bounded(clickIds.wbraid, 1024),
    gbraid: bounded(clickIds.gbraid, 1024),
  });
  const hasClickId = Boolean(row.gclid || row.wbraid || row.gbraid);
  const uploadAttempted = cfg !== null && hasClickId;

  if (stored && cfg && hasClickId) {
    ctx.waitUntil(
      upload(cfg, row).then(
        () => markStatus(row.id, "uploaded"),
        (e: unknown) => {
          console.warn(`ads: conversion upload failed (${row.event}):`, e);
          return markStatus(row.id, "error");
        },
      ),
    );
  } else if (stored && !cfg) {
    await markStatus(row.id, "unconfigured");
  } else if (stored && !hasClickId) {
    // Organic conversion: nothing to attribute, the record stays for reporting.
    await markStatus(row.id, "skipped");
  }

  return { ok: true, stored, uploadAttempted, serverUploadEnabled: cfg !== null };
}
