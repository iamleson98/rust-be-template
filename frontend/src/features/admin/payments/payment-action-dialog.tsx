'use client'

/**
 * Action dialog of the admin payments panel — cancel / refund /
 * mark-COD-collected confirmation.
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
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import { useT } from '@/lib/i18n'
import type { PaymentAction, UpdatePaymentStatusMutation } from './types'

export function PaymentActionDialog({
  actionDialog,
  setActionDialog,
  actionReason,
  setActionReason,
  actionAmount,
  setActionAmount,
  updateStatus,
  handleSubmitAction,
}: {
  actionDialog: PaymentAction | null
  setActionDialog: React.Dispatch<React.SetStateAction<PaymentAction | null>>
  actionReason: string
  setActionReason: React.Dispatch<React.SetStateAction<string>>
  actionAmount: string
  setActionAmount: React.Dispatch<React.SetStateAction<string>>
  updateStatus: UpdatePaymentStatusMutation
  handleSubmitAction: () => void
}) {
  const t = useT()
  return (
      <Dialog open={!!actionDialog} onOpenChange={(o) => !o && setActionDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {actionDialog?.type === 'cancel' && t('adminPayments.cancelTransaction')}
              {actionDialog?.type === 'refund' && t('adminPayments.refundTransaction')}
              {actionDialog?.type === 'mark_collected' && t('adminPayments.confirmCashTitle')}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t('adminPayments.txnRefLabel', { ref: actionDialog?.payment.providerTxnRef ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {actionDialog?.type === 'mark_collected' && (
              <div>
                <Label className="text-xs">{t('adminPayments.amountCollectedLabel')}</Label>
                <Input
                  type="number"
                  value={actionAmount}
                  onChange={(e) => setActionAmount(e.target.value)}
                  className="mt-1"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {t('adminPayments.amountCollectedHint')}
                </p>
              </div>
            )}
            {(actionDialog?.type === 'cancel' || actionDialog?.type === 'refund') && (
              <div>
                <Label className="text-xs">{t('adminPayments.reasonLabel')}</Label>
                <Textarea
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  className="mt-1"
                  rows={3}
                  placeholder={t('adminPayments.reasonPlaceholder')}
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setActionDialog(null)}>
                {t('common.close')}
              </Button>
              <Button
                size="sm"
                disabled={updateStatus.isPending}
                onClick={handleSubmitAction}
                className={
                  actionDialog?.type === 'cancel'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : actionDialog?.type === 'mark_collected'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }
              >
                {updateStatus.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
  )
}
