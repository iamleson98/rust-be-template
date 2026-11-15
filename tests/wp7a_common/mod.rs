//! Shared fixtures of the `wp7a_*` tests: a migrated in-memory database
//! with one brand, route and schedule, and helpers that insert the rows the
//! ads, review and payment tests need (users, trips, bookings, payments).
//! Each test crate uses a different part of it.

#![allow(dead_code)]

use std::sync::Arc;

use chrono::{Duration, FixedOffset, SecondsFormat, Utc};
use sea_orm::{ActiveModelTrait, ActiveValue::Set};
use sea_orm_migration::MigratorTrait;
use uuid::Uuid;

use backend::entity::{booking, brand, payment, route, schedule, trip_session};
use backend::store::{
    CompositeStore, DbAddressStore, DbAuditStore, DbBookingStore, DbBrandStore, DbChatStore,
    DbNotificationStore, DbPaymentStore, DbPlaceStore, DbPostStore, DbPriceAlertStore, DbRbacStore,
    DbRefreshTokenStore, DbReviewStore, DbRouteStore, DbScheduleStore, DbStaffPresenceStore,
    DbTripStore, DbUserStore, DbVehicleTypeStore,
};

pub struct Env {
    pub store: Arc<CompositeStore>,
    pub brand: Uuid,
    pub route: Uuid,
    pub schedule: Uuid,
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// Today's date in Vietnam (UTC+7), shifted by `days`.
pub fn vn_date(days: i64) -> String {
    let vn = FixedOffset::east_opt(7 * 3600).expect("UTC+7");
    (Utc::now().with_timezone(&vn) + Duration::days(days))
        .format("%Y-%m-%d")
        .to_string()
}

/// A migrated database whose one schedule departs at `departure_time`
/// (`HH:MM`, Vietnam wall-clock time).
pub async fn env(departure_time: &str) -> Env {
    let mut opts = sea_orm::ConnectOptions::new("sqlite::memory:");
    opts.max_connections(1);
    let conn = Arc::new(sea_orm::Database::connect(opts).await.expect("connect"));
    migrator::Migrator::up(conn.as_ref(), None)
        .await
        .expect("migrate");
    let db = &conn;
    let store = Arc::new(CompositeStore::new(
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
    ));
    let db = store.db();
    let stamp = now();

    let brand_id = Uuid::new_v4();
    brand::ActiveModel {
        id: Set(brand_id),
        slug: Set(format!("wp7a-{}", brand_id.simple())),
        name: Set("Wp7a Coaches".into()),
        status: Set("active".into()),
        total_trips: Set(0),
        created_at: Set(stamp.clone()),
        updated_at: Set(stamp.clone()),
        ..Default::default()
    }
    .insert(db)
    .await
    .expect("brand");

    let route_id = Uuid::new_v4();
    route::ActiveModel {
        id: Set(route_id),
        brand_id: Set(Some(brand_id)),
        name: Set("Hà Nội - Đà Nẵng".into()),
        start_location_id: Set("ha-noi".into()),
        end_location_id: Set("da-nang".into()),
        status: Set("active".into()),
        created_at: Set(stamp.clone()),
        updated_at: Set(stamp.clone()),
    }
    .insert(db)
    .await
    .expect("route");

    let schedule_id = Uuid::new_v4();
    schedule::ActiveModel {
        id: Set(schedule_id),
        route_id: Set(route_id),
        departure_time: Set(departure_time.into()),
        days_of_week: Set(Some("1111111".into())),
        base_price_adult: Set(350_000),
        created_at: Set(stamp),
        ..Default::default()
    }
    .insert(db)
    .await
    .expect("schedule");

    Env {
        store,
        brand: brand_id,
        route: route_id,
        schedule: schedule_id,
    }
}

impl Env {
    pub async fn user(&self) -> Uuid {
        self.store
            .user_store()
            .create_user(
                format!("{}@wp7a.test", Uuid::new_v4().simple()),
                "Wp7a Tester".into(),
                "unused-hash".into(),
                "user".into(),
            )
            .await
            .expect("user")
            .id
    }

    /// A trip of the schedule on `date` (`YYYY-MM-DD`).
    pub async fn trip(&self, date: &str) -> Uuid {
        let id = Uuid::new_v4();
        let stamp = now();
        trip_session::ActiveModel {
            id: Set(id),
            schedule_id: Set(self.schedule),
            departure_date: Set(date.into()),
            status: Set("scheduled".into()),
            total_seats: Set(10),
            available_seats: Set(10),
            created_at: Set(stamp.clone()),
            updated_at: Set(stamp),
            ..Default::default()
        }
        .insert(self.store.db())
        .await
        .expect("trip");
        id
    }

    /// A booking of `trip` in `status`, worth `total` đồng.
    pub async fn booking(
        &self,
        user: Option<Uuid>,
        trip: Uuid,
        status: &str,
        total: i64,
    ) -> booking::Model {
        let stamp = now();
        booking::ActiveModel {
            id: Set(Uuid::new_v4()),
            code: Set(format!("VEX-{}", &Uuid::new_v4().simple().to_string()[..8])),
            user_id: Set(user),
            trip_session_id: Set(trip),
            adult_count: Set(1),
            child_count: Set(0),
            subtotal: Set(total),
            discount: Set(0),
            fees: Set(0),
            total: Set(total),
            currency: Set("VND".into()),
            status: Set(status.into()),
            contact_name: Set(Some("Nguyễn Văn A".into())),
            contact_phone: Set(Some("0912345678".into())),
            created_at: Set(stamp.clone()),
            updated_at: Set(stamp),
            ..Default::default()
        }
        .insert(self.store.db())
        .await
        .expect("booking")
    }

    /// A payment of `booking` through `provider` in `status`.
    pub async fn payment(
        &self,
        booking: &booking::Model,
        provider: &str,
        status: &str,
        amount: i64,
    ) -> payment::Model {
        let stamp = now();
        payment::ActiveModel {
            id: Set(Uuid::new_v4()),
            booking_id: Set(booking.id),
            user_id: Set(booking.user_id),
            provider: Set(provider.into()),
            status: Set(status.into()),
            amount: Set(amount),
            currency: Set("VND".into()),
            created_at: Set(stamp.clone()),
            updated_at: Set(stamp),
            provider_txn_ref: Set(Uuid::new_v4().simple().to_string()),
            ..Default::default()
        }
        .insert(self.store.db())
        .await
        .expect("payment")
    }
}
