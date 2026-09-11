'use client'

// Extracted from the original 'cancel-dialog.tsx'.

import { useT } from '@/lib/i18n'
import { CheckCircle2, FileText } from 'lucide-react'

export function CancelSuccessStep({
  refundPercent,
  refundAmount,
  refCode,
}: {
  refundPercent: number
  refundAmount: number
  refCode: string
}) {
  const t = useT()

  return (
    <div
      key="step3"
      className="py-2 flex flex-col items-center text-center"
    >
      <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center mb-4">
        <CheckCircle2 className="h-8 w-8 text-blue-600" />
      </div>

      <h3 className="text-lg font-bold text-foreground mb-1">
        {t('cancel.successTitle')}
      </h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-xs">
        {t('cancel.successDesc')}
      </p>

      {refundAmount > 0 && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 mb-4 w-full max-w-xs">
          <div className="text-xs font-medium text-blue-600 mb-1">
            {t('cancel.refundAmount')}
          </div>
          <div className="text-xl font-extrabold text-blue-700">
            {refundAmount.toLocaleString('vi-VN')}đ
            <span className="text-sm font-normal text-blue-500 ml-1">
              ({refundPercent}%)
            </span>
          </div>
        </div>
      )}

      {refCode && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <FileText className="h-3.5 w-3.5" />
          {t('cancel.refCode')}:{' '}
          <span className="font-mono font-semibold text-foreground">{refCode}</span>
        </div>
      )}
    </div>
  )
}
