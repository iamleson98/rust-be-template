'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Navigation } from 'lucide-react'
import { BookingItem, isBookingUpcoming } from '@/features/booking/history/booking-types'
import { RouteNavigationDialog } from '@/features/map/route-navigation-dialog'

/**
 * PickupDirectionsButton (ROUTE-1)
 *
 * Renders the "Đường đi đến điểm đón" button + the dialog that shows
 * driving directions from the user's current location to the booking's
 * boarding point.
 *
 * Renders nothing if:
 *   - the booking is not in an actionable status (pending/confirmed/paid)
 *   - the trip is not upcoming
 *   - the booking has no persisted pickup coordinates
 *
 * Designed to be plugged into BookingCard via the `extraActions` slot —
 * see `BookingList.renderExtraActions` and `BookingCard.extraActions`.
 */
export function PickupDirectionsButton({ booking }: { booking: BookingItem }) {
  const [open, setOpen] = useState(false)

  // Only show for actionable, upcoming bookings with valid pickup coords.
  const isActionable =
    booking.status === 'pending' ||
    booking.status === 'confirmed' ||
    booking.status === 'paid'
  const isUpcoming = isBookingUpcoming(booking)
  const hasCoords =
    typeof booking.pickupPointLat === 'number' &&
    typeof booking.pickupPointLon === 'number' &&
    Number.isFinite(booking.pickupPointLat) &&
    Number.isFinite(booking.pickupPointLon)

  if (!isActionable || !isUpcoming || !hasCoords) {
    return null
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-blue-700 hover:text-blue-800 hover:bg-blue-50 border-blue-200"
        onClick={() => setOpen(true)}
        aria-label="Đường đi đến điểm đón"
      >
        <Navigation className="h-3.5 w-3.5" />
        Đường đi đến điểm đón
      </Button>

      <RouteNavigationDialog
        open={open}
        onOpenChange={setOpen}
        pickupName={booking.pickupPointName}
        pickupAddress={booking.pickupPointAddress ?? null}
        pickupLat={booking.pickupPointLat!}
        pickupLon={booking.pickupPointLon!}
      />
    </>
  )
}
