/**
 * Admin output serializers — build the SPA SDK's admin response shapes
 * (`AdminBrandOut`, `AdminRouteOut`, `AdminScheduleOut`, …) from D1 rows.
 * Every field name matches the openapi.json contract exactly.
 */
import { getDb } from "@/lib/db/client";
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
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
} from "@/lib/db/schema";
import { findCity } from "@/lib/city-match";
import { countOf, groupedCounts } from "@/lib/db/counts";
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

type CellKind = "seat" | "bed" | "cabin" | "cabin_double" | "driver" | "door" | "stairs" | "wc";

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
  return singleDeck(
    5,
    [
      [1, "driver"],
      [5, "door"],
    ],
    seatRows,
  );
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
    build: () =>
      singleDeck(
        3,
        [
          [1, "driver"],
          [3, "seat"],
        ],
        [[1, 2, 3]],
      ),
  },
  {
    id: "car_7",
    name: "Xe 7 chỗ",
    vehicleType: "minivan",
    description: "Ghế phụ, hàng 2 ba chỗ, hàng 3 hai chỗ (6 khách + tài xế)",
    build: () =>
      singleDeck(
        3,
        [
          [1, "driver"],
          [3, "seat"],
        ],
        [
          [1, 2, 3],
          [1, 3],
        ],
      ),
  },
  {
    id: "limo_9",
    name: "Limousine 9 chỗ",
    vehicleType: "limousine",
    description: "Hai ghế cạnh tài xế, 2 hàng ghế đơn có lối đi giữa, hàng cuối 3 chỗ",
    build: () =>
      singleDeck(
        3,
        [
          [1, "driver"],
          [2, "seat"],
          [3, "seat"],
        ],
        [
          [1, 3],
          [1, 3],
          [1, 2, 3],
        ],
      ),
  },
  {
    id: "limo_11",
    name: "Limousine 11 chỗ",
    vehicleType: "limousine",
    description: "Hai ghế cạnh tài xế, 3 hàng ghế đơn có lối đi giữa, hàng cuối 3 chỗ (xe 12 chỗ)",
    build: () =>
      singleDeck(
        3,
        [
          [1, "driver"],
          [2, "seat"],
          [3, "seat"],
        ],
        [
          [1, 3],
          [1, 3],
          [1, 3],
          [1, 2, 3],
        ],
      ),
  },
  {
    id: "minibus_15",
    name: "Ghế ngồi 16 chỗ",
    vehicleType: "standard",
    description: "Hai ghế cạnh tài xế, 3 hàng 2+1 có lối đi, hàng cuối 4 chỗ (15 khách + tài xế)",
    build: () =>
      singleDeck(
        4,
        [
          [1, "driver"],
          [2, "seat"],
          [3, "seat"],
          [4, "door"],
        ],
        [
          [1, 2, 4],
          [1, 2, 4],
          [1, 2, 4],
          [1, 2, 3, 4],
        ],
      ),
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

/** `AdminBrandOut` — brand row + route/layout counts + child fare policy.
 * (Counts via batched GROUP BY maps — the Rust admin_service pattern; the
 * correlated-subquery form silently returned 0, see db/counts.ts.) */
export async function adminBrandList() {
  const db = await getDb();
  const rows = await db.select({ brand: brands }).from(brands).orderBy(desc(brands.createdAt));
  const ids = rows.map((r) => r.brand.id);
  const [routeCounts, layoutCounts] = await Promise.all([
    groupedCounts(routes, routes.brandId, ids),
    groupedCounts(busLayouts, busLayouts.brandId, ids),
  ]);
  return rows.map(({ brand: b }) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    logoUrl: b.logoUrl,
    rating: b.rating,
    status: b.status,
    contactPhone: b.contactPhone,
    contactEmail: b.contactEmail,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    routeCount: countOf(routeCounts, b.id),
    layoutCount: countOf(layoutCounts, b.id),
    childFare:
      b.childMaxAge != null && b.childDiscountAmount != null
        ? { maxAge: b.childMaxAge, discountAmount: b.childDiscountAmount }
        : null,
  }));
}

/** The `address` table row as drizzle selects it — shared by the
 * serializers and the routes that build these rows by hand. */
export type AddressRow = typeof addresses.$inferSelect;

