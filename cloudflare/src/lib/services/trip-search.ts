/**
 * Trip search — a faithful port of the Rust `trip_search` service:
 * city-pair search over trip_session × schedule × route × brand with
 * server-side facets counted over ALL matches, then the customer's
 * filters, deterministic sort and offset paging. Card shape = the
 * flat `TripResult` DTO the SPA SDK expects.
 */
import { rawAll } from "@/lib/db/client";
import { sql, type SQL } from "drizzle-orm";
import { VIETNAMESE_CITIES } from "@/lib/cities";
import { CITY_COORDS } from "@/lib/city-coords";
import { vehicleTypeCatalog as vehicleTypeCatalogCached } from "./lookups";

// ── Constants (Rust parity) ────────────────────────────────────

/** "Plenty of seats" means more than this many left. */
export const FEW_SEATS = 5;

/** Boarding hour bands of the time-of-day filter, `[start, end)`. */
const HOUR_BANDS: Array<[string, number, number]> = [
  ["0-6", 0, 6],
  ["6-12", 6, 12],
  ["12-18", 12, 18],
  ["18-24", 18, 24],
];

// ── Small helpers (ports of the Rust utils) ────────────────────

/** `HH:MM` → minutes past midnight; `null` when unparseable. */
export function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  const h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Compute the ISO departure timestamp from date + time (Rust parity). */
export function computeIsoTimestamps(
  departureDate: string | null,
  departureTime: string | null,
): string | null {
  if (!departureDate) return null;
  const date = departureDate.split("T")[0]!;
  const time = departureTime && departureTime !== "" ? departureTime : departureDate.split("T")[1];
  if (!time) return null;
  return `${date}T${time}:00`;
}

/** Arrival ISO with midnight rollover (Rust `compute_arrival_iso`). */
export function computeArrivalIso(
  departureDate: string,
  departureHhmm: string,
  arrivalHhmm: string,
): string | null {
  const minutes = (t: string) => {
    const [h, m] = t.split(":");
    if (!h || !m) return null;
    return parseInt(h, 10) * 60 + parseInt(m, 10);
  };
  const arr = minutes(arrivalHhmm);
  const dep = minutes(departureHhmm) ?? Number.MIN_SAFE_INTEGER;
  if (arr == null) return null;
  const dateOnly = departureDate.split("T")[0]!;
  const [y, mo, d] = dateOnly.split("-").map((n) => parseInt(n, 10));
  if (!y || !mo || !d) return null;
  const ms = Date.UTC(y, mo - 1, d) + (arr <= dep ? 86_400_000 : 0);
  const dt = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  return `${day}T${arrivalHhmm}:00`;
}

/** Amenity key → Vietnamese label. */
export function amenityLabel(key: string): string {
  switch (key) {
    case "wifi": return "WiFi";
    case "ac": return "Điều hòa";
    case "water": return "Nước uống";
    case "charging": return "Cắm sạc";
    case "blanket": return "Chăn mền";
    default: return "";
  }
}

/** Static vehicle-type label map (Rust `vehicle_type_label`). */
export function vehicleTypeLabelOf(vt: string): string {
  switch (vt) {
    case "limousine": return "Limousine";
    case "sleeper": return "Giường nằm";
    case "semi_sleeper":
    case "semi-sleeper": return "Giường nằm đơn";
    case "minivan": return "Minivan";
    case "standard": return "Ghế ngồi";
    default: return "Ghế ngồi";
  }
}

/** Parse a Schedule.amenities JSON string / CSV into keys. */
export function parseAmenities(raw: string | null): string[] {
  if (!raw || raw.trim() === "") return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
  } catch { /* csv fallback */ }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** The brand's child-ticket policy; `null` when it sells none. */
export interface ChildPolicy { maxAge: number; discountAmount: number }
export function childPolicyOf(b: { child_max_age?: number | null; child_discount_amount?: number | null } | null | undefined): ChildPolicy | null {
  if (!b || b.child_max_age == null) return null;
  return { maxAge: b.child_max_age, discountAmount: b.child_discount_amount ?? 0 };
}

/** What a child pays for a seat sold to adults at `adult` (Rust `fares::child_price`). */
export function childPrice(adult: number, fare: { adult: number; child: number | null }, policy: ChildPolicy | null): number | undefined {
  if (!policy) return undefined;
  const price = fare.child ?? adult - policy.discountAmount;
  return Math.max(0, Math.min(price, adult));
}

