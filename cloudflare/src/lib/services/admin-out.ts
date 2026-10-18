/**
 * Admin output serializers — build the SPA SDK's admin response shapes
 * (`AdminBrandOut`, `AdminRouteOut`, `AdminScheduleOut`, …) from D1 rows.
 * Every field name matches the openapi.json contract exactly.
 */
import { getDb, rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import {
  addresses,
  busLayouts,
  pickupPoints,
  routes,
  schedules,
  schedulePoints,
  scheduleFares,
  vehicleTypes,
  brands,
  coupons,
  discountCampaigns,
  discountCampaignBrands,
  discountTiers,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { findCity } from "@/lib/services/trip-search";
import {
  deriveFromSeats,
  trustedPlan,
  layoutSeats,
  layoutInUse,
  type SeatPlan,
  parseSeatPlan,
} from "@/lib/services/seat-plan";

// Re-exported for the routes that import them from here (stable surface).
export { parseSeatPlan, type SeatPlan };

// ────────────────────────────────────────────────────────────────
//  Seat-plan preset catalog — a faithful port of the Rust backend's
//  `service/seat_plan_presets.rs`. Orientation: row 1 is the front,
//  col 1 the driver's side (left in Vietnam). Sellable cells are
//  numbered front → rear, left → right: `01…` single deck,
//  `A01…` (lower) / `B01…` (upper) on two decks.
// ────────────────────────────────────────────────────────────────

type CellKind =
  | "seat"
  | "bed"
  | "cabin"
  | "cabin_double"
  | "driver"
  | "door"
  | "stairs"
  | "wc";

const SELLABLE: CellKind[] = ["seat", "bed", "cabin", "cabin_double"];

export interface BusLayoutPreset {
  id: string;
  name: string;
  vehicleType: string;
  capacity: number;
  description: string;
  plan: SeatPlan;
}

type PlanCellT = SeatPlan["decks"][number]["cells"][number];

class DeckBuilder {
  rows: number;
  cols: number;
  prefix: string;
  next = 1;
  cells: PlanCellT[] = [];

  constructor(rows: number, cols: number, prefix: string) {
    this.rows = rows;
    this.cols = cols;
    this.prefix = prefix;
  }

  cell(row: number, col: number, kind: CellKind): this {
    const sellable = SELLABLE.includes(kind);
    let label: string | null = null;
    if (sellable) {
      label = `${this.prefix}${String(this.next).padStart(2, "0")}`;
      this.next += 1;
    }
    this.cells.push({ row, col, kind, label, seatClass: null, seatId: null });
    return this;
  }

  row(row: number, cols: number[], kind: CellKind): this {
    for (const col of cols) this.cell(row, col, kind);
    return this;
  }

  build(): SeatPlan["decks"][number] {
    return { name: null, rows: this.rows, cols: this.cols, cells: this.cells };
  }
}

/** One-deck vehicle: cab row (driver, door, front passengers) + seat rows. */
function singleDeck(cols: number, cab: Array<[number, CellKind]>, seatRows: number[][]): SeatPlan {
  let deck = new DeckBuilder(1 + seatRows.length, cols, "");
  for (const [col, kind] of cab) deck = deck.cell(1, col, kind);
  seatRows.forEach((cols_, i) => {
    deck = deck.row(2 + i, cols_, "seat");
  });
  return { decks: [deck.build()] };
}

/** Seater coach: `rows` rows of 2+2 around a centre aisle + 5-seat rear bench. */
function coach(rows: number): SeatPlan {
  const pairRow = [1, 2, 4, 5];
  const seatRows = Array.from({ length: rows }, () => pairRow);
  seatRows.push([1, 2, 3, 4, 5]);
  return singleDeck(5, [[1, "driver"], [5, "door"]], seatRows);
}

/** 3-lane double-decker sleeper, `perDeck` berths per deck. */
function sleeper(perDeck: number, wc: boolean): SeatPlan {
  const rear = perDeck % 3 === 0 ? 0 : perDeck % 3 === 1 ? 4 : 5;
  const full = (perDeck - rear) / 3;
  const benchRow = 2 + full;
  const rows = rear > 0 ? benchRow : 1 + full;
  const deck = (upper: boolean): SeatPlan["decks"][number] => {
    let d = new DeckBuilder(rows, 5, upper ? "B" : "A");
    d = upper ? d.cell(1, 5, "stairs") : d.cell(1, 1, "driver").cell(1, 5, "door");
    for (let r = 0; r < full; r++) d = d.row(2 + r, [1, 3, 5], "bed");
    if (rear === 5) d = d.row(benchRow, [1, 2, 3, 4, 5], "bed");
    else if (rear === 4) {
      d = d.row(benchRow, [1, 2, 4, 5], "bed");
      if (wc && !upper) d = d.cell(benchRow, 3, "wc");
    }
    return d.build();
  };
  return { decks: [deck(false), deck(true)] };
}

/** Limousine with berths in three lanes (6 · 5 · 6 per deck). */
function limoBed34(): SeatPlan {
  const deck = (upper: boolean): SeatPlan["decks"][number] => {
    let d = new DeckBuilder(7, 5, upper ? "B" : "A");
    d = upper ? d.cell(1, 5, "stairs") : d.cell(1, 1, "driver").cell(1, 5, "door");
    for (let row = 2; row <= 7; row++) {
      d = d.row(row, row === 2 ? [1, 5] : [1, 3, 5], "bed");
    }
    return d.build();
  };
  return { decks: [deck(false), deck(true)] };
}

/** Cabin limousine: two lanes of single cabins around one aisle. */
function cabin(
  lowerFull: number,
  lowerRear: CellKind | null,
  upperFull: number,
  upperRear: CellKind | null,
): SeatPlan {
  const used = (full: number, rear: CellKind | null) => full + (rear ? 1 : 0);
  const rows = 1 + Math.max(used(lowerFull, lowerRear), used(upperFull, upperRear));
  const deck = (upper: boolean, full: number, rear: CellKind | null): SeatPlan["decks"][number] => {
    let d = new DeckBuilder(rows, 3, upper ? "B" : "A");
    d = upper ? d.cell(1, 3, "stairs") : d.cell(1, 1, "driver").cell(1, 3, "door");
    for (let r = 0; r < full; r++) d = d.row(2 + r, [1, 3], "cabin");
    if (rear) d = d.cell(2 + full, 2, rear);
    return d.build();
  };
  return { decks: [deck(false, lowerFull, lowerRear), deck(true, upperFull, upperRear)] };
}

interface Spec {
  id: string;
  name: string;
  vehicleType: string;
  description: string;
  build: () => SeatPlan;
}

const CATALOG: Spec[] = [
  {
    id: "car_4",
    name: "Xe 4 chỗ",
    vehicleType: "standard",
    description: "Ghế phụ và hàng ghế sau 3 chỗ (4 khách + tài xế)",
    build: () => singleDeck(3, [[1, "driver"], [3, "seat"]], [[1, 2, 3]]),
  },
  {
    id: "car_7",
    name: "Xe 7 chỗ",
    vehicleType: "minivan",
    description: "Ghế phụ, hàng 2 ba chỗ, hàng 3 hai chỗ (6 khách + tài xế)",
    build: () => singleDeck(3, [[1, "driver"], [3, "seat"]], [[1, 2, 3], [1, 3]]),
  },
  {
    id: "limo_9",
    name: "Limousine 9 chỗ",
    vehicleType: "limousine",
    description: "Hai ghế cạnh tài xế, 2 hàng ghế đơn có lối đi giữa, hàng cuối 3 chỗ",
    build: () =>
      singleDeck(3, [[1, "driver"], [2, "seat"], [3, "seat"]], [[1, 3], [1, 3], [1, 2, 3]]),
  },
  {
    id: "limo_11",
    name: "Limousine 11 chỗ",
    vehicleType: "limousine",
    description: "Hai ghế cạnh tài xế, 3 hàng ghế đơn có lối đi giữa, hàng cuối 3 chỗ (xe 12 chỗ)",
    build: () =>
      singleDeck(3, [[1, "driver"], [2, "seat"], [3, "seat"]], [[1, 3], [1, 3], [1, 3], [1, 2, 3]]),
  },
  {
    id: "minibus_15",
    name: "Ghế ngồi 16 chỗ",
    vehicleType: "standard",
    description: "Hai ghế cạnh tài xế, 3 hàng 2+1 có lối đi, hàng cuối 4 chỗ (15 khách + tài xế)",
    build: () =>
      singleDeck(4, [[1, "driver"], [2, "seat"], [3, "seat"], [4, "door"]], [
        [1, 2, 4],
        [1, 2, 4],
        [1, 2, 4],
        [1, 2, 3, 4],
      ]),
  },
  {
    id: "seat_29",
    name: "Ghế ngồi 29 chỗ",
    vehicleType: "standard",
    description: "6 hàng 2+2 và hàng cuối 5 chỗ",
    build: () => coach(6),
  },
  {
    id: "seat_45",
    name: "Ghế ngồi 45 chỗ",
    vehicleType: "standard",
    description: "10 hàng 2+2 và hàng cuối 5 chỗ",
    build: () => coach(10),
  },
  {
    id: "sleeper_38_wc",
    name: "Giường nằm 38 (có WC)",
    vehicleType: "sleeper",
    description: "2 tầng × (5 hàng 3 giường + hàng cuối 4 giường); WC cuối xe tầng dưới",
    build: () => sleeper(19, true),
  },
  {
    id: "sleeper_40",
    name: "Giường nằm 40",
    vehicleType: "sleeper",
    description: "2 tầng × (5 hàng 3 giường + hàng cuối 5 giường)",
    build: () => sleeper(20, false),
  },
  {
    id: "sleeper_42",
    name: "Giường nằm 42",
    vehicleType: "sleeper",
    description: "2 tầng × 7 hàng 3 giường",
    build: () => sleeper(21, false),
  },
  {
    id: "sleeper_44",
    name: "Giường nằm 44",
    vehicleType: "sleeper",
    description: "2 tầng × (6 hàng 3 giường + hàng cuối 4 giường)",
    build: () => sleeper(22, false),
  },
  {
    id: "sleeper_46",
    name: "Giường nằm 46",
    vehicleType: "sleeper",
    description: "2 tầng × (6 hàng 3 giường + hàng cuối 5 giường)",
    build: () => sleeper(23, false),
  },
  {
    id: "limo_bed_34",
    name: "Limousine giường 34",
    vehicleType: "limousine",
    description: "2 tầng × 17 giường, 3 dãy (6 · 5 · 6)",
    build: limoBed34,
  },
  {
    id: "cabin_24",
    name: "Limousine 24 phòng",
    vehicleType: "limousine",
    description: "2 tầng × 6 hàng 2 phòng, lối đi giữa",
    build: () => cabin(6, null, 6, null),
  },
  {
    id: "cabin_22",
    name: "Limousine 22 phòng (có WC)",
    vehicleType: "limousine",
    description: "Tầng dưới 10 phòng + WC cuối xe, tầng trên 12 phòng; lối đi giữa",
    build: () => cabin(5, "wc", 6, null),
  },
  {
    id: "cabin_22_double",
    name: "Limousine 22 phòng (1 phòng đôi)",
    vehicleType: "limousine",
    description: "Mỗi tầng 5 hàng 2 phòng + phòng cuối xe; phòng cuối tầng dưới là phòng đôi",
    build: () => cabin(5, "cabin_double", 5, "cabin"),
  },
  {
    id: "cabin_22_plain",
    name: "Limousine 22 phòng",
    vehicleType: "limousine",
    description: "Mỗi tầng 5 hàng 2 phòng + phòng cuối giữa xe (không WC, không phòng đôi)",
    build: () => cabin(5, "cabin", 5, "cabin"),
  },
  {
    id: "cabin_21",
    name: "Limousine 21 phòng",
    vehicleType: "limousine",
    description: "Tầng dưới 11 phòng, tầng trên 10 phòng; lối đi giữa",
    build: () => cabin(5, "cabin", 5, null),
  },
  {
    id: "cabin_20",
    name: "Limousine 20 phòng",
    vehicleType: "limousine",
    description: "2 tầng × 5 hàng 2 phòng, lối đi giữa",
    build: () => cabin(5, null, 5, null),
  },
];

function sellableCount(plan: SeatPlan): number {
  return plan.decks.reduce(
    (n, d) => n + d.cells.filter((c) => SELLABLE.includes(c.kind as CellKind)).length,
    0,
  );
}

function presetOf(s: Spec): BusLayoutPreset {
  const plan = s.build();
  return {
    id: s.id,
    name: s.name,
    vehicleType: s.vehicleType,
    capacity: sellableCount(plan),
    description: s.description,
    plan,
  };
}

/** The full "create from template" catalog. */
export function presetCatalog(): BusLayoutPreset[] {
  return CATALOG.map(presetOf);
}

/** A catalog preset by id; `sleeper_<n>` resolves for even n in 30–50. */
export function findPreset(id: string): BusLayoutPreset | null {
  const spec = CATALOG.find((s) => s.id === id);
  if (spec) return presetOf(spec);
  if (id.startsWith("sleeper_")) {
    const n = parseInt(id.slice(8), 10);
    if (Number.isFinite(n) && n >= 30 && n <= 50 && n % 2 === 0) {
      const plan = sleeper(n / 2, false);
      return {
        id,
        name: `Giường nằm ${n}`,
        vehicleType: "sleeper",
        description: "2 tầng, 3 dãy giường",
        capacity: sellableCount(plan),
        plan,
      };
    }
  }
  return null;
}

/** `AdminBrandOut` — brand row + route/layout counts + child fare policy. */
export async function adminBrandList() {
  const rows = await rawAll<{
    id: string;
    slug: string;
    name: string;
    logo_url: string | null;
    rating: number | null;
    status: string;
    contact_phone: string | null;
    contact_email: string | null;
    created_at: string;
    updated_at: string;
    child_max_age: number | null;
    child_discount_amount: number | null;
    route_count: number;
    layout_count: number;
  }>(sql`
    SELECT b.id, b.slug, b.name, b.logo_url, b.rating, b.status,
           b.contact_phone, b.contact_email, b.created_at, b.updated_at,
           b.child_max_age, b.child_discount_amount,
           (SELECT COUNT(*) FROM route r WHERE r.brand_id = b.id) AS route_count,
           (SELECT COUNT(*) FROM bus_layout bl WHERE bl.brand_id = b.id) AS layout_count
    FROM brand b
    ORDER BY b.created_at DESC
  `);
  return rows.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    logoUrl: b.logo_url,
    rating: b.rating,
    status: b.status,
    contactPhone: b.contact_phone,
    contactEmail: b.contact_email,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
    routeCount: b.route_count,
    layoutCount: b.layout_count,
    childFare:
      b.child_max_age != null && b.child_discount_amount != null
        ? { maxAge: b.child_max_age, discountAmount: b.child_discount_amount }
        : null,
  }));
}

