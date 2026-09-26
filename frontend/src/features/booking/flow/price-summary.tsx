'use client'

/**
 * PriceSummary — the price-breakdown box shared by the payment step and
 * the success step of the BookingDialog.
 *
 * Extracted from the original `booking-dialog.tsx`. Shows:
 *   - Subtotal (per-seat price sum)
 *   - Insurance (optional — hidden when `insuranceCost === 0`)
 *   - Campaign discount (optional — hidden when `discount === 0`)
 *   - Service fees
 *   - Total (highlighted)
 */

import { ShieldCheck } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import { useT } from '@/lib/i18n'

export type InsuranceLevel = 'none' | 'basic' | 'premium'

// Values are i18n keys — render with `t(INSURANCE_LABEL_MAP[level])`.
export const INSURANCE_LABEL_MAP: Record<InsuranceLevel, string> = {
  none: 'bookingFlow.insuranceNone',
  basic: 'bookingFlow.insuranceBasic',
  premium: 'bookingFlow.insurancePremium',
}

export function PriceSummary({
  seatCount,
  subtotal,
  insuranceLevel,
  insuranceCost,
  campaignCode,
  discount,
  fees,
  total,
  currency,
  className,
}: {
  seatCount: number
  subtotal: number
  insuranceLevel: InsuranceLevel
  insuranceCost: number
  campaignCode: string
  discount: number
  fees: number
  total: number
  currency: Currency
  className?: string
}) {
  const t = useT()
  return (
    <div className={`rounded-lg border bg-slate-50 p-4 space-y-2 ${className ?? ''}`}>
      <h4 className="font-semibold text-sm mb-2">{t('bookingFlow.priceDetails')}</h4>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{t('bookingFlow.subtotalSeats', { count: seatCount })}</span>
        <span>{formatCurrency(subtotal, currency)}</span>
      </div>
      {insuranceCost > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
            {t(INSURANCE_LABEL_MAP[insuranceLevel])}
          </span>
          <span>{formatCurrency(insuranceCost, currency)}</span>
        </div>
      )}
      {discount > 0 && (
        <div className="flex justify-between text-sm text-blue-700">
          <span>{t('bookingFlow.discountLabel', { code: campaignCode })}</span>
          <span>-{formatCurrency(discount, currency)}</span>
        </div>
      )}
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{t('bookingFlow.serviceFees')}</span>
        <span>{formatCurrency(fees, currency)}</span>
      </div>
      <div className="border-t pt-2 flex justify-between font-bold text-base">
        <span>{t('bookingFlow.grandTotal')}</span>
        <span className="text-blue-700">{formatCurrency(total, currency)}</span>
      </div>
    </div>
  )
}
