'use client'

/**
 * PaymentMethod — the payment step (step 3) of the BookingDialog.
 *
 * Extracted from the original `booking-dialog.tsx`. Renders the
 * payment-method picker (MoMo / VNPay / bank transfer / cash-on-bus)
 * + the price summary + the SSL trust note + the submit button.
 *
 * The parent owns the form (`onSubmit` is `form.handleSubmit(...)`) so
 * this component stays purely presentational.
 */

import { Button } from '@/components/ui/button'
import { ChevronLeft, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import { PriceSummary, type InsuranceLevel } from './price-summary'
import { PaymentTrustBadges } from '@/components/seo/trust-signals'

export type PaymentMethodKey = 'momo' | 'vnpay' | 'bank' | 'cod'

const PAYMENT_OPTIONS: { key: PaymentMethodKey; label: string; icon: string; sub: string }[] = [
  { key: 'momo', label: 'Ví MoMo', icon: '🟣', sub: 'Quét mã QR' },
  { key: 'vnpay', label: 'VNPay QR', icon: '🔵', sub: 'Ngân hàng' },
  { key: 'bank', label: 'Chuyển khoản', icon: '🏦', sub: 'Internet Banking' },
  { key: 'cod', label: 'Thanh toán tại xe', icon: '💵', sub: 'Tiền mặt' },
]

export function PaymentMethodStep({
  paymentMethod,
  onSetPaymentMethod,
  seatCount,
  subtotal,
  insuranceLevel,
  insuranceCost,
  campaignCode,
  discount,
  fees,
  total,
  currency,
  error,
  submitting,
  onGoBack,
  onSubmit,
}: {
  paymentMethod: PaymentMethodKey
  onSetPaymentMethod: (m: PaymentMethodKey) => void
  seatCount: number
  subtotal: number
  insuranceLevel: InsuranceLevel
  insuranceCost: number
  campaignCode: string
  discount: number
  fees: number
  total: number
  currency: Currency
  error: string
  submitting: boolean
  onGoBack: () => void
  onSubmit: () => void
}) {
  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm mb-3">Phương thức thanh toán</h3>
        <div className="grid grid-cols-2 gap-2">
          {PAYMENT_OPTIONS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => onSetPaymentMethod(m.key)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                paymentMethod === m.key
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/10'
                  : 'border-slate-200 hover:border-primary/40'
              }`}
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

      <PriceSummary
        seatCount={seatCount}
        subtotal={subtotal}
        insuranceLevel={insuranceLevel}
        insuranceCost={insuranceCost}
        campaignCode={campaignCode}
        discount={discount}
        fees={fees}
        total={total}
        currency={currency}
      />

      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-info/5 border border-info/20 rounded-lg p-3">
        <ShieldCheck className="h-4 w-4 text-success shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">Thanh toán an toàn</p>
          <p>Thông tin của bạn được mã hoá SSL 256-bit. Ve điện tử sẽ gửi qua SMS &amp; email sau khi thanh toán. Dữ liệu cá nhân được xử lý theo Nghị định 13/2023/NĐ-CP — không chia sẻ với bên thứ ba.</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {/* Payment trust badges — SSL + PCI DSS + refund guarantee */}
      <PaymentTrustBadges className="mb-1" />

      <div className="flex justify-between">
        <Button variant="outline" onClick={onGoBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> Quay lại
        </Button>
        <Button
          onClick={onSubmit}
          disabled={submitting}
          className="gap-2"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Đang xử lý...
            </>
          ) : (
            <>
              <Lock className="h-4 w-4" /> Thanh toán {formatCurrency(total, currency)}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
