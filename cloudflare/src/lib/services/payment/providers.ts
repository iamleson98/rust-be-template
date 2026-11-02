/** One function per provider that turns a payment into what the customer pays with: a gateway URL, an order, a QR or nothing (cash). */
import { ApiError } from "@/lib/auth/rbac";
import { badRequest } from "../http-errors";
import { buildMemo, buildVietQr, genTxnRef, hmacHex, percentEncode } from "./codec";
import { PaymentConfig } from "./config";

// ── Providers ────────────────────────────────────────────────────

export interface CreateInput {
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

export async function createVnpay(cfg: PaymentConfig, input: CreateInput): Promise<ProviderResult> {
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

export async function createMomo(cfg: PaymentConfig, input: CreateInput): Promise<ProviderResult> {
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

export async function createZalopay(
  cfg: PaymentConfig,
  input: CreateInput,
): Promise<ProviderResult> {
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

export function createVietqr(cfg: PaymentConfig, input: CreateInput): ProviderResult {
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

export function createCod(input: CreateInput): ProviderResult {
  // No gateway interaction: the intent to pay cash is recorded and the
  // booking hold keeps the seats. The reference is a random internal id.
  return {
    gatewayUrl: null,
    qrPayload: null,
    providerTxnRef: genTxnRef(),
    providerResponse: JSON.stringify({ provider: "cod", booking_code: input.bookingCode }),
  };
}
