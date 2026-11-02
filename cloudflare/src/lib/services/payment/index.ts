/**
 * The payment service's public surface. The modules behind it:
 * `config` (providers, statuses, configuration and the state machine),
 * `codec` (signing and the VietQR payload), `providers` (one per gateway),
 * `output` (API shapes), `operations` (create, read, cancel, complete),
 * `ipn` (verified provider notifications) and `admin`.
 */
export {
  PROVIDERS,
  STATUSES,
  enabledProviders,
  paymentConfig,
  type PaymentConfig,
  type Provider,
} from "./config";
export {
  bankNameForBin,
  buildMemo,
  buildVietQr,
  constantTimeEq,
  crc16,
  genTxnRef,
  percentEncode,
} from "./codec";
export { adminPaymentOut, paymentOut, type AdminPaymentOut, type PaymentOut } from "./output";
export {
  cancelPayment,
  cancelPriorPendingPayments,
  createPayment,
  ensureOwner,
  getPayment,
  listBookingPayments,
  markCodCollected,
} from "./operations";
export { handleMomoIpn, handleVnpayIpn, handleZalopayCallback } from "./ipn";
export { adminListPayments, adminPaymentSummary, adminUpdatePaymentStatus } from "./admin";