/** What a child pays for a standard seat; 0 without child tickets. */
export function standardChildPrice(
  schedule: { base_price_adult: number; base_price_child: number | null },
  policy: ChildPolicy | null,
): number {
  return childPrice(schedule.base_price_adult, { adult: schedule.base_price_adult, child: schedule.base_price_child }, policy) ?? 0;
}

/** Normalize a seat class: trimmed, lowercase; "standard" default. */
export function classOf(seatClass: string | null): string {
  const c = (seatClass ?? "").trim().toLowerCase();
  return c === "" || c === "standard" ? "standard" : c;
}

/** Resolve a schedule's vehicle class into `[code, label]` (Rust parity). */
export function resolveVehicleType(
  sched: { vt_code?: string | null; vt_label?: string | null; layout_vehicle_type?: string | null },
  catalog: Array<{ code: string; label: string }>,
): [string, string] {
  if (sched.vt_code) return [sched.vt_code, sched.vt_label ?? sched.vt_code];
  const code = sched.layout_vehicle_type ?? "standard";
  const hit = catalog.find((v) => v.code.toLowerCase() === code.toLowerCase());
  return [code, hit ? hit.label : vehicleTypeLabelOf(code)];
}

// ── The flat TripResult card ───────────────────────────────────

export interface TripResultCard {
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
  pickup?: unknown;
  dropoff?: unknown;
}

/** One fully-built candidate row from SQL. */
interface CandidateRow {
  id: string;
  schedule_id: string;
  departure_date: string;
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
  brand_child_max_age: number | null;
  brand_child_discount_amount: number | null;
  departure_time: string;
  amenities: string | null;
  base_price_adult: number;
  base_price_child: number | null;
  bus_layout_id?: string | null;
  pickup_time?: string | null;
  vt_code: string | null;
  vt_label: string | null;
  layout_vehicle_type: string | null;
  layout_total_seats: number | null;
  avail_min: number | null;
  avail_max: number | null;
  avail_count: number;
  fare_min: number | null;
  fare_max: number | null;
  last_arrival: string | null;
}

/** Normalized (diacritic-stripped, lowercased) text for city matching. */
const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** City slugs matching a query: exact slug, or name/alias (diacritic-insensitive). */
export function matchCitySlugs(q: string): string[] {
  const nq = norm(q);
  if (!nq) return [];
  const hits = VIETNAMESE_CITIES.filter(
    (c) => c.id === q || norm(c.name) === nq || (c.aliases ?? []).some((a) => norm(a) === nq),
  );
  return hits.map((c) => c.id);
}

/** City display info with coordinates; `null` when unknown. */
export function findCity(slug: string): { name: string; lat: number; lon: number } | null {
  const city = VIETNAMESE_CITIES.find((c) => c.id === slug);
  const coords = CITY_COORDS[slug];
  if (!city) return null;
  return { name: city.name, lat: coords?.lat ?? 0, lon: coords?.lon ?? 0 };
}

