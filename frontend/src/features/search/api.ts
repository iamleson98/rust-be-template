import { keepPreviousData, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { searchTripsGeoOptions, searchTripsOptions, type TripSearchResponse } from '@/api'
import type { SearchParams } from '@/lib/search-params'

export type TripSearchParams = Pick<SearchParams, 'from' | 'to' | 'date'> &
  Partial<
    Pick<
      SearchParams,
      'adults' | 'children' | 'sort' | 'vehicleTypes' | 'fromLat' | 'fromLon' | 'toLat' | 'toLon'
    >
  >

const isCoord = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Both endpoints return `TripSearchResponse`, but their key types differ, so
 * the options are widened to one shape. Precise picks (all four coordinates)
 * switch to the geo endpoint, which ranks by pickup + drop distance.
 */
function tripSearchOptions(p: TripSearchParams) {
  const minSeats = (p.adults ?? 1) + (p.children ?? 0)
  const vehicleTypes = p.vehicleTypes?.length ? p.vehicleTypes.join(',') : undefined
  const options =
    isCoord(p.fromLat) && isCoord(p.fromLon) && isCoord(p.toLat) && isCoord(p.toLon)
      ? searchTripsGeoOptions({
          query: {
            fromLat: p.fromLat,
            fromLon: p.fromLon,
            toLat: p.toLat,
            toLon: p.toLon,
            date: p.date,
            minSeats,
            vehicleTypes,
          },
        })
      : searchTripsOptions({
          query: {
            from: p.from,
            to: p.to,
            date: p.date,
            sort: p.sort ?? 'departure',
            minSeats,
            vehicleTypes,
          },
        })
  return options as unknown as UseQueryOptions<TripSearchResponse>
}

/** Trips for a search; stays idle until `params` has a place and a date. */
export function useTripSearch(params: TripSearchParams | null) {
  return useQuery({
    ...tripSearchOptions(params ?? { from: '', to: '', date: '' }),
    enabled: !!params && !!(params.from || params.to) && !!params.date,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 1,
  })
}
