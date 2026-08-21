/**
 * Payment-related TanStack Query hooks.
 *
 * Uses the auto-generated SDK (`@/lib/api/sdk.gen`) + the auto-generated
 * TanStack Query option builders (`@/lib/api/@tanstack/react-query.gen`)
 * for all payment API calls. No hand-written fetch logic — the generated
 * SDK handles auth cookies, URL encoding, and error parsing.
 *
 * ## Type aliases
 *
 * The generated SDK types use `string` for `provider` and `status`
 * (because the Rust backend uses `String` for these columns, not an
 * enum). We define `PaymentProvider` and `PaymentStatus` type aliases
 * HERE (not in `lib/api/`) so consumers get type-safety without us
 * modifying the auto-generated code.
 *
 * ## Conventions
 *
 * - Reads use `useQuery` with sensible `staleTime` + `refetchInterval`.
 * - Writes use `useMutation` + invalidate `['payments']` on success.
 * - All hooks accept optional `onSuccess` / `onError` / `onSettled`
 *   callbacks (defined at hook-creation time, per TanStack best practice).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelPayment as sdkCancelPayment,
  createPayment as sdkCreatePayment,
  getPayment as sdkGetPayment,
  listAdminPayments as sdkListAdminPayments,
  listBookingPayments as sdkListBookingPayments,
  markCodCollected as sdkMarkCodCollected,
  updatePaymentStatus as sdkUpdatePaymentStatus,
} from "@/lib/api/sdk.gen";
import type {
  AdminPaymentListResponse,
  AdminPaymentOut,
  AdminPaymentsQuery,
  BankTransferInstructions,
  CancelPaymentReq,
  CancelPaymentResponse,
  CreatePaymentReq,
  CreatePaymentResponse,
  ListPaymentsResponse,
  MarkCodCollectedReq,
  MarkCodCollectedResponse,
  PaymentOut,
  UpdatePaymentStatusReq,
  UpdatePaymentStatusResponse,
} from "@/lib/api/types.gen";

// ─────────────────────────────────────────────────────────────
//  Type aliases — not in lib/api (auto-generated, don't touch)
// ─────────────────────────────────────────────────────────────

/**
 * Payment provider identifier. The Rust backend stores this as a
 * `String` column, so the generated SDK types it as `string`. We
 * narrow it here so consumers get autocomplete + type-safety.
 */
export type PaymentProvider = "vnpay" | "momo" | "zalopay" | "vietqr" | "cod";

/**
 * Payment lifecycle status. Same situation as `PaymentProvider` —
 * stored as `String` in the DB, narrowed here for type-safety.
 */
export type PaymentStatus =
  | "pending"
  | "completed"
  | "failed"
  | "cancelled"
  | "refunded";

// Re-export the generated types so consumers can import everything
// from one place (`@/lib/queries/payments`).
export type {
  AdminPaymentListResponse,
  AdminPaymentOut,
  AdminPaymentsQuery,
  BankTransferInstructions,
  CancelPaymentReq,
  CancelPaymentResponse,
  CreatePaymentReq,
  CreatePaymentResponse,
  ListPaymentsResponse,
  MarkCodCollectedReq,
  MarkCodCollectedResponse,
  PaymentOut,
  UpdatePaymentStatusReq,
  UpdatePaymentStatusResponse,
};

// ─────────────────────────────────────────────────────────────
//  Mutation callback type
// ─────────────────────────────────────────────────────────────

export type PaymentMutationCallbacks<TData = unknown, TVars = unknown> = {
  onSuccess?: (data: TData, vars: TVars) => void;
  onError?: (err: unknown, vars: TVars) => void;
  onSettled?: (
    data: TData | undefined,
    err: unknown | undefined,
    vars: TVars,
  ) => void;
};

// ─────────────────────────────────────────────────────────────
//  User-facing hooks
// ─────────────────────────────────────────────────────────────

/**
 * Get a single payment by id (for status polling).
 *
 * Refetches every 3s while the payment is in a non-terminal state
 * (`pending`). Stops polling once the payment reaches `completed`,
 * `failed`, `cancelled`, or `refunded`.
 */
export function usePayment(id?: string, opts?: { enabled?: boolean }) {
  return useQuery<PaymentOut>({
    queryKey: ["payments", id],
    queryFn: async () => {
      const { data } = await sdkGetPayment({ path: { id: id as string } });
      return data as PaymentOut;
    },
    enabled: !!id && (opts?.enabled ?? true),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const status = data.status as PaymentStatus;
      if (["completed", "failed", "cancelled", "refunded"].includes(status)) {
        return false;
      }
      return 3000;
    },
    staleTime: 10 * 1000,
  });
}

