/**
 * Options for the public catalog reads (brands, routes): the server answers
 * them from the edge cache for a minute and they change only when staff edit
 * the catalog, which refreshes them through their resource tags. So they stay
 * fresh for 5 minutes instead of the global 30 s: on the Free plan every
 * `/api` call counts against 100,000 Worker requests a day.
 */
export const CATALOG_QUERY = { staleTime: 5 * 60_000 } as const;