export function adminAddressOut(a: AddressRow) {
  return {
    id: a.id,
    brandId: a.brandId,
    name: a.name,
    address: a.address,
    lat: a.lat ?? 0,
    lon: a.lon ?? 0,
    cityId: a.cityId,
    province: a.province,
    district: a.district,
    ward: a.ward,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export type PickupPointRow = typeof pickupPoints.$inferSelect;

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

/** `AdminRouteOut` — route row + endpoint names + schedule/pickup counts.
 * Page + total are two builder queries on one shared WHERE (drizzle's
 * `and()` skips undefined conditions — no conditional SQL strings). */
export async function adminRouteList(filters: {
  brandId?: string;
  q?: string;
  limit: number;
  offset: number;
}) {
  const db = await getDb();
  const q = filters.q?.trim();
  const where = and(
    filters.brandId !== undefined ? eq(routes.brandId, filters.brandId) : undefined,
    q !== undefined && q.length > 0
      ? or(
          like(routes.name, `%${q}%`),
          like(routes.startLocationId, `%${q}%`),
          like(routes.endLocationId, `%${q}%`),
        )
      : undefined,
  );
  const rows = await db
    .select({ route: routes })
    .from(routes)
    .where(where)
    .orderBy(desc(routes.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);
  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(routes)
    .where(where);
  const total = totalRows[0]?.total ?? 0;
  const ids = rows.map((r) => r.route.id);
  const [scheduleCounts, pickupCounts] = await Promise.all([
    groupedCounts(schedules, schedules.routeId, ids),
    groupedCounts(pickupPoints, pickupPoints.routeId, ids),
  ]);
  return {
    items: rows.map(({ route: r }) => ({
      id: r.id,
      brandId: r.brandId,
      name: r.name,
      startLocationId: r.startLocationId,
      endLocationId: r.endLocationId,
      startLocation: placePreview(r.startLocationId),
      endLocation: placePreview(r.endLocationId),
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      scheduleCount: countOf(scheduleCounts, r.id),
      pickupPointCount: countOf(pickupCounts, r.id),
    })),
    total,
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
    .where(inArray(scheduleFares.scheduleId, ids));
  const pointRows = await db
    .select({ point: schedulePoints, address: addresses })
    .from(schedulePoints)
    .innerJoin(addresses, eq(addresses.id, schedulePoints.addressId))
    .where(inArray(schedulePoints.scheduleId, ids))
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
          address: adminAddressOut(p.address),
        })),
      createdAt: s.createdAt,
    };
  });
}

/** `AdminVehicleTypeOut` list. */
export async function adminVehicleTypeList(filters: { q?: string; limit: number; offset: number }) {
  const db = await getDb();
  const q = filters.q?.trim();
  const where =
    q !== undefined && q.length > 0
      ? or(like(vehicleTypes.label, `%${q}%`), like(vehicleTypes.code, `%${q}%`))
      : undefined;
  const rows = await db
    .select()
    .from(vehicleTypes)
    .where(where)
    .orderBy(vehicleTypes.sortOrder, vehicleTypes.code)
    .limit(filters.limit)
    .offset(filters.offset);
  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(vehicleTypes)
    .where(where);
  return {
    items: rows.map((v) => ({
      id: v.id,
      code: v.code,
      label: v.label,
      totalSeats: v.totalSeats,
      sortOrder: v.sortOrder,
      status: v.status,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    })),
    total: totalRows[0]?.total ?? 0,
  };
}

/** `AdminBusLayoutOut` list (slim — plan and `inUse` live in the DETAIL
 * endpoint, exactly like the Rust `AdminBusLayoutOut`: the list contract
 * has no in-use field, and both SPAs read the lock from the detail fetch
 * when opening the editor). */
export async function adminBusLayoutList(filters: {
  brandId?: string;
  /** With `brandId`: the shared catalog (no brand) too. */
  includeShared?: boolean;
  limit: number;
  offset: number;
}) {
  const db = await getDb();
  const ofBrand =
    filters.brandId !== undefined ? eq(busLayouts.brandId, filters.brandId) : undefined;
  const where =
    ofBrand && filters.includeShared ? or(ofBrand, isNull(busLayouts.brandId)) : ofBrand;
  const rows = await db
    .select({ layout: busLayouts })
    .from(busLayouts)
    .where(where)
    .orderBy(desc(busLayouts.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);
  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(busLayouts)
    .where(where);
  return {
    items: rows.map(({ layout: b }) => ({
      id: b.id,
      brandId: b.brandId,
      name: b.name,
      vehicleType: b.vehicleType,
      totalSeats: b.totalSeats,
      planned: b.layoutData !== null,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    })),
    total: totalRows[0]?.total ?? 0,
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
