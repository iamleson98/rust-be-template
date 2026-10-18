/**
 * Trip search — port of the Rust trip_search service semantics:
 * city-pair search over trip_session × schedule × route × brand, with
 * filters (vehicle types, brands, price band, hour bands, rating,
 * plenty-of-seats, amenities, departAfter), sorting and server-side facets.
 */
import { rawAll } from "@/lib/db/client";
import { sql, type SQL } from "drizzle-orm";

export interface SearchParams {
  from: string; // city slug
  to: string; // city slug
  date: string; // YYYY-MM-DD
  departAfter?: string; // HH:MM
  vehicleTypes?: string[]; // codes
  brands?: string[]; // slugs
  priceMin?: number;
  priceMax?: number;
  hourBands?: string[]; // 0-6,6-12,12-18,18-24
  minRating?: number;
  plentyOfSeats?: boolean; // >5 seats left
  amenities?: string[];
  sort?: "departure" | "price" | "rating";
  limit?: number;
  offset?: number;
}

interface TripRow {
  id: string;
  schedule_id: string;
  departure_date: string;
  departure_time: string;
  status: string;
  total_seats: number;
  available_seats: number;
  route_id: string;
  route_name: string;
  start_location_id: string;
  end_location_id: string;
  brand_id: string | null;
  brand_slug: string | null;
  brand_name: string | null;
  brand_logo_url: string | null;
  brand_rating: number | null;
  vehicle_type_code: string | null;
  vehicle_type_label: string | null;
  amenities: string | null;
  base_price_adult: number;
  base_price_child: number | null;
  min_price: number | null;
  duration_minutes: number | null;
}

/** Cheapest price scalar subquery (available seat → fare table → base). */
function tripPriceSql(): SQL {
  return sql`(
    SELECT COALESCE(
      (SELECT MIN(final_price) FROM seat_inventory si WHERE si.trip_session_id = ts.id AND si.status = 'available'),
      (SELECT MIN(price_adult) FROM schedule_fare sf WHERE sf.schedule_id = s.id),
      s.base_price_adult
    )
  )`;
}

/** Build the WHERE chain shared by the page query and the facet query. */
function buildFilters(p: SearchParams): SQL {
  const price = tripPriceSql();
  const conds: SQL[] = [
    sql`ts.departure_date = ${p.date}`,
    sql`ts.status = 'scheduled'`,
    sql`r.start_location_id = ${p.from}`,
    sql`r.end_location_id = ${p.to}`,
    sql`r.status = 'active'`,
    sql`b.status = 'active'`,
    sql`(s.effective_from IS NULL OR s.effective_from <= ${p.date})`,
    sql`(s.effective_to IS NULL OR s.effective_to >= ${p.date})`,
    sql`(s.days_of_week IS NULL OR json_array_length(s.days_of_week) = 0 OR EXISTS (SELECT 1 FROM json_each(s.days_of_week) je WHERE CAST(je.value AS INTEGER) = CAST(strftime('%w', ${p.date} || 'T00:00:00Z') AS INTEGER) + 1))`,
  ];
  if (p.departAfter) conds.push(sql`s.departure_time >= ${p.departAfter}`);
  if (p.vehicleTypes?.length) {
    const vt = p.vehicleTypes.map((c) => sql`${c}`).reduce((a, b) => sql`${a}, ${b}`);
    conds.push(sql`vt.code IN (${vt})`);
  }
  if (p.brands?.length) {
    const bs = p.brands.map((c) => sql`${c}`).reduce((a, b) => sql`${a}, ${b}`);
    conds.push(sql`b.slug IN (${bs})`);
  }
  if (p.minRating) conds.push(sql`COALESCE(b.rating, 0) >= ${p.minRating}`);
  if (p.plentyOfSeats) conds.push(sql`ts.available_seats > 5`);
  if (p.priceMin != null) conds.push(sql`${price} >= ${p.priceMin}`);
  if (p.priceMax != null) conds.push(sql`${price} <= ${p.priceMax}`);
  if (p.hourBands?.length) {
    const hourConds = p.hourBands.map((band) => {
      const [lo, hi] = band.split("-").map((n) => parseInt(n ?? "0", 10));
      return sql`CAST(substr(s.departure_time, 1, 2) AS INTEGER) >= ${lo} AND CAST(substr(s.departure_time, 1, 2) AS INTEGER) < ${hi}`;
    });
    const hourOr = hourConds.reduce((a, b) => sql`(${a}) OR (${b})`);
    conds.push(sql`(${hourOr})`);
  }
  if (p.amenities?.length) {
    for (const a of p.amenities) {
      conds.push(sql`EXISTS (SELECT 1 FROM json_each(COALESCE(s.amenities, '[]')) je WHERE je.value = ${a})`);
    }
  }
  return conds.reduce((a, b) => sql`${a} AND ${b}`);
}

