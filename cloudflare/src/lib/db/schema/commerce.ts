/**
 * Commerce schema: trip sessions (a schedule on a date), seat inventory,
 * bookings, payments, reviews, campaigns/coupons.
 * Ported from migrations _000007_create_bookings, _000006_create_promotions,
 * _000020_create_discount_campaigns, _000017_ad_conversions, etc.
 */
import { isoNow } from "./now";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { brands } from "./commerce-brand";
import { routes, schedules, seats, pickupPoints } from "./catalog";

/** One schedule departing on one concrete date ("the trip"). */
export const tripSessions = sqliteTable(
  "trip_session",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    departureDate: text("departure_date").notNull(), // YYYY-MM-DD
    actualDepartureAt: text("actual_departure_at"),
    driverName: text("driver_name"),
    driverPhone: text("driver_phone"),
    status: text("status").notNull().default("scheduled"),
    totalSeats: integer("total_seats").notNull().default(0),
    availableSeats: integer("available_seats").notNull().default(0),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  (t) => [
    index("idx_trip_schedule").on(t.scheduleId),
    index("idx_trip_date").on(t.departureDate),
    uniqueIndex("idx_trip_schedule_date").on(t.scheduleId, t.departureDate),
    index("idx_trip_date_status").on(t.departureDate, t.status),
  ],
);

