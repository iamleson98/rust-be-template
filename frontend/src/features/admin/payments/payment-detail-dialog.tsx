'use client'

/**
 * Detail dialog of the admin payments panel — full payment info plus
 * the admin action buttons.
 *
 * Extracted from the original 'src/features/admin/payments/payments-panel.tsx'.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Ban,
  CheckCircle2,
  ArrowLeftRight,
} from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import { useT } from '@/lib/i18n'
import type { AdminPaymentOut } from '@/lib/queries/payments'
import { ProviderBadge, StatusBadge } from './payment-badges'
import type { PaymentAction, UpdatePaymentStatusMutation } from './types'

export function PaymentDetailDialog({
  selectedPayment,
  setSelectedPayment,
  updateStatus,
  setActionDialog,
  setActionAmount,
  currency,
}: {
  selectedPayment: AdminPaymentOut | null
  setSelectedPayment: (p: AdminPaymentOut | null) => void
  updateStatus: UpdatePaymentStatusMutation
  setActionDialog: React.Dispatch<React.SetStateAction<PaymentAction | null>>
  setActionAmount: React.Dispatch<React.SetStateAction<string>>
  currency: Currency
}) {
  const t = useT()
  return (
      <Dialog open={!!selectedPayment} onOpenChange={(o) => !o && setSelectedPayment(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{t('adminPayments.detailTitle')}</DialogTitle>
            <DialogDescription className="text-xs">
              {selectedPayment?.providerTxnRef}
            </DialogDescription>
          </DialogHeader>
          {selectedPayment && (
            <div className="space-y-2.5 text-sm">
              <DetailRow label={t('booking.code')} value={
                <span className="font-mono font-semibold">{selectedPayment.bookingCode ?? '—'}</span>
              } />
              <DetailRow label={t('adminPayments.method')} value={<ProviderBadge provider={selectedPayment.provider} />} />
              <DetailRow label={t('common.status')} value={<StatusBadge status={selectedPayment.status} />} />
              <DetailRow
                label={t('adminPayments.amount')}
                value={
                  <span className="font-bold text-primary text-base">
                    {formatCurrency(selectedPayment.amount, currency)}
                  </span>
                }
              />
              <DetailRow label={t('adminPayments.gatewayTxnId')} value={
                <span className="font-mono text-xs text-muted-foreground">
                  {selectedPayment.providerTransId ?? '—'}
                </span>
              } />
              <DetailRow label={t('adminFeedback.content')} value={selectedPayment.memo ?? '—'} />
              <DetailRow
                label={t('adminPayments.createdAt')}
                value={new Date(selectedPayment.createdAt).toLocaleString('vi-VN')}
              />
              <DetailRow
                label={t('adminPayments.updatedAt')}
                value={new Date(selectedPayment.updatedAt).toLocaleString('vi-VN')}
              />
              {selectedPayment.collectedAt && (
                <DetailRow
                  label={t('adminPayments.collectedAt')}
                  value={new Date(selectedPayment.collectedAt).toLocaleString('vi-VN')}
                />
              )}
              {selectedPayment.failureReason && (
                <div className="rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 text-xs px-3 py-2">
                  {t('adminPayments.failureReason', { reason: selectedPayment.failureReason })}
                </div>
              )}

              {/* Action buttons in detail dialog */}
              <div className="flex items-center gap-2 pt-3 border-t">
                {selectedPayment.status === 'pending' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    disabled={updateStatus.isPending}
                    onClick={() => {
                      setActionDialog({ type: 'cancel', payment: selectedPayment })
                      setSelectedPayment(null)
                    }}
                  >
                    <Ban className="h-3.5 w-3.5" /> {t('adminPayments.cancelTransaction')}
                  </Button>
                )}
                {selectedPayment.status === 'pending' && selectedPayment.provider === 'cod' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                    disabled={updateStatus.isPending}
                    onClick={() => {
                      setActionDialog({ type: 'mark_collected', payment: selectedPayment })
                      setActionAmount(String(selectedPayment.amount))
                      setSelectedPayment(null)
                    }}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> {t('adminPayments.markCollected')}
                  </Button>
                )}
                {selectedPayment.status === 'completed' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                    disabled={updateStatus.isPending}
                    onClick={() => {
                      setActionDialog({ type: 'refund', payment: selectedPayment })
                      setSelectedPayment(null)
                    }}
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" /> {t('adminPayments.refund')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
  )
}

function DetailRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between border-b pb-2 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  )
}
