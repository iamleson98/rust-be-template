//! Loyalty integration tests — the loyalty summary must be derived
//! from REAL completed bookings: 1 point per 10,000 VND of booking
//! total (floored per booking), tier bands over the balance, and the
//! per-booking earning history (newest first, with route + brand names
//! resolved through the trip → schedule → route → brand chain).
//!
//! The test builds a MIGRATED in-memory CompositeStore (not the full
//! AppState — the store is intentionally private there; router
//! registration is separately pinned by the OpenAPI dump test) and
//! seeds rows directly through the store layer, so the arithmetic and
//! the name-resolution chain run against the real engine.
//!
//! Non-completed bookings must NOT earn points.

// Link anchor: rustc only places an rlib on a TEST binary's link line
// when the test's own code references the crate. The rustqlite engine
// (`sqlite3` crate — the sqlite3_* C ABI) is otherwise dropped and
// sqlx-sqlite's FFI references go unresolved. Referencing the compat
// crate's Rust-visible `engine_version` pulls the engine + compat
// rlibs onto THIS binary's link line.
#[used]
static ENGINE_LINK: fn() -> &'static str = sqlite3::engine_version;

use std::sync::Arc;

use sea_orm::{Database, DatabaseConnection, Set};
use sea_orm_migration::MigratorTrait;
use uuid::Uuid;

use backend::service::LoyaltyService;
use backend::store::CompositeStore;

/// Migrated in-memory DB + CompositeStore over the plain Db* stores
/// (no cache wrappers — they need a cache backend config).
async fn migrated_store() -> anyhow::Result<Arc<CompositeStore>> {
    use backend::store::{
        DbAddressStore, DbAuditStore, DbBookingStore, DbBrandStore, DbChatStore,
        DbNotificationStore, DbPaymentStore, DbPlaceStore, DbPostStore, DbPriceAlertStore,
        DbRbacStore, DbRefreshTokenStore, DbReviewStore, DbRouteStore, DbScheduleStore,
        DbStaffPresenceStore, DbTripStore, DbUserStore, DbVehicleTypeStore,
    };
    use std::sync::Once;
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let _ = dotenvy::dotenv();
        std::env::set_var("DATABASE_URL", "sqlite::memory:");
    });

    let mut opts = sea_orm::ConnectOptions::new("sqlite::memory:");
    opts.max_connections(1);
    let db: Arc<DatabaseConnection> = Arc::new(Database::connect(opts).await?);
    migrator::Migrator::up(db.as_ref(), None).await?;

    Ok(Arc::new(CompositeStore::new(
        db.clone(),
        Arc::new(DbUserStore::new(db.clone())),
        Arc::new(DbPostStore::new(db.clone())),
        Arc::new(DbRbacStore::new(db.clone())),
        Arc::new(DbRefreshTokenStore::new(db.clone())),
        Arc::new(DbBrandStore::new(db.clone())),
        Arc::new(DbChatStore::new(db.clone())),
        Arc::new(DbBookingStore::new(db.clone())),
        Arc::new(DbReviewStore::new(db.clone())),
        Arc::new(DbRouteStore::new(db.clone())),
        Arc::new(DbStaffPresenceStore::new(db.clone())),
        Arc::new(DbScheduleStore::new(db.clone())),
        Arc::new(DbTripStore::new(db.clone())),
        Arc::new(DbPlaceStore::new(db.clone())),
        Arc::new(DbPriceAlertStore::new(db.clone())),
        Arc::new(DbAuditStore::new(db.clone())),
        Arc::new(DbNotificationStore::new(db.clone())),
        Arc::new(DbPaymentStore::new(db.clone())),
        Arc::new(DbAddressStore::new(db.clone())),
        Arc::new(DbVehicleTypeStore::new(db.clone())),
    )))
}

/// Insert a real user row (bookings carry an FK to `user`).
async fn seed_user(store: &CompositeStore) -> anyhow::Result<Uuid> {
    let email = format!("loyalty-{}@example.com", Uuid::new_v4().simple());
    let user = store
        .user_store()
        .create_user(
            email,
            "Loyalty Tester".into(),
            "unused-hash".into(),
            "user".into(),
        )
        .await?;
    Ok(user.id)
}