/** Per-trip seat state machine: available → held → booked. */
export const seatInventory = sqliteTable(
  "seat_inventory",
  {
    id: text("id").primaryKey(),
    tripSessionId: text("trip_session_id")
      .notNull()
      .references(() => tripSessions.id, { onDelete: "cascade" }),
    seatId: text("seat_id")
      .notNull()
      .references(() => seats.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("available"),
    basePrice: integer("base_price").notNull().default(0),
    finalPrice: integer("final_price").notNull().default(0),
    currency: text("currency").notNull().default("VND"),
    heldUntil: text("held_until"),
    heldByBookingId: text("held_by_booking_id"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  (t) => [
    index("idx_si_trip").on(t.tripSessionId),
    index("idx_si_seat").on(t.seatId),
    uniqueIndex("idx_si_trip_seat").on(t.tripSessionId, t.seatId),
    index("idx_si_held_until").on(t.heldUntil),
  ],
);

export const bookings = sqliteTable(
  "booking",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(), // {BRANDPREFIX}-XXXXXX base32-ish
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    guestName: text("guest_name"),
    guestPhone: text("guest_phone"),
    guestEmail: text("guest_email"),
    tripSessionId: text("trip_session_id")
      .notNull()
      .references(() => tripSessions.id, { onDelete: "cascade" }),
    boardingPointId: text("boarding_point_id").references(() => pickupPoints.id, {
      onDelete: "set null",
    }),
    droppingPointId: text("dropping_point_id").references(() => pickupPoints.id, {
      onDelete: "set null",
    }),
    adultCount: integer("adult_count").notNull().default(1),
    childCount: integer("child_count").notNull().default(0),
    subtotal: integer("subtotal").notNull().default(0),
    discount: integer("discount").notNull().default(0),
    fees: integer("fees").notNull().default(0),
    total: integer("total").notNull().default(0),
    currency: text("currency").notNull().default("VND"),
    status: text("status").notNull().default("pending"), // pending | confirmed | cancelled
    paymentMethod: text("payment_method"), // cod | vnpay | momo | zalopay | vietqr
    campaignAppliedId: text("campaign_applied_id"),
    expiresAt: text("expires_at"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
    pickupName: text("pickup_name"),
    pickupAddress: text("pickup_address"),
    pickupLat: text("pickup_lat"),
    pickupLon: text("pickup_lon"),
    dropoffName: text("dropoff_name"),
    dropoffAddress: text("dropoff_address"),
    dropoffLat: text("dropoff_lat"),
    dropoffLon: text("dropoff_lon"),
  },
  (t) => [
    uniqueIndex("idx_booking_code").on(t.code),
    index("idx_booking_status_created").on(t.status, t.createdAt),
    index("idx_booking_user").on(t.userId, t.createdAt),
  ],
);

export const bookingSeats = sqliteTable(
  "booking_seat",
  {
    id: text("id").primaryKey(),
    bookingId: text("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    seatId: text("seat_id")
      .notNull()
      .references(() => seats.id, { onDelete: "cascade" }),
    passengerName: text("passenger_name"),
    passengerAge: integer("passenger_age"),
    passengerType: text("passenger_type"), // adult | child
    price: integer("price").notNull().default(0),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  (t) => [
    index("idx_bs_booking").on(t.bookingId),
    uniqueIndex("idx_bs_booking_seat").on(t.bookingId, t.seatId),
  ],
);

export const payments = sqliteTable(
  "payment",
  {
    id: text("id").primaryKey(),
    bookingId: text("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    provider: text("provider").notNull(), // vnpay | momo | zalopay | vietqr | cod
    status: text("status").notNull().default("pending"), // pending|completed|failed|cancelled|refunded
    amount: integer("amount").notNull().default(0),
    currency: text("currency").notNull().default("VND"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
    providerTxnRef: text("provider_txn_ref"),
    providerTransId: text("provider_trans_id"),
    gatewayUrl: text("gateway_url"),
    qrPayload: text("qr_payload"),
    memo: text("memo"),
    providerResponse: text("provider_response"),
    failureReason: text("failure_reason"),
    createdBy: text("created_by"),
    collectedAt: text("collected_at"),
    collectedBy: text("collected_by"),
  },
  (t) => [
    uniqueIndex("idx_payment_txn_ref").on(t.providerTxnRef),
    index("idx_payment_booking").on(t.bookingId),
    index("idx_payment_status").on(t.status),
  ],
);

export const reviews = sqliteTable(
  "review",
  {
    id: text("id").primaryKey(),
    bookingId: text("booking_id"),
    tripSessionId: text("trip_session_id").references(() => tripSessions.id, {
      onDelete: "set null",
    }),
    routeId: text("route_id").references(() => routes.id, { onDelete: "set null" }),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name"),
    authorPhone: text("author_phone"),
    rating: integer("rating").notNull(),
    title: text("title"),
    content: text("content"),
    tags: text("tags"),
    photos: text("photos"),
    status: text("status").notNull().default("published"),
    helpfulCount: integer("helpful_count").notNull().default(0),
    reply: text("reply"),
    repliedAt: text("replied_at"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  (t) => [
    index("idx_review_created").on(t.createdAt),
    index("idx_review_brand").on(t.brandId),
    index("idx_review_route").on(t.routeId),
  ],
);

export const campaigns = sqliteTable(
  "campaign",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    discountType: text("discount_type").notNull(), // percent | amount
    discountValue: integer("discount_value").notNull(),
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  (t) => [
    uniqueIndex("idx_campaign_code").on(t.code),
    index("idx_campaign_brand").on(t.brandId),
    index("idx_campaign_status").on(t.status),
  ],
);

export const discountPrograms = sqliteTable(
  "discount_program",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    discountType: text("discount_type").notNull(),
    discountValue: integer("discount_value").notNull(),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  (t) => [index("idx_dp_brand").on(t.brandId), index("idx_dp_status").on(t.status)],
);

export const discountCampaigns = sqliteTable(
  "discount_campaign",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    couponValidity: text("coupon_validity").notNull(),
    allBrands: integer("all_brands", { mode: "boolean" }).notNull().default(true),
    paused: integer("paused", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  (t) => [index("idx_dc_window").on(t.startsAt, t.endsAt)],
);

export const discountCampaignBrands = sqliteTable(
  "discount_campaign_brand",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => discountCampaigns.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("idx_dcb").on(t.campaignId, t.brandId)],
);

export const discountTiers = sqliteTable(
  "discount_tier",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => discountCampaigns.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    totalSlots: integer("total_slots").notNull(),
    claimedSlots: integer("claimed_slots").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  (t) => [index("idx_dt_campaign").on(t.campaignId)],
);

export const coupons = sqliteTable(
  "coupon",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => discountCampaigns.id, { onDelete: "cascade" }),
    tierId: text("tier_id")
      .notNull()
      .references(() => discountTiers.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    amount: integer("amount").notNull(),
    // Rust lifecycle: held → reserved (on a booking) → redeemed (paid) →
    // settled | rejected; expired (window passed) | released (given up).
    // `active_holder` is set exactly while held/reserved (UNIQUE — one
    // active coupon per account).
    status: text("status").notNull(),
    activeHolder: text("active_holder"),
    validUntil: text("valid_until"),
    bookingId: text("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "set null" }),
    claimIp: text("claim_ip"),
    claimedAt: text("claimed_at").notNull(),
    reservedAt: text("reserved_at"),
    redeemedAt: text("redeemed_at"),
    settledAt: text("settled_at"),
    settledBy: text("settled_by"),
    settlementNote: text("settlement_note"),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  (t) => [
    index("idx_coupon_user").on(t.userId),
    index("idx_coupon_status").on(t.status),
    uniqueIndex("idx_coupon_code").on(t.code),
    uniqueIndex("idx_coupon_active_holder").on(t.activeHolder),
    uniqueIndex("idx_coupon_campaign_user").on(t.campaignId, t.userId),
    uniqueIndex("idx_coupon_booking").on(t.bookingId),
  ],
);
