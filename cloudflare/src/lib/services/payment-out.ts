/**
 * PaymentOut serializer — the SPA SDK's payment shape, incl. the VietQR
 * QR image data-URI and manual bank-transfer instructions.
 */
import type { Database } from "@/lib/db/client";
import { getEnv } from "@/lib/db/client";
import { buildVietQr } from "./payment";

type PaymentRow = {
  id: string;
  bookingId: string;
  userId: string | null;
  provider: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  providerTxnRef: string | null;
  providerTransId: string | null;
  gatewayUrl: string | null;
  qrPayload: string | null;
  memo: string | null;
  providerResponse: string | null;
  failureReason: string | null;
  collectedAt: string | null;
  collectedBy: string | null;
};

export interface PaymentOut {
  id: string;
  bookingId: string;
  userId?: string | null;
  provider: string;
  status: string;
  amount: number;
  currency: string;
  gatewayUrl?: string | null;
  qrPayload?: string | null;
  qrImageDataUri?: string | null;
  bankTransferInstructions?: {
    accountName: string;
    accountNo: string;
    amount: number;
    bankBin: string;
    bankName: string;
    memo: string;
  };
  memo?: string | null;
  providerTransId?: string | null;
  providerTxnRef: string;
  failureReason?: string | null;
  collectedAt?: string | null;
  collectedBy?: string | null;
  returnUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

async function qrDataUri(payload: string): Promise<string | null> {
  try {
    const QR = (await import("qrcode")).default;
    const svg = await QR.toString(payload, { type: "svg", margin: 1, width: 256 });
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  } catch {
    return null;
  }
}

/** Serialize one payment row into `PaymentOut`. */
export async function paymentOut(p: PaymentRow): Promise<PaymentOut> {
  const out: PaymentOut = {
    id: p.id,
    bookingId: p.bookingId,
    userId: p.userId,
    provider: p.provider,
    status: p.status,
    amount: Number(p.amount),
    currency: p.currency,
    gatewayUrl: p.gatewayUrl,
    qrPayload: p.qrPayload,
    memo: p.memo,
    providerTransId: p.providerTransId,
    providerTxnRef: p.providerTxnRef ?? "",
    failureReason: p.failureReason,
    collectedAt: p.collectedAt,
    collectedBy: p.collectedBy,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
  if (p.provider === "vietqr" && p.qrPayload) {
    out.qrImageDataUri = await qrDataUri(p.qrPayload);
    const env = await getEnv();
    const bankBin = env.VIETQR_BANK_BIN ?? "";
    const accountNo = env.VIETQR_ACCOUNT_NO ?? "";
    const accountName = env.VIETQR_ACCOUNT_NAME ?? "VEXEVN";
    if (bankBin && accountNo) {
      // Keep the payload consistent with the instructions shown.
      const memo = p.memo ?? `VEXEVN`;
      out.bankTransferInstructions = {
        accountName,
        accountNo,
        amount: Number(p.amount),
        bankBin,
        bankName: env.VIETQR_BANK_NAME ?? "Ngân hàng",
        memo,
      };
      const expected = buildVietQr(bankBin, accountNo, accountName, Number(p.amount), memo);
      if (p.qrPayload !== expected) out.qrImageDataUri = await qrDataUri(expected);
    }
  }
  return out;
}

export type { Database };
