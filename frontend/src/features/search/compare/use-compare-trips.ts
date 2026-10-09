import { useQueries, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { tripDetail, type TripDetail, type TripResult, type TripSearchResponse } from '@/api'

/** A row any search on this page already fetched (both search endpoints are tagged `search`). */
function fromSearchCache(queryClient: QueryClient, tripId: string): TripResult | undefined {
  const searches = queryClient.getQueriesData<TripSearchResponse>({
    predicate: (q) => (q.queryKey[0] as { tags?: string[] }).tags?.includes('search') ?? false,
  })
  for (const [, response] of searches) {
    const hit = response?.items.find((r) => r.tripId === tripId)
    if (hit) return hit
  }
}

/** The detail endpoint, reshaped as a search-result row for the comparison table. */
function detailToResult(d: TripDetail): TripResult {
  return {
    tripId: d.trip.id,
    amenities: d.amenities.map((a) => a.label),
    arrivalAt: d.trip.arrivalAt ?? undefined,
    availableSeats: d.trip.availableSeats,
    brandAccent: d.brand.accentColor ?? '#2563eb',
    brandId: d.brand.id ?? undefined,
    brandName: d.brand.name ?? '',
    brandRating: d.brand.rating,
    brandSlug: d.brand.slug ?? '',
    busLayoutId: d.busLayout.id,
    capacity: d.busLayout.capacity ?? undefined,
    departureAt: d.trip.departureAt ?? undefined,
    departureDate: d.trip.departureDate,
    departureTime: d.trip.departureTime ?? undefined,
    fromLat: d.from.lat,
    fromLon: d.from.lon,
    fromName: d.from.name,
    maxPrice: d.pricing.basePriceAdult,
    minPrice: d.pricing.basePriceAdult,
    priceAdult: d.pricing.basePriceAdult,
    priceChild: d.pricing.basePriceChild,
    routeId: d.route.id,
    routeName: d.route.name,
    scheduleId: d.trip.id,
    toLat: d.to.lat,
    toLon: d.to.lon,
    toName: d.to.name,
    totalSeats: d.trip.totalSeats,
    vehicleType: d.busLayout.vehicleType ?? 'standard',
  } as unknown as TripResult
}

/** Rows for the compared trips: from the search cache when possible, else the trip detail (so a reload still works). */
export function useCompareTrips(tripIds: string[]) {
  const queryClient = useQueryClient()
  return useQueries({
    queries: tripIds.map((id) => ({
      queryKey: ['compare-trip', id],
      staleTime: Number.POSITIVE_INFINITY,
      retry: false,
      queryFn: async () =>
        fromSearchCache(queryClient, id) ??
        detailToResult((await tripDetail({ path: { id }, throwOnError: true })).data),
    })),
    combine: (results) => ({
      trips: results.flatMap((r) => (r.data ? [r.data] : [])),
      loading: results.some((r) => r.isPending),
    }),
  })
}
