/**
 * Payment-related TanStack Query hooks.
 *
 * Wraps the manually-written `payments` SDK (`@/lib/api/payments`) with
 * TanStack Query, following the same conventions as the rest of the
 * app's `lib/queries/index.ts`:
 *
 * - Reads use `useQuery` with sensible `staleTime` + `refetchInterval`.
 * - Writes use `useMutation` + invalidate `['payments']` on success.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cancelPayment as apiCancelPayment,
  createPayment as apiCreatePayment,
  getPayment as apiGetPayment,
  listAdminPayments as apiListAdminPayments,
  listBookingPayments as apiListBookingPayments,
  markCodCollected as apiMarkCodCollected,
  updatePaymentStatus as apiUpdatePaymentStatus,
  type AdminPaymentListResponse,
  type AdminPaymentsQuery,
  type CancelPaymentRequest,
  type CancelPaymentResponse,
  type CreatePaymentRequest,
  type CreatePaymentResponse,
  type MarkCodCollectedRequest,
  type MarkCodCollectedResponse,
  type PaymentOut,
  type UpdatePaymentStatusRequest,
  type UpdatePaymentStatusResponse,
} from '@/lib/api/payments'

export type PaymentMutationCallbacks<TData = unknown, TVars = unknown> = {
  onSuccess?: (data: TData, vars: TVars) => void
  onError?: (err: unknown, vars: TVars) => void
  onSettled?: (data: TData | undefined, err: unknown | undefined, vars: TVars) => void
}

// ─────────────────────────────────────────────────────────────
//  User-facing hooks
// ─────────────────────────────────────────────────────────────

/** Get a single payment by id (for status polling). */
export function usePayment(id?: string, opts?: { enabled?: boolean }) {
  return useQuery<PaymentOut>({
    queryKey: ['payments', id],
    queryFn: () => apiGetPayment(id as string),
    enabled: !!id && (opts?.enabled ?? true),
    // Payments change frequently while pending — refetch every 3s.
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return false
      // Stop polling once the payment reaches a terminal state.
      if (['completed', 'failed', 'cancelled', 'refunded'].includes(data.status)) {
        return false
      }
      return 3000
    },
    staleTime: 10 * 1000,
  })
}

/** List all payments for a booking. */
export function useBookingPayments(bookingId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['payments', 'booking', bookingId],
    queryFn: () => apiListBookingPayments(bookingId as string),
    enabled: !!bookingId && (opts?.enabled ?? true),
    staleTime: 15 * 1000,
    refetchInterval: 5 * 1000,
  })
}

/** Create a payment intent for a booking. */
export function useCreatePayment<TData = CreatePaymentResponse, TVars = CreatePaymentRequest>(
  opts?: PaymentMutationCallbacks<TData, TVars>,
) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    mutationFn: async (vars) => {
      const res = await apiCreatePayment(vars as unknown as CreatePaymentRequest)
      return res as unknown as TData
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
      opts?.onSuccess?.(data, vars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars),
  })
}

/** Cancel a pending payment. */
export function useCancelPayment<TData = CancelPaymentResponse, TVars = { id: string; body?: CancelPaymentRequest }>(
  opts?: PaymentMutationCallbacks<TData, TVars>,
) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    mutationFn: async (vars) => {
      const v = vars as unknown as { id: string; body?: CancelPaymentRequest }
      const res = await apiCancelPayment(v.id, v.body ?? {})
      return res as unknown as TData
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      opts?.onSuccess?.(data, vars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars),
  })
}

/** Mark a COD payment as collected by the driver. */
export function useMarkCodCollected<TData = MarkCodCollectedResponse, TVars = { id: string; body?: MarkCodCollectedRequest }>(
  opts?: PaymentMutationCallbacks<TData, TVars>,
) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    mutationFn: async (vars) => {
      const v = vars as unknown as { id: string; body?: MarkCodCollectedRequest }
      const res = await apiMarkCodCollected(v.id, v.body ?? {})
      return res as unknown as TData
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
      opts?.onSuccess?.(data, vars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars),
  })
}

// ─────────────────────────────────────────────────────────────
//  Admin hooks
// ─────────────────────────────────────────────────────────────

/** `GET /api/admin/payments` — paginated admin payment list. */
export function useAdminPayments(query: AdminPaymentsQuery = {}) {
  return useQuery<AdminPaymentListResponse>({
    queryKey: ['admin', 'payments', query],
    queryFn: () => apiListAdminPayments(query),
    staleTime: 15 * 1000,
  })
}

/** `PATCH /api/admin/payments/{id}` — admin override of payment status. */
export function useUpdatePaymentStatus<
  TData = UpdatePaymentStatusResponse,
  TVars = { id: string; body: UpdatePaymentStatusRequest },
>(opts?: PaymentMutationCallbacks<TData, TVars>) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    mutationFn: async (vars) => {
      const v = vars as unknown as { id: string; body: UpdatePaymentStatusRequest }
      const res = await apiUpdatePaymentStatus(v.id, v.body)
      return res as unknown as TData
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'payments'] })
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
      opts?.onSuccess?.(data, vars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars),
  })
}
