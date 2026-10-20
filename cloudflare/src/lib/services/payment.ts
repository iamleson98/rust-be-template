/**
 * Payment service — port of `payment_service.rs` and the `payment/*`
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
import { getDb, getEnv } from "@/lib/db/client";
import { bookings, payments } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { ApiError } from "@/lib/auth/rbac";
import {
  badRequest,
  confirmAsSystem,
  forbidden,
  gone,
  holdExpired,
  holdForPayment,
  holdUntilDeparture,
  notFound,
} from "./booking";

type PaymentRow = typeof payments.$inferSelect;

/** All providers, in the order checkout lists them. */
export const PROVIDERS = ["momo", "vnpay", "zalopay", "cod", "vietqr"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const STATUSES = ["pending", "completed", "failed", "cancelled", "refunded"] as const;
const isTerminal = (status: string) => status !== "pending";

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

function isActive(cfg: PaymentConfig, provider: string): boolean {
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

// ── Crypto + encoding helpers ────────────────────────────────────

const enc = new TextEncoder();

async function hmacHex(
  hash: "SHA-256" | "SHA-512",
  secret: string,
  data: string | Uint8Array,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as BufferSource,
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const sig = await crypto.subtle.sign("HMAC", key, bytes as BufferSource);
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (the signatures are public hex, but compare like Rust anyway). */
export function constantTimeEq(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Rust `percent_encode`: unreserved bytes pass, everything else is `%XX` (upper-case). */
export function percentEncode(s: string): string {
  let out = "";
  for (const b of enc.encode(s)) {
    const c = String.fromCharCode(b);
    out += /[A-Za-z0-9\-_.~]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** `VX{timestamp_millis}{6 random upper-case alphanumerics}`. */
export function genTxnRef(): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `VX${Date.now()}${Array.from(bytes, (b) => chars[b % chars.length]).join("")}`;
}

/** The memo embedded in the QR / order info. */
export const buildMemo = (bookingCode: string) => `VEXEVN-${bookingCode.toUpperCase()}`;

const nowIso = () => new Date().toISOString();

// ── VietQR payload ───────────────────────────────────────────────

function tlv(tag: string, value: string): string {
  return `${tag}${value.length.toString().padStart(2, "0")}${value}`;
}

/** CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF). */
export function crc16(data: string): number {
  let crc = 0xffff;
  for (const byte of enc.encode(data)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** The NAPAS VietQR payload (Rust `build_vietqr_string`). */
export function buildVietQr(
  bankBin: string,
  accountNo: string,
  amount: number,
  memo: string,
  billNo: string,
): string {
  const merchantAccount =
    tlv("00", "A000000727") + tlv("01", `${bankBin}${accountNo}`) + tlv("02", "5769");
  let payload =
    tlv("00", "01") + // payload format indicator
    tlv("01", "12") + // point of initiation: dynamic
    tlv("26", merchantAccount) +
    tlv("52", "4111") + // MCC: transportation
    tlv("53", "704") + // currency: VND
    tlv("54", String(amount)) +
    tlv("58", "VN") + // country
    tlv("62", tlv("01", billNo) + tlv("08", memo));
  payload += "6304";
  return payload + crc16(payload).toString(16).toUpperCase().padStart(4, "0");
}

/** Map a Vietnamese bank BIN to its display name; unknown banks show the BIN. */
export function bankNameForBin(bin: string): string {
  const names: Record<string, string> = {
    "970403": "Sacombank",
    "970407": "Techcombank",
    "970409": "BIDV",
    "970415": "VietinBank",
    "970416": "ACB",
    "970418": "Agribank",
    "970422": "MBBank",
    "970423": "TPBank",
    "970429": "Eximbank",
    "970432": "VPBank",
    "970436": "Vietcombank",
  };
  return names[bin] ?? bin;
}

// ── Providers ────────────────────────────────────────────────────

interface CreateInput {
  paymentId: string;
  bookingCode: string;
  amount: number;
  currency: string;
  returnUrl: string;
  ipnUrl: string;
  memo: string;
}

interface ProviderResult {
  gatewayUrl: string | null;
  qrPayload: string | null;
  providerTxnRef: string;
  providerResponse: string;
}

const unavailable = (message: string) => new ApiError(503, "service-unavailable", message);

/** `YYYYMMDDHHMMSS` of a UTC instant (as Rust formats VNPay dates). */
function vnpDate(d: Date): string {
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

async function createVnpay(cfg: PaymentConfig, input: CreateInput): Promise<ProviderResult> {
  const txnRef = genTxnRef();
  const now = new Date();
  const orderInfo = buildMemo(input.bookingCode);
  const amountX100 = input.amount * 100;
  const params: Record<string, string> = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: cfg.vnpay.tmnCode,
    vnp_Amount: String(amountX100),
    vnp_CurrCode: "VND",
    vnp_TxnRef: txnRef,
    vnp_OrderInfo: orderInfo,
    vnp_OrderType: "other",
    vnp_Locale: "vn",
    vnp_CreateDate: vnpDate(now),
    vnp_ExpireDate: vnpDate(new Date(now.getTime() + 15 * 60_000)),
    vnp_ReturnUrl: input.returnUrl,
    vnp_IpnUrl: input.ipnUrl,
  };
  const sortedKeys = Object.keys(params).sort();
  const signData = sortedKeys.map((k) => `${k}=${percentEncode(params[k])}`).join("&");
  const secureHash = await hmacHex("SHA-512", cfg.vnpay.hashSecret, signData);
  params.vnp_SecureHash = secureHash;
  params.vnp_SecureHashType = "HmacSHA512";
  const query = Object.keys(params)
    .map((k) => `${k}=${percentEncode(params[k])}`)
    .sort()
    .join("&");
  const base = cfg.vnpay.production
    ? "https://payment.vnpayment.vn/paymentv2/vpcpay.html"
    : "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";
  return {
    gatewayUrl: `${base}?${query}`,
    qrPayload: null,
    providerTxnRef: txnRef,
    providerResponse: JSON.stringify({
      vnp_TxnRef: txnRef,
      vnp_Amount: amountX100,
      vnp_OrderInfo: orderInfo,
    }),
  };
}

async function postJson(
  what: string,
  url: string,
  body: unknown,
): Promise<{ text: string; json: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw unavailable(`${what} create-payment failed: ${e instanceof Error ? e.message : e}`);
  }
  const text = await res.text();
  if (!res.ok) throw unavailable(`${what} returned non-2xx: ${res.status} body=${text}`);
  try {
    return { text, json: JSON.parse(text) as Record<string, unknown> };
  } catch (e) {
    throw new ApiError(500, "internal", `${what} response parse failed: ${e} body=${text}`);
  }
}

async function createMomo(cfg: PaymentConfig, input: CreateInput): Promise<ProviderResult> {
  const m = cfg.momo;
  const orderId = genTxnRef();
  const requestId = crypto.randomUUID();
  const orderInfo = buildMemo(input.bookingCode);
  const requestType = "captureWallet";
  const extraData = "";
  const signData =
    `accessKey=${m.accessKey}&amount=${input.amount}&extraData=${extraData}&ipnUrl=${input.ipnUrl}` +
    `&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${m.partnerCode}` +
    `&redirectUrl=${input.returnUrl}&requestId=${requestId}&requestType=${requestType}`;
  const signature = await hmacHex("SHA-256", m.secretKey, signData);
  const endpoint = m.production
    ? "https://payment.momo.vn/v2/gateway/api/create"
    : "https://test-payment.momo.vn/v2/gateway/api/create";
  const { text, json } = await postJson("MoMo", endpoint, {
    partnerCode: m.partnerCode,
    accessKey: m.accessKey,
    requestId,
    amount: input.amount,
    orderId,
    orderInfo,
    redirectUrl: input.returnUrl,
    ipnUrl: input.ipnUrl,
    requestType,
    extraData,
    lang: "vi",
    signature,
  });
  // MoMo answers in camelCase.
  const resultCode = typeof json.resultCode === "number" ? json.resultCode : null;
  if (resultCode !== 0)
    throw badRequest(
      `MoMo create-payment rejected: code=${resultCode} message=${String(json.message ?? "")}`,
    );
  if (typeof json.payUrl !== "string")
    throw new ApiError(500, "internal", "MoMo response missing payUrl");
  return {
    gatewayUrl: json.payUrl,
    qrPayload: null,
    providerTxnRef: orderId,
    providerResponse: text,
  };
}

async function createZalopay(cfg: PaymentConfig, input: CreateInput): Promise<ProviderResult> {
  const z = cfg.zalopay;
  const appId = Number.parseInt(z.appId, 10) || 0;
  const yymmdd = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const appTransId = `${yymmdd}_${input.bookingCode}`;
  const appUser = "VEXEVN";
  const appTime = Date.now();
  const embedData = JSON.stringify({ redirecturl: input.returnUrl, callbackurl: input.ipnUrl });
  const item = JSON.stringify([
    {
      itemid: input.bookingCode,
      itemname: `Ve xe ${input.bookingCode}`,
      itemprice: input.amount,
      itemquantity: 1,
    },
  ]);
  const mac = await hmacHex(
    "SHA-256",
    z.key1,
    [appId, appTransId, appUser, input.amount, appTime, embedData, item].join("|"),
  );
  const base = z.production
    ? "https://openapi.zalopay.com/v2"
    : "https://sb-openapi.zalopay.com/v2";
  const { text, json } = await postJson("ZaloPay", `${base}/create`, {
    app_id: appId,
    app_trans_id: appTransId,
    app_user: appUser,
    app_time: appTime,
    amount: input.amount,
    item,
    embed_data: embedData,
    callback_url: input.ipnUrl,
    description: `Thanh toan ve xe ${input.bookingCode} - ${buildMemo(input.bookingCode)}`,
    mac,
  });
  if (json.return_code !== 1)
    throw badRequest(
      `ZaloPay create-payment rejected: code=${String(json.return_code)} message=${String(json.return_message ?? "(no message)")}`,
    );
  if (typeof json.order_url !== "string")
    throw new ApiError(500, "internal", "ZaloPay response missing order_url");
  // The callback names the order by `app_trans_id`, so that is the reference
  // we store (Rust stored a random one, which the callback could never find).
  return {
    gatewayUrl: json.order_url,
    qrPayload: null,
    providerTxnRef: appTransId,
    providerResponse: text,
  };
}

function createVietqr(cfg: PaymentConfig, input: CreateInput): ProviderResult {
  const memo = buildMemo(input.bookingCode);
  return {
    gatewayUrl: null,
    qrPayload: buildVietQr(
      cfg.vietqr.bankBin,
      cfg.vietqr.accountNo,
      input.amount,
      memo,
      input.bookingCode,
    ),
    providerTxnRef: input.paymentId,
    providerResponse: JSON.stringify({ provider: "vietqr", memo, amount: input.amount }),
  };
}

function createCod(input: CreateInput): ProviderResult {
  // No gateway interaction: the intent to pay cash is recorded and the
  // booking hold keeps the seats. The reference is a random internal id.
  return {
    gatewayUrl: null,
    qrPayload: null,
    providerTxnRef: genTxnRef(),
    providerResponse: JSON.stringify({ provider: "cod", booking_code: input.bookingCode }),
  };
}

// ── Output ───────────────────────────────────────────────────────

export interface PaymentOut {
  id: string;
  bookingId: string;
  userId?: string;
  provider: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  providerTxnRef: string;
  providerTransId?: string;
  gatewayUrl?: string;
  qrPayload?: string;
  qrImageDataUri?: string;
  memo?: string;
  failureReason?: string;
  collectedAt?: string;
  collectedBy?: string;
  bankTransferInstructions?: {
    bankBin: string;
    bankName: string;
    accountNo: string;
    accountName: string;
    amount: number;
    memo: string;
  };
  returnUrl?: string;
}

const orUndefined = <T>(v: T | null | undefined): T | undefined => v ?? undefined;

async function qrSvgDataUri(payload: string): Promise<string | undefined> {
  try {
    const QR = (await import("qrcode")).default;
    const svg = await QR.toString(payload, { type: "svg", margin: 4, width: 480 });
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  } catch {
    return undefined;
  }
}

/** Serialize one payment row into `PaymentOut` (the QR image only on creation, like Rust). */
export async function paymentOut(
  p: PaymentRow,
  cfg: PaymentConfig,
  opts: { withQrImage?: boolean } = {},
): Promise<PaymentOut> {
  const vietqr = p.provider === "vietqr" && cfg.vietqr.active;
  return {
    id: p.id,
    bookingId: p.bookingId,
    userId: orUndefined(p.userId),
    provider: p.provider,
    status: p.status,
    amount: Number(p.amount),
    currency: p.currency,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    providerTxnRef: p.providerTxnRef ?? "",
    providerTransId: orUndefined(p.providerTransId),
    gatewayUrl: orUndefined(p.gatewayUrl),
    qrPayload: orUndefined(p.qrPayload),
    qrImageDataUri: opts.withQrImage && p.qrPayload ? await qrSvgDataUri(p.qrPayload) : undefined,
    memo: orUndefined(p.memo),
    failureReason: orUndefined(p.failureReason),
    collectedAt: orUndefined(p.collectedAt),
    collectedBy: orUndefined(p.collectedBy),
    bankTransferInstructions: vietqr
      ? {
          bankBin: cfg.vietqr.bankBin,
          bankName: cfg.vietqr.bankName || bankNameForBin(cfg.vietqr.bankBin),
          accountNo: cfg.vietqr.accountNo,
          accountName: cfg.vietqr.accountName,
          amount: Number(p.amount),
          memo: p.memo ?? "",
        }
      : undefined,
    returnUrl: `${cfg.publicBaseUrl.replace(/\/+$/, "")}/payments/${p.id}/return`,
  };
}

/** Admin shape: adds the booking code and the raw provider response. */
export interface AdminPaymentOut extends Omit<
  PaymentOut,
  "qrImageDataUri" | "bankTransferInstructions" | "returnUrl"
> {
  bookingCode?: string;
  providerResponse?: string;
}

export function adminPaymentOut(
  p: PaymentRow,
  bookingCode: string | null | undefined,
): AdminPaymentOut {
  return {
    id: p.id,
    bookingId: p.bookingId,
    bookingCode: orUndefined(bookingCode),
    userId: orUndefined(p.userId),
    provider: p.provider,
    status: p.status,
    amount: Number(p.amount),
    currency: p.currency,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    providerTxnRef: p.providerTxnRef ?? "",
    providerTransId: orUndefined(p.providerTransId),
    gatewayUrl: orUndefined(p.gatewayUrl),
    qrPayload: orUndefined(p.qrPayload),
    memo: orUndefined(p.memo),
    providerResponse: orUndefined(p.providerResponse),
    failureReason: orUndefined(p.failureReason),
    collectedAt: orUndefined(p.collectedAt),
    collectedBy: orUndefined(p.collectedBy),
  };
}

// ── Ownership ────────────────────────────────────────────────────

/**
 * A booking and its payments belong to the user who made the booking. Only
 * a booking with no owner at all (a legacy guest booking) is open to
 * whoever holds its id. Signed-out callers get 401 on an owned booking so
 * the client can send them to sign in.
 */
export function ensureOwner(owner: string | null, caller: string | null): void {
  if (!owner) return;
  if (!caller) throw new ApiError(401, "unauthorized", "sign in to continue");
  if (caller !== owner) throw forbidden("not your booking");
}

async function findPayment(id: string): Promise<PaymentRow> {
  const db = await getDb();
  const p = (await db.select().from(payments).where(eq(payments.id, id)).limit(1))[0];
  if (!p) throw notFound("payment not found");
  return p;
}

/** The payment's owner: the user stored on the payment, else the booking's. */
async function assertOwnership(p: PaymentRow, caller: string | null): Promise<void> {
  let owner = p.userId;
  if (!owner) {
    const db = await getDb();
    const b = (await db.select().from(bookings).where(eq(bookings.id, p.bookingId)).limit(1))[0];
    owner = b?.userId ?? null;
  }
  ensureOwner(owner, caller);
}

// ── User-facing operations ───────────────────────────────────────

const ALLOWED = PROVIDERS.join(", ");

/**
 * Create a payment intent for a booking: the booking must be `pending` and
 * its hold alive; a previous pending payment is cancelled (one active
 * payment per booking); the provider is asked for the gateway URL / QR.
 */
export async function createPayment(
  req: { bookingId: string; provider: string },
  callerId: string | null,
): Promise<{ payment: PaymentOut }> {
  if (typeof req.provider !== "string" || req.provider.length < 1 || req.provider.length > 16)
    throw badRequest("provider has an invalid length");
  if (!(PROVIDERS as readonly string[]).includes(req.provider))
    throw badRequest(`invalid provider: ${req.provider} (allowed: ${ALLOWED})`);

  const db = await getDb();
  const booking = (
    await db.select().from(bookings).where(eq(bookings.id, req.bookingId)).limit(1)
  )[0];
  if (!booking) throw notFound("booking not found");
  ensureOwner(booking.userId, callerId);
  if (booking.status !== "pending")
    throw badRequest(`booking is not in pending status (current: ${booking.status})`);
  if (holdExpired(booking)) throw gone("booking hold has expired");
  // A coupon can cover the whole fare. Gateways refuse a zero amount, so
  // such a booking is placed with pay-on-board (nothing to collect).
  if (booking.total <= 0 && req.provider !== "cod")
    throw badRequest("nothing to pay online: choose pay on board (cod)");

  // Rust checks the provider after placing the booking, so a disabled
  // provider still moved the hold and cancelled the previous payment before
  // failing. Checking first leaves the booking untouched on that failure.
  const cfg = await paymentConfig();
  if (!isActive(cfg, req.provider)) throw badRequest(`provider '${req.provider}' is not enabled`);

  // Paying on board places the booking: its seats wait until departure for
  // the operator's confirmation call. A gateway payment needs longer than
  // the checkout hold; the seats stay put while it runs.
  const held =
    req.provider === "cod"
      ? await holdUntilDeparture(booking, "cod")
      : await holdForPayment(booking.id, req.provider);
  if (!held) throw badRequest("booking is not in pending status");

  await cancelPriorPendingPayments(booking.id);

  const base = cfg.publicBaseUrl.replace(/\/+$/, "");
  const input: CreateInput = {
    paymentId: crypto.randomUUID(),
    bookingCode: booking.code,
    amount: booking.total,
    currency: booking.currency,
    returnUrl: `${base}/payments/${booking.id}/return`,
    ipnUrl: `${base}/api/payments/ipn/${req.provider}`,
    memo: buildMemo(booking.code),
  };
  const result =
    req.provider === "vnpay"
      ? await createVnpay(cfg, input)
      : req.provider === "momo"
        ? await createMomo(cfg, input)
        : req.provider === "zalopay"
          ? await createZalopay(cfg, input)
          : req.provider === "vietqr"
            ? createVietqr(cfg, input)
            : createCod(input);

  const now = nowIso();
  const row: PaymentRow = {
    id: crypto.randomUUID(),
    bookingId: booking.id,
    userId: booking.userId,
    provider: req.provider,
    status: "pending",
    amount: booking.total,
    currency: booking.currency,
    createdAt: now,
    updatedAt: now,
    providerTxnRef: result.providerTxnRef,
    providerTransId: null,
    gatewayUrl: result.gatewayUrl,
    qrPayload: result.qrPayload,
    memo: input.memo,
    providerResponse: result.providerResponse,
    failureReason: null,
    createdBy: callerId,
    collectedAt: null,
    collectedBy: null,
  };
  await db.insert(payments).values(row);
  return { payment: await paymentOut(row, cfg, { withQrImage: true }) };
}

/** Cancel every pending payment of a booking (one active payment at a time). */
export async function cancelPriorPendingPayments(bookingId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(payments)
    .set({ status: "cancelled", updatedAt: nowIso(), failureReason: "superseded by new payment" })
    .where(and(eq(payments.bookingId, bookingId), eq(payments.status, "pending")));
}

/** A single payment; the caller must own its booking. */
export async function getPayment(id: string, callerId: string | null): Promise<PaymentOut> {
  const p = await findPayment(id);
  await assertOwnership(p, callerId);
  return paymentOut(p, await paymentConfig());
}

/** The payments of a booking, newest first; the caller must own the booking. */
export async function listBookingPayments(
  bookingId: string,
  callerId: string | null,
): Promise<{ items: PaymentOut[] }> {
  const db = await getDb();
  const booking = (await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1))[0];
  if (!booking) throw notFound("booking not found");
  ensureOwner(booking.userId, callerId);
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.bookingId, bookingId))
    .orderBy(desc(payments.createdAt));
  const cfg = await paymentConfig();
  return { items: await Promise.all(rows.map((p) => paymentOut(p, cfg))) };
}

/**
 * Cancel a pending payment (user-initiated). Does NOT cancel the booking —
 * the user can immediately create a new payment with a different provider.
 */
export async function cancelPayment(id: string, callerId: string | null, reason?: string | null) {
  if (reason != null && reason.length > 1000) throw badRequest("reason has an invalid length");
  const p = await findPayment(id);
  await assertOwnership(p, callerId);
  if (p.status !== "pending")
    throw badRequest(`payment is not in pending status (current: ${p.status})`);
  const now = nowIso();
  const db = await getDb();
  await db
    .update(payments)
    .set({ status: "cancelled", updatedAt: now, failureReason: reason ?? null })
    .where(eq(payments.id, id));
  return { paymentId: id, status: "cancelled", cancelledAt: now, reason: reason ?? undefined };
}

// ── Completion ───────────────────────────────────────────────────

/**
 * Confirm the booking behind a payment that has been collected. If that is
 * no longer possible (the booking was cancelled or its seats were released)
 * the customer has paid for nothing: say so loudly and write it on the
 * payment so an admin sees it in the payments list. Returns the error.
 */
async function confirmPaidBooking(p: PaymentRow): Promise<unknown | null> {
  try {
    await confirmAsSystem(p.bookingId, p.provider);
    return null;
  } catch (error) {
    console.error(
      `[payment] payment ${p.id} collected but booking ${p.bookingId} could not be confirmed — refund or fix by hand`,
      error,
    );
    const text = error instanceof Error ? error.message : String(error);
    const db = await getDb();
    await db
      .update(payments)
      .set({
        failureReason: `paid, but the booking could not be confirmed: ${text}`,
        updatedAt: nowIso(),
      })
      .where(eq(payments.id, p.id));
    return error;
  }
}

/**
 * Money was verified: the booking is confirmed FIRST (idempotent), then the
 * payment completes, so a Worker killed between the two leaves a payment
 * that is still `pending` and a gateway retry finishes the job. (Rust
 * completes the payment first, which would strand a paid booking.)
 */
async function completePayment(
  p: PaymentRow,
  extra: Partial<typeof payments.$inferInsert> = {},
): Promise<unknown | null> {
  const error = await confirmPaidBooking(p);
  const db = await getDb();
  await db
    .update(payments)
    .set({ ...extra, status: "completed", updatedAt: nowIso() })
    .where(and(eq(payments.id, p.id), eq(payments.status, "pending")));
  return error;
}

async function markFailed(p: PaymentRow, reason: string, providerResponse: string): Promise<void> {
  // Conditional so concurrent IPN retries only flip pending → failed.
  const db = await getDb();
  await db
    .update(payments)
    .set({ status: "failed", updatedAt: nowIso(), failureReason: reason, providerResponse })
    .where(and(eq(payments.id, p.id), eq(payments.status, "pending")));
}

/**
 * Mark a COD payment as collected (cash received by driver/staff):
 * `pending → completed` and the booking is confirmed.
 */
export async function markCodCollected(
  id: string,
  staffId: string,
  body: { amountCollected?: number | null; note?: string | null } = {},
) {
  if (
    body.amountCollected != null &&
    (!Number.isInteger(body.amountCollected) ||
      body.amountCollected < 0 ||
      body.amountCollected > 1_000_000_000)
  )
    throw badRequest("amount collected is outside the allowed range");
  if (body.note != null && body.note.length > 500) throw badRequest("note has an invalid length");
  const p = await findPayment(id);
  if (p.provider !== "cod") throw badRequest("mark-cod-collected is only valid for COD payments");
  if (p.status !== "pending")
    throw badRequest(`payment is not in pending status (current: ${p.status})`);
  const now = nowIso();
  const error = await completePayment(p, { collectedAt: now, collectedBy: staffId });
  if (error) throw error;
  return {
    paymentId: p.id,
    status: "completed",
    amountCollected: body.amountCollected ?? Number(p.amount),
    collectedAt: now,
  };
}

// ── IPN webhooks ─────────────────────────────────────────────────
//
// Each handler resolves normally when the notification was processed (or
// was a harmless repeat) and throws a 404 ApiError when no payment matches
// its reference; anything else thrown means "could not verify".

async function paymentByTxnRef(txnRef: string): Promise<PaymentRow> {
  const db = await getDb();
  const p = (
    await db.select().from(payments).where(eq(payments.providerTxnRef, txnRef)).limit(1)
  )[0];
  if (!p) throw notFound(`payment with txn_ref ${txnRef} not found`);
  return p;
}

/** VNPay IPN: GET callback with all params in the query string. */
export async function handleVnpayIpn(params: Record<string, string>): Promise<void> {
  const cfg = await paymentConfig();
  const received = params.vnp_SecureHash;
  if (received === undefined) throw badRequest("missing vnp_SecureHash");
  const signData = Object.keys(params)
    .filter((k) => k !== "vnp_SecureHash" && k !== "vnp_SecureHashType")
    .sort()
    .map((k) => `${k}=${percentEncode(params[k])}`)
    .join("&");
  const computed = await hmacHex("SHA-512", cfg.vnpay.hashSecret, signData);
  if (!constantTimeEq(computed, received))
    throw new ApiError(401, "unauthorized", "invalid vnp_SecureHash signature");
  const txnRef = params.vnp_TxnRef;
  if (txnRef === undefined) throw badRequest("missing vnp_TxnRef");

  const p = await paymentByTxnRef(txnRef);
  // Idempotency: an already-terminal payment is not touched twice.
  if (isTerminal(p.status)) return;

  const responseCode = params.vnp_ResponseCode ?? "";
  const txnStatus = params.vnp_TransactionStatus ?? "";
  const response = JSON.stringify(params);
  if (responseCode === "00" && txnStatus === "00") {
    const expected = Number(p.amount) * 100; // VNPay amounts are VND × 100
    const actual = /^-?\d+$/.test(params.vnp_Amount ?? "") ? Number(params.vnp_Amount) : null;
    if (actual != null && actual !== expected) {
      await markFailed(p, `amount mismatch: expected ${expected}, got ${actual}`, response);
      return;
    }
    await completePayment(p, {
      providerTransId: params.vnp_TransactionNo ?? null,
      providerResponse: response,
    });
  } else {
    // The booking stays pending so the user can retry with another provider.
    await markFailed(
      p,
      `vnp_ResponseCode=${responseCode}, vnp_TransactionStatus=${txnStatus}`,
      response,
    );
  }
}

/** MoMo notifies in camelCase; Rust's struct also names the fields in snake_case. */
function momoField(body: Record<string, unknown>, camel: string, snake: string): unknown {
  return body[camel] ?? body[snake];
}

/** MoMo IPN: POST JSON body. */
export async function handleMomoIpn(body: Record<string, unknown>): Promise<void> {
  const cfg = await paymentConfig();
  const f = (camel: string, snake: string) => momoField(body, camel, snake);
  const str = (v: unknown) => (v == null ? "" : String(v));
  const need = (v: unknown, name: string) => {
    if (v === undefined || v === null)
      throw new ApiError(422, "validation", `missing field ${name}`);
    return v;
  };
  const amount = Number(need(f("amount", "amount"), "amount"));
  const transId = Number(need(f("transId", "trans_id"), "transId"));
  const resultCode = Number(need(f("resultCode", "result_code"), "resultCode"));
  const orderId = str(need(f("orderId", "order_id"), "orderId"));
  const signature = str(need(f("signature", "signature"), "signature"));
  const signData =
    `accessKey=${cfg.momo.accessKey}&amount=${amount}&extraData=${str(f("extraData", "extra_data"))}` +
    `&message=${str(f("message", "message"))}&orderId=${orderId}` +
    `&orderInfo=${str(f("orderInfo", "order_info"))}&orderType=${str(f("orderType", "order_type"))}` +
    `&partnerCode=${str(f("partnerCode", "partner_code"))}&payType=${str(f("payType", "pay_type"))}` +
    `&requestId=${str(f("requestId", "request_id"))}&responseTime=${str(f("responseTime", "response_time"))}` +
    `&resultCode=${resultCode}&transId=${transId}`;
  const computed = await hmacHex("SHA-256", cfg.momo.secretKey, signData);
  if (!constantTimeEq(computed, signature))
    throw new ApiError(401, "unauthorized", "invalid MoMo signature");

  const p = await paymentByTxnRef(orderId);
  if (isTerminal(p.status)) return;
  const response = JSON.stringify(body);
  if (resultCode === 0) {
    if (amount !== Number(p.amount)) {
      await markFailed(p, `amount mismatch: expected ${p.amount}, got ${amount}`, response);
      return;
    }
    await completePayment(p, { providerTransId: String(transId), providerResponse: response });
  } else {
    await markFailed(p, `resultCode=${resultCode}`, response);
  }
}

/**
 * ZaloPay callback: POST `{ data, mac, type }`, where `data` is a JSON
 * string and `mac = HMAC-SHA256(key2, data)`. ZaloPay calls back only for
 * paid orders.
 */
export async function handleZalopayCallback(rawBody: string): Promise<void> {
  const cfg = await paymentConfig();
  let body: { data?: unknown; mac?: unknown };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch (e) {
    throw badRequest(`ZaloPay callback body parse failed: ${e}`);
  }
  if (typeof body.data !== "string" || typeof body.mac !== "string")
    throw badRequest("ZaloPay callback body parse failed: missing data or mac");
  const computed = await hmacHex("SHA-256", cfg.zalopay.key2, body.data);
  if (!constantTimeEq(computed, body.mac))
    throw new ApiError(401, "unauthorized", "invalid ZaloPay mac");
  const data = JSON.parse(body.data) as {
    app_id?: number;
    app_trans_id?: string;
    zp_trans_id?: number;
    amount?: number;
  };
  if (Number(data.app_id) !== (Number.parseInt(cfg.zalopay.appId, 10) || 0))
    throw new ApiError(401, "unauthorized", "ZaloPay callback app_id mismatch");

  const p = await paymentByTxnRef(String(data.app_trans_id ?? ""));
  if (isTerminal(p.status)) return;
  const zpTransId = Number(data.zp_trans_id ?? 0);
  const response = body.data;
  if (zpTransId > 0) {
    if (Number(data.amount) !== Number(p.amount)) {
      await markFailed(p, `amount mismatch: expected ${p.amount}, got ${data.amount}`, response);
      return;
    }
    await completePayment(p, { providerTransId: String(zpTransId), providerResponse: response });
  } else {
    await markFailed(p, `zp_trans_id=${zpTransId} (non-positive)`, response);
  }
}

// ── Admin operations ─────────────────────────────────────────────

export async function adminListPayments(q: {
  status?: string | null;
  provider?: string | null;
  limit?: number | null;
  offset?: number | null;
}) {
  const limit = Math.min(Math.max(q.limit ?? 20, 1), 200);
  const offset = q.offset ?? 0;
  const db = await getDb();
  const where = and(
    q.status ? eq(payments.status, q.status) : undefined,
    q.provider ? eq(payments.provider, q.provider) : undefined,
  );
  const rows = await db
    .select({ payment: payments, bookingCode: bookings.code })
    .from(payments)
    .leftJoin(bookings, eq(bookings.id, payments.bookingId))
    .where(where)
    .orderBy(desc(payments.createdAt))
    .limit(limit)
    .offset(offset);
  const totalRows = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(payments)
    .where(where);
  return {
    items: rows.map((r) => adminPaymentOut(r.payment, r.bookingCode)),
    total: Number(totalRows[0]?.n ?? 0),
  };
}

/** Totals over every payment: how many per status and the money collected. */
export async function adminPaymentSummary() {
  const db = await getDb();
  const rows = await db
    .select({
      status: payments.status,
      n: sql<number>`COUNT(*)`,
      amount: sql<number | null>`SUM(${payments.amount})`,
    })
    .from(payments)
    .groupBy(payments.status);
  const summary = {
    total: 0,
    pending: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    refunded: 0,
    collected: 0,
  };
  for (const r of rows) {
    const n = Number(r.n);
    summary.total += n;
    if (r.status === "pending") summary.pending = n;
    else if (r.status === "completed") {
      summary.completed = n;
      summary.collected = Number(r.amount ?? 0);
    } else if (r.status === "failed") summary.failed = n;
    else if (r.status === "cancelled") summary.cancelled = n;
    else if (r.status === "refunded") summary.refunded = n;
  }
  return summary;
}

export async function adminGetPayment(id: string): Promise<AdminPaymentOut> {
  const p = await findPayment(id);
  const db = await getDb();
  const b = (await db.select().from(bookings).where(eq(bookings.id, p.bookingId)).limit(1))[0];
  return adminPaymentOut(p, b?.code);
}

/**
 * Manual override of a payment's status. Marking a payment `completed` also
 * confirms its booking (a failure to do so is written on the payment).
 */
export async function adminUpdatePaymentStatus(id: string, status: string, reason?: string | null) {
  if (typeof status !== "string" || status.length < 1 || status.length > 16)
    throw badRequest("status has an invalid length");
  if (reason != null && reason.length > 1000) throw badRequest("reason has an invalid length");
  if (!(STATUSES as readonly string[]).includes(status))
    throw badRequest(`invalid status: ${status} (allowed: ${STATUSES.join(", ")})`);
  const p = await findPayment(id);
  const now = nowIso();
  const db = await getDb();
  await db
    .update(payments)
    .set({ status, updatedAt: now, ...(reason != null ? { failureReason: reason } : {}) })
    .where(eq(payments.id, id));
  if (status === "completed") await confirmPaidBooking(p);
  const updated = await findPayment(id);
  return {
    paymentId: id,
    status,
    reason: orUndefined(updated.failureReason),
    updatedAt: now,
  };
}
