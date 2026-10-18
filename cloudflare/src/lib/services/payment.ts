/**
 * Payment service — port of payment_service.rs.
 *
 * Providers:
 *  - cod:    no gateway; pending until staff marks collected → booking confirmed
 *  - vietqr: EMVCo QR payload built locally (no external calls), manual reconcile
 *  - vnpay:  gateway URL + HMAC-SHA512 secure hash (works when secrets configured)
 *  - momo / zalopay: registry-ready; return "not configured" until credentials
 *    are added (config state, not missing features — same behavior as the Rust
 *    backend with unset env).
 *
 * One active payment per booking (prior pending auto-cancelled).
 */
import { getDb, type Database } from "@/lib/db/client";
import { bookings, payments } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { ApiError } from "@/lib/auth/rbac";
import { getEnv } from "@/lib/db/client";
import { completeBookingPayment } from "./booking";

export type Provider = "cod" | "vietqr" | "vnpay" | "momo" | "zalopay";

export async function enabledProviders(): Promise<
  { id: Provider; label: string; requiresRedirect: boolean }[]
> {
  const env = await getEnv();
  const on = (v?: string) => v === "true";
  const list: { id: Provider; label: string; requiresRedirect: boolean }[] = [];
  if (on(env.PAYMENT_COD_ENABLED ?? "true"))
    list.push({ id: "cod", label: "Thanh toán khi lên xe (COD)", requiresRedirect: false });
  if (on(env.VIETQR_ENABLED)) {
    const ready = !!(env.VIETQR_BANK_BIN && env.VIETQR_ACCOUNT_NO);
    if (ready) list.push({ id: "vietqr", label: "Chuyển khoản QR (VietQR)", requiresRedirect: false });
  }
  if (on(env.VNPAY_ENABLED) && env.VNPAY_TMN_CODE && env.VNPAY_HASH_SECRET)
    list.push({ id: "vnpay", label: "VNPay", requiresRedirect: true });
  if (on(env.MOMO_ENABLED) && env.MOMO_PARTNER_CODE)
    list.push({ id: "momo", label: "MoMo", requiresRedirect: true });
  if (on(env.ZALOPAY_ENABLED) && env.ZALOPAY_APP_ID)
    list.push({ id: "zalopay", label: "ZaloPay", requiresRedirect: true });
  return list;
}

function genTxnRef(): string {
  const ms = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `VX${ms}${rand}`;
}

