'use client'

import { Button } from '@/components/ui/button'
import { Users, Copy, Sparkles, Plus, ChevronRight } from 'lucide-react'
import { useGuest } from '@/stores/guest'
import { useT } from '@/lib/i18n'
import { SeatSelector } from './seat-selector'
import { PassengerSummary } from './passenger-list'
import { PassengerFormCard } from './passenger-form-card'
import type { BookingForm } from './use-booking-form'

/** Step 1: who travels on which seat, with helpers to fill names and hand out seats. */
export function BookingPassengerStep({
  booking,
  error,
  onContinue,
}: {
  booking: BookingForm
  error: string
  onContinue: () => void
}) {
  const t = useT()
  const guestName = useGuest((s) => s.guestName)
  const { form, fields, passengers, seats } = booking
  return (
    <div className="p-5 space-y-4">
      {/* Header + actions */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <Users className="h-4 w-4 text-blue-600" />
            {t('bookingFlow.passengerInfo')}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('bookingFlow.passengerSeatSummary', {
              count: passengers.length,
              seats: seats.length,
            })}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={booking.copyContactName}
            disabled={!form.getValues('contactName') && !guestName}
            className="gap-1.5 h-8 text-xs"
          >
            <Copy className="h-3.5 w-3.5" />
            {t('bookingFlow.copyFromContact')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={booking.autoAssignSeats}
            disabled={booking.unassigned === 0}
            className="gap-1.5 h-8 text-xs"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('bookingFlow.autoMatchSeats')}
          </Button>
        </div>
      </div>

      <SeatSelector selectedSeats={seats} passengers={passengers} />

      <div className="space-y-3">
        {fields.map((field, i) => (
          <PassengerFormCard
            key={field.id}
            index={i}
            // `useWatch` lags a freshly appended field by one render.
            passenger={passengers[i] ?? field}
            passengers={passengers}
            seats={seats}
            control={form.control}
            onRemove={fields.length > 1 ? () => booking.removePassenger(i) : undefined}
          />
        ))}
      </div>

      {fields.length < seats.length && (
        <Button
          variant="outline"
          onClick={booking.addPassenger}
          className="w-full gap-1.5 border-dashed"
        >
          <Plus className="h-4 w-4" />
          {t('bookingFlow.addPassengerRemaining', { count: seats.length - fields.length })}
        </Button>
      )}

      <PassengerSummary
        passengers={passengers}
        seatCount={seats.length}
        subtotal={booking.subtotal}
        unassigned={booking.unassigned}
        duplicateSeats={booking.duplicateSeats}
      />

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={onContinue}
          disabled={!booking.canContinue}
          className="gap-1 bg-primary hover:bg-primary/90"
        >
          {t('bookingFlow.continue')} <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
