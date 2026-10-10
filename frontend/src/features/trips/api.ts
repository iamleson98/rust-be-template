import { useQuery } from '@tanstack/react-query'
import { tripDetailOptions } from '@/api'

/** Trip detail (seat map, stops, pricing); idle until an id is given. */
export function useTripDetail(tripId: string | undefined) {
  return useQuery({
    ...tripDetailOptions({ path: { id: tripId ?? '' } }),
    enabled: !!tripId,
  })
}
