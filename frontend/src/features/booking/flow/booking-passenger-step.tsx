'use client'

/**
 * BookingPassengerStep — step 1 (passengers) of the BookingDialog: the
 * header + "Sao chép từ liên hệ" / "Tự ghép ghế" actions, the mini seat
 * preview, the per-passenger form cards, the add-passenger button, the
 * passenger summary and the continue CTA.
 *
 * Extracted from the original `booking-dialog.tsx` — the parent owns the
 * RHF form (`form` is passed down) and all the passenger-array callbacks.
 */

import type { FieldArrayWithId, UseFormReturn } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Users, Copy, Sparkles, Plus, ChevronRight } from 'lucide-react'
import type { Currency } from '@/lib/currency'
import { SeatSelector } from './seat-selector'
import { PassengerSummary } from './passenger-list'
import { PassengerFormCard } from './passenger-form-card'
import { type BookingValues, type PassengerFormValue, type SelectedSeat } from './booking-form'

export function BookingPassengerStep({
  form,
  passengers,
  passengerFields,
  selectedSeatCodes,
  currency,
  guestName,
  subtotal,
  unassignedCount,
  hasDuplicateSeats,
  canContinueStep1,
  error,
  addPassenger,
  removePassenger,
  autoAssignSeats,
  copyContactToFirst,
  gotoContact,
}: {
  form: UseFormReturn<BookingValues>
  passengers: PassengerFormValue[]
  passengerFields: FieldArrayWithId<BookingValues, 'passengers'>[]
  selectedSeatCodes: SelectedSeat[]
  currency: Currency
  guestName: string | null
  subtotal: number
  unassignedCount: number
  hasDuplicateSeats: boolean
  canContinueStep1: boolean
  error: string
  addPassenger: () => void
  removePassenger: (index: number) => void
  autoAssignSeats: () => void
  copyContactToFirst: () => void
  gotoContact: () => void
}) {
  return (
    <div className="p-5 space-y-4">
      {/* Header + actions */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <Users className="h-4 w-4 text-blue-600" />
            Thông tin hành khách
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {passengers.length}/{selectedSeatCodes.length} hành khách • {selectedSeatCodes.length} ghế đã chọn
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={copyContactToFirst}
            disabled={!form.getValues('contactName') && !guestName}
            className="gap-1.5 h-8 text-xs"
          >
            <Copy className="h-3.5 w-3.5" />
            Sao chép từ liên hệ
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={autoAssignSeats}
            disabled={unassignedCount === 0}
            className="gap-1.5 h-8 text-xs"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Tự ghép ghế
          </Button>
        </div>
      </div>

      {/* Mini seat preview — color-coded by passenger */}
      {selectedSeatCodes.length > 0 && (
        <SeatSelector
          selectedSeats={selectedSeatCodes}
          passengers={passengers}
        />
      )}

      {/* Passenger cards */}
      <div className="space-y-3">
        {passengerFields.map((p, i) => (
          <PassengerFormCard
            key={p.id}
            p={p}
            i={i}
            passengers={passengers}
            passengerFields={passengerFields}
            selectedSeatCodes={selectedSeatCodes}
            control={form.control}
            currency={currency}
            removePassenger={removePassenger}
          />
        ))}
      </div>

      {/* Add passenger button */}
      {passengerFields.length < selectedSeatCodes.length && (
        <Button
          variant="outline"
          onClick={addPassenger}
          className="w-full gap-1.5 border-dashed"
        >
          <Plus className="h-4 w-4" />
          Thêm hành khách (còn {selectedSeatCodes.length - passengerFields.length} ghế)
        </Button>
      )}

      {/* Summary section */}
      <PassengerSummary
        passengers={passengers}
        selectedSeatCount={selectedSeatCodes.length}
        subtotal={subtotal}
        currency={currency}
        unassignedCount={unassignedCount}
        hasDuplicateSeats={hasDuplicateSeats}
      />

      {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

      <div className="flex justify-end">
        <Button
          onClick={gotoContact}
          disabled={!canContinueStep1}
          className="gap-1 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700"
        >
          Tiếp tục <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
