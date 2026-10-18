import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import {
  searchTripsGeoInfiniteOptions,
  searchTripsGeoOptions,
  searchTripsInfiniteOptions,
  searchTripsOptions,
  type TripSearchResponse,
} from "@spa/api";
import type { SearchParams } from "@spa/lib/search-params";
import type { FilterQuery } from "./filters";

export type TripSearchParams = Pick<SearchParams, "from" | "to" | "date"> &
  Partial<
    Pick<
      SearchParams,
      | "time"
      | "adults"
      | "children"
      | "sort"
      | "vehicleTypes"
      | "fromLat"
      | "fromLon"
      | "toLat"
      | "toLon"
    >
  > & {
    /** The results page's filters, applied by the server over every match. */
    filters?: FilterQuery;
  };

/** Trips per page of the results list; ten keeps the first paint quick on phones. */
export const TRIP_SEARCH_PAGE_SIZE = 10;

const IDLE: TripSearchParams = { from: "", to: "", date: "" };

const isCoord = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v);

type GeoSearchParams = TripSearchParams &
  Required<Pick<TripSearchParams, "fromLat" | "fromLon" | "toLat" | "toLon">>;

const isPrecise = (p: TripSearchParams): p is GeoSearchParams =>
  isCoord(p.fromLat) && isCoord(p.fromLon) && isCoord(p.toLat) && isCoord(p.toLon);

/** A search is idle until it has a place and a date. */
const canSearch = (p: TripSearchParams | null) => !!p && !!(p.from || p.to) && !!p.date;

/**
 * The query for whichever endpoint fits: precise picks (all four coordinates) use the geo
 * endpoint, which ranks by pickup + drop distance; everything else searches city to city.
 */
function endpointQuery(p: TripSearchParams, limit?: number) {
  const minSeats = (p.adults ?? 1) + (p.children ?? 0);
  const vehicleTypes = p.vehicleTypes?.length ? p.vehicleTypes.join(",") : undefined;
  const departAfter = p.time || undefined;
  const filters = p.filters ?? {};
  if (isPrecise(p)) {
    const { fromLat, fromLon, toLat, toLon, date } = p;
    return {
      geo: true as const,
      query: {
        fromLat,
        fromLon,
        toLat,
        toLon,
        date,
        departAfter,
        // Nearest stops first unless the customer picked another order.
        sort: p.sort ?? "distance",
        minSeats,
        vehicleTypes,
        limit,
        ...filters,
      },
    };
  }
  const { from, to, date } = p;
  return {
    geo: false as const,
    query: {
      from,
      to,
      date,
      departAfter,
      // "Nearest" only means something with exact places.
      sort: p.sort === "distance" || !p.sort ? "departure" : p.sort,
      minSeats,
      vehicleTypes,
      limit,
      ...filters,
    },
  };
}

// Both endpoints return `TripSearchResponse`, but their key types differ, so the options are
// widened to one shape.
function tripSearchOptions(p: TripSearchParams) {
  const { geo, query } = endpointQuery(p);
  return (geo
    ? searchTripsGeoOptions({ query })
    : searchTripsOptions({ query })) as unknown as UseQueryOptions<TripSearchResponse>;
}

function tripSearchInfiniteOptions(p: TripSearchParams) {
  const { geo, query } = endpointQuery(p, TRIP_SEARCH_PAGE_SIZE);
  return (geo
    ? searchTripsGeoInfiniteOptions({ query })
    : searchTripsInfiniteOptions({ query })) as unknown as ReturnType<
    typeof searchTripsInfiniteOptions
  >;
}

/** One page of trips for a search; stays idle until `params` has a place and a date. */
export function useTripSearch(params: TripSearchParams | null) {
  return useQuery({
    ...tripSearchOptions(params ?? IDLE),
    enabled: canSearch(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 1,
  });
}

/**
 * Offset of the page after `last`, or undefined when the server says there is none.
 * Without page metadata (an unpaginated response) no cursor is guessed, and a corrupt page
 * can never make the client request the same offset again.
 */
export function tripSearchNextPageParam(last: TripSearchResponse): number | undefined {
  if (last.hasMore !== true) return undefined;
  const limit =
    typeof last.limit === "number" && last.limit > 0 ? last.limit : TRIP_SEARCH_PAGE_SIZE;
  const offset = typeof last.offset === "number" && last.offset >= 0 ? last.offset : 0;
  return offset + limit > offset ? offset + limit : undefined;
}

/**
 * The results page's trips, a page at a time: page one renders at once and `fetchNextPage`
 * appends the next. Other consumers (ticket pickers, brand dialogs) take a single page with
 * {@link useTripSearch}.
 */
export function useTripSearchInfinite(params: TripSearchParams | null) {
  return useInfiniteQuery({
    ...tripSearchInfiniteOptions(params ?? IDLE),
    initialPageParam: 0,
    getNextPageParam: tripSearchNextPageParam,
    enabled: canSearch(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 1,
  });
}