/**
 * List all payments for a booking.
 *
 * Refetches every 5s — useful while a payment is pending and the
 * user is waiting for the gateway to confirm.
 */
export function useBookingPayments(
  bookingId?: string,
  opts?: { enabled?: boolean },
) {
  return useQuery<ListPaymentsResponse>({
    queryKey: ["payments", "booking", bookingId],
    queryFn: async () => {
      const { data } = await sdkListBookingPayments({
        path: { bookingId: bookingId as string },
      });
      return data as ListPaymentsResponse;
    },
    enabled: !!bookingId && (opts?.enabled ?? true),
    staleTime: 15 * 1000,
    refetchInterval: 5 * 1000,
  });
}

/**
 * Create a payment intent for a booking.
 *
 * On success, invalidates the `['payments']` and `['bookings']` query
 * caches so the UI reflects the new payment immediately.
 */
export function useCreatePayment<
  TData = CreatePaymentResponse,
  TVars = { bookingId: string; provider: PaymentProvider },
>(opts?: PaymentMutationCallbacks<TData, TVars>) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    mutationFn: async (vars) => {
      const v = vars as unknown as {
        bookingId: string;
        provider: PaymentProvider;
      };
      const { data } = await sdkCreatePayment({
        body: { bookingId: v.bookingId, provider: v.provider },
      });
      return data as unknown as TData;
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      opts?.onSuccess?.(data, vars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars),
  });
}

/**
 * Cancel a pending payment.
 *
 * On success, invalidates the `['payments']` query cache.
 */
export function useCancelPayment<
  TData = CancelPaymentResponse,
  TVars = { id: string; body?: CancelPaymentReq },
>(opts?: PaymentMutationCallbacks<TData, TVars>) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    mutationFn: async (vars) => {
      const v = vars as unknown as { id: string; body?: CancelPaymentReq };
      const { data } = await sdkCancelPayment({
        path: { id: v.id },
        body: v.body ?? {},
      });
      return data as unknown as TData;
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      opts?.onSuccess?.(data, vars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars),
  });
}

/**
 * Mark a COD payment as collected by the driver.
 *
 * On success, invalidates `['payments']` and `['bookings']` so the
 * booking status updates from `pending` → `confirmed`.
 */
export function useMarkCodCollected<
  TData = MarkCodCollectedResponse,
  TVars = { id: string; body?: MarkCodCollectedReq },
>(opts?: PaymentMutationCallbacks<TData, TVars>) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    mutationFn: async (vars) => {
      const v = vars as unknown as { id: string; body?: MarkCodCollectedReq };
      const { data } = await sdkMarkCodCollected({
        path: { id: v.id },
        body: v.body ?? {},
      });
      return data as unknown as TData;
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      opts?.onSuccess?.(data, vars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars),
  });
}

// ─────────────────────────────────────────────────────────────
//  Admin hooks
// ─────────────────────────────────────────────────────────────

/**
 * `GET /api/admin/payments` — paginated admin payment list.
 *
 * Supports filtering by `status` + `provider`. The admin panel uses
 * this to render the payments table.
 */
export function useAdminPayments(query: AdminPaymentsQuery = {}) {
  return useQuery<AdminPaymentListResponse>({
    queryKey: ["admin", "payments", query],
    queryFn: async () => {
      const { data } = await sdkListAdminPayments({
        query: {
          status: query.status ?? undefined,
          provider: query.provider ?? undefined,
          limit: query.limit ?? undefined,
          offset: query.offset ?? undefined,
        },
      });
      return data as AdminPaymentListResponse;
    },
    staleTime: 15 * 1000,
  });
}

/**
 * `PATCH /api/admin/payments/{id}` — admin override of payment status.
 *
 * On success, invalidates `['admin', 'payments']`, `['payments']`, and
 * `['bookings']` so all affected views update immediately.
 */
export function useUpdatePaymentStatus<
  TData = UpdatePaymentStatusResponse,
  TVars = { id: string; body: UpdatePaymentStatusReq },
>(opts?: PaymentMutationCallbacks<TData, TVars>) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    mutationFn: async (vars) => {
      const v = vars as unknown as { id: string; body: UpdatePaymentStatusReq };
      const { data } = await sdkUpdatePaymentStatus({
        path: { id: v.id },
        body: v.body,
      });
      return data as unknown as TData;
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["admin", "payments"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      opts?.onSuccess?.(data, vars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars),
  });
}