/** Build one result card from a candidate row (Rust `build`). */
export function buildCard(r: CandidateRow, catalog: Array<{ code: string; label: string }>): TripResultCard {
  const from = findCity(r.start_location_id);
  const to = findCity(r.end_location_id);
  const policy = childPolicyOf({ child_max_age: r.brand_child_max_age, child_discount_amount: r.brand_child_discount_amount });
  // Prices: the seats still for sale where the trip was opened; the fare
  // table's class range otherwise; the base price as the last resort.
  const [minPrice, maxPrice] =
    r.avail_count > 0 && r.avail_min != null && r.avail_max != null
      ? [r.avail_min, r.avail_max]
      : r.fare_min != null && r.fare_max != null
        ? [r.fare_min, r.fare_max]
        : [r.base_price_adult, r.base_price_adult];
  const [vehicleType, vehicleTypeLabel] = resolveVehicleType(
    { vt_code: r.vt_code, vt_label: r.vt_label, layout_vehicle_type: r.layout_vehicle_type },
    catalog,
  );
  const departureAt = computeIsoTimestamps(r.departure_date, r.departure_time) ?? undefined;
  const arrivalAt = r.last_arrival
    ? (computeArrivalIso(r.departure_date, r.departure_time, r.last_arrival) ?? undefined)
    : undefined;
  return {
    tripId: r.id,
    scheduleId: r.schedule_id,
    departureDate: r.departure_date,
    status: r.status,
    availableSeats: r.available_seats,
    totalSeats: r.total_seats,
    routeId: r.route_id,
    routeName: r.route_name,
    brandId: r.brand_id ?? undefined,
    brandName: r.brand_name ?? "",
    brandSlug: r.brand_slug ?? "",
    brandLogo: r.brand_logo_url ?? undefined,
    brandRating: r.brand_rating ?? undefined,
    fromName: from?.name ?? "",
    fromLat: from?.lat ?? 0,
    fromLon: from?.lon ?? 0,
    toName: to?.name ?? "",
    toLat: to?.lat ?? 0,
    toLon: to?.lon ?? 0,
    departureTime: r.departure_time,
    departureAt,
    arrivalAt,
    busLayoutId: undefined, // filled by caller when the layout is known
    minPrice,
    maxPrice,
    priceAdult: r.base_price_adult,
    priceChild: standardChildPrice(
      { base_price_adult: r.base_price_adult, base_price_child: r.base_price_child },
      policy,
    ),
    vehicleType,
    vehicleTypeLabel,
    capacity: r.layout_total_seats ?? undefined,
    amenities: parseAmenities(r.amenities),
  };
}

/** Boarding minutes: at the pickup stop when known (day rollover), else departure. */
function boardingMinutes(r: { departure_time: string; pickup_time?: string | null }): number {
  const departs = minutesOf(r.departure_time) ?? 0;
  const at = r.pickup_time ? minutesOf(r.pickup_time) : null;
  if (at != null && at < departs) return at + 24 * 60;
  return at ?? departs;
}

// ── Filters / options (Rust parity) ────────────────────────────

export interface SearchFilters {
  vehicleTypes: string[];
  brands: string[];
  priceMin?: number;
  priceMax?: number;
  hours: Array<[number, number]>;
  minRating?: number;
  plentyOfSeats: boolean;
  amenities: string[];
}

export interface SearchOptions {
  date: string;
  limit: number;
  offset: number;
  sort: "departure" | "price" | "rating" | "distance";
  minSeats: number;
  departAfter?: number | null;
  filters: SearchFilters;
}

