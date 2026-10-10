//! What a seat costs.
//!
//! Each schedule prices its own seats, so the same vehicle can cost more on
//! one route than another. Standard seats, and seats of any class without a
//! fare of its own, cost `schedule.base_price_adult`. A `schedule_fare` row
//! prices one other class (`vip`, `premium`, `bed_upper`, …).
//!
//! Child tickets are the brand's choice. When the brand sets
//! `child_max_age`, passengers up to that age pay the class's child price
//! if the schedule sets one, and otherwise the adult price less
//! `child_discount_percent`, rounded to the nearest 1,000 ₫. A child never
//! pays more than an adult.
//!
//! The server alone applies these rules: the passenger type a client sends
//! is ignored, only the age counts.

use std::collections::HashMap;

use uuid::Uuid;

use crate::dto::fares::{ChildFarePolicy, SeatClassFare};
use crate::entity::{brand, schedule, schedule_fare, seat};
use crate::error::{AppError, AppResult};
use crate::service::trip_time;
use crate::store::CompositeStore;

/// The class of seats that have none.
pub const STANDARD: &str = "standard";

/// Longest seat class name (`seat.seat_class` is `VARCHAR(30)`).
pub const MAX_CLASS_CHARS: usize = 30;

/// Oldest age a brand may treat as a child.
pub const MAX_CHILD_AGE: i16 = 17;

/// A brand's child-ticket rule.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChildPolicy {
    /// Passengers up to this age (inclusive) are children.
    pub max_age: i16,
    /// Percent off the adult price when the schedule sets no child price.
    pub discount_percent: i16,
}

impl ChildPolicy {
    /// The brand's policy; `None` when it sells no child tickets.
    pub fn of(brand: &brand::Model) -> Option<Self> {
        Some(Self {
            max_age: brand.child_max_age?,
            discount_percent: brand.child_discount_percent.unwrap_or(0),
        })
    }

    pub fn covers(self, age: i64) -> bool {
        age <= i64::from(self.max_age)
    }
}

impl From<ChildPolicy> for ChildFarePolicy {
    fn from(p: ChildPolicy) -> Self {
        Self {
            max_age: p.max_age,
            discount_percent: p.discount_percent,
        }
    }
}

/// The price of one seat class on one schedule.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Fare {
    pub adult: i64,
    /// Overrides the brand's child discount.
    pub child: Option<i64>,
}

/// Every fare of one schedule.
#[derive(Clone, Debug, Default)]
pub struct FareTable {
    standard: Fare,
    classes: HashMap<String, Fare>,
}

impl FareTable {
    pub fn new(schedule: &schedule::Model, rows: &[schedule_fare::Model]) -> Self {
        Self {
            standard: Fare {
                adult: schedule.base_price_adult,
                child: schedule.base_price_child,
            },
            classes: rows
                .iter()
                .filter(|r| r.schedule_id == schedule.id)
                .map(|r| {
                    let fare = Fare {
                        adult: r.price_adult,
                        child: r.price_child,
                    };
                    (r.seat_class.clone(), fare)
                })
                .collect(),
        }
    }

    /// The fare of a seat of `class`: its own, or the standard one.
    pub fn fare(&self, class: Option<&str>) -> Fare {
        class
            .and_then(|c| self.classes.get(c))
            .copied()
            .unwrap_or(self.standard)
    }

    /// A schedule's fares, read from the store.
    pub async fn load(store: &CompositeStore, schedule: &schedule::Model) -> AppResult<Self> {
        let rows = store
            .schedule_store()
            .list_fares(vec![schedule.id])
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(Self::new(schedule, &rows))
    }
}

/// The class a seat is priced and shown by.
pub fn class_of(seat: &seat::Model) -> String {
    normalize_class(seat.seat_class.as_deref()).unwrap_or_else(|| STANDARD.into())
}

/// Wire form of a schedule's class fares, cheapest first.
pub fn class_fares_out(rows: &[schedule_fare::Model]) -> Vec<SeatClassFare> {
    let mut out: Vec<SeatClassFare> = rows
        .iter()
        .map(|r| SeatClassFare {
            seat_class: r.seat_class.clone(),
            price_adult: r.price_adult,
            price_child: r.price_child,
        })
        .collect();
    out.sort_by(|a, b| (a.price_adult, &a.seat_class).cmp(&(b.price_adult, &b.seat_class)));
    out
}

/// Bring the seats still for sale on the schedule's upcoming trips in line
/// with its fares. Held and sold seats keep their price. Returns the number
/// of seats re-priced.
pub async fn reprice_upcoming(
    store: &CompositeStore,
    schedule: &schedule::Model,
) -> AppResult<u64> {
    let Some(layout_id) = schedule.bus_layout_id else {
        return Ok(0);
    };
    let internal = |e: crate::store::StoreError| AppError::Internal(e.to_string());
    let trips = store
        .trip_store()
        .list_trips_of_schedule_from(schedule.id, &trip_time::local_today())
        .await
        .map_err(internal)?;
    if trips.is_empty() {
        return Ok(0);
    }
    let trip_ids: Vec<Uuid> = trips.iter().map(|t| t.id).collect();
    let seats = store
        .trip_store()
        .list_seats_by_bus_layout_id(&layout_id.to_string())
        .await
        .map_err(internal)?;
    let fares = FareTable::load(store, schedule).await?;

    let mut by_price: HashMap<i64, Vec<Uuid>> = HashMap::new();
    for seat in &seats {
        let price = fares.fare(Some(&class_of(seat))).adult;
        by_price.entry(price).or_default().push(seat.id);
    }
    let mut repriced = 0;
    for (price, seat_ids) in by_price {
        repriced += store
            .trip_store()
            .reprice_available_seats(trip_ids.clone(), seat_ids, price)
            .await
            .map_err(internal)?;
    }
    Ok(repriced)
}