export interface AddressRow {
  id: string;
  brandId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  province: string | null;
  district: string | null;
  ward: string | null;
  createdAt: string;
  updatedAt: string;
}

export function adminAddressOut(a: AddressRow) {
  return {
    id: a.id,
    brandId: a.brandId,
    name: a.name,
    address: a.address,
    lat: a.lat ?? 0,
    lon: a.lon ?? 0,
    province: a.province,
    district: a.district,
    ward: a.ward,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export interface PickupPointRow {
  id: string;
  routeId: string;
  name: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  stopOrder: number;
  kind: string | null;
  createdAt: string;
}

export function adminPickupPointOut(p: PickupPointRow) {
  return {
    id: p.id,
    routeId: p.routeId,
    name: p.name,
    address: p.address,
    lat: p.lat,
    lon: p.lon,
    stopOrder: p.stopOrder,
    kind: p.kind,
    createdAt: p.createdAt,
  };
}

/** `AdminRouteOut` — route row + endpoint names + schedule/pickup counts. */
export async function adminRouteList(filters: { brandId?: string; q?: string; limit: number; offset: number }) {
  const rows = await rawAll<{
    id: string;
    brand_id: string | null;
    name: string;
    start_location_id: string;
    end_location_id: string;
    status: string;
    created_at: string;
    updated_at: string;
    schedule_count: number;
    pickup_count: number;
    total: number;
  }>(sql`
    SELECT r.id, r.brand_id, r.name, r.start_location_id, r.end_location_id,
           r.status, r.created_at, r.updated_at,
           (SELECT COUNT(*) FROM schedule s WHERE s.route_id = r.id) AS schedule_count,
           (SELECT COUNT(*) FROM pickup_point pp WHERE pp.route_id = r.id) AS pickup_count,
           (SELECT COUNT(*) FROM route r2 WHERE 1=1
              ${filters.brandId ? sql`AND r2.brand_id = ${filters.brandId}` : sql``}
              ${filters.q ? sql`AND (r2.name LIKE ${"%" + filters.q + "%"} OR r2.start_location_id LIKE ${"%" + filters.q + "%"} OR r2.end_location_id LIKE ${"%" + filters.q + "%"})` : sql``}
           ) AS total
    FROM route r
    WHERE 1=1
      ${filters.brandId ? sql`AND r.brand_id = ${filters.brandId}` : sql``}
      ${filters.q ? sql`AND (r.name LIKE ${"%" + filters.q + "%"} OR r.start_location_id LIKE ${"%" + filters.q + "%"} OR r.end_location_id LIKE ${"%" + filters.q + "%"})` : sql``}
    ORDER BY r.created_at DESC
    LIMIT ${filters.limit} OFFSET ${filters.offset}
  `);
  return {
    items: rows.map((r) => ({
      id: r.id,
      brandId: r.brand_id,
      name: r.name,
      startLocationId: r.start_location_id,
      endLocationId: r.end_location_id,
      startLocation: placePreview(r.start_location_id),
      endLocation: placePreview(r.end_location_id),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      scheduleCount: r.schedule_count,
      pickupPointCount: r.pickup_count,
    })),
    total: rows[0]?.total ?? 0,
  };
}

/** `AdminPlacePreview` — slug id + display name from the city catalog. */
function placePreview(slug: string): { id: string; name: string; province: string | null } | null {
  const city = findCity(slug);
  if (!city) return null;
  return { id: slug, name: city.name, province: null };
}

/** `AdminScheduleOut` — schedule + class fares + ordered points (w/ address). */
export async function adminScheduleList(routeId?: string) {
  const db = await getDb();
  const scheds = await db
    .select()
    .from(schedules)
    .where(routeId ? eq(schedules.routeId, routeId) : undefined)
    .orderBy(schedules.departureTime);
  if (scheds.length === 0) return [];
  const ids = scheds.map((s) => s.id);

  const fareRows = await db
    .select()
    .from(scheduleFares)
    .where(sql`schedule_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  const pointRows = await db
    .select({ point: schedulePoints, address: addresses })
    .from(schedulePoints)
    .innerJoin(addresses, eq(addresses.id, schedulePoints.addressId))
    .where(sql`schedule_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
    .orderBy(schedulePoints.stopOrder);
  const vtRows = await db.select().from(vehicleTypes);

  return scheds.map((s) => {
    const vt = vtRows.find((v) => v.id === s.vehicleTypeId);
    return {
      id: s.id,
      routeId: s.routeId,
      departureTime: s.departureTime,
      effectiveFrom: s.effectiveFrom,
      effectiveTo: s.effectiveTo,
      daysOfWeek: s.daysOfWeek,
      busLayoutId: s.busLayoutId,
      basePriceAdult: s.basePriceAdult,
      basePriceChild: s.basePriceChild,
      amenities: s.amenities,
      vehicleTypeId: s.vehicleTypeId,
      vehicleType: vt ? { id: vt.id, code: vt.code, label: vt.label } : null,
      classFares: fareRows
        .filter((f) => f.scheduleId === s.id)
        .map((f) => ({
          seatClass: f.seatClass,
          priceAdult: f.priceAdult,
          priceChild: f.priceChild,
        })),
      points: pointRows
        .filter((p) => p.point.scheduleId === s.id)
        .map((p) => ({
          id: p.point.id,
          scheduleId: p.point.scheduleId,
          addressId: p.point.addressId,
          stopOrder: p.point.stopOrder,
          kind: p.point.kind,
          arrivalTime: p.point.arrivalTime,
          address: adminAddressOut(p.address as unknown as AddressRow),
        })),
      createdAt: s.createdAt,
    };
  });
}

/** `AdminVehicleTypeOut` list. */
export async function adminVehicleTypeList(filters: { q?: string; limit: number; offset: number }) {
  const rows = await rawAll<{
    id: string;
    code: string;
    label: string;
    total_seats: number | null;
    sort_order: number;
    status: string;
    created_at: string;
    updated_at: string;
    total: number;
  }>(sql`
    SELECT id, code, label, total_seats, sort_order, status, created_at, updated_at,
           (SELECT COUNT(*) FROM vehicle_type v2
             ${filters.q ? sql`WHERE v2.label LIKE ${"%" + filters.q + "%"} OR v2.code LIKE ${"%" + filters.q + "%"}` : sql``}
           ) AS total
    FROM vehicle_type
    ${filters.q ? sql`WHERE label LIKE ${"%" + filters.q + "%"} OR code LIKE ${"%" + filters.q + "%"}` : sql``}
    ORDER BY sort_order, code
    LIMIT ${filters.limit} OFFSET ${filters.offset}
  `);
  return {
    items: rows.map((v) => ({
      id: v.id,
      code: v.code,
      label: v.label,
      totalSeats: v.total_seats,
      sortOrder: v.sort_order,
      status: v.status,
      createdAt: v.created_at,
      updatedAt: v.updated_at,
    })),
    total: rows[0]?.total ?? 0,
  };
}

/** `AdminBusLayoutOut` list (slim — plan lives in the detail endpoint). */
export async function adminBusLayoutList(filters: { brandId?: string; limit: number; offset: number }) {
  const rows = await rawAll<{
    id: string;
    brand_id: string | null;
    name: string | null;
    vehicle_type: string | null;
    total_seats: number | null;
    layout_data: string | null;
    created_at: string;
    updated_at: string;
    in_use: number;
    total: number;
  }>(sql`
    SELECT bl.id, bl.brand_id, bl.name, bl.vehicle_type, bl.total_seats,
           bl.layout_data, bl.created_at, bl.updated_at,
           (SELECT COUNT(*) FROM schedule s WHERE s.bus_layout_id = bl.id) AS in_use,
           (SELECT COUNT(*) FROM bus_layout b2
             ${filters.brandId ? sql`WHERE b2.brand_id = ${filters.brandId}` : sql``}
           ) AS total
    FROM bus_layout bl
    ${filters.brandId ? sql`WHERE bl.brand_id = ${filters.brandId}` : sql``}
    ORDER BY bl.created_at DESC
    LIMIT ${filters.limit} OFFSET ${filters.offset}
  `);
  return {
    items: rows.map((b) => ({
      id: b.id,
      brandId: b.brand_id,
      name: b.name,
      vehicleType: b.vehicle_type,
      totalSeats: b.total_seats,
      planned: !!b.layout_data,
      inUse: b.in_use > 0,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    })),
    total: rows[0]?.total ?? 0,
  };
}

/** `AdminBusLayoutDetail` — full row + parsed plan (Rust `get_bus_layout`).
 *
 * The plan is the saved one while it still agrees with the `seat` rows
 * (seat ids/classes filled in from the rows), else a plain grid derived
 * from them (`planned = false`) so legacy layouts open in the editor too
 * — never an empty `decks: []` (that crashed the SPA editor with
 * "Cannot read properties of undefined (reading 'cells')").
 */
export async function adminBusLayoutDetail(id: string) {
  const db = await getDb();
  const row = (await db.select().from(busLayouts).where(eq(busLayouts.id, id)).limit(1))[0];
  if (!row) return null;
  const seatRows = await layoutSeats(id);
  const trusted = trustedPlan(row.layoutData, seatRows);
  const plan = trusted ?? deriveFromSeats(seatRows);
  const inUse = await layoutInUse(id);
  return {
    id: row.id,
    brandId: row.brandId,
    name: row.name,
    vehicleType: row.vehicleType,
    totalSeats: row.totalSeats,
    planned: trusted != null,
    plan,
    inUse,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

