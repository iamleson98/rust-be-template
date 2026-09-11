'use client'

/**
 * BookingStepHeader — the dialog header of the BookingDialog: title +
 * description line, the 4-step progress stepper and the trip summary bar
 * (route, departure time, selected seat codes).
 *
 * Extracted from the original `booking-dialog.tsx`; the stepIndex / steps
 * labels moved here with it.
 */

import { DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { formatDateTimeVN } from '@/lib/types'
import { CheckCircle2, Ticket, Calendar, Bus } from 'lucide-react'
import { type SelectedSeat, type TripDetail } from './booking-form'

export function BookingStepHeader({
  bookingStep,
  trip,
  selectedSeatCodes,
}: {
  bookingStep: string
  trip: TripDetail | null | undefined
  selectedSeatCodes: SelectedSeat[]
}) {
  const stepIndex = ((bookingStep: string): number => {
    if (bookingStep === 'contact') return 1
    if (bookingStep === 'payment') return 2
    if (bookingStep === 'success') return 3
    return 0 // 'idle' or 'passengers'
  })(bookingStep)
  const steps = ['Hành khách', 'Liên hệ', 'Thanh toán', 'Hoàn tất']

  return (
    <div className="px-5 py-4 border-b bg-linear-to-r from-blue-50 to-blue-50">
      <DialogTitle className="text-lg font-extrabold flex items-center gap-2">
        <Ticket className="h-5 w-5 text-blue-600" />
        {bookingStep === 'success' ? 'Đặt vé thành công!' : 'Hoàn tất đặt vé'}
      </DialogTitle>
      <DialogDescription className="text-xs mt-1">
        {trip ? `${trip.brand.name} • ${trip.from.name} → ${trip.to.name}` : 'Đang tải...'}
      </DialogDescription>

      {/* Stepper */}
      {bookingStep !== 'success' && (
        <div className="flex items-center gap-1 mt-3">
          {steps.slice(0, 3).map((s, i) => (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div
                className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${i < stepIndex
                    ? 'bg-blue-600 text-white'
                    : i === stepIndex
                      ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                      : 'bg-slate-200 text-slate-500'
                  }`}
              >
                {i < stepIndex ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`text-xs ${i === stepIndex ? 'font-semibold text-blue-700' : 'text-muted-foreground'}`}>{s}</span>
              {i < 2 && <div className={`h-px flex-1 mx-1 ${i < stepIndex ? 'bg-blue-400' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>
      )}

      {/* Trip summary bar */}
      {trip && bookingStep !== 'success' && (
        <div className="px-5 py-2.5 bg-slate-50 border-b flex items-center gap-3 text-xs">
          <Bus className="h-4 w-4 text-blue-600" />
          <span className="font-medium">{trip.from.name} → {trip.to.name}</span>
          <span className="text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDateTimeVN(trip.trip.departureAt)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {selectedSeatCodes.map((s) => (
              <Badge key={s.id} variant="outline" className="font-mono text-[10px]">
                {s.code}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
