'use client'

/**
 * PaymentDialog — modal that displays the payment instructions for a booking.
 *
 * Two modes:
 *   1. **Resume mode** — `paymentId` is provided AND the payment is still
 *      `pending`. Shows the existing payment's provider-specific UI.
 *   2. **Choose provider mode** — no paymentId (or the prior payment was
 *      cancelled/failed). Shows a grid of provider buttons (VNPay / MoMo /
 *      ZaloPay / VietQR / COD); clicking one calls `createPayment` and
 *      switches to resume mode.
 *
 * Renders different UIs based on the payment `provider`:
 *   - `vnpay` / `momo` / `zalopay`: "Pay now" button that opens the gateway URL
 *     in a new tab. Polls `/api/payments/{id}` every 3s; auto-closes when the
 *     payment becomes `completed`.
 *   - `vietqr`: QR image (pre-rendered server-side) + bank-transfer
 *     instructions (account no, account name, memo, amount). Also polls.
 *   - `cod`: "Pay on the bus" notice + "Cash collected by driver" status pill
 *     once the driver confirms.
 *
 * Usage: parent opens the dialog with an optional `paymentId` (resumes an
 * in-flight payment) + the booking id (used to create a new payment).
 *
 * The provider-specific bodies live in sibling files: `ProviderPicker`
 * (payment-provider-picker.tsx), `GatewayRedirect` (gateway-redirect.tsx),
 * `VietQrDisplay` (vietqr-display.tsx); the small `StatusPill` and
 * `CodDisplay` stay here.
 */

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Banknote,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import {
  useCancelPayment,
  useCreatePayment,
  usePayment,
} from '@/lib/queries/payments'
import type { PaymentOut, PaymentProvider } from '@/lib/queries/payments'
import { ProviderPicker } from './payment-provider-picker'
import { GatewayRedirect } from './gateway-redirect'
import { VietQrDisplay } from './vietqr-display'

