import type { UseMutationResult } from '@tanstack/react-query'
import type {
  AdminPaymentOut,
  Options,
  UpdatePaymentStatusData,
  UpdatePaymentStatusResponse,
} from '@/api'

/** The admin action pending confirmation in the payments action dialog. */
export type PaymentAction = {
  type: 'cancel' | 'refund' | 'mark_collected'
  payment: AdminPaymentOut
}

export type UpdatePaymentStatusMutation = UseMutationResult<
  UpdatePaymentStatusResponse,
  Error,
  Options<UpdatePaymentStatusData>
>
