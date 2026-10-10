//! A ticket's life end to end: placed by the customer, confirmed by staff
//! after a phone call, completed or cancelled — and what each side sees.

use sea_orm::EntityTrait;
use uuid::Uuid;

use crate::dto::admin::{AdminBookingsQuery, UpdateBookingStatusRequest};
use crate::error::AppError;
use crate::service::test_support::{fixture, hold_req, Fixture};
use crate::service::{trip_time, AdminService};

fn staff(f: &Fixture) -> AdminService {
    AdminService::new(f.store.clone())
}

async fn set(f: &Fixture, id: Uuid, status: &str) -> Result<String, AppError> {
    let body = UpdateBookingStatusRequest {
        status: status.into(),
        reason: Some("called the customer".into()),
    };
    Ok(staff(f)
        .update_booking_status(f.owner().await, id, &body)
        .await?
        .item
        .status)
}

fn tickets(status: &str) -> AdminBookingsQuery {
    AdminBookingsQuery {
        status: Some(status.into()),
        ..Default::default()
    }
}

#[tokio::test]
async fn staff_confirm_a_placed_ticket_and_its_seats_become_booked() {
    let f = fixture(2).await;
    let owner = f.owner().await;
    let held = f.hold(owner, 2).await;
    f.svc.place_cash(owner, held.booking_id).await.unwrap();

    let awaiting = staff(&f).list_bookings(&tickets("awaiting")).await.unwrap();
    assert_eq!(awaiting.total, 1);
    assert_eq!(awaiting.items[0].code, held.code);

    assert_eq!(
        set(&f, held.booking_id, "confirmed").await.unwrap(),
        "confirmed"
    );
    assert_eq!(f.seats_now().await, (0, 0, 2, 0));
    let awaiting = staff(&f).list_bookings(&tickets("awaiting")).await.unwrap();
    assert_eq!(awaiting.total, 0);
}

#[tokio::test]
async fn completed_and_cancelled_tickets_are_final() {
    let f = fixture(2).await;
    let owner = f.owner().await;
    let done = f.hold(owner, 1).await;
    f.svc.place_cash(owner, done.booking_id).await.unwrap();
    set(&f, done.booking_id, "confirmed").await.unwrap();
    let dropped = f
        .svc
        .hold_with_user(owner, &hold_req(f.trip, vec![f.seats[1]], f.stops))
        .await
        .unwrap();
    f.svc.place_cash(owner, dropped.booking_id).await.unwrap();
    f.svc.cancel(owner, dropped.booking_id, None).await.unwrap();

    // Completing is final, so not before the trip has left.
    let err = set(&f, done.booking_id, "completed").await.unwrap_err();
    assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    f.depart_in(-1).await;
    assert_eq!(
        set(&f, done.booking_id, "completed").await.unwrap(),
        "completed"
    );

    for id in [done.booking_id, dropped.booking_id] {
        for status in ["confirmed", "completed", "cancelled", "pending"] {
            let err = set(&f, id, status).await.unwrap_err();
            assert!(matches!(err, AppError::Conflict(_)), "{status}: {err:?}");
        }
    }
}

#[tokio::test]
async fn staff_cancel_frees_the_seats_and_skipping_steps_is_refused() {
    let f = fixture(2).await;
    let owner = f.owner().await;
    let held = f.hold(owner, 2).await;
    f.svc.place_cash(owner, held.booking_id).await.unwrap();

    let err = set(&f, held.booking_id, "completed").await.unwrap_err();
    assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");

    assert_eq!(
        set(&f, held.booking_id, "cancelled").await.unwrap(),
        "cancelled"
    );
    assert_eq!(f.seats_now().await, (2, 0, 0, 2));
}