export function PaymentDialog({
  paymentId,
  bookingId,
  bookingTotal,
  open,
  onClose,
  onPaid,
}: {
  /** If provided, the dialog opens in resume mode showing this payment. */
  paymentId?: string
  /** Required when creating a new payment (no `paymentId`). */
  bookingId?: string
  /** Booking total (VND integer) — shown when no payment exists yet. */
  bookingTotal?: number
  open: boolean
  onClose: () => void
  /** Called when the payment transitions to `completed`. */
  onPaid?: (payment: PaymentOut) => void
}) {
  const [resumeId, setResumeId] = useState<string | undefined>(paymentId)
  // Re-sync when the parent's `paymentId` prop changes (e.g. after the
  // first successful create-payment, the parent refetches the booking and
  // passes the new paymentId).
  useEffect(() => {
    setResumeId(paymentId)
  }, [paymentId])

  const payment = usePayment(resumeId, { enabled: open && !!resumeId })
  const cancelPayment = useCancelPayment()
  const createPayment = useCreatePayment()

  // When the payment becomes `completed`, fire onPaid + auto-close after 1.5s.
  useEffect(() => {
    if (payment.data?.status === 'completed') {
      onPaid?.(payment.data)
      const t = setTimeout(() => {
        onClose()
      }, 1500)
      return () => clearTimeout(t)
    }
  }, [payment.data?.status, onPaid, onClose])

  const p = payment.data
  const currency = (p?.currency as Currency) ?? 'VND'

  const handleCreate = async (provider: PaymentProvider) => {
    if (!bookingId) {
      toast.error('Thiếu mã đặt chỗ — không thể tạo giao dịch')
      return
    }
    try {
      const result = await createPayment.mutateAsync({
        bookingId,
        provider,
      } as unknown as { bookingId: string; provider: PaymentProvider })
      setResumeId((result as unknown as { payment: PaymentOut }).payment.id)
    } catch (e: unknown) {
      toast.error('Tạo giao dịch thất bại', {
        description: e instanceof Error ? e.message : undefined,
      })
    }
  }

  const showProviderPicker =
    !p || ['failed', 'cancelled'].includes(p.status)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-base font-semibold">
          Thanh toán vé
        </DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          {p ? `Mã giao dịch: ${p.providerTxnRef}` : 'Chọn phương thức thanh toán'}
        </DialogDescription>

        {showProviderPicker ? (
          <ProviderPicker
            onPick={handleCreate}
            creating={createPayment.isPending}
            amount={p?.amount ?? bookingTotal ?? 0}
            currency={currency}
            priorFailureReason={p?.failureReason ?? undefined}
          />
        ) : p ? (
          <div className="space-y-4">
            {/* Status pill */}
            <StatusPill status={p.status} />

            {/* Amount */}
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-center">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Số tiền
              </div>
              <div className="text-2xl font-extrabold text-slate-900">
                {formatCurrency(p.amount, currency)}
              </div>
            </div>

            {/* Provider-specific body */}
            {p.provider === 'vnpay' || p.provider === 'momo' || p.provider === 'zalopay' ? (
              <GatewayRedirect
                provider={p.provider}
                gatewayUrl={p.gatewayUrl}
                status={p.status}
              />
            ) : p.provider === 'vietqr' ? (
              <VietQrDisplay payment={p} currency={currency} />
            ) : p.provider === 'cod' ? (
              <CodDisplay payment={p} />
            ) : null}

            {/* Footer */}
            <div className="flex justify-between items-center pt-2">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                Mã hoá SSL 256-bit. Vé điện tử gửi qua SMS/email.
              </div>
              {p.status === 'pending' && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cancelPayment.isPending}
                  onClick={async () => {
                    try {
                      await cancelPayment.mutateAsync({ id: p.id })
                      toast.success('Đã huỷ giao dịch')
                      // Reset to provider-picker for retry.
                      setResumeId(undefined)
                    } catch (e: unknown) {
                      toast.error('Huỷ thất bại', {
                        description: e instanceof Error ? e.message : undefined,
                      })
                    }
                  }}
                >
                  Huỷ
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: PaymentOut['status'] | string }) {
  const map = {
    pending: { label: 'Đang chờ thanh toán', color: 'bg-amber-100 text-amber-800', icon: Clock },
    completed: {
      label: 'Đã thanh toán',
      color: 'bg-emerald-100 text-emerald-800',
      icon: CheckCircle2,
    },
    failed: { label: 'Thất bại', color: 'bg-rose-100 text-rose-800', icon: XCircle },
    cancelled: { label: 'Đã huỷ', color: 'bg-slate-100 text-slate-700', icon: XCircle },
    refunded: { label: 'Đã hoàn tiền', color: 'bg-primary/10 text-primary', icon: ShieldCheck },
  } as const
  const cfg = map[status as keyof typeof map] ?? map.pending
  const Icon = cfg.icon
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${cfg.color}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {cfg.label}
    </div>
  )
}

function CodDisplay({ payment }: { payment: PaymentOut }) {
  if (payment.status === 'completed') {
    return (
      <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
        <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto mb-2" />
        <div className="text-sm font-medium text-emerald-800">
          Đã thu tiền mặt tại xe.
        </div>
        {payment.collectedAt && (
          <div className="text-[11px] text-emerald-700 mt-1">
            {new Date(payment.collectedAt).toLocaleString('vi-VN')}
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Banknote className="h-5 w-5 text-amber-600" />
        <span className="font-medium text-sm">Thanh toán tiền mặt tại xe</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Bạn sẽ thanh toán bằng tiền mặt khi lên xe. Hãy giữ mã vé để đối chiếu.
      </p>
      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
        <strong>Lưu ý:</strong> vé sẽ giữ trong 10 phút. Vui lòng đến trạm đúng giờ.
        Nếu không thanh toán, ghế sẽ tự động được nhả cho khách khác.
      </div>
    </div>
  )
}
