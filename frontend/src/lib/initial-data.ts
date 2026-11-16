import type { QueryClient } from '@tanstack/react-query'
import { brandsOptions, recommendationsOptions, routesOptions, statsOptions } from '@/api'

/** Where the server writes what the home page's first screen reads (`src/web/content.rs`). */
export const INITIAL_DATA_ID = 'initial-data'

/**
 * Puts the answers the server embedded in the page into the query cache, so
 * the screen that is about to mount finds them there and asks the API for
 * nothing. Each is stamped with the moment the server read it: a query that
 * is stale by its own rules asks again as usual. Anything missing or not
 * understood is skipped (the screen then fetches it as before).
 */
export function primeFromServer(queryClient: QueryClient, doc: Document = document): void {
  const raw = doc.getElementById(INITIAL_DATA_ID)?.textContent
  if (!raw) return
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }
  const updatedAt = typeof data.generatedAt === 'number' ? data.generatedAt : undefined
  if (updatedAt === undefined) return
  const put = (queryKey: readonly unknown[], value: unknown) => {
    if (value && typeof value === 'object') queryClient.setQueryData(queryKey, value, { updatedAt })
  }
  put(routesOptions().queryKey, data.routes)
  put(brandsOptions().queryKey, data.brands)
  put(statsOptions().queryKey, data.stats)
  put(recommendationsOptions().queryKey, data.recommendations)
}
