/** Provider notifications (IPN): each is verified (signature and amount) before the payment completes. */
import { getDb } from "@/lib/db/client";
import { payments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ApiError } from "@/lib/auth/rbac";
import { badRequest, notFound } from "../booking";
import { constantTimeEq, hmacHex, percentEncode } from "./codec";
import { PaymentRow, isTerminal, paymentConfig } from "./config";
import { completePayment, markFailed } from "./operations";

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
