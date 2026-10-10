//! Seat prices end to end: class fares, brand child tickets, seat
//! assignment and boarding points, on a real database.

use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use uuid::Uuid;

use crate::dto::booking::{HoldReq, PassengerReq};
use crate::entity::{
    booking_seat, brand, pickup_point, schedule, schedule_fare, seat, seat_inventory,
};
use crate::error::AppError;
use crate::service::fares;
use crate::service::test_support::{fixture, hold_req, Fixture};

const STANDARD: i64 = 350_000;
const VIP: i64 = 500_000;

impl Fixture {
    async fn schedule(&self) -> schedule::Model {
        schedule::Entity::find()
            .one(self.store.db())
            .await
            .unwrap()
            .unwrap()
    }

    /// Make the first seat VIP at [`VIP`] and re-price the trip.
    async fn vip_first_seat(&self) {
        let db = self.store.db();
        seat::Entity::update_many()
            .col_expr(
                seat::Column::SeatClass,
                sea_orm::sea_query::Expr::value("vip"),
            )
            .filter(seat::Column::Id.eq(self.seats[0]))
            .exec(db)
            .await
            .unwrap();
        let schedule = self.schedule().await;
        schedule_fare::ActiveModel {
            id: Set(Uuid::new_v4()),
            schedule_id: Set(schedule.id),
            seat_class: Set("vip".into()),
            price_adult: Set(VIP),
            price_child: Set(None),
            created_at: Set(String::new()),
            updated_at: Set(String::new()),
        }
        .insert(db)
        .await
        .unwrap();
        fares::reprice_upcoming(&self.store, &schedule)
            .await
            .unwrap();
    }

    async fn child_tickets(&self, max_age: i16, discount_percent: i16) {
        let mut brand: brand::ActiveModel = brand::Entity::find_by_id(self.brand_of_trip().await)
            .one(self.store.db())
            .await
            .unwrap()
            .unwrap()
            .into();
        brand.child_max_age = Set(Some(max_age));
        brand.child_discount_percent = Set(Some(discount_percent));
        brand.update(self.store.db()).await.unwrap();
    }

    async fn price_of(&self, seat_id: Uuid) -> i64 {
        seat_inventory::Entity::find()
            .filter(seat_inventory::Column::TripSessionId.eq(self.trip))
            .filter(seat_inventory::Column::SeatId.eq(seat_id))
            .one(self.store.db())
            .await
            .unwrap()
            .unwrap()
            .final_price
    }

    async fn tickets(&self, booking: Uuid) -> Vec<booking_seat::Model> {
        booking_seat::Entity::find()
            .filter(booking_seat::Column::BookingId.eq(booking))
            .all(self.store.db())
            .await
            .unwrap()
    }
}

fn passenger(age: i64, seat: Option<Uuid>, claimed: &str) -> PassengerReq {
    PassengerReq {
        name: "Trần Thị B".into(),
        passenger_type: Some(claimed.into()),
        age: Some(age),
        seat_id: seat,
    }
}

fn two_passengers(f: &Fixture, passengers: Vec<PassengerReq>) -> HoldReq {
    HoldReq {
        passengers,
        ..hold_req(f.trip, f.seats[..2].to_vec(), f.stops)
    }
}

#[tokio::test]
async fn class_fares_reprice_unsold_seats_only() {
    let f = fixture(3).await;
    let owner = f.owner().await;
    // Seat 2 is held before the fare changes and keeps its price.
    let held = f
        .svc
        .hold_with_user(owner, &hold_req(f.trip, vec![f.seats[1]], f.stops))
        .await
        .unwrap();
    f.vip_first_seat().await;
    seat::Entity::update_many()
        .col_expr(
            seat::Column::SeatClass,
            sea_orm::sea_query::Expr::value("vip"),
        )
        .filter(seat::Column::Id.eq(f.seats[1]))
        .exec(f.store.db())
        .await
        .unwrap();
    fares::reprice_upcoming(&f.store, &f.schedule().await)
        .await
        .unwrap();

    assert_eq!(f.price_of(f.seats[0]).await, VIP);
    assert_eq!(f.price_of(f.seats[1]).await, STANDARD);
    assert_eq!(f.price_of(f.seats[2]).await, STANDARD);
    assert_eq!(held.total, STANDARD);
}

