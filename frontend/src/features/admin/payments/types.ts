/**
 * Shared types for the admin payments feature siblings.
 *
 * Extracted from the original 'src/features/admin/payments/payments-panel.tsx'.
 */

import type { UpdatePaymentStatusReq, UpdatePaymentStatusResponse, AdminPaymentOut } from '@/lib/api/types.gen'
import type { useUpdatePaymentStatus } from '@/lib/queries/payments'

/** The admin action pending confirmation in the payments action dialog. */
export type PaymentAction = {
  type: 'cancel' | 'refund' | 'mark_collected'
  payment: AdminPaymentOut
}

/**
 * The useUpdatePaymentStatus() mutation instance driving the panel actions.
 * NOTE: plain `ReturnType<typeof useUpdatePaymentStatus>` would instantiate
 * the hook's generics with their constraints (`unknown`) — TS 4.7
 * instantiation expressions pin the real response/variables types instead.
 */
export type UpdatePaymentStatusMutation = ReturnType<
  typeof useUpdatePaymentStatus<UpdatePaymentStatusResponse, { id: string; body: UpdatePaymentStatusReq }>
>