/// Seed the full chain brand → route → schedule → trip_session so the
/// history entries can resolve route + brand names, and return the
/// trip session id.
async fn seed_trip_chain(store: &CompositeStore) -> anyhow::Result<Uuid> {
    use backend::entity::{brand, route, schedule, trip_session};
    let now = "2026-09-01T08:00:00";

    let brand_id = Uuid::new_v4();
    store
        .brand_store()
        .insert_brand(brand::ActiveModel {
            id: Set(brand_id),
            slug: Set("loyalty-test-coaches".into()),
            name: Set("Loyalty Test Coaches".into()),
            logo_url: Set(None),
            description: Set(None),
            contact_phone: Set(None),
            contact_email: Set(None),
            rating: Set(None),
            status: Set("active".into()),
            accent_color: Set(Some("#2563eb".into())),
            total_trips: Set(0),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
            child_max_age: Set(None),
            child_discount_percent: Set(None),
        })
        .await?;

    let route_id = Uuid::new_v4();
    store
        .route_store()
        .insert_route(route::ActiveModel {
            id: Set(route_id),
            brand_id: Set(Some(brand_id)),
            name: Set("Hà Nội - Đà Nẵng".into()),
            start_location_id: Set("ha-noi".into()),
            end_location_id: Set("da-nang".into()),
            status: Set("active".into()),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        })
        .await?;

    let schedule_id = Uuid::new_v4();
    store
        .schedule_store()
        .insert_schedule(schedule::ActiveModel {
            id: Set(schedule_id),
            route_id: Set(route_id),
            departure_time: Set("08:30".into()),
            effective_from: Set(None),
            effective_to: Set(None),
            days_of_week: Set(Some("1111111".into())),
            bus_layout_id: Set(None),
            base_price_adult: Set(350_000),
            base_price_child: Set(None),
            amenities: Set(None),
            created_at: Set(now.into()),
            vehicle_type_id: Set(None),
        })
        .await?;

    let trip_id = Uuid::new_v4();
    store
        .trip_store()
        .insert_trip_session(trip_session::ActiveModel {
            id: Set(trip_id),
            schedule_id: Set(schedule_id),
            departure_date: Set("2026-09-01".into()),
            actual_departure_at: Set(None),
            driver_name: Set(None),
            driver_phone: Set(None),
            status: Set("completed".into()),
            total_seats: Set(40),
            available_seats: Set(40),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        })
        .await?;
    Ok(trip_id)
}

/// Insert a booking row directly (status + total under test control).
async fn insert_booking(
    store: &CompositeStore,
    user_id: Uuid,
    trip_id: Uuid,
    code: &str,
    status: &str,
    total: i64,
    created_at: &str,
) -> anyhow::Result<Uuid> {
    use backend::entity::booking;
    let id = Uuid::new_v4();
    store
        .booking_store()
        .insert_booking(booking::ActiveModel {
            id: Set(id),
            code: Set(code.into()),
            user_id: Set(Some(user_id)),
            guest_name: Set(None),
            guest_phone: Set(None),
            guest_email: Set(None),
            trip_session_id: Set(trip_id),
            boarding_point_id: Set(None),
            dropping_point_id: Set(None),
            adult_count: Set(1),
            child_count: Set(0),
            subtotal: Set(total),
            discount: Set(0),
            fees: Set(0),
            total: Set(total),
            currency: Set("VND".into()),
            status: Set(status.into()),
            payment_method: Set(None),
            campaign_applied_id: Set(None),
            expires_at: Set(None),
            contact_name: Set(Some("Loyalty Tester".into())),
            contact_phone: Set(None),
            contact_email: Set(None),
            created_at: Set(created_at.into()),
            updated_at: Set(created_at.into()),
            dropoff_address: Set(None),
            dropoff_lat: Set(None),
            dropoff_lon: Set(None),
            dropoff_name: Set(None),
            pickup_address: Set(None),
            pickup_lat: Set(None),
            pickup_lon: Set(None),
            pickup_name: Set(None),
        })
        .await?;
    Ok(id)
}

