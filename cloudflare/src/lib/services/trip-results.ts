/**
 * The shared half of trip search — the pure part of `trip_search::results`:
 * the customer's filters, the filter options counted over every match, the
 * deterministic sort and offset paging. The city search and the coordinate
 * search both end here; loading the cards is `trip-cards.ts`.
 */
import { amenityLabel, minutesOf } from "./public-format";
import {
  FEW_SEATS,
  HOUR_BANDS,
  type Filters,
  type SearchOptions,
  type Sort,
} from "./trip-search-options";

/** Where the customer boards or leaves a trip (coordinate search). */
export interface TripStopMatch {
  name: string;
  /** `HH:MM` the bus is there, when the timetable says. */
  time?: string;
  distanceKm: number;
}

/** One result card — the flat `TripResult` the SPA reads. */
export interface TripCard {
  tripId: string;
  scheduleId: string;
  departureDate: string;
  status: string;
  availableSeats: number;
  totalSeats: number;
  routeId: string;
  routeName: string;
  brandId?: string;
  brandName: string;
  brandSlug: string;
  brandLogo?: string;
  brandRating?: number;
  fromName: string;
  fromLat: number;
  fromLon: number;
  toName: string;
  toLat: number;
  toLon: number;
  departureTime?: string;
  departureAt?: string;
  arrivalAt?: string;
  busLayoutId?: string;
  minPrice: number;
  maxPrice: number;
  priceAdult: number;
  priceChild: number;
  vehicleType: string;
  vehicleTypeLabel: string;
  capacity?: number;
  amenities: string[];
  pickup?: TripStopMatch;
  dropoff?: TripStopMatch;
}

/** A card and what sorting and filtering need about it. */
export interface Built {
  card: TripCard;
  /** Minutes past midnight of the departure day when the customer boards. */
  boardsAt: number;
  /** Pickup + drop-off distance (km); null outside the coordinate search. */
  distanceKm: number | null;
}

export interface FacetCount {
  key: string;
  label: string;
  count: number;
}

export interface SearchFacets {
  matches: number;
  priceMin: number;
  priceMax: number;
  brands: FacetCount[];
  vehicleTypes: FacetCount[];
  hours: FacetCount[];
  amenities: FacetCount[];
  plentyOfSeats: number;
}

export interface TripSearchResponse {
  items: TripCard[];
  total?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  facets?: SearchFacets;
}

const DAY_MINUTES = 24 * 60;

/**
 * When the customer boards, in minutes past midnight of the departure day:
 * at their pickup stop when the timetable says (past midnight when the bus
 * gets there after the day rolled over), else at departure.
 */
export function boardingMinutes(departureTime: string, pickupTime: string | undefined): number {
  const departs = minutesOf(departureTime) ?? 0;
  const at = pickupTime ? minutesOf(pickupTime) : null;
  if (at == null) return departs;
  return at < departs ? at + DAY_MINUTES : at;
}

const boardingHour = (b: Built) => Math.floor((b.boardsAt % DAY_MINUTES) / 60);

/** Does a card pass every filter the customer set? */
export function keep(b: Built, f: Filters): boolean {
  const t = b.card;
  return (
    (f.vehicleTypes.length === 0 || f.vehicleTypes.includes(t.vehicleType)) &&
    (f.brands.length === 0 || f.brands.includes(t.brandSlug)) &&
    (f.priceMin === undefined || t.minPrice >= f.priceMin) &&
    (f.priceMax === undefined || t.minPrice <= f.priceMax) &&
    (f.hours.length === 0 ||
      f.hours.some(([start, end]) => boardingHour(b) >= start && boardingHour(b) < end)) &&
    (f.minRating === undefined || (t.brandRating ?? 0) >= f.minRating) &&
    (!f.plentyOfSeats || t.availableSeats > FEW_SEATS) &&
    f.amenities.every((a) => t.amenities.includes(a))
  );
}

/** Byte-wise string order, as Rust's `String::cmp`. */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function countFacets(pairs: Array<[key: string, label: string]>): FacetCount[] {
  const byKey = new Map<string, FacetCount>();
  for (const [key, label] of pairs) {
    if (key === "") continue;
    const facet = byKey.get(key) ?? { key, label, count: 0 };
    facet.count++;
    byKey.set(key, facet);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || compareText(a.label, b.label));
}

/** Every filter option, counted over all matches. */
export function buildFacets(built: Built[]): SearchFacets {
  const cards = built.map((b) => b.card);
  return {
    matches: built.length,
    priceMin: cards.length ? Math.min(...cards.map((t) => t.minPrice)) : 0,
    priceMax: cards.length ? Math.max(...cards.map((t) => t.maxPrice)) : 0,
    brands: countFacets(cards.map((t) => [t.brandSlug, t.brandName || t.brandSlug])),
    vehicleTypes: countFacets(cards.map((t) => [t.vehicleType, t.vehicleTypeLabel])),
    hours: HOUR_BANDS.map(([key, start, end]) => ({
      key,
      label: key,
      count: built.filter((b) => boardingHour(b) >= start && boardingHour(b) < end).length,
    })),
    amenities: countFacets(
      cards.flatMap((t) => t.amenities.map((a): [string, string] => [a, amenityLabel(a)])),
    ),
    plentyOfSeats: cards.filter((t) => t.availableSeats > FEW_SEATS).length,
  };
}

/**
 * Deterministic order: the key, then boarding time, then trip id (stable
 * OFFSET paging — equal keys never swap between pages).
 */
export function sortBuilt(matches: Built[], by: Sort): void {
  const tail = (a: Built, b: Built) =>
    a.boardsAt - b.boardsAt || compareText(a.card.tripId, b.card.tripId);
  const rating = (b: Built) => b.card.brandRating ?? -1;
  const distance = (b: Built) => b.distanceKm ?? Number.MAX_VALUE;
  matches.sort((a, b) => {
    switch (by) {
      case "departure":
        return tail(a, b);
      case "price":
        return a.card.minPrice - b.card.minPrice || tail(a, b);
      case "rating":
        return rating(b) - rating(a) || tail(a, b);
      case "distance":
        return distance(a) - distance(b) || tail(a, b);
    }
  });
}

/** A page of results with the page metadata (Rust `TripSearchResponse::paged`). */
function paged(items: TripCard[], total: number, opts: SearchOptions): TripSearchResponse {
  return {
    items,
    total,
    limit: opts.limit,
    offset: opts.offset,
    hasMore: opts.offset + items.length < total,
  };
}

/** The empty page: no matching routes or trips, but the page metadata and no filter options. */
export function emptyResults(opts: SearchOptions): TripSearchResponse {
  return { ...paged([], 0, opts), facets: buildFacets([]) };
}

/** Facets over every card, then filter, sort and page (Rust `trip_search::results`, minus loading). */
export function pageResults(built: Built[], opts: SearchOptions): TripSearchResponse {
  const facets = buildFacets(built);
  const matches = built.filter((b) => keep(b, opts.filters));
  sortBuilt(matches, opts.sort);
  const page = matches.slice(opts.offset, opts.offset + opts.limit).map((b) => b.card);
  return { ...paged(page, matches.length, opts), facets };
}
