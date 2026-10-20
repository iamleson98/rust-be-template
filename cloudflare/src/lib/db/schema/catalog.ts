/**
 * Catalog schema: places, brands, vehicle types, routes, schedules,
 * bus layouts, seats, route pictures.
 * Ported from migrations _000003_create_catalog, _000004_create_route_network,
 * _000005_create_schedules, _000010_seed_defaults, _000012_route_pictures,
 * _000018_seat_class_fares, _000021/_000022 tweaks.
 */
import { isoNow } from "./now";
import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brands } from "./commerce-brand";

export const places = sqliteTable(
  "place",
  {
    id: text("id").primaryKey(),
    osmId: integer("osm_id"),
    name: text("name").notNull(),
    nameAscii: text("name_ascii"),
    nameNoTones: text("name_no_tones"),
    type: text("type").notNull(),
    province: text("province"),
    district: text("district"),
    ward: text("ward"),
    lat: real("lat").notNull(),
    lon: real("lon").notNull(),
    population: integer("population").notNull().default(0),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  (t) => [
    uniqueIndex("idx_place_osm").on(t.osmId),
    index("idx_place_province").on(t.province),
    index("idx_place_type").on(t.type),
    index("idx_place_no_tones").on(t.nameNoTones),
  ],
);

export const vehicleTypes = sqliteTable(
  "vehicle_type",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(), // limousine | minivan | standard | semi_sleeper | sleeper
    label: text("label").notNull(),
    description: text("description"),
    totalSeats: integer("total_seats"),
    sortOrder: integer("sort_order").notNull().default(0),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  (t) => [uniqueIndex("idx_vt_code").on(t.code)],
);

export const addresses = sqliteTable(
  "address",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    lat: real("lat"),
    lon: real("lon"),
    province: text("province"),
    district: text("district"),
    ward: text("ward"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  (t) => [index("idx_address_brand").on(t.brandId), index("idx_address_geo").on(t.lat, t.lon)],
);

export const routes = sqliteTable(
  "route",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    startLocationId: text("start_location_id").notNull(), // city slug
    endLocationId: text("end_location_id").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  (t) => [
    index("idx_route_brand").on(t.brandId),
    index("idx_route_endpoints").on(t.startLocationId, t.endLocationId),
    index("idx_route_status").on(t.status),
    index("idx_route_created").on(t.createdAt),
  ],
);

export const pickupPoints = sqliteTable(
  "pickup_point",
  {
    id: text("id").primaryKey(),
    routeId: text("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    name: text("name"),
    address: text("address"),
    lat: real("lat"),
    lon: real("lon"),
    stopOrder: integer("stop_order").notNull().default(0),
    kind: text("kind"), // pickup | drop
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  (t) => [
    index("idx_pickup_route").on(t.routeId),
    index("idx_pickup_route_order").on(t.routeId, t.stopOrder),
    index("idx_pickup_geo").on(t.lat, t.lon),
  ],
);

export const busLayouts = sqliteTable(
  "bus_layout",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "set null" }),
    name: text("name"),
    vehicleType: text("vehicle_type"),
    totalSeats: integer("total_seats"),
    layoutData: text("layout_data"), // JSON seat plan
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  (t) => [index("idx_layout_brand").on(t.brandId)],
);

export const seats = sqliteTable(
  "seat",
  {
    id: text("id").primaryKey(),
    busLayoutId: text("bus_layout_id")
      .notNull()
      .references(() => busLayouts.id, { onDelete: "cascade" }),
    seatLabel: text("seat_label").notNull(),
    seatClass: text("seat_class"),
    rowNum: integer("row_num"),
    colNum: integer("col_num"),
    isWindow: integer("is_window", { mode: "boolean" }).notNull().default(false),
    floor: integer("floor").notNull().default(1),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  (t) => [
    index("idx_seat_layout").on(t.busLayoutId),
    uniqueIndex("idx_seat_layout_label").on(t.busLayoutId, t.seatLabel),
  ],
);

export const schedules = sqliteTable(
  "schedule",
  {
    id: text("id").primaryKey(),
    routeId: text("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    departureTime: text("departure_time").notNull(), // "HH:MM"
    effectiveFrom: text("effective_from"),
    effectiveTo: text("effective_to"),
    daysOfWeek: text("days_of_week"), // JSON array [1..7]
    busLayoutId: text("bus_layout_id").references(() => busLayouts.id, { onDelete: "set null" }),
    basePriceAdult: integer("base_price_adult").notNull().default(0),
    basePriceChild: integer("base_price_child"),
    amenities: text("amenities"), // JSON array
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    vehicleTypeId: text("vehicle_type_id").references(() => vehicleTypes.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("idx_schedule_route").on(t.routeId),
    index("idx_schedule_route_time").on(t.routeId, t.departureTime),
    index("idx_schedule_effective").on(t.effectiveFrom, t.effectiveTo),
    index("idx_schedule_vt").on(t.vehicleTypeId),
  ],
);

export const schedulePoints = sqliteTable(
  "schedule_point",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    addressId: text("address_id")
      .notNull()
      .references(() => addresses.id, { onDelete: "cascade" }),
    stopOrder: integer("stop_order").notNull().default(0),
    kind: text("kind").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    arrivalTime: text("arrival_time"),
  },
  (t) => [index("idx_sp_schedule").on(t.scheduleId), index("idx_sp_address").on(t.addressId)],
);

export const scheduleFares = sqliteTable(
  "schedule_fare",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    seatClass: text("seat_class").notNull(),
    priceAdult: integer("price_adult").notNull(),
    priceChild: integer("price_child"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  (t) => [uniqueIndex("idx_sf_schedule_class").on(t.scheduleId, t.seatClass)],
);

export const routePictures = sqliteTable(
  "route_picture",
  {
    id: text("id").primaryKey(),
    routeId: text("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    storageKey: text("storage_key").notNull(),
    thumbKey: text("thumb_key"),
    contentHash: text("content_hash").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    thumbBytes: integer("thumb_bytes"),
    width: integer("width"),
    height: integer("height"),
    altText: text("alt_text"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  (t) => [
    index("idx_rp_route_order").on(t.routeId, t.sortOrder),
    uniqueIndex("idx_rp_route_hash").on(t.routeId, t.contentHash),
  ],
);
