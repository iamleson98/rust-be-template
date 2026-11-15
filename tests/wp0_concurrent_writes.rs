//! Booking writes under real concurrency, on a WAL database FILE (so
//! `BEGIN CONCURRENT` is in effect, not the single-connection in-memory
//! fallback):
//!
//! * 20 parallel holds on ONE seat: exactly one wins, the other 19 get a
//!   conflict, and the losers leave no rows behind;
//! * a full booking + cash-payment path for many customers at once ends
//!   with every ticket confirmed, every payment completed and every seat
//!   sold exactly once.

use std::sync::Arc;
use std::time::Duration;

use sea_orm::sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sea_orm::{ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, Set, SqlxSqliteConnector};
use sea_orm_migration::MigratorTrait;
use tokio::sync::Barrier;
use uuid::Uuid;

use backend::config::PaymentConfig;
use backend::dto::booking::{HoldReq, PassengerReq};
use backend::dto::payment::CreatePaymentReq;
use backend::entity::{
    booking, booking_seat, brand, bus_layout, payment, pickup_point, route, schedule, seat,
    seat_inventory, trip_session,
};
use backend::error::AppError;
use backend::payment::cod::CodProvider;
use backend::payment::momo::MomoProvider;
use backend::payment::vietqr::VietQrProvider;
use backend::payment::vnpay::VnpayProvider;
use backend::payment::zalopay::ZalopayProvider;
use backend::service::{BookingService, PaymentService};
use backend::store::{
    CompositeStore, DbAddressStore, DbAuditStore, DbBookingStore, DbBrandStore, DbChatStore,
    DbNotificationStore, DbPaymentStore, DbPlaceStore, DbPostStore, DbPriceAlertStore, DbRbacStore,
    DbRefreshTokenStore, DbReviewStore, DbRouteStore, DbScheduleStore, DbStaffPresenceStore,
    DbTripStore, DbUserStore, DbVehicleTypeStore,
};

/// A migrated database file in WAL mode behind a pool of 8 connections.
async fn wal_store(dir: &tempfile::TempDir) -> Arc<CompositeStore> {
    let options = SqliteConnectOptions::new()
        .filename(dir.path().join("wp0.db"))
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await
        .expect("pool");
    let db = Arc::new(SqlxSqliteConnector::from_sqlx_sqlite_pool(pool));
    migrator::Migrator::up(db.as_ref(), None)
        .await
        .expect("migrate");

    Arc::new(CompositeStore::new(
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
    ))
}

struct Trip {
    id: Uuid,
    seats: Vec<Uuid>,
    stops: (Uuid, Uuid),
}

