'use client'

import type { TripPricing } from '@/api'
import { SEAT_CLASS_COLORS, SEAT_CLASS_LABELS } from '@/lib/labels'
import { useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'

/** What each class of seat costs on this trip, for adults and (if sold) children. */
export function FareTable({ pricing }: { pricing: TripPricing }) {
  const t = useT()
  const money = useMoney()
  const { fares, childFare } = pricing
  if (fares.length === 0) return null
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold">{t('tripDetail.faresTitle')}</h4>
      <table className="w-full overflow-hidden rounded-lg border bg-white text-sm">
        <thead className="bg-slate-50 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{t('tripDetail.seatClass')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('booking.passengerType.adult')}</th>
            {childFare && (
              <th className="px-3 py-2 text-right font-medium">
                {t('booking.passengerType.child')}
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {fares.map((fare) => (
            <tr key={fare.seatClass}>
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm"
                    style={{ background: SEAT_CLASS_COLORS[fare.seatClass] ?? '#64748b' }}
                  />
                  {t(SEAT_CLASS_LABELS[fare.seatClass] ?? fare.seatClass)}
                  <span className="text-xs text-muted-foreground">
                    {t('tripDetail.seatsLeft', { available: fare.available, total: fare.seats })}
                  </span>
                </span>
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {money(fare.priceAdult)}
              </td>
              {childFare && (
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-amber-700">
                  {money(fare.priceChild ?? fare.priceAdult)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        {childFare
          ? t('tripDetail.childFareRule', { age: childFare.maxAge })
          : t('tripDetail.noChildFare')}
      </p>
    </div>
  )
}
