/** Payments as the API returns them, to customers and to staff. */
import { bankNameForBin } from "./codec";
import { PaymentConfig, PaymentRow } from "./config";

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

export const orUndefined = <T>(v: T | null | undefined): T | undefined => v ?? undefined;

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
