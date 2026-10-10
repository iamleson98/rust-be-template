import { MutationCache, QueryClient, type Query } from '@tanstack/react-query'

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** Resource the mutation belongs to (set by the SDK generator). */
      resource?: string
      /** Extra resources to refresh on top of `resource`. */
      invalidates?: string[]
    }
  }
}

/** Resources that also hold stale data after a mutation on the key resource. */
const ALSO_REFRESH: Record<string, string[]> = {
  bookings: ['trips', 'loyalty'], // seats return to the pool; points derive from bookings
  payments: ['bookings'], // payment state drives booking state
  adminPayments: ['payments', 'bookings', 'adminBookings'],
  adminBookings: ['bookings', 'trips'], // a staff cancel frees seats
  adminReviews: ['reviews'],
  users: ['auth'], // a role change alters the session user
}

const resourcesOf = (query: Query) =>
  (query.queryKey[0] as { tags?: string[] } | undefined)?.tags ?? []

/** Mark every cached query tagged with one of `resources` stale (active ones refetch). */
export const invalidateResources = (queryClient: QueryClient, ...resources: string[]) =>
  queryClient.invalidateQueries({
    predicate: (query) => resourcesOf(query).some((r) => resources.includes(r)),
  })

export function createQueryClient() {
  const queryClient: QueryClient = new QueryClient({
    // Mutations refresh every cached query that shares their resource tag, so
    // call sites never repeat `invalidateQueries` (see openapi-ts.config.ts).
    mutationCache: new MutationCache({
      onSuccess: (_data, _vars, _ctx, { meta }) => {
        const { resource, invalidates = [] } = meta ?? {}
        const stale = [
          ...(resource ? [resource, ...(ALSO_REFRESH[resource] ?? [])] : []),
          ...invalidates,
        ]
        if (stale.length) void invalidateResources(queryClient, ...stale)
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false, // no reload flicker on alt-tab
        refetchOnMount: 'always',
        refetchOnReconnect: true,
        // 429s back off exponentially (3 tries); anything else retries once.
        retry: (failureCount, error) =>
          (error as { status?: number })?.status === 429 ? failureCount < 3 : failureCount < 1,
        retryDelay: (attempt, error) =>
          (error as { status?: number })?.status === 429
            ? Math.min(1000 * 2 ** attempt, 10_000)
            : 1000,
      },
      mutations: { retry: 0 },
    },
  })
  return queryClient
}