#[tokio::test]
async fn customers_see_tickets_with_stops_and_seat_numbers_not_unfinished_checkouts() {
    let f = fixture(3).await;
    let owner = f.owner().await;
    let abandoned = f.hold(owner, 1).await;
    let placed = f
        .svc
        .hold_with_user(owner, &hold_req(f.trip, f.seats[1..].to_vec(), f.stops))
        .await
        .unwrap();
    f.svc.place_cash(owner, placed.booking_id).await.unwrap();

    let mine = f.svc.list(owner, 50, 0).await.unwrap().items;
    assert_eq!(mine.len(), 1, "the unfinished checkout is not a ticket");
    let ticket = &mine[0];
    assert_ne!(ticket.id, abandoned.booking_id);
    assert!(ticket.can_cancel);
    assert_eq!(ticket.pickup.as_ref().unwrap().name, "Bến xe Giáp Bát");
    assert_eq!(
        ticket.dropoff.as_ref().unwrap().name,
        "Bến xe Trung tâm Đà Nẵng"
    );
    let codes: Vec<_> = ticket
        .seats
        .iter()
        .map(|s| s.seat_code.clone().unwrap())
        .collect();
    assert_eq!(codes, ["B1", "C1"]);
    assert!(ticket.trip.as_ref().unwrap().departure_at.is_some());

    // The detail by code is the same ticket, and only its owner may read it.
    let by_code = f
        .svc
        .detail(owner, &ticket.code.to_lowercase())
        .await
        .unwrap();
    assert_eq!(by_code.id, ticket.id);
    assert!(ticket.ticket_qr.is_none(), "lists carry no QR");
    assert!(by_code
        .ticket_qr
        .as_deref()
        .is_some_and(|qr| qr.starts_with("data:image/svg+xml;base64,")));
    let err = f
        .svc
        .detail(f.owner().await, &ticket.code)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Forbidden(_)), "{err:?}");
}

#[tokio::test]
async fn staff_filter_and_report_tickets_not_unfinished_checkouts() {
    let f = fixture(3).await;
    let owner = f.owner().await;
    let confirmed = f.hold(owner, 1).await;
    f.svc.place_cash(owner, confirmed.booking_id).await.unwrap();
    set(&f, confirmed.booking_id, "confirmed").await.unwrap();
    let dropped = f
        .svc
        .hold_with_user(owner, &hold_req(f.trip, vec![f.seats[1]], f.stops))
        .await
        .unwrap();
    f.svc.place_cash(owner, dropped.booking_id).await.unwrap();
    f.svc.cancel(owner, dropped.booking_id, None).await.unwrap();
    f.svc
        .hold_with_user(owner, &hold_req(f.trip, vec![f.seats[2]], f.stops))
        .await
        .unwrap();

    let staff = staff(&f);
    let count = |q: AdminBookingsQuery| {
        let staff = &staff;
        async move { staff.list_bookings(&q).await.map(|page| page.total) }
    };
    assert_eq!(
        count(tickets("all")).await.unwrap(),
        2,
        "an unfinished checkout is not a ticket"
    );

    // Brand and route reach the bookings through their trips.
    let route = crate::entity::route::Entity::find()
        .one(f.store.db())
        .await
        .unwrap()
        .unwrap()
        .id;
    let brand = f.brand_of_trip().await;
    let by = |brand_id, route_id| AdminBookingsQuery {
        brand_id,
        route_id,
        ..Default::default()
    };
    assert_eq!(count(by(Some(brand), None)).await.unwrap(), 2);
    assert_eq!(count(by(None, Some(route))).await.unwrap(), 2);
    assert_eq!(count(by(Some(Uuid::new_v4()), None)).await.unwrap(), 0);
    assert_eq!(count(by(None, Some(Uuid::new_v4()))).await.unwrap(), 0);

    // Dates are the Vietnamese days the tickets were booked on.
    let today = trip_time::local_today();
    let yesterday = (chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d").unwrap()
        - chrono::Duration::days(1))
    .to_string();
    let booked = |from: &str, to: &str| AdminBookingsQuery {
        date_from: Some(from.into()),
        date_to: Some(to.into()),
        ..Default::default()
    };
    assert_eq!(count(booked(&today, &today)).await.unwrap(), 2);
    assert_eq!(count(booked(&yesterday, &yesterday)).await.unwrap(), 0);
    let err = count(booked("09/10/2026", &today)).await.unwrap_err();
    assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");

    let cheapest_first = staff
        .list_bookings(&AdminBookingsQuery {
            sort: Some("total_asc".into()),
            ..Default::default()
        })
        .await
        .unwrap()
        .items;
    assert!(cheapest_first[0].total <= cheapest_first[1].total);

    // Revenue is what the confirmed ticket brings; the cancelled one counts
    // as a ticket but not as money.
    let stats = staff.booking_stats(&tickets("all")).await.unwrap();
    let t = &stats.totals;
    assert_eq!((t.total, t.confirmed, t.cancelled, t.pending), (2, 1, 1, 0));
    assert_eq!(t.revenue, f.booking(confirmed.booking_id).await.total);
    assert_eq!(stats.by_day.len(), 1);
    assert_eq!(stats.by_day[0].date, today);
    assert_eq!(stats.by_day[0].revenue, t.revenue);
}
