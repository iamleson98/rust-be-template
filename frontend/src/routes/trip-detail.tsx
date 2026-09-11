/**
 * Trip detail route — `/trips/$tripId`
 *
 * Deep-linkable trip detail page. Replaces the old `selectedTripId` +
 * TripDetailDialog pattern. The URL is shareable and crawlers see the
 * trip content (seat map, route, brand, reviews).
 *
 * The TripDetailDialog component is rendered with `tripId` from the
 * route params. Closing the dialog navigates back to the previous page
 * (browser history).
 */
import { useParams, useNavigate } from '@tanstack/react-router'
import { TripDetailDialog } from '@/features/trips/trip-detail-dialog'

export function TripDetailPage() {
  const { tripId } = useParams({ from: '/trips/$tripId' })
  const navigate = useNavigate()

  return (
    <TripDetailDialog
      tripId={tripId}
      onClose={() => {
        // If there's history, go back; otherwise go home.
        if (typeof window !== 'undefined' && window.history.length > 1) {
          window.history.back()
        } else {
          navigate({ to: '/' })
        }
      }}
    />
  )
}
