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
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
                  : 'border-slate-200 hover:border-blue-300'
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

      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-slate-50 rounded-lg p-3">
        <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0" />
        Thông tin của bạn được mã hoá SSL 256-bit. Vé điện tử sẽ gửi qua SMS &amp; email sau khi thanh toán.
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onGoBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> Quay lại
        </Button>
        <Button
          onClick={onSubmit}
          disabled={submitting}
          className="gap-2 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700"
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
