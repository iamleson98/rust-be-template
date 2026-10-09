'use client'

import { useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'

/** Seats subtotal, promo discount (when there is one) and the total to pay. */
export function PriceSummary({
  seatCount,
  subtotal,
  promoCode,
  discount,
  total,
  className,
}: {
  seatCount: number
  subtotal: number
  promoCode?: string
  discount: number
  total: number
  className?: string
}) {
  const t = useT()
  const money = useMoney()
  return (
    <div className={`rounded-lg border bg-slate-50 p-4 space-y-2 ${className ?? ''}`}>
      <h4 className="font-semibold text-sm mb-2">{t('bookingFlow.priceDetails')}</h4>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">
          {t('bookingFlow.subtotalSeats', { count: seatCount })}
        </span>
        <span>{money(subtotal)}</span>
      </div>
      {discount > 0 && (
        <div className="flex justify-between text-sm text-blue-700">
          <span className="text-muted-foreground">
            {t('bookingFlow.discountLabel', { code: promoCode ?? '' })}
          </span>
          <span>-{money(discount)}</span>
        </div>
      )}
      <div className="border-t pt-2 flex justify-between font-bold text-base">
        <span>{t('bookingFlow.grandTotal')}</span>
        <span className="text-blue-700">{money(total)}</span>
      </div>
    </div>
  )
}
