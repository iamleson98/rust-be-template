/**
 * How a trip search is narrowed, sorted and paged — port of `Sort`,
 * `Filters` and `Options` in `trip_search.rs`, with the query-string reading
 * the two search handlers share (`routes/public.rs`).
 */
import { ApiError } from "@/lib/auth/rbac";
import { queryReader, type QueryReader } from "@/lib/query";
import { minutesOf } from "./public-format";

/** "Plenty of seats" means more than this many left. */
export const FEW_SEATS = 5;

/** Boarding hour bands of the time-of-day filter, `[start, end)`. */
export const HOUR_BANDS: ReadonlyArray<readonly [key: string, start: number, end: number]> = [
  ["0-6", 0, 6],
  ["6-12", 6, 12],
  ["12-18", 12, 18],
  ["18-24", 18, 24],
];

export type Sort = "departure" | "price" | "rating" | "distance";

/** The results page's filters, applied over every match. */
export interface Filters {
  vehicleTypes: string[];
  /** Operator slugs. */
  brands: string[];
  /** Bounds on a trip's cheapest seat for sale (VND). */
  priceMin?: number;
  priceMax?: number;
  /** Boarding hour bands `[start, end)`. */
  hours: Array<[number, number]>;
  minRating?: number;
  /** More than `FEW_SEATS` seats left. */
  plentyOfSeats: boolean;
  /** Amenity keys a trip must all have. */
  amenities: string[];
}

export interface SearchOptions {
  /** `YYYY-MM-DD`. */
  date: string;
  limit: number;
  offset: number;
  sort: Sort;
  minSeats: number;
  /** Only trips boarding at or after this many minutes past midnight. */
  departAfter: number | null;
  filters: Filters;
}

const badRequest = (message: string) => new ApiError(400, "validation", message);

/** Comma-separated values, trimmed, blanks dropped. */
function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * `sort` as sent: the coordinate search defaults to (and alone knows)
 * distance, the city search defaults to departure.
 */
export function parseSort(sort: string | undefined, coordinateSearch: boolean): Sort {
  switch (sort?.trim()) {
    case "price":
      return "price";
    case "rating":
      return "rating";
    case "departure":
      return "departure";
    default:
      return coordinateSearch ? "distance" : "departure";
  }
}

function parseHours(value: string | undefined): Array<[number, number]> {
  return csv(value).map((band) => {
    const hit = HOUR_BANDS.find(([key]) => key === band);
    if (!hit) {
      throw badRequest(`hours: unknown band ${JSON.stringify(band)} (use 0-6, 6-12, 12-18, 18-24)`);
    }
    return [hit[1], hit[2]];
  });
}

/** The search form's optional "leaving after" `HH:MM`, as minutes past midnight. */
function parseDepartAfter(value: string | undefined): number | null {
  const v = value?.trim();
  if (!v) return null;
  const minutes = v.length <= 5 ? minutesOf(v) : null;
  if (minutes == null) throw badRequest("departAfter must be HH:MM");
  return minutes;
}

/** A real calendar date, `YYYY-MM-DD`. */
function isDate(text: string): boolean {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** The filter parameters of both searches (Rust `Filters::parse`). */
function parseFilters(q: QueryReader): Filters {
  const positive = (n: number | undefined) => (n !== undefined && n > 0 ? n : undefined);
  return {
    vehicleTypes: csv(q.string("vehicleTypes")),
    brands: csv(q.string("brands")),
    priceMin: positive(q.i64("priceMin")),
    priceMax: positive(q.i64("priceMax")),
    hours: parseHours(q.string("hours")),
    minRating: positive(q.f64("minRating")),
    plentyOfSeats: q.bool("plentyOfSeats") ?? false,
    amenities: csv(q.string("amenities")),
  };
}

/**
 * The options both searches share (Rust `Options::new`). Checked in Rust's
 * order: unreadable values, then `hours`, `date`, `departAfter`.
 */
export function parseSearchOptions(
  params: URLSearchParams,
  coordinateSearch: boolean,
): SearchOptions {
  const q = queryReader(params);
  const rawDate = q.required.string("date");
  const limit = q.u64("limit");
  const offset = q.u64("offset");
  const sort = q.string("sort");
  const minSeats = q.i64("minSeats");
  const filters = parseFilters(q);
  const date = rawDate.trim();
  if (!isDate(date)) throw badRequest("date must be YYYY-MM-DD");
  return {
    date,
    limit: Math.min(Math.max(limit ?? 20, 1), 100),
    offset: offset ?? 0,
    sort: parseSort(sort, coordinateSearch),
    minSeats: Math.max(minSeats ?? 1, 1),
    departAfter: parseDepartAfter(q.string("departAfter")),
    filters,
  };
}
