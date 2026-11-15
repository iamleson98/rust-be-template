import { queryOptions, useQuery } from '@tanstack/react-query'
import { brandProfileOptions as brandProfileQuery } from '@/api'

export type {
  BrandProfile,
  ProfileLocation,
  ProfileRoute,
  ProfileSchedule,
  ProfileTrip,
} from '@/api'

/**
 * `GET /api/brands/{slug}/profile`. Tagged like the generated brand queries
 * plus routes and trips, so a brand, route or schedule edit refreshes it;
 * between edits the server answers from the edge cache for a minute, so the
 * page waits as long before asking again (`staleTime`) instead of on every
 * visit.
 */
export const brandProfileOptions = (slug: string) => {
  const generated = brandProfileQuery({ path: { slug } })
  const [key] = generated.queryKey
  return queryOptions({
    ...generated,
    queryKey: [{ ...key, tags: [...(key.tags ?? []), 'routes', 'trips'] }],
    // Seats left move, so it waits only as long as the server's own cache does.
    staleTime: 60_000,
  })
}

export const useBrandProfile = (slug: string) => useQuery(brandProfileOptions(slug))
