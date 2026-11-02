/**
 * Options for the public catalog reads (brands, routes): the server answers
 * them from the edge cache for a minute and they change only when staff edit
 * the catalog, which refreshes them through their resource tags. The global
 * default, `refetchOnMount: "always"`, would ask again on every mount, and on
 * the Free plan every `/api` call counts against 100,000 Worker requests a day.
 */
export const CATALOG_QUERY = { staleTime: 5 * 60_000, refetchOnMount: true } as const;
