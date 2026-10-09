//! Shared fixtures for the service tests: a real in-memory database with the
//! production schema, one seeded trip and the services wired on top.

use std::sync::Arc;

use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use uuid::Uuid;

use crate::config::PaymentConfig;
use crate::dto::booking::{BookingHoldResponse, HoldReq};
use crate::entity::{booking, payment, seat_inventory, trip_session};
use crate::payment::cod::CodProvider;
use crate::payment::momo::MomoProvider;
use crate::payment::vietqr::VietQrProvider;
use crate::payment::vnpay::VnpayProvider;
use crate::payment::zalopay::ZalopayProvider;
use crate::service::{BookingService, PaymentService};
use crate::store::CompositeStore;

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Seed one trip with `n` bookable seats on a route with two stops; returns
/// (trip_id, seat_ids, (boarding stop, drop-off stop)).
pub(crate) async fn seed_trip_with_seats(
    store: &crate::store::CompositeStore,
    n: usize,
) -> (Uuid, Vec<Uuid>, (Uuid, Uuid)) {
    use crate::entity::{bus_layout, pickup_point, route, schedule, seat};
    use sea_orm::ActiveModelTrait;
    let now = crate::store::now_iso();
    let db = store.db();

    let brand_id = Uuid::new_v4();
    crate::entity::brand::ActiveModel {
        id: Set(brand_id),
        slug: Set(format!("seed-{}", brand_id.simple())),
        name: Set("Seed Brand".into()),
        status: Set("active".into()),
        total_trips: Set(0),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
        ..Default::default()
    }
    .insert(db)
    .await
    .unwrap();

    let layout_id = Uuid::new_v4();
    bus_layout::ActiveModel {
        id: Set(layout_id),
        brand_id: Set(Some(brand_id)),
        name: Set(Some("Seed Layout".into())),
        total_seats: Set(Some(n as i16)),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
        ..Default::default()
    }
    .insert(db)
    .await
    .unwrap();

    let mut seat_ids = Vec::with_capacity(n);
    for i in 0..n {
        let sid = Uuid::new_v4();
        seat::ActiveModel {
            id: Set(sid),
            bus_layout_id: Set(layout_id),
            seat_label: Set(format!("{}{}", char::from(b'A' + i as u8), 1)),
            is_window: Set(false),
            floor: Set(1),
            created_at: Set(now.clone()),
            ..Default::default()
        }
        .insert(db)
        .await
        .unwrap();
        seat_ids.push(sid);
    }

    let route_id = Uuid::new_v4();
    route::ActiveModel {
        id: Set(route_id),
        brand_id: Set(Some(brand_id)),
        name: Set("Hà Nội - Đà Nẵng".into()),
        start_location_id: Set("ha-noi".into()),
        end_location_id: Set("da-nang".into()),
        status: Set("active".into()),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
    }
    .insert(db)
    .await
    .unwrap();

    let mut stops = Vec::new();
    for (order, name) in [(1, "Bến xe Giáp Bát"), (2, "Bến xe Trung tâm Đà Nẵng")] {
        let id = Uuid::new_v4();
        pickup_point::ActiveModel {
            id: Set(id),
            route_id: Set(route_id),
            name: Set(Some(name.into())),
            stop_order: Set(order),
            created_at: Set(now.clone()),
            ..Default::default()
        }
        .insert(db)
        .await
        .unwrap();
        stops.push(id);
    }

    let schedule_id = Uuid::new_v4();
    schedule::ActiveModel {
        id: Set(schedule_id),
        route_id: Set(route_id),
        departure_time: Set("08:30".into()),
        days_of_week: Set(Some("1111111".into())),
        bus_layout_id: Set(Some(layout_id)),
        base_price_adult: Set(350_000),
        created_at: Set(now.clone()),
        ..Default::default()
    }
    .insert(db)
    .await
    .unwrap();

    let trip_id = Uuid::new_v4();
    trip_session::ActiveModel {
        id: Set(trip_id),
        schedule_id: Set(schedule_id),
        departure_date: Set((chrono::Utc::now() + chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string()),
        status: Set("scheduled".into()),
        total_seats: Set(n as i64),
        available_seats: Set(n as i64),
        created_at: Set(now.clone()),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(db)
    .await
    .unwrap();

    let inv: Vec<seat_inventory::ActiveModel> = seat_ids
        .iter()
        .map(|&sid| seat_inventory::ActiveModel {
            id: Set(Uuid::new_v4()),
            trip_session_id: Set(trip_id),
            seat_id: Set(sid),
            status: Set("available".into()),
            base_price: Set(350_000),
            final_price: Set(350_000),
            currency: Set("VND".into()),
            created_at: Set(crate::store::now_iso()),
            updated_at: Set(crate::store::now_iso()),
            ..Default::default()
        })
        .collect();
    store
        .trip_store()
        .insert_seat_inventories_batch(inv)
        .await
        .unwrap();

    (trip_id, seat_ids, (stops[0], stops[1]))
}

pub(crate) fn hold_req(trip_id: Uuid, seat_ids: Vec<Uuid>, stops: (Uuid, Uuid)) -> HoldReq {
    use crate::dto::booking::PassengerReq;
    HoldReq {
        trip_id,
        seat_ids: seat_ids.clone(),
        passengers: seat_ids
            .iter()
            .map(|_| PassengerReq {
                name: "Nguyễn Văn A".into(),
                passenger_type: None,
                age: Some(30),
                seat_id: None,
            })
            .collect(),
        boarding_point_id: Some(stops.0),
        dropping_point_id: Some(stops.1),
        contact_name: "Nguyễn Văn A".into(),
        contact_phone: "0912345678".into(),
        contact_email: None,
        campaign_code: None,
    }
}

pub(crate) struct Fixture {
    pub(crate) store: Arc<CompositeStore>,
    pub(crate) svc: Arc<BookingService>,
    pub(crate) payments: PaymentService,
    pub(crate) trip: Uuid,
    pub(crate) seats: Vec<Uuid>,
    /// (boarding stop, drop-off stop) of the trip's route.
    pub(crate) stops: (Uuid, Uuid),
}

pub(crate) async fn fixture(seats: usize) -> Fixture {
    use sea_orm_migration::MigratorTrait;
    let store = CompositeStore::in_memory().await;
    migrator::Migrator::up(store.db(), None).await.unwrap();
    let svc = Arc::new(BookingService::new(store.clone()));
    let (trip, seats, stops) = seed_trip_with_seats(&store, seats).await;
    let cfg = Arc::new(PaymentConfig {
        cod_enabled: true,
        ..PaymentConfig::default()
    });
    let payments = PaymentService::new(
        store.clone(),
        svc.clone(),
        cfg.clone(),
        Arc::new(VnpayProvider::new(&cfg.vnpay)),
        Arc::new(MomoProvider::new(&cfg.momo)),
        Arc::new(ZalopayProvider::new(&cfg.zalopay)),
        Arc::new(VietQrProvider::new(&cfg.vietqr)),
        Arc::new(CodProvider::new()),
    );
    Fixture {
        store,
        svc,
        payments,
        trip,
        seats,
        stops,
    }
}

impl Fixture {
    pub(crate) async fn owner(&self) -> Uuid {
        self.store
            .user_store()
            .create_user(
                format!("{}@test.dev", Uuid::new_v4().simple()),
                "Tester".into(),
                "x".into(),
                "user".into(),
            )
            .await
            .unwrap()
            .id
    }

    /// Hold the first `n` seats for `owner`.
    pub(crate) async fn hold(&self, owner: Uuid, n: usize) -> BookingHoldResponse {
        self.svc
            .hold_with_user(
                owner,
                &hold_req(self.trip, self.seats[..n].to_vec(), self.stops),
            )
            .await
            .expect("hold")
    }

    /// `(available, held, booked)` seat counts and the trip's counter.
    pub(crate) async fn seats_now(&self) -> (usize, usize, usize, i64) {
        let rows = seat_inventory::Entity::find()
            .filter(seat_inventory::Column::TripSessionId.eq(self.trip))
            .all(self.store.db())
            .await
            .unwrap();
        let count = |s: &str| rows.iter().filter(|r| r.status == s).count();
        let counter = trip_session::Entity::find_by_id(self.trip)
            .one(self.store.db())
            .await
            .unwrap()
            .unwrap()
            .available_seats;
        (count("available"), count("held"), count("booked"), counter)
    }

    pub(crate) async fn booking(&self, id: Uuid) -> booking::Model {
        booking::Entity::find_by_id(id)
            .one(self.store.db())
            .await
            .unwrap()
            .unwrap()
    }

    /// Pretend the hold ran out `ago_secs` ago.
    pub(crate) async fn age_hold(&self, id: Uuid, ago_secs: i64) {
        booking::Entity::update_many()
            .col_expr(
                booking::Column::ExpiresAt,
                sea_orm::sea_query::Expr::value(Some(
                    (Utc::now() - chrono::Duration::seconds(ago_secs))
                        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                )),
            )
            .filter(booking::Column::Id.eq(id))
            .exec(self.store.db())
            .await
            .unwrap();
    }

    /// Make the trip leave `hours` from now (negative = already left).
    pub(crate) async fn depart_in(&self, hours: i64) {
        let at = (Utc::now() + chrono::Duration::hours(hours))
            .with_timezone(&chrono::FixedOffset::east_opt(7 * 3600).unwrap());
        let trip = trip_session::Entity::find_by_id(self.trip)
            .one(self.store.db())
            .await
            .unwrap()
            .unwrap();
        crate::entity::schedule::Entity::update_many()
            .col_expr(
                crate::entity::schedule::Column::DepartureTime,
                sea_orm::sea_query::Expr::value(at.format("%H:%M").to_string()),
            )
            .filter(crate::entity::schedule::Column::Id.eq(trip.schedule_id))
            .exec(self.store.db())
            .await
            .unwrap();
        trip_session::Entity::update_many()
            .col_expr(
                trip_session::Column::DepartureDate,
                sea_orm::sea_query::Expr::value(at.format("%Y-%m-%d").to_string()),
            )
            .filter(trip_session::Column::Id.eq(self.trip))
            .exec(self.store.db())
            .await
            .unwrap();
    }

    pub(crate) async fn payment(
        &self,
        booking: &BookingHoldResponse,
        owner: Uuid,
        status: &str,
    ) -> Uuid {
        let id = Uuid::new_v4();
        payment::ActiveModel {
            id: Set(id),
            booking_id: Set(booking.booking_id),
            user_id: Set(Some(owner)),
            provider: Set("vnpay".into()),
            status: Set(status.into()),
            amount: Set(booking.total),
            currency: Set("VND".into()),
            created_at: Set(now_iso()),
            updated_at: Set(now_iso()),
            provider_txn_ref: Set(format!("ref-{id}")),
            ..Default::default()
        }
        .insert(self.store.db())
        .await
        .unwrap();
        id
    }

    pub(crate) async fn payment_status(&self, id: Uuid) -> String {
        payment::Entity::find_by_id(id)
            .one(self.store.db())
            .await
            .unwrap()
            .unwrap()
            .status
    }
}

impl Fixture {
    pub(crate) async fn owner_of(&self, booking: Uuid) -> Uuid {
        self.booking(booking).await.user_id.unwrap()
    }

    pub(crate) async fn brand_of_trip(&self) -> Uuid {
        crate::entity::brand::Entity::find()
            .one(self.store.db())
            .await
            .unwrap()
            .unwrap()
            .id
    }
}
