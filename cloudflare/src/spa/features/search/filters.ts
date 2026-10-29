import type { SearchFacets } from "@spa/api";
import type { Filters } from "@spa/lib/search-params";

// The filters are part of the `/search` URL; their shape lives with that contract.
export { NO_FILTERS, type Filters, type TimeRange } from "@spa/lib/search-params";

export type PriceRange = [number, number];

const PRICE_STEP = 50_000;

/** Every match's cheapest to dearest seat, rounded out to the slider step. */
export function priceBounds(facets: SearchFacets | undefined): PriceRange {
  if (!facets?.matches) return [0, 1_000_000];
  return [
    Math.floor(facets.priceMin / PRICE_STEP) * PRICE_STEP,
    Math.ceil(facets.priceMax / PRICE_STEP) * PRICE_STEP,
  ];
}

/** The selected price range, clamped into the bounds. */
export function effectiveRange(f: Filters, [lo, hi]: PriceRange): PriceRange {
  return [
    f.priceMin === 0 || f.priceMin < lo ? lo : f.priceMin,
    f.priceMax === 0 || f.priceMax > hi ? hi : f.priceMax,
  ];
}

/** The search query's filter parameters: only what narrows the search. */
export function filterQuery(f: Filters) {
  const list = (values: string[]) => (values.length ? values.join(",") : undefined);
  return {
    brands: list(f.brands),
    priceMin: f.priceMin || undefined,
    priceMax: f.priceMax || undefined,
    hours: list(f.timeRanges),
    minRating: f.minRating || undefined,
    plentyOfSeats: f.availableOnly || undefined,
    amenities: list(f.amenities),
  };
}

export type FilterQuery = ReturnType<typeof filterQuery>;

/** How many filter chips are active (a price range counts once, the rest per value). */
export function activeFilterCount(f: Filters, range: PriceRange, bounds: PriceRange): number {
  const priceActive = range[0] > bounds[0] || range[1] < bounds[1];
  return (
    Number(priceActive) +
    f.timeRanges.length +
    Number(f.minRating > 0) +
    f.brands.length +
    Number(f.availableOnly) +
    f.amenities.length
  );
}

export const toggle = <T>(list: T[], item: T): T[] =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

/** A facet's count for `key` (0 when no match has it). */
export const facetCount = (counts: { key: string; count: number }[] | undefined, key: string) =>
  counts?.find((c) => c.key === key)?.count ?? 0;
