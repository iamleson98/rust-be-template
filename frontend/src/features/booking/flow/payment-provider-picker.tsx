'use client'

/**
 * ProviderPicker — the "choose provider" grid shown by the PaymentDialog
 * when no payment exists yet (or the prior one failed / was cancelled):
 * amount box, optional prior-failure notice, the VNPay / MoMo / ZaloPay /
 * VietQR / COD buttons, the SSL trust note and the creating spinner.
 *
 * Extracted from the original `payment-dialog.tsx`.
 */

import { Loader2, ShieldCheck } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import { useT } from '@/lib/i18n'
import type { PaymentProvider } from '@/lib/queries/payments'

// ─────────────────────────────────────────────────────────────
//  Provider picker
// ─────────────────────────────────────────────────────────────

const getProviderOptions = (t: ReturnType<typeof useT>): {
  key: PaymentProvider
  label: string
  icon: string
  sub: string
}[] => [
  { key: 'vnpay', label: t('payment.vnpay'), icon: '🔵', sub: t('bookingFlow.subBankQr') },
  { key: 'momo', label: t('payment.momo'), icon: '🟣', sub: t('payment.momoDesc') },
  { key: 'zalopay', label: t('payment.zalopay'), icon: '🟢', sub: t('bookingFlow.subZaloWallet') },
  { key: 'vietqr', label: t('bookingFlow.providerVietqr'), icon: '🏦', sub: t('payment.vietqr') },
  { key: 'cod', label: t('bookingFlow.cash'), icon: '💵', sub: t('bookingFlow.subOnBus') },
]

export function ProviderPicker({
  onPick,
  creating,
  amount,
  currency,
  priorFailureReason,
}: {
  onPick: (p: PaymentProvider) => void
  creating: boolean
  amount: number
  currency: Currency
  priorFailureReason?: string
}) {
  const t = useT()
  const providerOptions = getProviderOptions(t)
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-center">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
          {t('bookingFlow.amount')}
        </div>
        <div className="text-2xl font-extrabold text-slate-900">
          {formatCurrency(amount, currency)}
        </div>
      </div>

      {priorFailureReason && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs px-3 py-2">
          {t('bookingFlow.priorFailure', { reason: priorFailureReason })}
        </div>
      )}

      <div>
        <h3 className="font-semibold text-sm mb-3">{t('payment.method')}</h3>
        <div className="grid grid-cols-2 gap-2">
          {providerOptions.map((m) => (
            <button
              key={m.key}
              type="button"
              disabled={creating}
              onClick={() => onPick(m.key)}
              className="rounded-lg border p-3 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-slate-200 hover:border-primary/40"
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{m.icon}</span>
                <div>
                  <div className="font-medium text-sm">{m.label}</div>
                  <div className="text-[11px] text-muted-foreground">{m.sub}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-slate-50 rounded-lg p-3">
        <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
        {t('bookingFlow.sslNote')}
      </div>

      {creating && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('bookingFlow.creatingTxn')}
        </div>
      )}
    </div>
  )
}