/// One trip tomorrow with `n` seats for sale on a two-stop route.
async fn seed_trip(store: &CompositeStore, n: usize) -> Trip {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let db = store.db();

    let brand_id = Uuid::new_v4();
    brand::Entity::insert(brand::ActiveModel {
        id: Set(brand_id),
        slug: Set(format!("wp0-{}", brand_id.simple())),
        name: Set("Wp0 Coaches".into()),
        status: Set("active".into()),
        total_trips: Set(0),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
        ..Default::default()
    })
    .exec_without_returning(db)
    .await
    .expect("brand");

    let layout_id = Uuid::new_v4();
    bus_layout::Entity::insert(bus_layout::ActiveModel {
        id: Set(layout_id),
        brand_id: Set(Some(brand_id)),
        name: Set(Some("Wp0 Layout".into())),
        total_seats: Set(Some(n as i16)),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
        ..Default::default()
    })
    .exec_without_returning(db)
    .await
    .expect("layout");

    let seat_ids: Vec<Uuid> = (0..n).map(|_| Uuid::new_v4()).collect();
    seat::Entity::insert_many(
        seat_ids
            .iter()
            .enumerate()
            .map(|(i, &id)| seat::ActiveModel {
                id: Set(id),
                bus_layout_id: Set(layout_id),
                seat_label: Set(format!("S{i:02}")),
                is_window: Set(false),
                floor: Set(1),
                created_at: Set(now.clone()),
                ..Default::default()
            }),
    )
    .exec_without_returning(db)
    .await
    .expect("seats");

    let route_id = Uuid::new_v4();
    route::Entity::insert(route::ActiveModel {
        id: Set(route_id),
        brand_id: Set(Some(brand_id)),
        name: Set("Hà Nội - Đà Nẵng".into()),
        start_location_id: Set("ha-noi".into()),
        end_location_id: Set("da-nang".into()),
        status: Set("active".into()),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
    })
    .exec_without_returning(db)
    .await
    .expect("route");

    let stops = (Uuid::new_v4(), Uuid::new_v4());
    for (order, id, name) in [
        (1, stops.0, "Bến xe Giáp Bát"),
        (2, stops.1, "Bến xe Đà Nẵng"),
    ] {
        pickup_point::Entity::insert(pickup_point::ActiveModel {
            id: Set(id),
            route_id: Set(route_id),
            name: Set(Some(name.into())),
            stop_order: Set(order),
            created_at: Set(now.clone()),
            ..Default::default()
        })
        .exec_without_returning(db)
        .await
        .expect("stop");
    }

    let schedule_id = Uuid::new_v4();
    schedule::Entity::insert(schedule::ActiveModel {
        id: Set(schedule_id),
        route_id: Set(route_id),
        departure_time: Set("08:30".into()),
        days_of_week: Set(Some("1111111".into())),
        bus_layout_id: Set(Some(layout_id)),
        base_price_adult: Set(350_000),
        created_at: Set(now.clone()),
        ..Default::default()
    })
    .exec_without_returning(db)
    .await
    .expect("schedule");

    let trip_id = Uuid::new_v4();
    trip_session::Entity::insert(trip_session::ActiveModel {
        id: Set(trip_id),
        schedule_id: Set(schedule_id),
        departure_date: Set((chrono::Utc::now() + chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string()),
        status: Set("scheduled".into()),
        total_seats: Set(n as i64),
        available_seats: Set(n as i64),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
        ..Default::default()
    })
    .exec_without_returning(db)
    .await
    .expect("trip");

    seat_inventory::Entity::insert_many(seat_ids.iter().map(|&seat_id| {
        seat_inventory::ActiveModel {
            id: Set(Uuid::new_v4()),
            trip_session_id: Set(trip_id),
            seat_id: Set(seat_id),
            status: Set("available".into()),
            base_price: Set(350_000),
            final_price: Set(350_000),
            currency: Set("VND".into()),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
            ..Default::default()
        }
    }))
    .exec_without_returning(db)
    .await
    .expect("inventory");

    Trip {
        id: trip_id,
        seats: seat_ids,
        stops,
    }
}

async fn new_user(store: &CompositeStore) -> Uuid {
    store
        .user_store()
        .create_user(
            format!("{}@wp0.test", Uuid::new_v4().simple()),
            "Wp0 Tester".into(),
            "unused-hash".into(),
            "user".into(),
        )
        .await
        .expect("user")
        .id
}

fn hold_req(trip: &Trip, seat_ids: Vec<Uuid>) -> HoldReq {
    HoldReq {
        trip_id: trip.id,
        passengers: seat_ids
            .iter()
            .map(|_| PassengerReq {
                name: "Nguyễn Văn A".into(),
                passenger_type: None,
                age: Some(30),
                seat_id: None,
            })
            .collect(),
        seat_ids,
        boarding_point_id: Some(trip.stops.0),
        dropping_point_id: Some(trip.stops.1),
        contact_name: "Nguyễn Văn A".into(),
        contact_phone: "0912345678".into(),
        contact_email: None,
        coupon_id: None,
    }
}

async fn count<E: EntityTrait>(store: &CompositeStore) -> u64
where
    E::Model: Send + Sync,
{
    E::find().count(store.db()).await.expect("count")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn twenty_parallel_holds_on_one_seat_leave_exactly_one_booking() {
    const HOLDERS: usize = 20;
    let dir = tempfile::tempdir().expect("tempdir");
    let store = wal_store(&dir).await;
    let svc = Arc::new(BookingService::new(store.clone()));
    let trip = Arc::new(seed_trip(&store, 1).await);
    let mut users = Vec::new();
    for _ in 0..HOLDERS {
        users.push(new_user(&store).await);
    }

    let start = Arc::new(Barrier::new(HOLDERS));
    let mut holds = Vec::new();
    for user in users {
        let (svc, trip, start) = (svc.clone(), trip.clone(), start.clone());
        holds.push(tokio::spawn(async move {
            let req = hold_req(&trip, trip.seats.clone());
            start.wait().await;
            svc.hold_with_user(user, &req).await
        }));
    }
    let mut winners = Vec::new();
    let mut conflicts = 0;
    for hold in holds {
        match hold.await.expect("task") {
            Ok(held) => winners.push(held),
            Err(AppError::Conflict(_)) => conflicts += 1,
            Err(other) => panic!("a losing hold must be a conflict, got {other:?}"),
        }
    }
    assert_eq!(winners.len(), 1, "exactly one hold wins the seat");
    assert_eq!(conflicts, HOLDERS - 1);

    // The losers left nothing behind.
    let winner = winners[0].booking_id;
    assert_eq!(count::<booking::Entity>(&store).await, 1);
    assert_eq!(count::<booking_seat::Entity>(&store).await, 1);
    let held: Vec<_> = seat_inventory::Entity::find()
        .filter(seat_inventory::Column::TripSessionId.eq(trip.id))
        .all(store.db())
        .await
        .expect("inventory");
    assert_eq!(held.len(), 1);
    assert_eq!(held[0].status, "held");
    assert_eq!(held[0].held_by_booking_id, Some(winner));
    let left = trip_session::Entity::find_by_id(trip.id)
        .one(store.db())
        .await
        .expect("trip")
        .expect("trip row")
        .available_seats;
    assert_eq!(left, 0, "the counter dropped once, for the winner only");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_bookings_and_cash_payments_sell_every_seat_once() {
    const CUSTOMERS: usize = 12;
    let dir = tempfile::tempdir().expect("tempdir");
    let store = wal_store(&dir).await;
    let svc = Arc::new(BookingService::new(store.clone()));
    let cfg = Arc::new(PaymentConfig {
        cod_enabled: true,
        ..PaymentConfig::default()
    });
    let payments = Arc::new(PaymentService::new(
        store.clone(),
        svc.clone(),
        cfg.clone(),
        Arc::new(VnpayProvider::new(&cfg.vnpay)),
        Arc::new(MomoProvider::new(&cfg.momo)),
        Arc::new(ZalopayProvider::new(&cfg.zalopay)),
        Arc::new(VietQrProvider::new(&cfg.vietqr)),
        Arc::new(CodProvider::new()),
    ));
    let trip = Arc::new(seed_trip(&store, CUSTOMERS).await);
    let staff = new_user(&store).await;
    let mut users = Vec::new();
    for _ in 0..CUSTOMERS {
        users.push(new_user(&store).await);
    }

    // Everyone books one seat of the same trip and pays on board, at once.
    let start = Arc::new(Barrier::new(CUSTOMERS));
    let mut customers = Vec::new();
    for (user, seat) in users.into_iter().zip(trip.seats.clone()) {
        let (svc, payments, trip, start) =
            (svc.clone(), payments.clone(), trip.clone(), start.clone());
        customers.push(tokio::spawn(async move {
            let req = hold_req(&trip, vec![seat]);
            start.wait().await;
            let held = svc.hold_with_user(user, &req).await.expect("hold");
            let owner = user.to_string();
            let made = payments
                .create_payment(
                    &CreatePaymentReq {
                        booking_id: held.booking_id,
                        provider: "cod".into(),
                    },
                    Some(&owner),
                )
                .await
                .expect("create payment");
            payments
                .mark_cod_collected(made.payment.id, staff, None, None)
                .await
                .expect("collect");
            held.booking_id
        }));
    }
    let mut booking_ids = Vec::new();
    for customer in customers {
        booking_ids.push(customer.await.expect("task"));
    }

    for id in &booking_ids {
        let b = booking::Entity::find_by_id(*id)
            .one(store.db())
            .await
            .expect("booking")
            .expect("booking row");
        assert_eq!(b.status, "confirmed");
    }
    let completed = payment::Entity::find()
        .filter(payment::Column::Status.eq("completed"))
        .count(store.db())
        .await
        .expect("payments");
    assert_eq!(completed, CUSTOMERS as u64);
    let booked = seat_inventory::Entity::find()
        .filter(seat_inventory::Column::Status.eq("booked"))
        .count(store.db())
        .await
        .expect("seats");
    assert_eq!(booked, CUSTOMERS as u64, "each seat sold exactly once");
    let left = trip_session::Entity::find_by_id(trip.id)
        .one(store.db())
        .await
        .expect("trip")
        .expect("trip row")
        .available_seats;
    assert_eq!(left, 0, "no decrement was lost");
}
