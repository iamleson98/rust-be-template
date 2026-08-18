/**
 * Payment API client — manually written to bridge the gap between
 * the OpenAPI auto-generated SDK (which doesn't yet include the new
 * payment endpoints) and the TanStack Query hooks.
 *
 * Once the OpenAPI spec is regenerated (run the server, then
 * `bunx @hey-api/openapi-ts` in `frontend/`), these types and
 * functions will be redundant — the auto-generated equivalents will
 * replace them. For now, this file is the single source of truth
 * for the payment wire shapes on the frontend.
 *
 * All shapes match the Rust DTOs in `src/dto/payment.rs`. When
 * adding a new field to a Rust DTO, also add it here so the
 * frontend types stay in sync.
 */

import { client } from '@/lib/api/client.gen'
import type { Options, RequestResult } from '@/lib/api/client'
import { createAuthFetch } from '@/lib/auth-fetch'

/**
 * Pre-configured fetch instance that:
 *   - Sends cookies (`credentials: 'include'`).
 *   - On 401, transparently refreshes the access token once + retries the request.
 *
 * Mirrors the configuration the auto-generated SDK receives in
 * `src/entry-client.tsx` (`client.setConfig({ fetch: createAuthFetch() })`).
 * The payment API client uses its own instance to keep it independent of
 * the global SDK configuration (so changes to the SDK client don't
 * affect payment calls).
 */
const authFetch = createAuthFetch()

// ─────────────────────────────────────────────────────────────
//  Types — mirror `src/dto/payment.rs`
// ─────────────────────────────────────────────────────────────

export type PaymentProvider = 'vnpay' | 'momo' | 'zalopay' | 'vietqr' | 'cod'
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'refunded'

export type BankTransferInstructions = {
  bankBin: string
  bankName: string
  accountNo: string
  accountName: string
  amount: number
  memo: string
}

/**
 * A single payment row, with provider-specific rendering hints.
 *
 * Rendering rules (front-end):
 *   - `gatewayUrl` set → render "Pay now" button that opens the URL
 *     in a new tab (VNPay / MoMo / ZaloPay).
 *   - `qrPayload` set → render a QR image (VietQR). Either encode
 *     the payload string with a client-side QR library or use the
 *     pre-rendered `qrImageDataUri`.
 *   - Neither + `provider === 'cod'` → render "Pay on the bus" copy
 *     + "Cash collected by driver" status pill.
 */
export type PaymentOut = {
  id: string
  bookingId: string
  userId?: string | null
  provider: PaymentProvider
  status: PaymentStatus
  amount: number
  currency: string
  createdAt: string
  updatedAt: string
  providerTxnRef: string
  providerTransId?: string | null
  gatewayUrl?: string | null
  qrPayload?: string | null
  /** Pre-rendered PNG data URI for VietQR. */
  qrImageDataUri?: string | null
  memo?: string | null
  failureReason?: string | null
  collectedAt?: string | null
  collectedBy?: string | null
  /** For VietQR — bank-transfer instructions. */
  bankTransferInstructions?: BankTransferInstructions | null
  returnUrl?: string | null
}

export type CreatePaymentRequest = {
  bookingId: string
  provider: PaymentProvider
}

export type CreatePaymentResponse = {
  payment: PaymentOut
}

export type ListPaymentsResponse = {
  items: PaymentOut[]
  total?: number | null
}

export type CancelPaymentRequest = {
  reason?: string
}

export type CancelPaymentResponse = {
  paymentId: string
  status: PaymentStatus
  cancelledAt: string
  reason?: string | null
}

export type MarkCodCollectedRequest = {
  amountCollected?: number
  note?: string
}

export type MarkCodCollectedResponse = {
  paymentId: string
  status: PaymentStatus
  amountCollected: number
  collectedAt: string
}

export type AdminPaymentOut = {
  id: string
  bookingId: string
  bookingCode?: string | null
  userId?: string | null
  provider: PaymentProvider
  status: PaymentStatus
  amount: number
  currency: string
  createdAt: string
  updatedAt: string
  providerTxnRef: string
  providerTransId?: string | null
  gatewayUrl?: string | null
  qrPayload?: string | null
  memo?: string | null
  providerResponse?: string | null
  failureReason?: string | null
  collectedAt?: string | null
  collectedBy?: string | null
}

export type AdminPaymentListResponse = {
  items: AdminPaymentOut[]
  total?: number | null
}

export type AdminPaymentsQuery = {
  status?: PaymentStatus
  provider?: PaymentProvider
  limit?: number
  offset?: number
}