export async function searchTrips(p: SearchParams) {
  const where = buildFilters(p);
  const price = tripPriceSql();
  const limit = Math.min(Math.max(p.limit ?? 20, 1), 100);
  const offset = Math.max(p.offset ?? 0, 0);

  const orderBy =
    p.sort === "price"
      ? sql`ORDER BY ${price} ASC, s.departure_time ASC, ts.id ASC`
      : p.sort === "rating"
        ? sql`ORDER BY COALESCE(b.rating, 0) DESC, s.departure_time ASC, ts.id ASC`
        : sql`ORDER BY s.departure_time ASC, ts.id ASC`;

  const rows = await rawAll<TripRow>(sql`
    SELECT ts.id, ts.schedule_id, ts.departure_date, ts.status,
           ts.total_seats, ts.available_seats,
           r.id AS route_id, r.name AS route_name,
           r.start_location_id, r.end_location_id,
           b.id AS brand_id, b.slug AS brand_slug, b.name AS brand_name,
           b.logo_url AS brand_logo_url, b.rating AS brand_rating,
           vt.code AS vehicle_type_code, vt.label AS vehicle_type_label,
           s.amenities, s.base_price_adult, s.base_price_child,
           s.departure_time,
           ${price} AS min_price,
           NULL AS duration_minutes
    FROM trip_session ts
    JOIN schedule s ON s.id = ts.schedule_id
    JOIN route r ON r.id = s.route_id
    LEFT JOIN brand b ON b.id = r.brand_id
    LEFT JOIN vehicle_type vt ON vt.id = s.vehicle_type_id
    WHERE ${where}
    ${orderBy}
    LIMIT ${limit} OFFSET ${offset}
  `);

  // Facets over ALL matches (not just this page).
  const facetRows = await rawAll<{
    vehicle_type_code: string | null;
    vehicle_type_label: string | null;
    brand_slug: string | null;
    brand_name: string | null;
    hour: number;
    price: number | null;
    available_seats: number;
  }>(sql`
    SELECT vt.code AS vehicle_type_code, vt.label AS vehicle_type_label,
           b.slug AS brand_slug, b.name AS brand_name,
           CAST(substr(s.departure_time, 1, 2) AS INTEGER) AS hour,
           ${price} AS price,
           ts.available_seats
    FROM trip_session ts
    JOIN schedule s ON s.id = ts.schedule_id
    JOIN route r ON r.id = s.route_id
    LEFT JOIN brand b ON b.id = r.brand_id
    LEFT JOIN vehicle_type vt ON vt.id = s.vehicle_type_id
    WHERE ${where}
  `);

  const facets = {
    vehicleTypes: new Map<string, { code: string; label: string; count: number }>(),
    brands: new Map<string, { slug: string; name: string; count: number }>(),
    hourBands: { "0-6": 0, "6-12": 0, "12-18": 0, "18-24": 0 } as Record<string, number>,
    minPrice: Infinity,
    maxPrice: 0,
  };
  for (const f of facetRows) {
    if (f.vehicle_type_code) {
      const cur = facets.vehicleTypes.get(f.vehicle_type_code) ?? {
        code: f.vehicle_type_code,
        label: f.vehicle_type_label ?? f.vehicle_type_code,
        count: 0,
      };
      cur.count++;
      facets.vehicleTypes.set(f.vehicle_type_code, cur);
    }
    if (f.brand_slug) {
      const cur = facets.brands.get(f.brand_slug) ?? {
        slug: f.brand_slug,
        name: f.brand_name ?? f.brand_slug,
        count: 0,
      };
      cur.count++;
      facets.brands.set(f.brand_slug, cur);
    }
    if (f.hour < 6) facets.hourBands["0-6"]!++;
    else if (f.hour < 12) facets.hourBands["6-12"]!++;
    else if (f.hour < 18) facets.hourBands["12-18"]!++;
    else facets.hourBands["18-24"]!++;
    if (f.price != null) {
      facets.minPrice = Math.min(facets.minPrice, f.price);
      facets.maxPrice = Math.max(facets.maxPrice, f.price);
    }
  }

  return {
    items: rows.map(serializeTrip),
    facets: {
      vehicleTypes: [...facets.vehicleTypes.values()],
      brands: [...facets.brands.values()],
      hourBands: facets.hourBands,
      minPrice: Number.isFinite(facets.minPrice) ? facets.minPrice : null,
      maxPrice: facets.maxPrice || null,
    },
    total: facetRows.length,
    limit,
    offset,
  };
}

export function serializeTrip(t: TripRow) {
  return {
    id: t.id,
    scheduleId: t.schedule_id,
    departureDate: t.departure_date,
    departureTime: t.departure_time,
    status: t.status,
    totalSeats: t.total_seats,
    availableSeats: t.available_seats,
    route: {
      id: t.route_id,
      name: t.route_name,
      from: t.start_location_id,
      to: t.end_location_id,
    },
    brand: t.brand_id
      ? {
          id: t.brand_id,
          slug: t.brand_slug,
          name: t.brand_name,
          logoUrl: t.brand_logo_url,
          rating: t.brand_rating,
        }
      : null,
    vehicleType: t.vehicle_type_code
      ? { code: t.vehicle_type_code, label: t.vehicle_type_label }
      : null,
    amenities: t.amenities ? safeJsonArray(t.amenities) : [],
    price: {
      adult: t.min_price ?? t.base_price_adult,
      child: t.base_price_child,
      currency: "VND",
    },
  };
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Parse search params from a URL (camelCase query names, like the Rust API). */
export function parseSearchParams(url: URL): SearchParams {
  const q = url.searchParams;
  const list = (k: string) =>
    q
      .getAll(k)
      .flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter(Boolean);
  const num = (k: string) => {
    const v = q.get(k);
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    from: q.get("from") ?? "",
    to: q.get("to") ?? "",
    date: q.get("date") ?? "",
    departAfter: q.get("departAfter") ?? undefined,
    vehicleTypes: list("vehicle_types"),
    brands: list("brands"),
    priceMin: num("price_min"),
    priceMax: num("price_max"),
    hourBands: list("hour_bands"),
    minRating: num("min_rating"),
    plentyOfSeats: q.get("plenty_of_seats") === "true",
    amenities: list("amenities"),
    sort: (q.get("sort") as SearchParams["sort"]) ?? "departure",
    limit: num("limit"),
    offset: num("offset"),
  };
}
