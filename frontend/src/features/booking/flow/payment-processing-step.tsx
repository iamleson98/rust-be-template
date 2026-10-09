'use client'

import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, ChevronLeft, Ban, Ticket } from 'lucide-react'
import { formatVND } from '@/lib/format'
import { useT } from '@/lib/i18n'
import type { PaymentOut } from '@/api'
import { StatusPill } from './payment-dialog'
import { GatewayRedirect } from './gateway-redirect'
import { VietQrDisplay } from './vietqr-display'

/**
 * Paying online inside the trip dialog: the gateway link or bank-transfer QR,
 * the live status, and cancel / retry. The parent owns the mutations and polling.
 */
export function PaymentProcessingStep({
  payment,
  bookingCode,
  cancelling,
  onCancelPayment,
  onRetry,
  onBackToMethods,
}: {
  payment: PaymentOut
  bookingCode: string
  cancelling: boolean
  /** Cancel the pending payment + return to the method picker. */
  onCancelPayment: () => void
  /** Retry with the same provider after a failure. */
  onRetry: () => void
  /** Back to the payment-method step (keeps the booking held). */
  onBackToMethods: () => void
}) {
  const t = useT()
  const pending = payment.status === 'pending'
  const failed = payment.status === 'failed' || payment.status === 'cancelled'

  return (
    <div className="p-5 space-y-4">
      {/* Booking reference — what this payment is for. */}
      <div className="flex items-center justify-between gap-2 rounded-lg border bg-slate-50 px-3.5 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Ticket className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('booking.code')}
            </div>
            <div className="font-mono font-bold text-sm text-primary truncate">{bookingCode}</div>
          </div>
        </div>
        <StatusPill status={payment.status} />
      </div>

      {/* Amount */}
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-center">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
          {t('bookingFlow.amount')}
        </div>
        <div className="text-2xl font-extrabold text-slate-900">{formatVND(payment.amount)}</div>
      </div>

      {/* Provider-specific body */}
      {payment.provider === 'vnpay' ||
      payment.provider === 'momo' ||
      payment.provider === 'zalopay' ? (
        <GatewayRedirect
          provider={payment.provider}
          gatewayUrl={payment.gatewayUrl}
          status={payment.status}
        />
      ) : payment.provider === 'vietqr' ? (
        <VietQrDisplay payment={payment} />
      ) : null}

      {/* Failure recovery */}
      {failed && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3.5 text-sm text-rose-700 space-y-2.5">
          <div className="font-medium">{t('bookingFlow.paymentFailedTitle')}</div>
          {payment.failureReason && (
            <div className="text-xs text-rose-600 break-words">{payment.failureReason}</div>
          )}
          <div className="flex flex-wrap gap-2 pt-0.5">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t('bookingFlow.retryPayment')}
            </Button>
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={onBackToMethods}>
              <ChevronLeft className="h-3.5 w-3.5" />
              {t('bookingFlow.chooseOtherMethod')}
            </Button>
          </div>
        </div>
      )}

      {/* Pending-state actions */}
      {pending && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('bookingFlow.waitingForGateway')}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={cancelling}
            onClick={onCancelPayment}
          >
            {cancelling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Ban className="h-3.5 w-3.5" />
            )}
            {t('common.cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}