export type UpdatePaymentStatusRequest = {
  status: PaymentStatus
  reason?: string
}

export type UpdatePaymentStatusResponse = {
  paymentId: string
  status: PaymentStatus
  reason?: string | null
  updatedAt: string
}

// ─────────────────────────────────────────────────────────────
//  SDK functions — thin wrappers over the shared `client`.
//
//  All functions use `authFetch` as the underlying fetch implementation
//  so the cookie-based access-token rotation (401 → refresh → retry)
//  works transparently for payment calls.
// ─────────────────────────────────────────────────────────────

const jsonHeaders = { 'Content-Type': 'application/json' }

/** `POST /api/payments` — initiate a payment for a booking. */
export async function createPayment(
  body: CreatePaymentRequest,
): Promise<CreatePaymentResponse> {
  const res = await authFetch(`${client.getConfig().baseUrl}/api/payments`, {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw await toError(res)
  }
  return (await res.json()) as CreatePaymentResponse
}

/** `GET /api/payments/{id}` — get payment status (for polling). */
export async function getPayment(id: string): Promise<PaymentOut> {
  const res = await authFetch(`${client.getConfig().baseUrl}/api/payments/${encodeURIComponent(id)}`, {
    method: 'GET',
    credentials: 'include',
  })
  if (!res.ok) {
    throw await toError(res)
  }
  return (await res.json()) as PaymentOut
}

/** `GET /api/payments/booking/{bookingId}` — list payments for a booking. */
export async function listBookingPayments(bookingId: string): Promise<ListPaymentsResponse> {
  const res = await authFetch(
    `${client.getConfig().baseUrl}/api/payments/booking/${encodeURIComponent(bookingId)}`,
    { method: 'GET', credentials: 'include' },
  )
  if (!res.ok) {
    throw await toError(res)
  }
  return (await res.json()) as ListPaymentsResponse
}

/** `POST /api/payments/{id}/cancel` — cancel a pending payment. */
export async function cancelPayment(
  id: string,
  body: CancelPaymentRequest = {},
): Promise<CancelPaymentResponse> {
  const res = await authFetch(
    `${client.getConfig().baseUrl}/api/payments/${encodeURIComponent(id)}/cancel`,
    {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    throw await toError(res)
  }
  return (await res.json()) as CancelPaymentResponse
}

/** `POST /api/payments/{id}/mark-cod-collected` — driver/admin confirms cash received. */
export async function markCodCollected(
  id: string,
  body: MarkCodCollectedRequest = {},
): Promise<MarkCodCollectedResponse> {
  const res = await authFetch(
    `${client.getConfig().baseUrl}/api/payments/${encodeURIComponent(id)}/mark-cod-collected`,
    {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    throw await toError(res)
  }
  return (await res.json()) as MarkCodCollectedResponse
}

// ─────────────────────────────────────────────────────────────
//  Admin SDK functions
// ─────────────────────────────────────────────────────────────

/** `GET /api/admin/payments` — paginated payment list. */
export async function listAdminPayments(
  query: AdminPaymentsQuery = {},
): Promise<AdminPaymentListResponse> {
  const url = new URL(`${client.getConfig().baseUrl}/api/admin/payments`)
  for (const [k, v] of Object.entries(query)) {
    if (v != null) url.searchParams.set(k, String(v))
  }
  const res = await authFetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
  })
  if (!res.ok) {
    throw await toError(res)
  }
  return (await res.json()) as AdminPaymentListResponse
}

/** `PATCH /api/admin/payments/{id}` — admin override of payment status. */
export async function updatePaymentStatus(
  id: string,
  body: UpdatePaymentStatusRequest,
): Promise<UpdatePaymentStatusResponse> {
  const res = await authFetch(
    `${client.getConfig().baseUrl}/api/admin/payments/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    throw await toError(res)
  }
  return (await res.json()) as UpdatePaymentStatusResponse
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

async function toError(res: Response): Promise<Error> {
  let message = `HTTP ${res.status} ${res.statusText}`
  let body: unknown = null
  try {
    body = await res.json()
    if (body && typeof body === 'object' && 'message' in body) {
      message = String((body as { message: unknown }).message)
    }
  } catch {
    // Not JSON — fall back to the status text.
  }
  const err = new Error(message) as Error & { status?: number; body?: unknown }
  err.status = res.status
  err.body = body
  return err
}

// ─────────────────────────────────────────────────────────────
//  Re-exports (so callers can `import { ... } from '@/lib/api/payments'`)
// ─────────────────────────────────────────────────────────────

export type {
  Options as PaymentOptions,
  RequestResult as PaymentRequestResult,
}
