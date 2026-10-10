import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { placesSearchOptions } from '@/api'

/** Place autocomplete; idle for blank queries or while `enabled` is false. */
export function usePlaceSearch(q: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    ...placesSearchOptions({ query: { q, limit: 20 } }),
    enabled: enabled && !!q.trim(),
    placeholderData: keepPreviousData,
  })
}
