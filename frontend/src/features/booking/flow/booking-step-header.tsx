'use client'

import { DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { formatDateTimeVN } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { Check, Ticket, Calendar, Bus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TripDetail } from '@/api'
import type { BookingStep } from '@/stores/booking-flow'
import type { SelectedSeat } from './booking-form'

/** Position of each step on the 3-dot stepper; paying online is still the payment step. */
const STEP_INDEX: Record<BookingStep, number> = {
  idle: 0,
  passengers: 0,
  contact: 1,
  payment: 2,
  pay: 2,
  success: 3,
}

/** Title, progress stepper and a one-line trip summary above every checkout step. */
export function BookingStepHeader({
  step,
  trip,
  seats,
}: {
  step: BookingStep
  trip: TripDetail | undefined
  seats: SelectedSeat[]
}) {
  const t = useT()
  const stepIndex = STEP_INDEX[step]
  const steps = [t('booking.passengers'), t('bookingFlow.stepContact'), t('booking.payment')]

  return (
    <div className="px-5 py-4 border-b bg-white">
      <DialogTitle className="text-lg font-extrabold flex items-center gap-2">
        <Ticket className="h-5 w-5 text-primary" />
        {step === 'success' ? t('booking.success') : t('bookingFlow.completeBooking')}
      </DialogTitle>
      <DialogDescription className="text-xs mt-1 pr-12">
        {trip
          ? `${trip.brand.name ?? ''} • ${trip.from.name ?? ''} → ${trip.to.name ?? ''}`
          : t('common.loading')}
      </DialogDescription>

      {step !== 'success' && (
        <div className="flex items-center mt-3.5" aria-label={t('bookingFlow.stepProgress')}>
          {steps.map((s, i) => (
            <div key={s} className={cn('flex items-center', i > 0 && 'flex-1')}>
              {i > 0 && (
                <div
                  className={cn(
                    'h-0.5 flex-1 mx-2 rounded-full transition-colors',
                    i <= stepIndex ? 'bg-primary' : 'bg-slate-200',
                  )}
                />
              )}
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    'h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors',
                    i < stepIndex
                      ? 'bg-primary text-white'
                      : i === stepIndex
                        ? 'bg-primary text-white ring-4 ring-primary/15'
                        : 'bg-slate-100 text-slate-400',
                  )}
                >
                  {i < stepIndex ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <span
                  className={cn(
                    'text-xs whitespace-nowrap',
                    i === stepIndex ? 'font-semibold text-primary' : 'text-muted-foreground',
                    i > stepIndex && 'hidden sm:inline',
                  )}
                >
                  {s}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {trip && step !== 'success' && (
        <div className="-mx-5 -mb-4 px-5 py-2.5 bg-slate-50 border-t flex items-center gap-3 text-xs mt-3">
          <Bus className="h-4 w-4 text-primary shrink-0" />
          <span className="font-medium truncate">
            {trip.from.name} → {trip.to.name}
          </span>
          <span className="text-muted-foreground flex items-center gap-1 shrink-0">
            <Calendar className="h-3 w-3" />
            {formatDateTimeVN(trip.trip.departureAt)}
          </span>
          <div className="ml-auto flex items-center gap-1 overflow-hidden">
            {seats.slice(0, 6).map((s) => (
              <Badge key={s.id} variant="outline" className="font-mono text-[10px]">
                {s.code}
              </Badge>
            ))}
            {seats.length > 6 && (
              <span className="text-[10px] text-muted-foreground">+{seats.length - 6}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
