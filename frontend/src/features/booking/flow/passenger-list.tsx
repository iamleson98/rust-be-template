'use client'

import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { AlertTriangle, Baby, CheckCircle2, User, UserCheck } from 'lucide-react'
import { useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import type { PassengerFormValue } from './booking-form'

/** Head count by passenger type, the seat subtotal, and what still blocks continuing. */
export function PassengerSummary({
  passengers,
  seatCount,
  subtotal,
  unassigned,
  duplicateSeats,
}: {
  passengers: PassengerFormValue[]
  seatCount: number
  subtotal: number
  unassigned: number
  duplicateSeats: boolean
}) {
  const t = useT()
  const money = useMoney()
  const adult = passengers.filter((p) => p.age >= 12).length
  const child = passengers.filter((p) => p.age >= 2 && p.age < 12).length
  const infant = passengers.filter((p) => p.age < 2).length

  return (
    <div className="rounded-lg border bg-white p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
        <CheckCircle2 className="h-3 w-3 text-blue-600" />
        {t('bookingFlow.summaryTitle')}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge className="bg-blue-100 text-blue-700 border-0 gap-1">
          <User className="h-3 w-3" />
          {t('bookingFlow.countAdult', { count: adult })}
        </Badge>
        <Badge className="bg-amber-100 text-amber-700 border-0 gap-1">
          <UserCheck className="h-3 w-3" />
          {t('bookingFlow.countChild', { count: child })}
        </Badge>
        {infant > 0 && (
          <Badge className="bg-pink-100 text-pink-700 border-0 gap-1">
            <Baby className="h-3 w-3" />
            {t('bookingFlow.countInfant', { count: infant })}
          </Badge>
        )}
        <Separator orientation="vertical" className="h-4" />
        <span className="text-muted-foreground">{t('bookingFlow.seatSubtotal')}</span>
        <span className="font-bold text-blue-700">{money(subtotal)}</span>
      </div>
      {unassigned > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{t('bookingFlow.unassignedHint', { count: unassigned })}</span>
        </div>
      )}
      {duplicateSeats && (
        <div className="flex items-center gap-1.5 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{t('bookingFlow.duplicateSeatsWarning')}</span>
        </div>
      )}
      {unassigned === 0 && !duplicateSeats && passengers.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-2 py-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>{t('bookingFlow.allSeatsAssigned')}</span>
        </div>
      )}
      <span className="sr-only">{t('bookingFlow.seatsSelectedCount', { count: seatCount })}</span>
    </div>
  )
}
