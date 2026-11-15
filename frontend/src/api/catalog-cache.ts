/**
 * Options for the public catalog reads (brands, routes): the server answers
 * them from its cache for a minute and they change only when staff edit the
 * catalog, which refreshes them through their resource tags. So they stay
 * fresh for 5 minutes instead of the global 30 s.
 */
export const CATALOG_QUERY = { staleTime: 5 * 60_000 } as const