#[tokio::test]
async fn each_passenger_pays_for_their_own_seat_and_age() {
    let f = fixture(2).await;
    f.vip_first_seat().await;
    f.child_tickets(10, 25).await;
    let owner = f.owner().await;

    // The child sits in the VIP seat although listed second; the claimed
    // passenger types are wrong on purpose and must be ignored.
    let req = two_passengers(
        &f,
        vec![
            passenger(35, Some(f.seats[1]), "child"),
            passenger(7, Some(f.seats[0]), "adult"),
        ],
    );
    let held = f.svc.hold_with_user(owner, &req).await.unwrap();

    // VIP 500,000 less 25 % = 375,000 for the child; 350,000 for the adult.
    assert_eq!(held.subtotal, 375_000 + STANDARD);
    let booking = f.booking(held.booking_id).await;
    assert_eq!((booking.adult_count, booking.child_count), (1, 1));
    let mut tickets = f.tickets(held.booking_id).await;
    tickets.sort_by_key(|t| t.price);
    assert_eq!(tickets[0].seat_id, f.seats[1]);
    assert_eq!(tickets[0].passenger_type.as_deref(), Some("adult"));
    assert_eq!(tickets[1].seat_id, f.seats[0]);
    assert_eq!(tickets[1].passenger_type.as_deref(), Some("child"));
    assert_eq!(tickets[1].price, 375_000);
}

#[tokio::test]
async fn without_a_child_policy_children_pay_the_adult_fare() {
    let f = fixture(2).await;
    let owner = f.owner().await;
    let req = two_passengers(
        &f,
        vec![passenger(4, None, "child"), passenger(40, None, "adult")],
    );
    let held = f.svc.hold_with_user(owner, &req).await.unwrap();
    assert_eq!(held.subtotal, 2 * STANDARD);
    assert_eq!(f.booking(held.booking_id).await.child_count, 0);
}

#[tokio::test]
async fn a_passenger_cannot_take_a_seat_twice_or_one_outside_the_hold() {
    let f = fixture(3).await;
    let owner = f.owner().await;
    for seats in [
        [Some(f.seats[0]), Some(f.seats[0])],
        [Some(f.seats[0]), Some(f.seats[2])],
    ] {
        let req = two_passengers(
            &f,
            seats.iter().map(|&s| passenger(30, s, "adult")).collect(),
        );
        let err = f.svc.hold_with_user(owner, &req).await.unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }
    assert_eq!(f.seats_now().await.0, 3, "nothing was held");
}

#[tokio::test]
async fn boarding_points_must_be_stops_of_the_route() {
    let f = fixture(1).await;
    let owner = f.owner().await;
    let elsewhere = HoldReq {
        boarding_point_id: Some(Uuid::new_v4()),
        ..hold_req(f.trip, vec![f.seats[0]], f.stops)
    };
    let missing = HoldReq {
        dropping_point_id: None,
        ..hold_req(f.trip, vec![f.seats[0]], f.stops)
    };
    for req in [elsewhere, missing] {
        let err = f.svc.hold_with_user(owner, &req).await.unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }
}

#[tokio::test]
async fn a_route_without_pickup_points_books_without_them() {
    let f = fixture(1).await;
    for stop in [f.stops.0, f.stops.1] {
        pickup_point::Entity::delete_by_id(stop)
            .exec(f.store.db())
            .await
            .unwrap();
    }
    let req = HoldReq {
        boarding_point_id: None,
        dropping_point_id: None,
        ..hold_req(f.trip, vec![f.seats[0]], f.stops)
    };
    let held = f.svc.hold_with_user(f.owner().await, &req).await.unwrap();
    assert_eq!(held.total, STANDARD);
    // The ticket names the route's cities instead.
    let ticket = f
        .svc
        .detail(f.owner_of(held.booking_id).await, &held.code)
        .await
        .unwrap();
    assert_eq!(ticket.pickup.unwrap().name, "Hà Nội");
    assert_eq!(ticket.dropoff.unwrap().name, "Đà Nẵng");
}