/// Who a ticket is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Passenger {
    Adult,
    Child,
}

impl Passenger {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Adult => "adult",
            Self::Child => "child",
        }
    }
}

/// What a child pays for a seat sold to adults at `adult` — the seat's
/// current price, which is the fare unless the trip was priced earlier.
/// `None` when the brand sells no child tickets.
pub fn child_price(adult: i64, fare: Fare, policy: Option<ChildPolicy>) -> Option<i64> {
    let policy = policy?;
    let price = fare
        .child
        .unwrap_or_else(|| round_vnd(adult * i64::from(100 - policy.discount_percent) / 100));
    Some(price.clamp(0, adult))
}

/// The ticket for a passenger of `age` in a seat sold to adults at `adult`.
pub fn ticket(age: i64, adult: i64, fare: Fare, policy: Option<ChildPolicy>) -> (Passenger, i64) {
    match child_price(adult, fare, policy.filter(|p| p.covers(age))) {
        Some(price) => (Passenger::Child, price),
        None => (Passenger::Adult, adult),
    }
}

/// Nearest 1,000 ₫ (prices are quoted in thousands).
fn round_vnd(amount: i64) -> i64 {
    (amount + 500).div_euclid(1000) * 1000
}

/// A seat class as stored: trimmed and lower-case; `None` for standard.
pub fn normalize_class(class: Option<&str>) -> Option<String> {
    let class = class?.trim().to_lowercase();
    (!class.is_empty() && class != STANDARD).then_some(class)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    const POLICY: ChildPolicy = ChildPolicy {
        max_age: 10,
        discount_percent: 25,
    };

    fn table() -> FareTable {
        let id = Uuid::new_v4();
        let schedule = schedule::Model {
            id,
            route_id: Uuid::new_v4(),
            departure_time: "08:00".into(),
            effective_from: None,
            effective_to: None,
            days_of_week: None,
            bus_layout_id: None,
            base_price_adult: 300_000,
            base_price_child: None,
            amenities: None,
            created_at: String::new(),
            vehicle_type_id: None,
        };
        let row = |class: &str, adult, child| schedule_fare::Model {
            id: Uuid::new_v4(),
            schedule_id: id,
            seat_class: class.into(),
            price_adult: adult,
            price_child: child,
            created_at: String::new(),
            updated_at: String::new(),
        };
        FareTable::new(
            &schedule,
            &[
                row("vip", 450_000, None),
                row("premium", 380_000, Some(250_000)),
            ],
        )
    }

    #[test]
    fn classes_fall_back_to_the_standard_fare() {
        let fares = table();
        assert_eq!(fares.fare(None).adult, 300_000);
        assert_eq!(fares.fare(Some("vip")).adult, 450_000);
        assert_eq!(fares.fare(Some("bed_upper")).adult, 300_000);
    }

    #[test]
    fn no_policy_means_everyone_pays_the_adult_fare() {
        let fare = table().fare(Some("vip"));
        assert_eq!(
            ticket(4, fare.adult, fare, None),
            (Passenger::Adult, 450_000)
        );
    }

    #[test]
    fn children_get_the_brand_discount_rounded_to_a_thousand() {
        let fare = table().fare(Some("vip"));
        // 450,000 less 25 % = 337,500 → 338,000.
        assert_eq!(
            ticket(10, fare.adult, fare, Some(POLICY)),
            (Passenger::Child, 338_000)
        );
        // One year past the limit is an adult.
        assert_eq!(
            ticket(11, fare.adult, fare, Some(POLICY)),
            (Passenger::Adult, 450_000)
        );
    }

    #[test]
    fn a_class_child_price_beats_the_discount_but_never_the_adult_price() {
        let fares = table();
        let premium = fares.fare(Some("premium"));
        assert_eq!(ticket(5, premium.adult, premium, Some(POLICY)).1, 250_000);
        // A seat still sold at an older, lower price caps the child price.
        assert_eq!(ticket(5, 200_000, premium, Some(POLICY)).1, 200_000);
    }

    #[test]
    fn a_full_discount_makes_children_free() {
        let fare = table().fare(None);
        let free = ChildPolicy {
            discount_percent: 100,
            ..POLICY
        };
        assert_eq!(
            ticket(3, fare.adult, fare, Some(free)),
            (Passenger::Child, 0)
        );
    }

    #[test]
    fn classes_are_normalized() {
        assert_eq!(normalize_class(Some(" VIP ")), Some("vip".into()));
        assert_eq!(normalize_class(Some("Standard")), None);
        assert_eq!(normalize_class(Some("")), None);
        assert_eq!(normalize_class(None), None);
    }
}
