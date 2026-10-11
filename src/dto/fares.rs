//! Fares on the wire: what a seat class costs, and a brand's child-ticket
//! rule. The rules themselves live in [`crate::service::fares`].

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use validator::Validate;

/// A brand's child tickets: passengers up to `maxAge` pay a child price.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct ChildFarePolicy {
    /// Oldest age (inclusive) that travels on a child ticket.
    #[validate(range(min = 1, max = 17))]
    pub max_age: i16,
    /// VND off the adult price, where the schedule sets no child price
    /// (a child never pays less than 0).
    #[validate(range(min = 0, max = 100_000_000))]
    pub discount_amount: i64,
}

/// What one seat class costs on a schedule. Standard seats use the
/// schedule's base prices instead.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct SeatClassFare {
    /// `vip`, `premium`, `bed_lower`, `bed_upper`, …
    #[validate(length(min = 1, max = 30))]
    pub seat_class: String,
    #[validate(range(min = 0, max = 1_000_000_000))]
    pub price_adult: i64,
    /// Overrides the brand's child discount for this class.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[validate(range(min = 0, max = 1_000_000_000))]
    pub price_child: Option<i64>,
}

/// How many seats of one class a layout has.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SeatClassCount {
    /// `standard` for seats without a class.
    pub seat_class: String,
    pub seats: i64,
}
