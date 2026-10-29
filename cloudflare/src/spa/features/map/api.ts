import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { placesSearchOptions } from "@spa/api";
import { useDebouncedValue } from "@spa/hooks/use-debounced-value";

/** The index is rebuilt weekly: an answer stays good for the whole visit. */
const PLACE_STALE_MS = 60 * 60 * 1000;
/** Typing pause before a request; each keystroke would otherwise be one. */
const PLACE_DEBOUNCE_MS = 180;

/**
 * The form a query is sent in. The engine ignores case and repeated spaces,
 * so "Hà Nội", "hà  nội " and "HÀ NỘI" become one request: one browser cache
 * entry, one edge cache entry (the Worker keys place reads the same way).
 */
export const normalizePlaceQuery = (q: string) =>
  q.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Place autocomplete over the raw input text: debounced, normalized, cached
 * for the visit, and cancelled when a newer query supersedes it. Idle for
 * blank queries or while `enabled` is false. `limit` is the rows the caller
 * shows; fetching more is wasted work for the engine and the network.
 */
export function usePlaceSearch(
  q: string,
  { enabled = true, limit = 8 }: { enabled?: boolean; limit?: number } = {},
) {
  const query = useDebouncedValue(normalizePlaceQuery(q), PLACE_DEBOUNCE_MS);
  return useQuery({
    ...placesSearchOptions({ query: { q: query, limit } }),
    enabled: enabled && !!query,
    staleTime: PLACE_STALE_MS,
    // The app-wide "always" refetches on every mount; place answers are not live data.
    refetchOnMount: true,
    placeholderData: keepPreviousData,
  });
}
