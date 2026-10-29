import { useMemo, useState } from "react";
import type { SearchFacets } from "@spa/api";
import {
  activeFilterCount,
  effectiveRange,
  NO_FILTERS,
  priceBounds,
  type Filters,
} from "./filters";

/**
 * The results page's filters: what is picked, and the price range the slider
 * shows against every match's prices (`facets`). The server does the
 * filtering; the state lives in the `/search` URL, so the query can read it
 * before the results (and their facets) arrive, and a reload keeps it.
 */
export function useResultFilters(
  filters: Filters,
  setFilters: (filters: Filters) => void,
  facets: SearchFacets | undefined,
) {
  const bounds = useMemo(() => priceBounds(facets), [facets]);

  // A new search moves the price bounds: forget the old price pick (render-phase
  // sync). Only a move between two answers counts: the first answer of a page
  // load sets the bounds a price pick from the URL was made against.
  const boundsKey = facets?.matches ? bounds.join("-") : null;
  const [lastKey, setLastKey] = useState(boundsKey);
  if (boundsKey !== null && boundsKey !== lastKey) {
    setLastKey(boundsKey);
    if (lastKey !== null && (filters.priceMin || filters.priceMax)) {
      setFilters({ ...filters, priceMin: 0, priceMax: 0 });
    }
  }

  const range = useMemo(() => effectiveRange(filters, bounds), [filters, bounds]);

  return {
    filters,
    setFilters,
    reset: () => setFilters(NO_FILTERS),
    bounds,
    range,
    facets,
    activeCount: activeFilterCount(filters, range, bounds),
  };
}

export type ResultFilters = ReturnType<typeof useResultFilters>;