#[tokio::test]
async fn loyalty_summary_derives_points_from_completed_bookings() -> anyhow::Result<()> {
    let store = migrated_store().await?;
    let user_id = seed_user(&store).await?;
    let trip_id = seed_trip_chain(&store).await?;

    // Completed bookings: 350k VND → 35 pts, 125k VND → 12 pts.
    // A cancelled + a pending booking must NOT earn anything.
    insert_booking(
        &store,
        user_id,
        trip_id,
        "LTY-C1",
        "completed",
        350_000,
        "2026-09-01T10:00:00",
    )
    .await?;
    insert_booking(
        &store,
        user_id,
        trip_id,
        "LTY-C2",
        "completed",
        125_000,
        "2026-09-02T10:00:00",
    )
    .await?;
    insert_booking(
        &store,
        user_id,
        trip_id,
        "LTY-X1",
        "cancelled",
        999_999,
        "2026-09-03T10:00:00",
    )
    .await?;
    insert_booking(
        &store,
        user_id,
        trip_id,
        "LTY-P1",
        "pending",
        500_000,
        "2026-09-04T10:00:00",
    )
    .await?;

    let loyalty = LoyaltyService::new(store.clone());
    let summary = loyalty.summary(user_id).await?;

    // ── Arithmetics: only completed bookings earn, floor per booking ──
    assert_eq!(
        summary.points,
        35 + 12,
        "points = sum(total/10k) over completed bookings"
    );
    assert_eq!(summary.completed_trips, 2);
    assert_eq!(summary.total_spent, 475_000);
    assert_eq!(summary.currency, "VND");

    // ── Tier band: 47 points → bronze, next tier silver @ 1000 ──
    assert_eq!(summary.tier.key, "bronze");
    assert_eq!(summary.tier.min_points, 0);
    let next = summary.next_tier.expect("bronze must have a next tier");
    assert_eq!(next.key, "silver");
    assert_eq!(next.min_points, 1_000);

    // ── History: only the completed bookings, newest first, names resolved ──
    assert_eq!(summary.history.len(), 2);
    assert_eq!(
        summary.history[0].booking_code, "LTY-C2",
        "newest completed booking first"
    );
    assert_eq!(summary.history[0].points, 12);
    assert_eq!(
        summary.history[0].route_name.as_deref(),
        Some("Hà Nội - Đà Nẵng")
    );
    assert_eq!(
        summary.history[0].brand_name.as_deref(),
        Some("Loyalty Test Coaches")
    );
    assert_eq!(summary.history[1].booking_code, "LTY-C1");
    assert_eq!(summary.history[1].points, 35);
    Ok(())
}

#[tokio::test]
async fn loyalty_summary_with_no_bookings_is_zero_and_bronze() -> anyhow::Result<()> {
    let store = migrated_store().await?;
    let loyalty = LoyaltyService::new(store.clone());
    let summary = loyalty.summary(Uuid::new_v4()).await?;

    assert_eq!(summary.points, 0);
    assert_eq!(summary.completed_trips, 0);
    assert_eq!(summary.total_spent, 0);
    assert_eq!(summary.currency, "VND");
    assert_eq!(summary.tier.key, "bronze");
    assert!(summary.history.is_empty());
    assert_eq!(
        summary.next_tier.as_ref().map(|t| t.key.as_str()),
        Some("silver")
    );
    Ok(())
}

#[tokio::test]
async fn loyalty_tiers_climb_with_the_balance() -> anyhow::Result<()> {
    let store = migrated_store().await?;
    let user_id = seed_user(&store).await?;
    let trip_id = seed_trip_chain(&store).await?;

    // 5 × 10,000,000 VND = 50M VND across completed bookings
    // → 5,000 points → exactly the gold threshold.
    for i in 0..5 {
        insert_booking(
            &store,
            user_id,
            trip_id,
            &format!("LTY-G{i}"),
            "completed",
            10_000_000,
            "2026-09-05T10:00:00",
        )
        .await?;
    }

    let loyalty = LoyaltyService::new(store.clone());
    let summary = loyalty.summary(user_id).await?;

    assert_eq!(summary.points, 5_000);
    assert_eq!(summary.tier.key, "gold");
    assert_eq!(
        summary.tier.benefit_codes,
        vec!["discount_10", "priority_seat", "voucher_60k"]
    );
    let next = summary.next_tier.expect("gold must have a next tier");
    assert_eq!(next.key, "platinum");
    assert_eq!(next.min_points, 20_000);
    Ok(())
}
