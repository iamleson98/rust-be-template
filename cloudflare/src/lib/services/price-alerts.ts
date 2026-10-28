/**
 * Price alerts — port of `price_alert_service.rs` and `routes/price_alerts.rs`.
 * An alert watches a route (or a from/to pair) for a fare at or below a
 * target; the daily job that fires them is in `jobs.ts`.
 */
import { and, count, desc, eq, isNull, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { ApiError } from "@/lib/auth/rbac";
import { priceAlerts } from "@/lib/db/schema";
import { badRequest, forbidden, notFound, uuidParam, validPhone } from "@/lib/services/http-errors";

type AlertRow = typeof priceAlerts.$inferSelect;

const ALERT_DAYS = 30;
const MAX_PAGE = 200;

export interface PriceAlertOut {
  id: string;
  phone: string;
  email: string | null;
  fromName: string | null;
  toName: string | null;
  routeId: string | null;
  targetPrice: number | null;
  frequency: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  lastTriggeredAt: string | null;
}

export function alertOut(a: AlertRow): PriceAlertOut {
  return {
    id: a.id,
    phone: a.phone,
    email: a.email,
    fromName: a.fromName,
    toName: a.toName,
    routeId: a.routeId,
    targetPrice: a.targetPrice,
    frequency: a.frequency,
    status: a.status,
    createdAt: a.createdAt,
    expiresAt: a.expiresAt,
    lastTriggeredAt: a.lastTriggeredAt,
  };
}

/**
 * Rust `is_valid_vn_phone`: `0xxxxxxxxx`, `+84xxxxxxxxx` or `84xxxxxxxxx`;
 * ten digits once the country code becomes `0`, mobile prefix 03–09.
 */
export function isValidVnPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("84") ? `0${digits.slice(2)}` : digits;
  return normalized.length === 10 && normalized.startsWith("0") && /[3-9]/.test(normalized[1]);
}

export interface CreatePriceAlertBody {
  phone: string;
  email?: string | null;
  fromName: string;
  toName: string;
  routeId?: string | null;
  targetPrice?: number;
  /** Legacy alias of `targetPrice`. */
  maxPrice?: number;
  frequency?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isLen = (v: unknown, min: number, max: number): v is string =>
  typeof v === "string" && [...v].length >= min && [...v].length <= max;

/** The `validator` rules of `CreatePriceAlertRequest`; returns the price (`targetPrice` or `maxPrice`). */
export function validateCreateAlert(b: CreatePriceAlertBody): number {
  if (typeof b !== "object" || b === null) throw badRequest("invalid request body");
  if (!isLen(b.phone, 1, 20)) throw badRequest("phone has an invalid length");
  if (!validPhone(b.phone)) throw badRequest("phone must be a valid phone number");
  if (b.email != null && (!isLen(b.email, 0, 255) || !EMAIL_RE.test(b.email)))
    throw badRequest("email must be a valid email address");
  if (!isLen(b.fromName, 1, 255)) throw badRequest("from name has an invalid length");
  if (!isLen(b.toName, 1, 255)) throw badRequest("to name has an invalid length");
  if (b.routeId != null) uuidParam("routeId", String(b.routeId));
  const price = b.targetPrice ?? b.maxPrice;
  if (typeof price !== "number" || !Number.isInteger(price))
    throw badRequest("invalid request body");
  if (price < 0 || price > 1_000_000_000)
    throw badRequest("target price is outside the allowed range");
  if (b.frequency != null && !isLen(b.frequency, 0, 10))
    throw badRequest("frequency has an invalid length");
  return price;
}

/** Rust `PriceAlertService::create`: the existing alert comes back, flagged, instead of a twin. */
export async function createPriceAlert(
  userId: string,
  b: CreatePriceAlertBody,
  targetPrice: number,
): Promise<{ alert: PriceAlertOut; duplicate: boolean }> {
  const phone = b.phone.trim();
  if (!phone) throw badRequest("phone is required");
  if (!isValidVnPhone(phone)) throw badRequest("invalid Vietnamese phone number");
  const fromName = b.fromName.trim();
  const toName = b.toName.trim();
  if (!fromName || !toName) throw badRequest("from_name and to_name are required");
  if (targetPrice <= 0) throw badRequest("target_price must be positive");
  const frequency = b.frequency?.trim() || "daily";

  const db = await getDb();
  const routeId = b.routeId ?? null;
  const existing = (
    await db
      .select()
      .from(priceAlerts)
      .where(
        and(
          eq(priceAlerts.targetPrice, targetPrice),
          eq(priceAlerts.status, "active"),
          routeId ? eq(priceAlerts.routeId, routeId) : isNull(priceAlerts.routeId),
          eq(priceAlerts.userId, userId),
        ),
      )
      .limit(1)
  )[0];
  if (existing) return { alert: alertOut(existing), duplicate: true };

  const now = Date.now();
  const row: AlertRow = {
    id: crypto.randomUUID(),
    userId,
    phone,
    email: b.email?.trim() ?? null,
    fromName,
    toName,
    routeId,
    targetPrice,
    frequency,
    status: "active",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ALERT_DAYS * 86_400_000).toISOString(),
    lastTriggeredAt: null,
  };
  await db.insert(priceAlerts).values(row);
  return { alert: alertOut(row), duplicate: false };
}

/**
 * `GET /api/price-alerts`: the signed-in caller's alerts, or — without a
 * session — the alerts of a `phone` (the dialog's "existing alerts" preview).
 */
export async function listPriceAlerts(opts: {
  userId: string | null;
  phone: string | null;
  status: string | null;
  limit: number;
  offset: number;
}) {
  const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE);
  let owner: SQL;
  if (opts.userId) {
    owner = eq(priceAlerts.userId, opts.userId);
  } else if (opts.phone !== null) {
    const phone = opts.phone.trim();
    if (!phone) throw badRequest("phone is required");
    owner = eq(priceAlerts.phone, phone);
  } else {
    throw new ApiError(401, "unauthorized", "login or provide a phone query param");
  }
  const where = and(owner, opts.status ? eq(priceAlerts.status, opts.status) : undefined);
  const db = await getDb();
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(priceAlerts)
      .where(where)
      .orderBy(desc(priceAlerts.createdAt))
      .limit(limit)
      .offset(opts.offset),
    db.select({ n: count() }).from(priceAlerts).where(where),
  ]);
  return { items: rows.map(alertOut), total: totals[0]?.n ?? 0, limit, offset: opts.offset };
}

/** Rust `PriceAlertService::remove`: soft-delete; phone-only (legacy) alerts have no owner to check. */
export async function cancelPriceAlert(id: string, callerId: string): Promise<PriceAlertOut> {
  const db = await getDb();
  const alert = (await db.select().from(priceAlerts).where(eq(priceAlerts.id, id)).limit(1))[0];
  if (!alert) throw notFound("price alert not found");
  if (alert.userId && alert.userId !== callerId)
    throw forbidden("can only cancel your own price alerts");
  await db.update(priceAlerts).set({ status: "cancelled" }).where(eq(priceAlerts.id, id));
  return alertOut({ ...alert, status: "cancelled" });
}