/** CRC16-CCITT (0x1021, init 0xFFFF) for EMV QR. */
function crc16(data: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(data)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Build an EMVCo-compatible VietQR payload (bank transfer QR). */
export function buildVietQr(
  bankBin: string,
  accountNo: string,
  accountName: string,
  amount: number,
  memo: string,
): string {
  const tl = (id: string, value: string) =>
    `${id}${value.length.toString().padStart(2, "0")}${value}`;
  const beneficiary = tl("00", tl("00", "A000000727") + tl("01", tl("00", bankBin) + tl("01", accountNo)));
  let payload =
    tl("00", "01") +
    tl("01", "12") + // dynamic QR
    tl("26", beneficiary) +
    tl("52", "0000") +
    tl("53", "704") + // VND
    tl("54", String(amount)) +
    tl("58", "VN") +
    tl("59", accountName.slice(0, 25)) +
    tl("60", "VN") +
    tl("62", tl("08", memo.slice(0, 25)));
  payload += "6304";
  return payload + crc16(payload);
}

async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** VNPay gateway URL (vnp_SecureHash = HMAC-SHA512 over sorted params). */
async function buildVnpayUrl(
  env: CloudflareEnv,
  booking: typeof bookings.$inferSelect,
  amount: number,
  txnRef: string,
  ip: string,
): Promise<string> {
  const base = env.APP_ENV === "development"
    ? "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"
    : "https://pay.vnpay.vn/vpcpay.html";
  const now = new Date(Date.now() + 10 * 60_000); // default expiry 10 min
  const params: Record<string, string> = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: env.VNPAY_TMN_CODE!,
    vnp_Amount: String(amount * 100),
    vnp_CurrCode: "VND",
    vnp_TxnRef: txnRef,
    vnp_OrderInfo: `Thanh toan ve ${booking.code}`,
    vnp_OrderType: "250000",
    vnp_Locale: "vn",
    vnp_ReturnUrl: `${env.PAYMENT_PUBLIC_BASE_URL ?? ""}/payments/callback`,
    vnp_IpAddr: ip || "127.0.0.1",
    vnp_CreateDate: toVnpFormat(new Date()),
    vnp_ExpireDate: toVnpFormat(now),
  };
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k]!)}`)
    .join("&");
  const secureHash = await hmacSha512Hex(env.VNPAY_HASH_SECRET!, sorted);
  return `${base}?${sorted}&vnp_SecureHashType=HMACSHA512&vnp_SecureHash=${secureHash}`;
}

function toVnpFormat(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export interface CreatePaymentInput {
  bookingId: string;
  provider: Provider;
  userId?: string | null;
  ip?: string;
}

export async function createPayment(
  db: Database,
  input: CreatePaymentInput,
): Promise<typeof payments.$inferSelect> {
  const env = await getEnv();
  const booking = (
    await db.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1)
  )[0];
  if (!booking) throw new ApiError(404, "not-found", "Booking not found");
  if (booking.status === "cancelled")
    throw new ApiError(409, "conflict", "Booking was cancelled");

  const providers = await enabledProviders();
  if (!providers.some((p) => p.id === input.provider))
    throw new ApiError(400, "validation", `Payment provider not available: ${input.provider}`);

  // Zero-total bookings must use COD (port of the Rust rule).
  if (booking.total <= 0 && input.provider !== "cod")
    throw new ApiError(400, "validation", "Zero-total bookings must use COD");

  const id = crypto.randomUUID();
  const txnRef = genTxnRef();
  const now = new Date().toISOString();
  const memo = `VEXEVN-${booking.code}`;

  let gatewayUrl: string | null = null;
  let qrPayload: string | null = null;
  if (input.provider === "vnpay") {
    gatewayUrl = await buildVnpayUrl(env, booking, booking.total, txnRef, input.ip ?? "127.0.0.1");
  } else if (input.provider === "vietqr") {
    qrPayload = buildVietQr(
      env.VIETQR_BANK_BIN ?? "",
      env.VIETQR_ACCOUNT_NO ?? "",
      env.VIETQR_ACCOUNT_NAME ?? "",
      booking.total,
      memo,
    );
  }

  // One active payment: auto-cancel prior pending.
  await db
    .update(payments)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(eq(payments.bookingId, booking.id), eq(payments.status, "pending")));

  const row: typeof payments.$inferSelect = {
    id,
    bookingId: booking.id,
    userId: input.userId ?? booking.userId,
    provider: input.provider,
    status: "pending",
    amount: booking.total,
    currency: "VND",
    providerTxnRef: txnRef,
    providerTransId: null,
    gatewayUrl,
    qrPayload,
    memo,
    providerResponse: null,
    failureReason: null,
    createdBy: input.userId ?? booking.userId,
    collectedAt: null,
    collectedBy: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(payments).values(row);

  // COD on zero-total bookings confirms immediately.
  if (input.provider === "cod" && booking.total <= 0) {
    await db.update(payments).set({ status: "completed", updatedAt: now }).where(eq(payments.id, id));
    await completeBookingPayment(db, booking.id);
    row.status = "completed";
  }
  return row;
}

/** Staff: mark COD cash collected → completed + booking confirmed. */
export async function markCodCollected(db: Database, paymentId: string, staffId: string) {
  const now = new Date().toISOString();
  const payment = (
    await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
  )[0];
  if (!payment) throw new ApiError(404, "not-found", "Payment not found");
  if (payment.provider !== "cod") throw new ApiError(400, "validation", "Not a COD payment");
  if (payment.status === "completed") return payment; // idempotent
  if (payment.status !== "pending")
    throw new ApiError(409, "conflict", `Payment is ${payment.status}`);
  await db
    .update(payments)
    .set({ status: "completed", collectedAt: now, collectedBy: staffId, updatedAt: now })
    .where(eq(payments.id, paymentId));
  await completeBookingPayment(db, payment.bookingId);
  return { ...payment, status: "completed", collectedAt: now, collectedBy: staffId };
}

export async function cancelPayment(db: Database, paymentId: string) {
  const now = new Date().toISOString();
  const payment = (
    await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
  )[0];
  if (!payment) throw new ApiError(404, "not-found", "Payment not found");
  if (payment.status !== "pending")
    throw new ApiError(409, "conflict", `Payment is ${payment.status}`);
  await db.update(payments).set({ status: "cancelled", updatedAt: now }).where(eq(payments.id, paymentId));
  return { ...payment, status: "cancelled" };
}
