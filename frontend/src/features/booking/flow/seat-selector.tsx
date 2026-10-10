'use client'

import { Armchair } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { PASSENGER_TYPE_META } from './booking-form'
import type { Ticket } from './use-booking-form'

/** The picked seats as chips, coloured by the passenger type sitting in each. */
export function SeatSelector({ tickets }: { tickets: Ticket[] }) {
  const t = useT()
  if (tickets.length === 0) return null

  return (
    <div className="rounded-lg border bg-slate-50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
        <Armchair className="h-3 w-3" />
        {t('bookingFlow.seatMapTitle')}
      </div>
      <div className="flex flex-wrap gap-2">
        {tickets.map(({ seat: s, passenger, passengerIndex: passengerIdx, type }) => {
          const isAssigned = !!passenger
          const typeMeta = passenger ? PASSENGER_TYPE_META[type] : null
          return (
            <div
              key={s.id}
              className={`relative rounded-lg border-2 px-2.5 py-1.5 min-w-16 text-center transition-all ${
                isAssigned && typeMeta
                  ? `${typeMeta.border} bg-linear-to-br ${typeMeta.gradient}`
                  : 'border-dashed border-slate-300 bg-white'
              }`}
              title={
                isAssigned && passenger
                  ? t('booking.seatAssigned', {
                      code: s.code,
                      name: passenger.name || t('booking.passenger', { n: passengerIdx + 1 }),
                    })
                  : t('booking.seatUnassigned', { code: s.code })
              }
            >
              <div className="font-mono font-bold text-xs">{s.code}</div>
              {isAssigned && typeMeta ? (
                <div
                  className={`text-[10px] font-medium ${typeMeta.text} flex items-center justify-center gap-0.5`}
                >
                  {typeMeta.icon}
                  {t('bookingFlow.hpLabel')}
                  {passengerIdx + 1}
                </div>
              ) : (
                <div className="text-[10px] text-slate-400">{t('bookingFlow.unassigned')}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