function csvList(v: string | null | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Parse the camelCase query string exactly like the Rust `SearchTripsQuery`. */
export function parseSearchOptions(url: URL): { from: string; to: string; opts: SearchOptions } | { error: string } {
  const q = url.searchParams;
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? "";
  if (!from.trim()) return { error: "missing departure location (from)" };
  if (!to.trim()) return { error: "missing arrival location (to)" };
  const date = (q.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "date must be YYYY-MM-DD" };

  const hours = csvList(q.get("hours")).map((band) => {
    const hit = HOUR_BANDS.find(([k]) => k === band);
    if (!hit) return null;
    return [hit[1], hit[2]] as [number, number];
  });
  if (hours.some((h) => h == null)) return { error: `hours: unknown band (use 0-6, 6-12, 12-18, 18-24)` };

  const num = (k: string) => {
    const v = q.get(k);
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const sortRaw = (q.get("sort") ?? "").trim();
  const sort: SearchOptions["sort"] =
    sortRaw === "price" ? "price" : sortRaw === "rating" ? "rating" : sortRaw === "distance" ? "distance" : "departure";

  const departAfterRaw = q.get("departAfter");
  let departAfter: number | null | undefined = null;
  if (departAfterRaw && departAfterRaw.trim() !== "") {
    const m = minutesOf(departAfterRaw);
    if (m == null || departAfterRaw.length > 5) return { error: "departAfter must be HH:MM" };
    departAfter = m;
  }

  return {
    from,
    to,
    opts: {
      date,
      limit: Math.min(Math.max(num("limit") ?? 20, 1), 100),
      offset: Math.max(num("offset") ?? 0, 0),
      sort,
      minSeats: Math.max(num("minSeats") ?? 1, 1),
      departAfter,
      filters: {
        vehicleTypes: csvList(q.get("vehicleTypes")),
        brands: csvList(q.get("brands")),
        priceMin: (num("priceMin") ?? undefined) || undefined,
        priceMax: (num("priceMax") ?? undefined) || undefined,
        hours: hours as Array<[number, number]>,
        minRating: (num("minRating") ?? undefined) || undefined,
        plentyOfSeats: q.get("plentyOfSeats") === "true",
        amenities: csvList(q.get("amenities")),
      },
    },
  };
}

// ── The candidate SQL (one query) ──────────────────────────────

/** Shared SELECT/WHERE for city searches. `fromSlugs`/`toSlugs` are city ids. */
function candidateQuery(date: string, fromSlugs: string[], toSlugs: string[], minSeats: number): SQL {
  const fromIn = fromSlugs.map((s) => sql`${s}`).reduce((a, b) => sql`${a}, ${b}`);
  const toIn = toSlugs.map((s) => sql`${s}`).reduce((a, b) => sql`${a}, ${b}`);
  return sql`
    SELECT ts.id, ts.schedule_id, ts.departure_date, ts.status,
           ts.total_seats, ts.available_seats,
           r.id AS route_id, r.name AS route_name,
           r.start_location_id, r.end_location_id,
           r.brand_id, b.slug AS brand_slug, b.name AS brand_name,
           b.logo_url AS brand_logo_url, b.rating AS brand_rating,
           b.child_max_age AS brand_child_max_age,
           b.child_discount_amount AS brand_child_discount_amount,
           s.departure_time, s.amenities, s.base_price_adult, s.base_price_child,
           s.vehicle_type_id, s.bus_layout_id,
           vt.code AS vt_code, vt.label AS vt_label,
           bl.vehicle_type AS layout_vehicle_type, bl.total_seats AS layout_total_seats,
           (SELECT MIN(si.final_price) FROM seat_inventory si WHERE si.trip_session_id = ts.id AND si.status = 'available') AS avail_min,
           (SELECT MAX(si.final_price) FROM seat_inventory si WHERE si.trip_session_id = ts.id AND si.status = 'available') AS avail_max,
           (SELECT COUNT(*) FROM seat_inventory si WHERE si.trip_session_id = ts.id AND si.status = 'available') AS avail_count,
           (SELECT MIN(sf.price_adult) FROM schedule_fare sf WHERE sf.schedule_id = s.id) AS fare_min,
           (SELECT MAX(sf.price_adult) FROM schedule_fare sf WHERE sf.schedule_id = s.id) AS fare_max,
           (SELECT sp.arrival_time FROM schedule_point sp
            WHERE sp.schedule_id = s.id AND sp.arrival_time IS NOT NULL AND sp.arrival_time != ''
            ORDER BY sp.stop_order DESC LIMIT 1) AS last_arrival,
           (SELECT sp.arrival_time FROM schedule_point sp
            WHERE sp.schedule_id = s.id AND sp.arrival_time IS NOT NULL AND sp.arrival_time != ''
            ORDER BY sp.stop_order ASC LIMIT 1) AS pickup_time
    FROM trip_session ts
    JOIN schedule s ON s.id = ts.schedule_id
    JOIN route r ON r.id = s.route_id
    LEFT JOIN brand b ON b.id = r.brand_id
    LEFT JOIN vehicle_type vt ON vt.id = s.vehicle_type_id
    LEFT JOIN bus_layout bl ON bl.id = s.bus_layout_id
    WHERE ts.departure_date = ${date}
      AND ts.status = 'scheduled'
      AND ts.available_seats >= ${minSeats}
      AND r.start_location_id IN (${fromIn})
      AND r.end_location_id IN (${toIn})
      AND r.status = 'active'
      AND (b.status = 'active' OR b.status IS NULL)
      AND (s.effective_from IS NULL OR s.effective_from <= ${date})
      AND (s.effective_to IS NULL OR s.effective_to >= ${date})
      AND (s.days_of_week IS NULL OR json_array_length(s.days_of_week) = 0
           OR EXISTS (SELECT 1 FROM json_each(s.days_of_week) je
                      WHERE CAST(je.value AS INTEGER) = CAST(strftime('%w', ${date} || 'T00:00:00Z') AS INTEGER) + 1))
  `;
}

// ── Facets ─────────────────────────────────────────────────────

export interface FacetCount { key: string; label: string; count: number }

function facetCounts(pairs: Array<[string, string]>): FacetCount[] {
  const byKey = new Map<string, FacetCount>();
  for (const [key, label] of pairs) {
    if (!key) continue;
    const cur = byKey.get(key) ?? { key, label, count: 0 };
    cur.count++;
    byKey.set(key, cur);
  }
  return [...byKey.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
}

function buildFacets(built: Array<{ card: TripResultCard; boardsAt: number }>) {
  const cards = built.map((b) => b.card);
  return {
    matches: built.length,
    priceMin: cards.length ? Math.min(...cards.map((t) => t.minPrice)) : 0,
    priceMax: cards.length ? Math.max(...cards.map((t) => t.maxPrice)) : 0,
    brands: facetCounts(
      cards.map((t) => [t.brandSlug, t.brandName || t.brandSlug] as [string, string]),
    ),
    vehicleTypes: facetCounts(
      cards.map((t) => [t.vehicleType, t.vehicleTypeLabel] as [string, string]),
    ),
    hours: HOUR_BANDS.map(([key, start, end]) => ({
      key,
      label: key,
      count: built.filter((b) => {
        const h = Math.floor((b.boardsAt % 1440) / 60);
        return h >= start && h < end;
      }).length,
    })),
    amenities: facetCounts(
      cards.flatMap((t) => t.amenities.map((a) => [a, amenityLabel(a) || a] as [string, string])),
    ),
    plentyOfSeats: cards.filter((t) => t.availableSeats > FEW_SEATS).length,
  };
}

// ── The search itself ──────────────────────────────────────────

/** Vehicle-type catalog for label resolution (cache-first, 5 min TTL). */
export async function vehicleTypeCatalog(): Promise<Array<{ code: string; label: string }>> {
  return vehicleTypeCatalogCached();
}

/** City search: build → facets → filter → sort → page (Rust `results`). */
export async function searchTrips(from: string, to: string, opts: SearchOptions) {
  const fromSlugs = matchCitySlugs(from);
  const toSlugs = matchCitySlugs(to);
  const empty = pagedEmpty(opts);
  if (!fromSlugs.length || !toSlugs.length) return empty;

  const rows = await rawAll<CandidateRow>(candidateQuery(opts.date, fromSlugs, toSlugs, opts.minSeats));
  // Still on sale: not yet departed (Vietnam local date/time).
  const now = Date.now() + 7 * 3_600_000; // UTC+7 wall clock
  const vnNow = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const nowDate = `${vnNow.getUTCFullYear()}-${pad(vnNow.getUTCMonth() + 1)}-${pad(vnNow.getUTCDate())}`;
  const nowTime = `${pad(vnNow.getUTCHours())}:${pad(vnNow.getUTCMinutes())}`;
  const onSale = rows.filter(
    (r) =>
      r.status === "scheduled" &&
      (r.departure_date > nowDate || (r.departure_date === nowDate && r.departure_time >= nowTime)),
  );
  const departAfterOk =
    opts.departAfter == null
      ? onSale
      : onSale.filter((r) => boardingMinutes(r) >= (opts.departAfter as number));
  if (!departAfterOk.length) return { ...empty, facets: buildFacets([]) };

  const catalog = await vehicleTypeCatalog();
  const built = departAfterOk.map((r) => {
    // City search: no pickup match — boarding is the departure (Rust parity).
    const row = { ...r, pickup_time: null } as CandidateRow;
    const card = buildCard(row, catalog);
    card.busLayoutId = row.bus_layout_id ?? undefined;
    return { card, boardsAt: boardingMinutes(row) };
  });

  const facets = buildFacets(built);
  const f = opts.filters;
  const matches = built.filter(({ card, boardsAt }) => {
    const hour = Math.floor((boardsAt % 1440) / 60);
    return (
      (!f.vehicleTypes.length || f.vehicleTypes.includes(card.vehicleType)) &&
      (!f.brands.length || f.brands.includes(card.brandSlug)) &&
      (f.priceMin == null || card.minPrice >= f.priceMin) &&
      (f.priceMax == null || card.minPrice <= f.priceMax) &&
      (!f.hours.length || f.hours.some(([s, e]) => hour >= s && hour < e)) &&
      (f.minRating == null || (card.brandRating ?? 0) >= f.minRating) &&
      (!f.plentyOfSeats || card.availableSeats > FEW_SEATS) &&
      f.amenities.every((a) => card.amenities.includes(a))
    );
  });

  const tail = (a: (typeof matches)[number], b: (typeof matches)[number]) =>
    a.boardsAt - b.boardsAt || a.card.tripId.localeCompare(b.card.tripId);
  matches.sort((a, b) => {
    if (opts.sort === "price") return a.card.minPrice - b.card.minPrice || tail(a, b);
    if (opts.sort === "rating") return (b.card.brandRating ?? -1) - (a.card.brandRating ?? -1) || tail(a, b);
    return tail(a, b);
  });

  const total = matches.length;
  const page = matches.slice(opts.offset, opts.offset + opts.limit);
  return {
    items: page.map((m) => m.card),
    total,
    limit: opts.limit,
    offset: opts.offset,
    hasMore: opts.offset + page.length < total,
    facets,
  };
}

function pagedEmpty(opts: SearchOptions) {
  return {
    items: [] as TripResultCard[],
    total: 0,
    limit: opts.limit,
    offset: opts.offset,
    hasMore: false,
    facets: buildFacets([]),
  };
}

// ── Recommendations (Rust: 4 of the next 16 upcoming trips) ────

const RECOMMENDATIONS = 4;
const RECOMMENDATION_CANDIDATES = 16;

export async function recommendationTrips() {
  const pad = (n: number) => String(n).padStart(2, "0");
  const vn = new Date(Date.now() + 7 * 3_600_000);
  const today = `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}`;
  const catalog = await vehicleTypeCatalog();
  const rows = await rawAll<CandidateRow>(sql`
    SELECT ts.id, ts.schedule_id, ts.departure_date, ts.status,
           ts.total_seats, ts.available_seats,
           r.id AS route_id, r.name AS route_name,
           r.start_location_id, r.end_location_id,
           r.brand_id, b.slug AS brand_slug, b.name AS brand_name,
           b.logo_url AS brand_logo_url, b.rating AS brand_rating,
           b.child_max_age AS brand_child_max_age,
           b.child_discount_amount AS brand_child_discount_amount,
           s.departure_time, s.amenities, s.base_price_adult, s.base_price_child,
           s.vehicle_type_id, s.bus_layout_id,
           vt.code AS vt_code, vt.label AS vt_label,
           bl.vehicle_type AS layout_vehicle_type, bl.total_seats AS layout_total_seats,
           (SELECT MIN(si.final_price) FROM seat_inventory si WHERE si.trip_session_id = ts.id AND si.status = 'available') AS avail_min,
           (SELECT MAX(si.final_price) FROM seat_inventory si WHERE si.trip_session_id = ts.id AND si.status = 'available') AS avail_max,
           (SELECT COUNT(*) FROM seat_inventory si WHERE si.trip_session_id = ts.id AND si.status = 'available') AS avail_count,
           (SELECT MIN(sf.price_adult) FROM schedule_fare sf WHERE sf.schedule_id = s.id) AS fare_min,
           (SELECT MAX(sf.price_adult) FROM schedule_fare sf WHERE sf.schedule_id = s.id) AS fare_max,
           (SELECT sp.arrival_time FROM schedule_point sp
            WHERE sp.schedule_id = s.id AND sp.arrival_time IS NOT NULL AND sp.arrival_time != ''
            ORDER BY sp.stop_order DESC LIMIT 1) AS last_arrival,
           NULL AS pickup_time
    FROM trip_session ts
    JOIN schedule s ON s.id = ts.schedule_id
    JOIN route r ON r.id = s.route_id
    LEFT JOIN brand b ON b.id = r.brand_id
    LEFT JOIN vehicle_type vt ON vt.id = s.vehicle_type_id
    LEFT JOIN bus_layout bl ON bl.id = s.bus_layout_id
    WHERE ts.departure_date >= ${today} AND ts.status = 'scheduled' AND ts.available_seats > 0
    ORDER BY ts.departure_date ASC, s.departure_time ASC
    LIMIT ${RECOMMENDATION_CANDIDATES}
  `);
  const cards = rows.map((r) => {
    const card = buildCard(r, catalog);
    card.busLayoutId = r.bus_layout_id ?? undefined;
    return card;
  });
  return {
    items: cards.slice(0, RECOMMENDATIONS),
    total: cards.length,
    limit: RECOMMENDATIONS,
    offset: 0,
    hasMore: cards.length > RECOMMENDATIONS,
    facets: buildFacets(cards.map((card) => ({ card, boardsAt: 0 }))),
  };
}
