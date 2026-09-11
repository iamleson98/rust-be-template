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
import type { PaymentProvider } from '@/lib/queries/payments'

// ─────────────────────────────────────────────────────────────
//  Provider picker
// ─────────────────────────────────────────────────────────────

const PROVIDER_OPTIONS: {
  key: PaymentProvider
  label: string
  icon: string
  sub: string
}[] = [
  { key: 'vnpay', label: 'VNPay QR', icon: '🔵', sub: 'Ngân hàng / QR' },
  { key: 'momo', label: 'Ví MoMo', icon: '🟣', sub: 'Quét mã QR' },
  { key: 'zalopay', label: 'ZaloPay', icon: '🟢', sub: 'Ví Zalo' },
  { key: 'vietqr', label: 'VietQR', icon: '🏦', sub: 'Chuyển khoản' },
  { key: 'cod', label: 'Tiền mặt', icon: '💵', sub: 'Tại xe' },
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
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-center">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
          Số tiền
        </div>
        <div className="text-2xl font-extrabold text-slate-900">
          {formatCurrency(amount, currency)}
        </div>
      </div>

      {priorFailureReason && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs px-3 py-2">
          Giao dịch trước thất bại: {priorFailureReason}. Vui lòng chọn phương thức khác.
        </div>
      )}

      <div>
        <h3 className="font-semibold text-sm mb-3">Phương thức thanh toán</h3>
        <div className="grid grid-cols-2 gap-2">
          {PROVIDER_OPTIONS.map((m) => (
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
        Thông tin của bạn được mã hoá SSL 256-bit. Vé điện tử sẽ gửi qua SMS &amp; email sau khi thanh toán.
      </div>

      {creating && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Đang tạo giao dịch...
        </div>
      )}
    </div>
  )
}
